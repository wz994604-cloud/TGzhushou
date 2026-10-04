import { sentActions } from './sent-actions.js';
import express from 'express';
import sharp from 'sharp';
import { put } from '@vercel/blob';
import { waitUntil } from '@vercel/functions';
import { createAssetCache } from './asset-cache.js';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDatabase, getSetting, setSetting, encryptToken, decryptToken } from './db.js';
import { listPublishers, savePublisher } from './publishers.js';
import { parseAdminIds, verifyInitData } from './auth.js';
import { botCall, safeTelegramError } from './telegram.js';
import { renderDelta, normalizeButtons } from './format.js';
import { normalizeSchedule, nextSlot } from './schedule.js';
import { createScheduler } from './scheduler.js';
import { normalizeTelegramId, decodeCsv, parseCsv } from './player-utils.js';
import { createBrowserAuth } from './browser-auth.js';
import { registerChatRoutes } from './chat.js';

const required = ['ENTRY_BOT_TOKEN', 'CONFIG_KEY'];
for (const key of required) if (!process.env[key]) throw new Error(`${key} 未配置`);
const adminIds = parseAdminIds(process.env.ADMIN_TG_IDS);
if (Buffer.from(process.env.CONFIG_KEY, 'base64').length !== 32) throw new Error('CONFIG_KEY 必须是 32 字节 Base64 密钥');
if (process.env.PUBLIC_URL && !/^https:\/\/[^\s/]+\/?$/.test(process.env.PUBLIC_URL)) throw new Error('PUBLIC_URL 应为 HTTPS 域名，不带子路径');
const ffaBaseUrl = String(process.env.FFA_API_BASE_URL || 'https://fferwepba.ffyl88.com').replace(/\/$/, '');
const db = openDatabase(process.env.NODE_ENV === 'test' && process.env.TEST_DATABASE_FILE
  ? { localFile:process.env.TEST_DATABASE_FILE } : {});
const scheduler = createScheduler(db, { configKey: process.env.CONFIG_KEY });
async function kickScheduler(label) {
  if (process.env.VERCEL === '1') {
    waitUntil(Promise.resolve().then(() => scheduler.tick()).catch(error => console.error(label, safeTelegramError(error))));
    return;
  }
  await scheduler.tick();
}
const app = express();
const browserAuth = createBrowserAuth(db, adminIds, process.env.PUBLIC_URL, {
  accounts: (() => {
    if (process.env.ADMIN_LOGIN_ACCOUNTS) {
      try {
        const parsed = JSON.parse(process.env.ADMIN_LOGIN_ACCOUNTS);
        if (!Array.isArray(parsed)) throw new Error('ADMIN_LOGIN_ACCOUNTS must be a JSON array');
        return parsed;
      } catch (error) {
        throw new Error(`ADMIN_LOGIN_ACCOUNTS 配置无效: ${error.message}`);
      }
    }
    return [{ username: process.env.ADMIN_LOGIN_USERNAME || 'admin', password: process.env.ADMIN_LOGIN_PASSWORD }];
  })(),
  salt: process.env.CONFIG_KEY
});
app.disable('x-powered-by');
app.use(express.json({ limit: '512kb' }));
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
browserAuth.routes(app);

app.get('/healthz', (_req, res) => {
  try { db.prepare('SELECT 1').get(); res.json({ ok: true, database: true }); }
  catch { res.status(503).json({ ok: false, database: false }); }
});

app.post('/tg/entry', async (req, res) => {
  const actual = Buffer.from(String(req.get('x-telegram-bot-api-secret-token') || ''));
  const expected = Buffer.from(crypto.createHash('sha256').update(`entry:${process.env.ENTRY_BOT_TOKEN}`).digest('hex'));
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return res.sendStatus(403);
  const chat = req.body?.message?.chat;
  const handleEntry = async () => {
    if (chat?.type === 'private' && adminIds.includes(String(req.body.message.from?.id)) && /^\/start(?:@\w+)?(?:\s|$)/.test(String(req.body.message.text || ''))) {
      const base = String(process.env.PUBLIC_URL || '').replace(/\/$/, '');
      if (base) await botCall(process.env.ENTRY_BOT_TOKEN, 'sendMessage', { chat_id: chat.id, text: '点击下方按钮打开活动后台。', reply_markup: { inline_keyboard: [[{ text: '打开活动后台', web_app: { url: base } }]] } });
    }
    if (chat?.type === 'private' && /^\/login(?:@\w+)?(?:\s|$)/.test(String(req.body.message.text || ''))) {
      const link = browserAuth.issueLink(req.body.message.from?.id);
      if (link) await botCall(process.env.ENTRY_BOT_TOKEN,'sendMessage',{ chat_id:chat.id,
        text:'一次性网页登录链接，5 分钟内使用：',reply_markup:{ inline_keyboard:[[{ text:'打开工作台',url:link }]] } });
    }
  };
  if (process.env.VERCEL === '1') {
    waitUntil(Promise.resolve().then(handleEntry).catch(error => console.error('Entry bot:', safeTelegramError(error))));
    return res.sendStatus(200);
  }
  try { await handleEntry(); } catch (error) { console.error('Entry bot:', safeTelegramError(error)); }
  res.sendStatus(200);
});

