import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDatabase, getSetting, setSetting, encryptToken } from './db.js';
import { verifyInitData } from './auth.js';
import { botCall, safeTelegramError } from './telegram.js';
import { renderDelta, normalizeButtons } from './format.js';
import { normalizeSchedule, nextSlot } from './schedule.js';
import { createScheduler } from './scheduler.js';

const required = ['ENTRY_BOT_TOKEN', 'ADMIN_TG_ID', 'CONFIG_KEY'];
for (const key of required) if (!process.env[key]) throw new Error(`${key} 未配置`);
if (!/^\d+$/.test(process.env.ADMIN_TG_ID)) throw new Error('ADMIN_TG_ID 必须是 Telegram 数字用户 ID');
if (Buffer.from(process.env.CONFIG_KEY, 'base64').length !== 32) throw new Error('CONFIG_KEY 必须是 32 字节 Base64 密钥');
if (process.env.PUBLIC_URL && !/^https:\/\/[^\s/]+\/?$/.test(process.env.PUBLIC_URL)) throw new Error('PUBLIC_URL 应为 HTTPS 域名，不带子路径');
const dataDir = path.resolve(process.env.DATA_DIR || './data');
const db = openDatabase(dataDir);
const scheduler = createScheduler(db, { configKey: process.env.CONFIG_KEY });
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '512kb' }));
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

app.get('/healthz', (_req, res) => {
  try { db.prepare('SELECT 1').get(); res.json({ ok: true, database: true }); }
  catch { res.status(503).json({ ok: false, database: false }); }
});

app.post('/tg/entry', async (req, res) => {
  const actual = Buffer.from(String(req.get('x-telegram-bot-api-secret-token') || ''));
  const expected = Buffer.from(crypto.createHash('sha256').update(`entry:${process.env.ENTRY_BOT_TOKEN}`).digest('hex'));
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return res.sendStatus(403);
  res.sendStatus(200);
  const chat = req.body?.message?.chat;
  if (chat?.type === 'private' && String(req.body.message.from?.id) === process.env.ADMIN_TG_ID && /^\/start(?:@\w+)?(?:\s|$)/.test(String(req.body.message.text || ''))) {
    const base = String(process.env.PUBLIC_URL || '').replace(/\/$/, '');
    if (base) botCall(process.env.ENTRY_BOT_TOKEN, 'sendMessage', { chat_id: chat.id, text: '点击下方按钮打开活动后台。', reply_markup: { inline_keyboard: [[{ text: '打开活动后台', web_app: { url: base } }]] } })
      .catch(error => console.error('Entry bot:', safeTelegramError(error)));
  }
});

app.use('/api', (req, res, next) => {
  try { req.admin = verifyInitData(String(req.get('x-telegram-init-data') || ''), process.env.ENTRY_BOT_TOKEN, process.env.ADMIN_TG_ID); next(); }
  catch (error) { res.status(401).json({ error: error.message }); }
});

const route = fn => async (req, res, next) => { try { await fn(req, res); } catch (error) { next(error); } };
const currentBot = () => scheduler.publisher();

app.get('/api/bootstrap', route(async (req, res) => {
  const bot = currentBot();
  res.json({ admin: req.admin, timezone: 'Asia/Shanghai', publisher: bot ? { id: bot.id, username: getSetting(db, 'publisher_username') } : null,
    targets: db.prepare('SELECT * FROM targets WHERE bot_id=? ORDER BY id DESC').all(bot?.id || ''),
    tasks: db.prepare('SELECT id,name,status,schedule_json,next_at,updated_at,bot_id FROM tasks ORDER BY id DESC LIMIT 100').all() });
}));

app.post('/api/publisher', route(async (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('机器人 Token 格式不正确');
  const identity = await botCall(token, 'getMe');
  if (!identity.is_bot || token === process.env.ENTRY_BOT_TOKEN) throw new Error('发布机器人必须使用独立身份');
  const current = currentBot();
  db.transaction(() => {
    if (current && current.id !== String(identity.id)) db.prepare("UPDATE tasks SET status='PAUSED',next_at=NULL WHERE bot_id=? AND status='ACTIVE'").run(current.id);
    setSetting(db, 'publisher_token', encryptToken(token, process.env.CONFIG_KEY));
    setSetting(db, 'publisher_id', identity.id);
    setSetting(db, 'publisher_username', identity.username || '');
  })();
  res.json({ id: String(identity.id), username: identity.username || '', previousTasksPaused: Boolean(current && current.id !== String(identity.id)) });
}));

