import crypto from 'node:crypto';
import sharp from 'sharp';
import { encryptToken, decryptToken } from './db.js';
import { botCall, safeTelegramError } from './telegram.js';
import { sendFormatted } from './sender.js';

const idPattern = /^-?\d+$/;
const sameSecret = (a, b) => {
  const left = Buffer.from(String(a || '')), right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};
const clamp = (value, fallback, max) => Math.min(max, Math.max(1, Number(value) || fallback));

export async function saveIncoming(db, botId, update) {
  const message = update?.message || update?.edited_message;
  if (!message?.chat || !idPattern.test(String(message.chat.id)) || !Number.isSafeInteger(message.message_id)) return false;
  const edited = Boolean(update.edited_message), chatId = String(message.chat.id);
  const from = message.from || {};
  const title = String(message.chat.title || [from.first_name, from.last_name].filter(Boolean).join(' ') || message.chat.username || chatId).slice(0, 200);
  const body = String(message.text || message.caption || '').slice(0, 4096);
  const kind = message.photo ? 'photo' : message.video ? 'video' : message.document ? 'document' : null;
  const fileId = kind === 'photo' ? message.photo.at(-1)?.file_id : kind ? message[kind]?.file_id : null;
  const at = Number(message.edit_date || message.date || Math.floor(Date.now() / 1000)) * 1000;
  return await db.transaction(async () => {
    const now = Date.now();
    await db.prepare(`INSERT INTO conversations(bot_id,chat_id,chat_type,title,username,updated_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(bot_id,chat_id) DO UPDATE SET
      chat_type=excluded.chat_type,title=excluded.title,username=excluded.username,updated_at=excluded.updated_at`)
      .run(botId,chatId,String(message.chat.type || 'private'),title,String(message.chat.username || from.username || ''),now);
    if (edited) {
      const result = await db.prepare(`UPDATE chat_messages SET text=?,entities_json=?,media_kind=?,file_id=?,edited_at=?
        WHERE bot_id=? AND chat_id=? AND telegram_message_id=?`)
        .run(body,JSON.stringify(message.entities || message.caption_entities || []),kind,fileId || null,at,botId,chatId,String(message.message_id));
      if (result.changes) await db.prepare(`UPDATE conversations SET last_message_text=? WHERE bot_id=? AND chat_id=? AND last_message_id=?`)
        .run(body || `[${kind || '消息'}]`,botId,chatId,String(message.message_id));
      if (result.changes) await db.prepare('INSERT INTO chat_events(bot_id,chat_id,created_at) VALUES(?,?,?)').run(botId,chatId,now);
      return Boolean(result.changes);
    }
    const inserted = (await db.prepare(`INSERT OR IGNORE INTO chat_messages(bot_id,chat_id,telegram_message_id,direction,from_id,text,entities_json,media_kind,file_id,reply_to_message_id,sent_at)
      VALUES(?,?,?,'IN',?,?,?,?,?,?,?)`).run(botId,chatId,String(message.message_id),String(from.id || ''),body,
        JSON.stringify(message.entities || message.caption_entities || []),kind,fileId || null,
        message.reply_to_message?.message_id ? String(message.reply_to_message.message_id) : null,at)).changes;
    if (inserted) await db.prepare(`UPDATE conversations SET last_message_id=?,last_message_text=?,last_message_at=?,unread_count=unread_count+1,updated_at=?
      WHERE bot_id=? AND chat_id=? AND last_message_at<=?`).run(String(message.message_id),body || `[${kind || '消息'}]`,at,now,botId,chatId,at);
    if (inserted) await db.prepare('INSERT INTO chat_events(bot_id,chat_id,created_at) VALUES(?,?,?)').run(botId,chatId,now);
    return Boolean(inserted);
  })();
}