async function ensureEntryBot() {
  const base = String(process.env.PUBLIC_URL || '').replace(/\/$/, '');
  if (!base) return;
  const webhookUrl = `${base}/tg/entry`;
  const secret = crypto.createHash('sha256').update(`entry:${process.env.ENTRY_BOT_TOKEN}`).digest('hex');
  const marker = `${webhookUrl}|${secret}`;
  if (getSetting(db, 'entry_webhook_config') === marker) return;
  await botCall(process.env.ENTRY_BOT_TOKEN, 'setChatMenuButton', { menu_button: { type: 'web_app', text: '打开活动后台', web_app: { url: base } } });
  await botCall(process.env.ENTRY_BOT_TOKEN, 'setWebhook', { url: webhookUrl,
    secret_token: secret, allowed_updates: ['message'] });
  setSetting(db, 'entry_webhook_config', marker);
}

app.post('/api/cron/tick', async (req,res,next) => { try {
  const auth = Buffer.from(String(req.get('authorization') || ''));
  const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET || ''}`);
  if (!process.env.CRON_SECRET || auth.length !== expected.length || !crypto.timingSafeEqual(auth, expected)) return res.sendStatus(401);
  const work = async () => {
    try { await ensureEntryBot(); } catch (error) { console.error('Entry bot setup:', safeTelegramError(error)); }
    await scheduler.tick();
  };
  if (process.env.VERCEL === '1') {
    waitUntil(Promise.resolve().then(work).catch(error => console.error('Cron tick:', safeTelegramError(error))));
    return res.json({ok:true,queued:true});
  }
  await work(); res.json({ok:true});
} catch(error){ next(error); } });

app.use('/api', (req, res, next) => {
  try {
    req.admin = req.get('x-telegram-init-data')
      ? verifyInitData(String(req.get('x-telegram-init-data')), process.env.ENTRY_BOT_TOKEN, adminIds)
      : browserAuth.authenticate(req);
    if (!req.admin) throw new Error('未授权');
    const selected = String(req.get('x-publisher-id') || '');
    if (selected && !scheduler.publisher(selected)) throw new Error('所选发布机器人不存在');
    next();
  }
  catch (error) { res.status(401).json({ error: error.message }); }
});

const route = fn => async (req, res, next) => { try { await fn(req, res); } catch (error) { next(error); } };
registerChatRoutes(app, { db, scheduler, configKey:process.env.CONFIG_KEY, publicUrl:process.env.PUBLIC_URL });
const currentBot = req => scheduler.publisher(req.get('x-publisher-id') || undefined);
function selectedBotId(req) { return currentBot(req)?.id || ''; }
function requireOriginalPlayerSource(req) {
  const id = selectedBotId(req);
  if (!id || id !== getSetting(db, 'publisher_id')) throw new Error('此机器人的用户来源尚未配置');
  return id;
}
function assertSelected(req, botId) {
  if (botId !== selectedBotId(req)) throw new Error('记录不属于所选机器人');
}
const sent = sentActions(db, id => scheduler.publisher(id));
function selectedSent(req) {
  const row = sent.read(req.params.kind, Number(req.params.id));
  if (row.bot_id !== currentBot(req)?.id) throw new Error('记录不属于所选机器人');
  return row;
}
app.get('/api/sent/:kind/:id', route(async(req,res)=>res.json(selectedSent(req))));
app.post('/api/sent/:kind/:id', route(async(req,res)=>{ selectedSent(req); res.json(await sent.act(req.params.kind,Number(req.params.id),req.body||{})); }));
const stickerCache = createAssetCache({ limit:128, ttl:3600000 });
const packCache = createAssetCache({ limit:16, ttl:600000 });
const previewCache = createAssetCache({ limit:16, ttl:3600000 });
const unavailableStickerCache = new Map();
const unavailableStickerTtl = 10 * 60 * 1000;
function privateImage(res) { res.set('Cache-Control', 'private, max-age=3600'); res.vary('x-telegram-init-data'); }
function privateUnavailableImage(res) { res.set('Cache-Control', 'private, max-age=600'); res.vary('x-telegram-init-data'); return res.sendStatus(404); }
class StickerUnavailableError extends Error { constructor() { super('表情缩略图不可用'); this.code = 'STICKER_UNAVAILABLE'; } }
function isImageFile(file) {
  const filePath = String(file?.file_path || '').toLowerCase();
  return Boolean(filePath && (!file.file_size || file.file_size <= 128_000) && /\.(webp|png|jpg|jpeg)$/.test(filePath));
}
function rememberUnavailableSticker(key) {
  unavailableStickerCache.set(key, Date.now() + unavailableStickerTtl);
  while (unavailableStickerCache.size > 256) unavailableStickerCache.delete(unavailableStickerCache.keys().next().value);
}
function isRememberedUnavailableSticker(key) {
  const expires = unavailableStickerCache.get(key);
  if (!expires) return false;
  if (expires > Date.now()) return true;
  unavailableStickerCache.delete(key);
  return false;
}

function ffaToken() {
  const encrypted = getSetting(db, 'ffa_token');
  return encrypted ? decryptToken(encrypted, process.env.CONFIG_KEY) : '';
}

function ffaUrl(pathname) {
  const url = new URL(pathname, `${ffaBaseUrl}/`);
  if (url.origin !== ffaBaseUrl) throw new Error('发发娱乐接口地址无效');
  return url;
}

async function ffaCall(token, params = {}) {
  const body = new URLSearchParams({ page_index: '1', page_size: '200', ...params });
  const response = await fetch(ffaUrl('/Admin/user/list'), {
    method: 'POST', headers: { authorization: token, 'content-type': 'application/x-www-form-urlencoded' }, body,
    signal: AbortSignal.timeout(20000)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json?.status === 'false' || json?.status === false) {
    throw Object.assign(new Error('发发娱乐 Token 已失效或接口拒绝请求'), { telegramCode: response.status === 401 ? 401 : undefined });
  }
  if (!Array.isArray(json?.data)) throw new Error('发发娱乐接口返回格式异常');
  return json;
}

function playerRow(raw) {
  const telegramId = normalizeTelegramId(raw?.uid);
  if (!telegramId) return null;
  return { telegramId, displayName: String(raw.nickname || '').trim().slice(0, 100), username: String(raw.tgusername || '').trim().slice(0, 100), platformId: String(raw.id ?? '').trim().slice(0, 100), active: String(raw.status ?? raw.active ?? '1') === '1' ? 1 : 0 };
}

async function fetchFfaPlayers(token) {
  const players = [], seen = new Set();
  for (let page = 1; page <= 1000; page++) {
    const result = await ffaCall(token, { page_index: String(page), page_size: '200' });
    for (const raw of result.data) {
      const row = playerRow(raw); if (row && !seen.has(row.telegramId)) { seen.add(row.telegramId); players.push(row); }
    }
    if (result.data.length < 200 || players.length >= Number(result.count || 0)) break;
  }
  return players;
}

app.get('/api/bootstrap', route(async (req, res) => {
  const bot = currentBot(req);
  res.json({ admin: req.admin, timezone: 'Asia/Shanghai', publishers: listPublishers(db), publisher: bot ? { id: bot.id, username: bot.username, legacy: bot.id === getSetting(db, 'publisher_id') } : null,
    targets: db.prepare('SELECT * FROM targets WHERE bot_id=? ORDER BY id DESC').all(bot?.id || ''),
    tasks: db.prepare('SELECT id,name,status,schedule_json,next_at,updated_at,bot_id FROM tasks WHERE bot_id=? ORDER BY id DESC LIMIT 100').all(bot?.id || '') });
}));

app.post('/api/publisher', route(async (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('机器人 Token 格式不正确');
  const identity = await botCall(token, 'getMe');
  if (!identity.is_bot || token === process.env.ENTRY_BOT_TOKEN) throw new Error('发布机器人必须使用独立身份');
  res.json(savePublisher(db, process.env.CONFIG_KEY, identity, token));
}));

app.get('/api/ffa', route(async (req, res) => {
  requireOriginalPlayerSource(req);
  res.json({ configured: Boolean(getSetting(db, 'ffa_token')), baseUrl: ffaBaseUrl });
}));

app.post('/api/ffa/token', route(async (req, res) => {
  requireOriginalPlayerSource(req);
  const token = String(req.body?.token || '').trim();
  if (!/^.{20,}$/.test(token)) throw new Error('发发娱乐 Token 格式不正确');
  await ffaCall(token, { page_index: '1', page_size: '1' });
  setSetting(db, 'ffa_token', encryptToken(token, process.env.CONFIG_KEY));
  res.json({ ok: true, baseUrl: ffaBaseUrl });
}));

app.post('/api/ffa/sync', route(async (req, res) => {
  const botId = requireOriginalPlayerSource(req);
  const token = ffaToken();
  if (!token) throw new Error('请先配置发发娱乐 Token');
  const rows = await fetchFfaPlayers(token), now = Date.now();
  const upsert = db.prepare(`INSERT INTO bot_players(bot_id,telegram_id,display_name,username,platform_id,active,first_seen,last_seen,source)
    VALUES(?,?,?,?,?,?,?,?,'ffa') ON CONFLICT(bot_id,telegram_id) DO UPDATE SET display_name=excluded.display_name,username=excluded.username,
    platform_id=excluded.platform_id,active=excluded.active,last_seen=excluded.last_seen`);
  const legacyUpsert = db.prepare(`INSERT INTO players(telegram_id,display_name,username,platform_id,active,first_seen,last_seen,source)
    VALUES(?,?,?,?,?,?,?,'ffa') ON CONFLICT(telegram_id) DO UPDATE SET display_name=excluded.display_name,username=excluded.username,
    platform_id=excluded.platform_id,active=excluded.active,last_seen=excluded.last_seen`);
  const stats = { total: rows.length, created: 0, updated: 0 };
  db.transaction(() => { for (const row of rows) { const existed = db.prepare('SELECT 1 FROM bot_players WHERE bot_id=? AND telegram_id=?').get(botId,row.telegramId); upsert.run(botId,row.telegramId,row.displayName,row.username,row.platformId,row.active,now,now); legacyUpsert.run(row.telegramId,row.displayName,row.username,row.platformId,row.active,now,now); existed ? stats.updated++ : stats.created++; } })();
  res.json({ ...stats, unchanged: stats.total - stats.created - stats.updated });
}));

app.get('/api/players', route(async (req, res) => {
  const q = String(req.query.q || '').trim(), page = Math.max(1, Number(req.query.page || 1)), size = Math.min(100, Math.max(10, Number(req.query.size || 50)));
  const where = q ? `AND (telegram_id LIKE @q OR display_name LIKE @q OR username LIKE @q OR platform_id LIKE @q)` : '';
  const params = { botId: selectedBotId(req), ...(q ? { q: `%${q}%` } : {}) };
  const total = db.prepare(`SELECT COUNT(*) count FROM bot_players WHERE bot_id=@botId ${where}`).get(params).count;
  const rows = db.prepare(`SELECT telegram_id,display_name,username,platform_id,active,last_seen FROM bot_players WHERE bot_id=@botId ${where} ORDER BY last_seen DESC,telegram_id LIMIT @size OFFSET @offset`).all({ ...params, size, offset: (page - 1) * size });
  res.json({ rows, total, page, size });
}));

app.get('/api/players/ids', route(async (req, res) => {
  res.json({ rows: db.prepare("SELECT telegram_id,display_name FROM bot_players WHERE bot_id=? AND active=1 ORDER BY last_seen DESC").all(selectedBotId(req)) });
}));

app.get('/api/broadcasts', route(async (req, res) => {
  res.json(db.prepare(`SELECT b.*,SUM(CASE WHEN d.status='SUCCESS' THEN 1 ELSE 0 END) success_count,SUM(CASE WHEN d.status='FAILED' THEN 1 ELSE 0 END) failed_count,
    SUM(CASE WHEN d.status IN ('PENDING','SENDING') THEN 1 ELSE 0 END) pending_count FROM broadcasts b
    LEFT JOIN broadcast_deliveries d ON d.broadcast_id=b.id WHERE b.bot_id=? GROUP BY b.id ORDER BY b.id DESC LIMIT 50`).all(selectedBotId(req)));
}));

app.get('/api/broadcasts/:id', route(async (req, res) => {
  const item = db.prepare('SELECT * FROM broadcasts WHERE id=?').get(Number(req.params.id));
  if (!item || item.bot_id !== selectedBotId(req)) return res.sendStatus(404);
  res.json({ ...item, deliveries: db.prepare(`SELECT d.*,c.deleted,c.state AS last_action,c.error AS last_error FROM broadcast_deliveries d LEFT JOIN sent_changes c ON c.kind='broadcasts' AND c.delivery_id=d.id WHERE d.broadcast_id=? ORDER BY d.id`).all(item.id) });
}));

app.post('/api/broadcasts', route(async (req, res) => {
  const bot = currentBot(req); if (!bot) throw new Error('请先配置发布机器人');
  const name = String(req.body?.name || '').trim();
  if (!name || name.length > 100) throw new Error('群发名称应为 1–100 字');
  const formatted = renderDelta(req.body?.delta?.ops);
  const buttons = normalizeButtons(req.body?.buttons || []);
  const mediaId = req.body?.mediaId ? Number(req.body.mediaId) : null;
  if (mediaId && !db.prepare('SELECT id FROM media WHERE id=?').get(mediaId)) throw new Error('图片不存在');
  if (mediaId && formatted.text.length > 1024) throw new Error('图片说明最多 1024 字符');
  const ids = [...new Set((Array.isArray(req.body?.playerIds) ? req.body.playerIds : []).map(normalizeTelegramId).filter(Boolean))];
  if (!ids.length) throw new Error('请选择至少一个有效用户');
  const placeholders = ids.map(() => '?').join(',');
  const players = db.prepare(`SELECT telegram_id AS telegramId,display_name AS displayName FROM bot_players WHERE bot_id=? AND active=1 AND telegram_id IN (${placeholders})`).all(bot.id,...ids);
  if (players.length !== ids.length) throw new Error('部分用户不存在或已停用，请刷新名单后重试');
  const broadcastId = scheduler.queueBroadcast({ name, deltaJson: JSON.stringify(req.body.delta.ops), buttonsJson: JSON.stringify(buttons), mediaId, players }, bot.id);
  await kickScheduler('Broadcast tick:');
  res.json({ id: broadcastId, total: players.length });
}));

app.post('/api/broadcasts/:id/stop', route(async (req, res) => {
  const id = Number(req.params.id), item = db.prepare('SELECT * FROM broadcasts WHERE id=?').get(id);
  if (!item || item.bot_id !== selectedBotId(req)) return res.sendStatus(404);
  db.transaction(() => {
    db.prepare("UPDATE broadcast_deliveries SET status='CANCELLED',error_text='管理员停止发送',completed_at=? WHERE broadcast_id=? AND status='PENDING'").run(Date.now(), id);
    db.prepare("UPDATE broadcasts SET status='STOPPED',completed_at=? WHERE id=? AND status IN ('PENDING','RUNNING')").run(Date.now(), id);
  })();
  res.json({ ok:true });
}));

app.post('/api/targets', route(async (req, res) => {
  const bot = currentBot(req);
  if (!bot) throw new Error('请先配置发布机器人');
  const ref = String(req.body?.reference || '').trim();
  if (!/^(?:-\d{1,20}|@[A-Za-z0-9_]{5,32})$/.test(ref)) throw new Error('请输入负数群/频道 ID 或 @公开用户名');
  const chat = await botCall(bot.token, 'getChat', { chat_id: ref });
  if (!['group', 'supergroup', 'channel'].includes(chat.type)) throw new Error('目标必须是群或频道');
  const member = await botCall(bot.token, 'getChatMember', { chat_id: chat.id, user_id: Number(bot.id) });
  const allowed = ['administrator', 'creator'].includes(member.status) && (chat.type !== 'channel' || member.status === 'creator' || member.can_post_messages);
  const error = allowed ? null : chat.type === 'channel' ? '缺少频道发布消息权限' : '机器人不是群管理员';
  db.prepare(`INSERT INTO targets(bot_id,chat_id,title,chat_type,username,can_publish,last_error) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(bot_id,chat_id) DO UPDATE SET title=excluded.title,chat_type=excluded.chat_type,username=excluded.username,can_publish=excluded.can_publish,last_error=excluded.last_error`)
    .run(bot.id, String(chat.id), String(chat.title || chat.id), chat.type, chat.username || null, allowed ? 1 : 0, error);
  res.json(db.prepare('SELECT * FROM targets WHERE bot_id=? AND chat_id=?').get(bot.id, String(chat.id)));
}));

app.delete('/api/targets/:id', route(async (req, res) => {
  const bot = currentBot(req);
  const result = db.prepare('DELETE FROM targets WHERE id=? AND bot_id=?').run(Number(req.params.id), bot?.id || '');
  if (!result.changes) return res.sendStatus(404);
  res.json({ ok: true });
}));

app.post('/api/sticker-packs', route(async (req, res) => {
  const bot = currentBot(req);
  if (!bot) throw new Error('请先配置发布机器人');
  const input = String(req.body?.pack || '').trim();
  const name = /(?:^|\/addemoji\/)([A-Za-z0-9_]{5,64})\/?$/.exec(input)?.[1];
  if (!name) throw new Error('请输入 Telegram addemoji 表情包链接或包名');
  const pack = await packCache(`${bot.id}:${name}`, async () => {
    const pack = await botCall(bot.token, 'getStickerSet', { name });
    return { title: pack.title, stickers: (pack.stickers || []).filter(item => item.custom_emoji_id).slice(0, 120)
    .map(item => ({ id: item.custom_emoji_id, alt: item.emoji || '🙂', thumbnailId: item.thumbnail?.file_id || (!item.is_animated && !item.is_video ? item.file_id : null) })) };
  });
  res.json({ name, ...pack });
}));

app.get('/api/sticker-packs/saved', route(async (req, res) => {
  const bot = currentBot(req);
  if (!bot) return res.json({ packs: [] });
  const packs = db.prepare('SELECT * FROM sticker_packs WHERE bot_id=? ORDER BY updated_at DESC').all(bot.id);
  res.json({ packs: packs.map(pack => ({ ...pack, stickers: db.prepare('SELECT emoji_id AS id,alt,thumbnail_id AS thumbnailId FROM sticker_pack_items WHERE pack_id=? ORDER BY position').all(pack.id) })) });
}));

app.post('/api/sticker-packs/saved', route(async (req, res) => {
  const bot = currentBot(req); if (!bot) throw new Error('请先配置发布机器人');
  const name = String(req.body?.name || '').trim(), title = String(req.body?.title || name).trim(), stickers = req.body?.stickers;
  if (!/^[A-Za-z0-9_]{5,64}$/.test(name) || !title || !Array.isArray(stickers) || !stickers.length || stickers.length > 120) throw new Error('表情包数据无效');
  const clean = stickers.map((item, index) => ({ id: String(item.id || ''), alt: String(item.alt || '🙂').slice(0, 8), thumbnailId: item.thumbnailId ? String(item.thumbnailId).slice(0, 300) : null, position: index })).filter(item => /^\d{5,30}$/.test(item.id));
  if (!clean.length) throw new Error('表情包没有有效的专属表情');
  const now = Date.now();
  db.transaction(() => {
    db.prepare(`INSERT INTO sticker_packs(bot_id,name,title,created_at,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(bot_id,name) DO UPDATE SET title=excluded.title,updated_at=excluded.updated_at`).run(bot.id,name,title,now,now);
    const pack = db.prepare('SELECT id FROM sticker_packs WHERE bot_id=? AND name=?').get(bot.id,name);
    db.prepare('DELETE FROM sticker_pack_items WHERE pack_id=?').run(pack.id);
    const add = db.prepare('INSERT INTO sticker_pack_items(pack_id,emoji_id,alt,thumbnail_id,position) VALUES(?,?,?,?,?)');
    for (const item of clean) add.run(pack.id,item.id,item.alt,item.thumbnailId,item.position);
  })();
  res.json({ ok:true });
}));

app.delete('/api/sticker-packs/saved/:id', route(async (req, res) => {
  const bot = currentBot(req); if (!bot) return res.sendStatus(404);
  const result = db.prepare('DELETE FROM sticker_packs WHERE id=? AND bot_id=?').run(Number(req.params.id),bot.id);
  if (!result.changes) return res.sendStatus(404);
  res.json({ ok:true });
}));

app.get('/api/sticker-image', route(async (req, res) => {
  const bot = currentBot(req);
  if (!bot) return res.sendStatus(404);
  const fileId = String(req.query.id || '');
  const emojiId = String(req.query.emoji || '');
  if (fileId && !/^[A-Za-z0-9_-]{10,300}$/.test(fileId)) return res.sendStatus(400);
  if (!fileId && !/^\d{5,30}$/.test(emojiId)) return res.sendStatus(400);
  const key = bot.id + ':' + (fileId || `emoji:${emojiId}`);
  if (isRememberedUnavailableSticker(key)) return privateUnavailableImage(res);
  let image;
  try {
    image = await stickerCache(key, async () => {
      let file;
      if (fileId) {
        try { file = await botCall(bot.token, 'getFile', { file_id:fileId }); }
        catch (error) {
          if (!emojiId || !error.telegramCode || error.telegramCode < 400 || error.telegramCode >= 500 || error.telegramCode === 429) throw error;
        }
      }
      // Telegram file_ids are scoped to the bot that obtained them. Saved packs
      // can outlive a publisher-bot change, so resolve the current file_id from
      // the stable custom emoji ID before downloading its thumbnail. If an old
      // file points to TGS/WEBM, resolve again so an available static thumbnail
      // wins; otherwise the UI will keep the alt emoji instead of retrying.
      if (!isImageFile(file) && emojiId) {
        let stickers;
        try { stickers = await botCall(bot.token, 'getCustomEmojiStickers', { custom_emoji_ids:[emojiId] }); }
        catch (error) {
          if (error.telegramCode && error.telegramCode >= 400 && error.telegramCode < 500 && error.telegramCode !== 429) throw new StickerUnavailableError();
          throw error;
        }
        const sticker = Array.isArray(stickers) ? stickers.find(item => String(item?.custom_emoji_id) === emojiId) || stickers[0] : null;
        const currentFileId = sticker?.thumbnail?.file_id || (!sticker?.is_animated && !sticker?.is_video ? sticker?.file_id : null);
        if (!currentFileId) throw new StickerUnavailableError();
        try { file = await botCall(bot.token, 'getFile', { file_id:currentFileId }); }
        catch (error) {
          if (error.telegramCode && error.telegramCode >= 400 && error.telegramCode < 500 && error.telegramCode !== 429) throw new StickerUnavailableError();
          throw error;
        }
      }
      if (!isImageFile(file)) throw new StickerUnavailableError();
      const response = await fetch('https://api.telegram.org/file/bot' + bot.token + '/' + file.file_path, { signal:AbortSignal.timeout(15000) });
      if (!response.ok) throw new StickerUnavailableError();
      // Enforce the limit on actual streamed bytes as well as Telegram metadata.
      const reader = response.body.getReader(); let size = 0; const chunks = [];
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.length;
          if (size > 128_000) { await reader.cancel(); throw new StickerUnavailableError(); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      return { bytes:Buffer.concat(chunks), type:path.extname(file.file_path).toLowerCase() };
    });
  } catch (error) {
    if (error?.code === 'STICKER_UNAVAILABLE') {
      rememberUnavailableSticker(key);
      return privateUnavailableImage(res);
    }
    throw error;
  }
  privateImage(res); res.type(image.type).send(image.bytes);
}));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const chatUpload = multer({ storage:multer.memoryStorage(), limits:{ fileSize:20 * 1024 * 1024 } });
app.post('/api/players/import', upload.single('file'), route(async (req, res) => {
  const botId = requireOriginalPlayerSource(req);
  const file = req.file; if (!file) throw new Error('请选择 WPS 导出的 CSV 文件');
  const rows = parseCsv(decodeCsv(file.buffer)); if (rows.length < 2) throw new Error('CSV 文件没有有效数据');
  const header = rows[0].map(value => value.trim().replace(/^\ufeff/, ''));
  const find = names => { const index = header.findIndex(value => names.includes(value)); return index >= 0 ? index : null; };
  const platformIndex = find(['ID','id']) ?? 0, nameIndex = find(['昵称','nickname']) ?? 2, telegramIndex = find(['用户名','tgusername','telegram_id']) ?? 4;
  const unique = new Map(), stats = { total: rows.length - 1, invalid: 0, duplicate: 0, created: 0, updated: 0 };
  for (const values of rows.slice(1)) {
    const telegramId = normalizeTelegramId(values[telegramIndex]);
    if (!telegramId) { stats.invalid++; continue; }
    if (unique.has(telegramId)) stats.duplicate++;
    unique.set(telegramId, { telegramId, displayName: String(values[nameIndex] || '').trim().slice(0,100), username:'', platformId:String(values[platformIndex] || '').trim().slice(0,100), active:1 });
  }
  const now = Date.now(), upsert = db.prepare(`INSERT INTO bot_players(bot_id,telegram_id,display_name,username,platform_id,active,first_seen,last_seen,source)
    VALUES(?,?,?,?,?,?,?,?,'csv') ON CONFLICT(bot_id,telegram_id) DO UPDATE SET display_name=excluded.display_name,platform_id=excluded.platform_id,active=excluded.active,last_seen=excluded.last_seen,source='csv'`);
  const legacyUpsert = db.prepare(`INSERT INTO players(telegram_id,display_name,username,platform_id,active,first_seen,last_seen,source)
    VALUES(?,?,?,?,?,?,?,'csv') ON CONFLICT(telegram_id) DO UPDATE SET display_name=excluded.display_name,platform_id=excluded.platform_id,active=excluded.active,last_seen=excluded.last_seen,source='csv'`);
  db.transaction(() => { for (const row of unique.values()) { const existed = db.prepare('SELECT 1 FROM bot_players WHERE bot_id=? AND telegram_id=?').get(botId,row.telegramId); upsert.run(botId,row.telegramId,row.displayName,row.username,row.platformId,row.active,now,now); legacyUpsert.run(row.telegramId,row.displayName,row.username,row.platformId,row.active,now,now); existed ? stats.updated++ : stats.created++; } })();
  res.json({ ...stats, unchanged: unique.size - stats.created - stats.updated });
}));

app.post('/api/media', upload.single('image'), route(async (req, res) => {
  const buffer = req.file?.buffer;
  if (!buffer) throw new Error('请选择图片');
  const mime = buffer.subarray(0, 3).toString('hex') === 'ffd8ff' ? 'image/jpeg'
    : buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'image/png'
    : buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : null;
  if (!mime) throw new Error('只支持 JPEG、PNG、WebP 图片');
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  const ext = mime === 'image/jpeg' ? '.jpg' : mime === 'image/png' ? '.png' : '.webp';
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN 未配置，媒体上传不可用');
  const blob = await put(`media/${sha}${ext}`, buffer, { access:'public', addRandomSuffix:false });
  const filename = blob.url
  db.prepare('INSERT OR IGNORE INTO media(sha256,mime,size,file_path,created_at) VALUES(?,?,?,?,?)').run(sha, mime, buffer.length, filename, Date.now());
  res.json(db.prepare('SELECT id,mime,size FROM media WHERE sha256=?').get(sha));
}));

app.post('/api/chat/media', chatUpload.single('file'), route(async (req,res) => {
  const file = req.file;
  if (!file?.buffer) throw new Error('请选择图片、视频或文件');
  const mime = String(file.mimetype || '').toLowerCase();
  const allowed = /^(image\/(jpeg|png|webp)|video\/(mp4|webm)|application\/(pdf|zip|octet-stream|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet))|text\/plain)$/;
  if (!allowed.test(mime)) throw new Error('文件格式不支持');
  const ext = mime === 'image/jpeg' ? '.jpg' : mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp'
    : mime === 'video/mp4' ? '.mp4' : mime === 'video/webm' ? '.webm' : '.bin';
  const sha = crypto.createHash('sha256').update(file.buffer).digest('hex');
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN 未配置，媒体上传不可用');
  const blob = await put(`media/${sha}${ext}`, file.buffer, { access:'public', addRandomSuffix:false });
  const filename = blob.url
  db.prepare('INSERT OR IGNORE INTO media(sha256,mime,size,file_path,created_at) VALUES(?,?,?,?,?)')
    .run(sha,mime,file.buffer.length,filename,Date.now());
  res.json(db.prepare('SELECT id,mime,size FROM media WHERE sha256=?').get(sha));
}));

app.get('/api/media/:id', route(async (req, res) => {
  const media = db.prepare('SELECT * FROM media WHERE id=?').get(Number(req.params.id));
  if (!media) return res.sendStatus(404);
  privateImage(res);
  if (req.query.preview === '1') {
    if (!media.mime.startsWith('image/')) return res.sendStatus(400);
    const bytes = await previewCache(media.sha256, async () => {
      const source = await fetch(media.file_path); if (!source.ok) throw new Error('媒体对象读取失败');
      return sharp(Buffer.from(await source.arrayBuffer()), { limitInputPixels:40000000 }).rotate()
        .resize(720, 720, { fit:'inside', withoutEnlargement:true }).webp({ quality:75 }).toBuffer();
    });
    return res.type('image/webp').send(bytes);
  }
  const source = await fetch(media.file_path); if (!source.ok) return res.sendStatus(404); res.type(media.mime).send(Buffer.from(await source.arrayBuffer()));
}));

function taskPayload(body, bot) {
  const name = String(body?.name || '').trim();
  if (!name || name.length > 100) throw new Error('活动名称应为 1–100 字');
  const delta = body?.delta?.ops;
  const formatted = renderDelta(delta);
  const buttons = normalizeButtons(body?.buttons || []);
  if (!Array.isArray(body?.targetIds)) throw new Error('请选择发布目标');
  const ids = [...new Set(body.targetIds.map(Number))];
  if (!ids.length || ids.length > 50 || ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('请选择 1–50 个发布目标');
  const placeholders = ids.map(() => '?').join(',');
  const targets = db.prepare(`SELECT id FROM targets WHERE bot_id=? AND can_publish=1 AND id IN (${placeholders})`).all(bot.id, ...ids);
  if (targets.length !== ids.length) throw new Error('有目标不存在或缺少发布权限');
  const mediaId = body.mediaId ? Number(body.mediaId) : null;
  if (mediaId && !db.prepare('SELECT id FROM media WHERE id=?').get(mediaId)) throw new Error('图片不存在');
  if (mediaId && formatted.text.length > 1024) throw new Error('图片说明最多 1024 字符');
  const schedule = normalizeSchedule(body.schedule);
  return { name, delta: JSON.stringify(delta), buttons: JSON.stringify(buttons), ids: JSON.stringify(ids), schedule: JSON.stringify(schedule), mediaId };
}

app.post('/api/tasks', route(async (req, res) => {
  const bot = currentBot(req);
  if (!bot) throw new Error('请先配置发布机器人');
  const item = taskPayload(req.body, bot), now = Date.now();
  const result = db.prepare(`INSERT INTO tasks(name,delta_json,buttons_json,target_ids_json,schedule_json,media_id,bot_id,status,next_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(item.name,item.delta,item.buttons,item.ids,item.schedule,item.mediaId,bot.id,'DRAFT',null,now,now);
  res.json(db.prepare('SELECT * FROM tasks WHERE id=?').get(result.lastInsertRowid));
}));

app.put('/api/tasks/:id', route(async (req, res) => {
  const bot = currentBot(req), id = Number(req.params.id);
  const old = db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
  if (!old || old.bot_id !== bot?.id) throw new Error('任务不存在或属于旧机器人');
  const item = taskPayload(req.body, bot), now = Date.now();
  const schedule = JSON.parse(item.schedule);
  const active = old.status === 'ACTIVE' && schedule.kind !== 'MANUAL';
  db.prepare(`UPDATE tasks SET name=?,delta_json=?,buttons_json=?,target_ids_json=?,schedule_json=?,media_id=?,status=?,next_at=?,updated_at=? WHERE id=?`)
    .run(item.name,item.delta,item.buttons,item.ids,item.schedule,item.mediaId,active?'ACTIVE':['PAUSED','STOPPED'].includes(old.status)?old.status:'DRAFT',active?nextSlot(schedule,now):null,now,id);
  res.json(db.prepare('SELECT * FROM tasks WHERE id=?').get(id));
}));

app.get('/api/tasks/:id', route(async (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(Number(req.params.id));
  if (!task || task.bot_id !== selectedBotId(req)) return res.sendStatus(404);
  res.json(task);
}));

app.delete('/api/tasks/:id', route(async (req, res) => {
  const id = Number(req.params.id), task = db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
  if (!task || task.bot_id !== selectedBotId(req)) return res.sendStatus(404);
  if (task.status === 'ACTIVE' || db.prepare("SELECT 1 FROM deliveries WHERE status IN ('PENDING','SENDING') AND run_id IN (SELECT id FROM runs WHERE task_id=?)").get(id)) throw new Error('请先停止任务并等待正在发送的消息处理完毕');
  db.transaction(() => {
    db.prepare('DELETE FROM deliveries WHERE run_id IN (SELECT id FROM runs WHERE task_id=?)').run(id);
    db.prepare('DELETE FROM runs WHERE task_id=?').run(id);
    db.prepare('DELETE FROM tasks WHERE id=?').run(id);
  })();
  res.json({ ok:true });
}));

app.post('/api/tasks/:id/status', route(async (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(Number(req.params.id));
  if (!task || task.bot_id !== currentBot(req)?.id) throw new Error('任务不存在或属于旧机器人');
  const action = String(req.body?.action || '');
  if (!['activate','pause','stop'].includes(action)) throw new Error('操作无效');
  const schedule = JSON.parse(task.schedule_json);
  if (action === 'activate' && task.status === 'ACTIVE') return res.json(task);
  if (action === 'pause' && task.status === 'STOPPED') throw new Error('任务已停止，请先重新开始');
  if (action === 'activate' && task.status === 'COMPLETED') throw new Error('单次任务已经完成');
  const timed = schedule.kind !== 'MANUAL';
  const next = action === 'activate' && timed ? nextSlot(schedule, Date.now()) : null;
  if (action === 'activate' && timed && !next) throw new Error('没有未来发布时间，请编辑任务设置新的发布时间');
  const status = action === 'activate' ? (timed ? 'ACTIVE' : 'DRAFT') : action === 'pause' ? 'PAUSED' : 'STOPPED';
  db.transaction(() => {
    db.prepare('UPDATE tasks SET status=?,next_at=?,updated_at=? WHERE id=?').run(status,next,Date.now(),task.id);
    if (action !== 'activate') db.prepare(`UPDATE deliveries SET status='CANCELLED',error_text='任务已暂停或停止',completed_at=? WHERE status='PENDING' AND run_id IN
      (SELECT id FROM runs WHERE task_id=? AND (?='stop' OR source='SCHEDULED'))`).run(Date.now(), task.id, action);
  })();
  res.json(db.prepare('SELECT * FROM tasks WHERE id=?').get(task.id));
}));

app.post('/api/tasks/:id/send', route(async (req, res) => {
  const runId = scheduler.queueNow(Number(req.params.id), req.body?.requestKey, selectedBotId(req));
  await kickScheduler('Immediate tick:');
  res.json({ runId });
}));

app.get('/api/runs', route(async (req, res) => {
  res.json(db.prepare(`SELECT r.id,r.task_id,r.source,r.slot_at,r.status,r.created_at,t.name,
    COUNT(d.id) total,SUM(CASE WHEN d.status='SUCCESS' THEN 1 ELSE 0 END) success_count,SUM(CASE WHEN d.status='FAILED' THEN 1 ELSE 0 END) failed_count,SUM(CASE WHEN d.status='UNKNOWN' THEN 1 ELSE 0 END) unknown_count
    FROM runs r JOIN tasks t ON t.id=r.task_id LEFT JOIN deliveries d ON d.run_id=r.id
    WHERE r.bot_id=? GROUP BY r.id,t.name ORDER BY r.id DESC LIMIT 50`).all(selectedBotId(req)));
}));

app.get('/api/runs/:id', route(async (req, res) => {
  const run = db.prepare('SELECT * FROM runs WHERE id=?').get(Number(req.params.id));
  if (!run || run.bot_id !== selectedBotId(req)) return res.sendStatus(404);
  res.json({ ...run, deliveries: db.prepare(`SELECT d.*,c.deleted,c.state AS last_action,c.error AS last_error FROM deliveries d LEFT JOIN sent_changes c ON c.kind='runs' AND c.delivery_id=d.id WHERE d.run_id=? ORDER BY d.id`).all(run.id) });
}));

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
app.use('/api', (_req, res) => res.status(404).json({ error:'接口不存在' }));
// Serve the Mini App shell at `/` as well as client-side routes. Explicitly
// enabling the index avoids Express 5 treating the root request as a missing
// static asset and returning the JSON error handler response.
app.use(express.static(dist, { index:'index.html', setHeaders(res, filename) {
  if (path.dirname(filename) === path.join(dist, 'assets') && /-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(filename)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
} }));
app.use((req, res, next) => {
  if (req.method === 'GET' && req.accepts('html')) return res.sendFile(path.join(dist, 'index.html'));
  next();
});
app.use((error, _req, res, _next) => {
  console.error('Request:', safeTelegramError(error));
  res.status(error instanceof multer.MulterError ? 400 : error.telegramCode ? 502 : 400).json({ error: safeTelegramError(error) });
});

const port = Number(process.env.PORT || 8080);
export default app;

if (process.env.VERCEL !== '1') {
const server = app.listen(port, '0.0.0.0', async () => {
  console.log(`TGzhushou listening on ${port}`);
  scheduler.start();
  const base = String(process.env.PUBLIC_URL || '').replace(/\/$/, '');
  if (!base) return;
  try {
    await botCall(process.env.ENTRY_BOT_TOKEN, 'setChatMenuButton', { menu_button: { type: 'web_app', text: '打开活动后台', web_app: { url: base } } });
    await botCall(process.env.ENTRY_BOT_TOKEN, 'setWebhook', { url: `${base}/tg/entry`, secret_token: crypto.createHash('sha256').update(`entry:${process.env.ENTRY_BOT_TOKEN}`).digest('hex'), allowed_updates: ['message'] });
    console.log('Entry bot menu and webhook ready');
  } catch (error) { console.error('Entry bot setup:', safeTelegramError(error)); }
});
function shutdown() { scheduler.stop(); server.close(async () => { await db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 25000).unref(); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
}