app.post('/api/targets', route(async (req, res) => {
  const bot = currentBot();
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
  const bot = currentBot();
  const result = db.prepare('DELETE FROM targets WHERE id=? AND bot_id=?').run(Number(req.params.id), bot?.id || '');
  if (!result.changes) return res.sendStatus(404);
  res.json({ ok: true });
}));

app.post('/api/sticker-packs', route(async (req, res) => {
  const bot = currentBot();
  if (!bot) throw new Error('请先配置发布机器人');
  const input = String(req.body?.pack || '').trim();
  const name = /(?:^|\/addemoji\/)([A-Za-z0-9_]{5,64})\/?$/.exec(input)?.[1];
  if (!name) throw new Error('请输入 Telegram addemoji 表情包链接或包名');
  const pack = await botCall(bot.token, 'getStickerSet', { name });
  res.json({ title: pack.title, stickers: (pack.stickers || []).filter(item => item.custom_emoji_id).slice(0, 120)
    .map(item => ({ id: item.custom_emoji_id, alt: item.emoji || '🙂', thumbnailId: item.thumbnail?.file_id || item.file_id || null })) });
}));

app.get('/api/sticker-image', route(async (req, res) => {
  const bot = currentBot();
  if (!bot) return res.sendStatus(404);
  const fileId = String(req.query.id || '');
  if (!/^[A-Za-z0-9_-]{10,300}$/.test(fileId)) return res.sendStatus(400);
  const file = await botCall(bot.token, 'getFile', { file_id: fileId });
  if (!file.file_path || file.file_size > 128_000 || !/\.(webp|png|jpg|jpeg)$/.test(file.file_path)) return res.sendStatus(404);
  const response = await fetch(`https://api.telegram.org/file/bot${bot.token}/${file.file_path}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) return res.sendStatus(502);
  const bytes = Buffer.from(await response.arrayBuffer());
  res.type(path.extname(file.file_path)).send(bytes);
}));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
app.post('/api/media', upload.single('image'), route(async (req, res) => {
  const buffer = req.file?.buffer;
  if (!buffer) throw new Error('请选择图片');
  const mime = buffer.subarray(0, 3).toString('hex') === 'ffd8ff' ? 'image/jpeg'
    : buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'image/png'
    : buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : null;
  if (!mime) throw new Error('只支持 JPEG、PNG、WebP 图片');
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  const ext = mime === 'image/jpeg' ? '.jpg' : mime === 'image/png' ? '.png' : '.webp';
  const filename = path.join(dataDir, 'media', sha + ext);
  await fs.writeFile(filename, buffer, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  db.prepare('INSERT OR IGNORE INTO media(sha256,mime,size,file_path,created_at) VALUES(?,?,?,?,?)').run(sha, mime, buffer.length, filename, Date.now());
  res.json(db.prepare('SELECT id,mime,size FROM media WHERE sha256=?').get(sha));
}));

app.get('/api/media/:id', route(async (req, res) => {
  const media = db.prepare('SELECT * FROM media WHERE id=?').get(Number(req.params.id));
  if (!media) return res.sendStatus(404);
  res.type(media.mime).sendFile(media.file_path);
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
  const bot = currentBot();
  if (!bot) throw new Error('请先配置发布机器人');
  const item = taskPayload(req.body, bot), now = Date.now();
  const result = db.prepare(`INSERT INTO tasks(name,delta_json,buttons_json,target_ids_json,schedule_json,media_id,bot_id,status,next_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(item.name,item.delta,item.buttons,item.ids,item.schedule,item.mediaId,bot.id,'DRAFT',null,now,now);
  res.json(db.prepare('SELECT * FROM tasks WHERE id=?').get(result.lastInsertRowid));
}));

app.put('/api/tasks/:id', route(async (req, res) => {
  const bot = currentBot(), id = Number(req.params.id);
  const old = db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
  if (!old || old.bot_id !== bot?.id || old.status === 'STOPPED') throw new Error('任务不存在、已停止或属于旧机器人');
  const item = taskPayload(req.body, bot), now = Date.now();
  const schedule = JSON.parse(item.schedule);
  const active = old.status === 'ACTIVE' && schedule.kind !== 'MANUAL';
  db.prepare(`UPDATE tasks SET name=?,delta_json=?,buttons_json=?,target_ids_json=?,schedule_json=?,media_id=?,status=?,next_at=?,updated_at=? WHERE id=?`)
    .run(item.name,item.delta,item.buttons,item.ids,item.schedule,item.mediaId,active?'ACTIVE':old.status==='PAUSED'?'PAUSED':'DRAFT',active?nextSlot(schedule,now):null,now,id);
  res.json(db.prepare('SELECT * FROM tasks WHERE id=?').get(id));
}));

app.get('/api/tasks/:id', route(async (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(Number(req.params.id));
  if (!task) return res.sendStatus(404);
  res.json(task);
}));

app.delete('/api/tasks/:id', route(async (req, res) => {
  const id = Number(req.params.id), task = db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
  if (!task) return res.sendStatus(404);
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
  if (!task || task.bot_id !== currentBot()?.id) throw new Error('任务不存在或属于旧机器人');
  const action = String(req.body?.action || '');
  if (!['activate','pause','stop'].includes(action)) throw new Error('操作无效');
  if (task.status === 'STOPPED') throw new Error('任务已停止');
  const schedule = JSON.parse(task.schedule_json);
  if (action === 'activate' && schedule.kind === 'MANUAL') throw new Error('手动任务无需启用定时');
  if (action === 'activate' && task.status === 'COMPLETED') throw new Error('单次任务已经完成');
  const next = action === 'activate' ? nextSlot(schedule, Date.now()) : null;
  if (action === 'activate' && !next) throw new Error('没有未来发布时间');
  const status = action === 'activate' ? 'ACTIVE' : action === 'pause' ? 'PAUSED' : 'STOPPED';
  db.prepare('UPDATE tasks SET status=?,next_at=?,updated_at=? WHERE id=?').run(status,next,Date.now(),task.id);
  if (action !== 'activate') db.prepare(`UPDATE deliveries SET status='CANCELLED',error_text='任务已暂停或停止',completed_at=? WHERE status='PENDING' AND run_id IN
    (SELECT id FROM runs WHERE task_id=? AND source='SCHEDULED')`).run(Date.now(), task.id);
  res.json(db.prepare('SELECT * FROM tasks WHERE id=?').get(task.id));
}));

app.post('/api/tasks/:id/send', route(async (req, res) => {
  const runId = scheduler.queueNow(Number(req.params.id), req.body?.requestKey);
  scheduler.tick().catch(error => console.error('Immediate tick:', safeTelegramError(error)));
  res.json({ runId });
}));

app.get('/api/runs', route(async (_req, res) => {
  res.json(db.prepare(`SELECT r.id,r.task_id,r.source,r.slot_at,r.status,r.created_at,t.name,
    COUNT(d.id) total,SUM(d.status='SUCCESS') success_count,SUM(d.status='FAILED') failed_count,SUM(d.status='UNKNOWN') unknown_count
    FROM runs r JOIN tasks t ON t.id=r.task_id LEFT JOIN deliveries d ON d.run_id=r.id
    GROUP BY r.id ORDER BY r.id DESC LIMIT 50`).all());
}));

app.get('/api/runs/:id', route(async (req, res) => {
  const run = db.prepare('SELECT * FROM runs WHERE id=?').get(Number(req.params.id));
  if (!run) return res.sendStatus(404);
  res.json({ ...run, deliveries: db.prepare('SELECT * FROM deliveries WHERE run_id=? ORDER BY id').all(run.id) });
}));

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
app.use('/api', (_req, res) => res.status(404).json({ error:'接口不存在' }));
// Serve the Mini App shell at `/` as well as client-side routes. Explicitly
// enabling the index avoids Express 5 treating the root request as a missing
// static asset and returning the JSON error handler response.
app.use(express.static(dist, { index: 'index.html' }));
app.use((req, res, next) => {
  if (req.method === 'GET' && req.accepts('html')) return res.sendFile(path.join(dist, 'index.html'));
  next();
});
app.use((error, _req, res, _next) => {
  console.error('Request:', safeTelegramError(error));
  res.status(error instanceof multer.MulterError ? 400 : error.telegramCode ? 502 : 400).json({ error: safeTelegramError(error) });
});

const port = Number(process.env.PORT || 8080);
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
function shutdown() { scheduler.stop(); server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 25000).unref(); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