export function registerChatRoutes(app, { db, scheduler, configKey, publicUrl, botApi = botCall, publisherFor }) {
  const ownUrl = id => `${String(publicUrl || '').replace(/\/$/, '')}/tg/publisher/${id}`;
  const botFor = async req => publisherFor ? publisherFor(req) : await scheduler.publisher(req.get('x-publisher-id') || undefined);
  const currentId = async req => (await botFor(req))?.id || '';
  const inbox = async id => await db.prepare('SELECT * FROM publisher_inbox WHERE bot_id=?').get(id);
  const botAvatars = new Map();
  const missingChatAvatars = new Map();
  const missingChatAvatarTtl = 6 * 60 * 60_000;
  async function avatarBotCall(bot, method, payload) {
    try { return await botApi(bot.token,method,payload); }
    catch (error) {
      console.warn(`Bot avatar ${method} failed for ${bot.id}:`,safeTelegramError(error));
      if (method==='getUserProfilePhotos' && error.telegramCode===401) {
        try { await botApi(bot.token,'getMe');console.warn(`Bot avatar getMe succeeded for ${bot.id}`); }
        catch (checkError) { console.warn(`Bot avatar getMe failed for ${bot.id}:`,safeTelegramError(checkError)); }
      }
      throw error;
    }
  }
  const wrapper = fn => async (req,res,next) => { try { await fn(req,res); } catch (error) { next(error); } };
  async function refreshAvatar(bot, chatId) {
    const key = bot.id + ':' + chatId;
    if ((missingChatAvatars.get(key) || 0) > Date.now()) return false;
    const chat = await botApi(bot.token, 'getChat', { chat_id: String(chatId) });
    const fileId = chat?.photo?.big_file_id || chat?.photo?.small_file_id || null;
    if (fileId) {
      await db.prepare('UPDATE conversations SET avatar_file_id=? WHERE bot_id=? AND chat_id=?').run(fileId,bot.id,String(chatId));
      missingChatAvatars.delete(key);
      return true;
    }
    missingChatAvatars.set(key, Date.now() + missingChatAvatarTtl);
    while (missingChatAvatars.size > 1000) missingChatAvatars.delete(missingChatAvatars.keys().next().value);
    return false;
  }
  async function setState(id, status, enabled, error = null) {
    await db.prepare(`INSERT INTO publisher_inbox(bot_id,webhook_status,enabled,last_error,checked_at) VALUES(?,?,?,?,?)
      ON CONFLICT(bot_id) DO UPDATE SET webhook_status=excluded.webhook_status,enabled=excluded.enabled,last_error=excluded.last_error,checked_at=excluded.checked_at`)
      .run(id,status,Number(Boolean(enabled)),error,Date.now());
  }
  async function inspect(bot) {
    if (!publicUrl) return { status:'NO_PUBLIC_URL', enabled:false };
    const info = await botApi(bot.token,'getWebhookInfo');
    const url = String(info.url || '');
    const status = !url ? 'AVAILABLE' : url === ownUrl(bot.id) ? 'READY' : 'EXTERNAL';
    const enabled = status === 'READY' && Boolean((await inbox(bot.id))?.secret);
    await setState(bot.id,status,enabled,status === 'EXTERNAL' ? '已有外部 webhook，未接管' : null);
    let externalHost = null;
    if (status === 'EXTERNAL') {
      try { externalHost = new URL(url).host; } catch { /* Telegram may return an invalid URL. */ }
    }
    return { status, enabled, external:status === 'EXTERNAL', externalHost };
  }
  app.post('/tg/publisher/:botId', wrapper(async (req,res) => {
    const id = String(req.params.botId), row = await inbox(id), bot = await scheduler.publisher(id);
    if (!row?.enabled || !row.secret) return res.sendStatus(403);
    const expected = decryptToken(row.secret,configKey);
    if (!sameSecret(req.get('x-telegram-bot-api-secret-token'),expected)) return res.sendStatus(403);
    const saved = await saveIncoming(db,id,req.body);
    if (saved && bot) refreshAvatar(bot, req.body?.message?.chat?.id).catch(() => {});
    res.sendStatus(200);
  }));
  app.get('/api/inbox/status', wrapper(async (req,res) => {
    const bot = await botFor(req); if (!bot) return res.status(404).json({ error:'未配置发布机器人' });
    try { res.json(await inspect(bot)); }
    catch (error) { await setState(bot.id,'ERROR',0,String(error.message).slice(0,200)); throw error; }
  }));
  app.post('/api/inbox/enable', wrapper(async (req,res) => {
    const bot = await botFor(req); if (!bot) return res.status(404).json({ error:'未配置发布机器人' });
    const state = await inspect(bot);
    if (state.status !== 'AVAILABLE' && state.status !== 'READY' &&
        !(state.status === 'EXTERNAL' && req.body?.takeover === true)) return res.status(409).json(state);
    let secret = (await inbox(bot.id))?.secret;
    if (!secret) secret = encryptToken(crypto.randomBytes(32).toString('base64url'),configKey);
    await botApi(bot.token,'setWebhook',{ url:ownUrl(bot.id), secret_token:decryptToken(secret,configKey), allowed_updates:['message','edited_message'] });
    await db.prepare(`INSERT INTO publisher_inbox(bot_id,enabled,webhook_status,secret,checked_at) VALUES(?,1,'READY',?,?)
      ON CONFLICT(bot_id) DO UPDATE SET enabled=1,webhook_status='READY',secret=excluded.secret,checked_at=excluded.checked_at,last_error=NULL`)
      .run(bot.id,secret,Date.now());
    res.json({ status:'READY', enabled:true });
  }));
  app.post('/api/inbox/disable', wrapper(async (req,res) => {
    if (req.admin?.canManageBots !== true) return res.sendStatus(403);
    const bot = await botFor(req); if (!bot) return res.status(404).json({error:'未配置发布机器人'});
    const state = await inspect(bot);
    if (state.status !== 'READY' && state.status !== 'AVAILABLE') return res.status(409).json(state);
    if (state.status === 'READY') await botApi(bot.token,'deleteWebhook',{drop_pending_updates:false});
    await setState(bot.id,'AVAILABLE',false);
    res.json({status:'AVAILABLE',enabled:false});
  }));
  app.get('/api/chat/conversations', wrapper(async (req,res) => {
    const id = await currentId(req), limit = clamp(req.query.limit,40,100), q = String(req.query.q || '').slice(0,100);
    const before = /^(\d+):(-?\d+)$/.exec(String(req.query.before || ''));
    const beforeAt = before ? Number(before[1]) : 0, beforeChat = before?.[2] || '';
    const cursor = (await db.prepare('SELECT COALESCE(MAX(id),0) n FROM chat_events WHERE bot_id=?').get(id)).n;
    const rows = await db.prepare(`SELECT * FROM conversations WHERE bot_id=?
      AND (?=0 OR last_message_at<? OR (last_message_at=? AND chat_id<?))
      AND (title LIKE ? OR username LIKE ? OR chat_id LIKE ?) ORDER BY last_message_at DESC,chat_id DESC LIMIT ?`)
      .all(id,beforeAt,beforeAt,beforeAt,beforeChat,`%${q}%`,`%${q}%`,`%${q}%`,limit);
    const bot = await botFor(req);
    if (bot) rows.filter(row => !row.avatar_file_id).slice(0, 20).forEach(row => refreshAvatar(bot,row.chat_id).catch(() => {}));
    const totalUnread = (await db.prepare('SELECT COALESCE(SUM(unread_count),0) n FROM conversations WHERE bot_id=?').get(id)).n;
    res.json({ rows, next:rows.length === limit ? `${rows.at(-1).last_message_at}:${rows.at(-1).chat_id}` : null, totalUnread, cursor });
  }));
  app.get('/api/chat/bot-avatars/:botId', wrapper(async (req,res) => {
    const id = String(req.params.botId);
    if (id !== (await currentId(req)) || !/^\d+$/.test(id)) return res.sendStatus(404);
    const bot = await botFor(req);
    const cached = botAvatars.get(id);
    if (cached && cached.expires > Date.now()) {
      if (!cached.bytes) return res.sendStatus(404);
      res.set('Cache-Control','private, max-age=3600');res.type(cached.type);return res.send(cached.bytes);
    }
    const photos = await avatarBotCall(bot,'getUserProfilePhotos',{user_id:Number(id),limit:1});
    const photo = photos?.photos?.[0]?.[0];
    if (!photo?.file_id) {
      botAvatars.set(id,{expires:Date.now()+6*60*60_000});
      return res.sendStatus(404);
    }
    const file = await avatarBotCall(bot,'getFile',{file_id:photo.file_id});
    if (!/^[A-Za-z0-9_./-]+$/.test(file?.file_path || '') || file.file_path.includes('..')) return res.sendStatus(404);
    let response;
    try { response = await fetch(`https://api.telegram.org/file/bot${bot.token}/${file.file_path}`,{signal:AbortSignal.timeout(10000)}); }
    catch (error) { console.warn(`Bot avatar file download failed for ${bot.id}:`,safeTelegramError(error));throw error; }
    if (!response.ok) { console.warn(`Bot avatar file download returned ${response.status} for ${bot.id}`);return res.sendStatus(502); }
    if (Number(response.headers.get('content-length') || 0)>2_000_000) {
      console.warn(`Bot avatar file exceeded size limit for ${bot.id}`);
      return res.sendStatus(502);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length>2_000_000) { console.warn(`Bot avatar file exceeded size limit for ${bot.id}`);return res.sendStatus(502); }
    let format;
    try { format = (await sharp(bytes).metadata()).format; }
    catch { console.warn(`Bot avatar file is not a supported image for ${bot.id}`);return res.sendStatus(502); }
    const type = { jpeg:'image/jpeg', png:'image/png', webp:'image/webp' }[format];
    if (!type) { console.warn(`Bot avatar file is not a supported image for ${bot.id}`);return res.sendStatus(502); }
    botAvatars.set(id,{bytes,type,expires:Date.now()+6*60*60_000});
    res.set('Cache-Control','private, max-age=3600');res.type(type);res.send(bytes);
  }));
  app.get('/api/chat/avatars/:botId/:chatId', wrapper(async (req,res) => {
    const bot = await botFor(req);
    if (!bot || bot.id !== String(req.params.botId)) return res.sendStatus(404);
    const row = (await inbox(bot.id)) && (await db.prepare('SELECT avatar_file_id FROM conversations WHERE bot_id=? AND chat_id=?').get(bot.id,String(req.params.chatId)));
    if (!row?.avatar_file_id) return res.sendStatus(404);
    const file = await botApi(bot.token,'getFile',{ file_id:row.avatar_file_id });
    const response = await fetch(`https://api.telegram.org/file/bot${bot.token}/${file.file_path}`, { signal:AbortSignal.timeout(20000) });
    if (!response.ok) return res.sendStatus(404);
    res.set('Cache-Control','public, max-age=86400');
    res.type(response.headers.get('content-type') || 'image/jpeg');
    res.send(Buffer.from(await response.arrayBuffer()));
  }));
  app.get('/api/chat/conversations/:chatId/messages', wrapper(async (req,res) => {
    const id = await currentId(req), chat = String(req.params.chatId), before = Number(req.query.before || 0), limit = clamp(req.query.limit,50,100);
    const rows = await db.prepare(`SELECT * FROM chat_messages WHERE bot_id=? AND chat_id=? AND (?=0 OR id<?) ORDER BY id DESC LIMIT ?`)
      .all(id,chat,before,before,limit);
    res.json({ rows:rows.reverse(), next:rows.length === limit ? rows[0].id : null });
  }));
  app.post('/api/chat/conversations/:chatId/read', wrapper(async (req,res) => {
    const id = await currentId(req), chat = String(req.params.chatId);
    await db.prepare(`UPDATE conversations SET unread_count=0,last_read_message_id=last_message_id,updated_at=? WHERE bot_id=? AND chat_id=?`).run(Date.now(),id,chat);
    res.json({ ok:true });
  }));
  app.get('/api/chat/updates', wrapper(async (req,res) => {
    const id = await currentId(req), after = Number(req.query.after || 0);
    const rows = await db.prepare('SELECT * FROM chat_events WHERE bot_id=? AND id>? ORDER BY id LIMIT 100').all(id,after);
    res.json({ rows, cursor:rows.length ? rows.at(-1).id : after });
  }));
  app.post('/api/chat/conversations/:chatId/send', wrapper(async (req,res) => {
    const bot = await botFor(req), chat = String(req.params.chatId);
    if (!bot || !idPattern.test(chat) || !(await db.prepare('SELECT 1 FROM conversations WHERE bot_id=? AND chat_id=?').get(bot.id,chat)))
      return res.status(404).json({ error:'会话不存在' });
    const replyTo = req.body?.replyTo ? String(req.body.replyTo) : null;
    if (replyTo && (!idPattern.test(replyTo) || !(await db.prepare('SELECT 1 FROM chat_messages WHERE bot_id=? AND chat_id=? AND telegram_message_id=?').get(bot.id,chat,replyTo))))
      throw new Error('引用消息不属于当前会话');
    const mediaId = Number(req.body?.mediaId || 0), media = mediaId ? await db.prepare('SELECT * FROM media WHERE id=?').get(mediaId) : null;
    if (mediaId && !media) throw new Error('媒体不存在');
    const { sent, formatted } = await sendFormatted({ token:bot.token, chatId:chat, delta:req.body?.delta?.ops,
      buttons:req.body?.buttons || [], media, replyTo });
    const kind = media ? media.mime.startsWith('image/') ? 'photo' : media.mime.startsWith('video/') ? 'video' : 'document' : null;
    const at = Number(sent.date || Math.floor(Date.now() / 1000)) * 1000;
    await db.transaction(async () => {
      await db.prepare(`INSERT OR IGNORE INTO chat_messages(bot_id,chat_id,telegram_message_id,direction,from_id,text,entities_json,media_kind,media_id,reply_to_message_id,sent_at,buttons_json)
        VALUES(?,?,?,'OUT',?,?,?,?,?,?,?,?)`).run(bot.id,chat,String(sent.message_id),bot.id,formatted.text,
          JSON.stringify(formatted.entities),kind,media?.id || null,replyTo,at,JSON.stringify(req.body?.buttons || []));
      await db.prepare(`UPDATE conversations SET last_message_id=?,last_message_text=?,last_message_at=?,updated_at=? WHERE bot_id=? AND chat_id=?`)
        .run(String(sent.message_id),formatted.text || `[${kind}]`,at,Date.now(),bot.id,chat);
      await db.prepare('INSERT INTO chat_events(bot_id,chat_id,created_at) VALUES(?,?,?)').run(bot.id,chat,Date.now());
    })();
    res.json(await db.prepare('SELECT * FROM chat_messages WHERE bot_id=? AND chat_id=? AND telegram_message_id=?').get(bot.id,chat,String(sent.message_id)));
  }));
  app.get('/api/chat/files/:id', wrapper(async (req,res) => {
    const bot = await botFor(req), row = await db.prepare('SELECT * FROM chat_messages WHERE id=? AND bot_id=?').get(Number(req.params.id),bot?.id || '');
    if (!row) return res.sendStatus(404);
    if (row.media_id) {
      const media = await db.prepare('SELECT * FROM media WHERE id=?').get(row.media_id);
      if (!media) return res.sendStatus(404); const source=await fetch(media.file_path, { signal:AbortSignal.timeout(20000) }); if(!source.ok)return res.sendStatus(404); return res.type(media.mime).send(Buffer.from(await source.arrayBuffer()));
    }
    if (!row.file_id) return res.sendStatus(404);
    const file = await botApi(bot.token,'getFile',{ file_id:row.file_id });
    if (!file.file_path || Number(file.file_size || 0) > 20 * 1024 * 1024) return res.sendStatus(413);
    const response = await fetch(`https://api.telegram.org/file/bot${bot.token}/${file.file_path}`,{ signal:AbortSignal.timeout(20000) });
    if (!response.ok) return res.sendStatus(502);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 20 * 1024 * 1024) return res.sendStatus(413);
    res.type(row.media_kind === 'photo' ? 'image/jpeg' : row.media_kind === 'video' ? 'video/mp4' : 'application/octet-stream').send(bytes);
  }));
}
