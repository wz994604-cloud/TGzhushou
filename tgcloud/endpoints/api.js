import { db, EndpointError, fetch as tgFetch } from 'sdk';
import {
  base64, botCall, fail, inputFile, mediaBytes, now, parseJson, publisherFor,
  publicPublisher, rememberUser, safeId, sendMessage, textFromDelta, buttonsToMarkup,
} from '../lib/serverless.js';

function routeParts(route) {
  const raw = String(route || '/');
  const [pathname, search = ''] = raw.split('?');
  const query = {};
  for (const pair of search.split('&')) {
    if (!pair) continue;
    const [key, value = ''] = pair.split('=');
    query[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
  }
  return { path: pathname.replace(/^\/api\/?/, '').replace(/^\//, ''), query };
}

function normaliseSchedule(schedule) {
  const value = schedule && typeof schedule === 'object' ? schedule : { kind: 'MANUAL' };
  const kind = ['MANUAL', 'ONCE', 'DAILY'].includes(value.kind) ? value.kind : 'MANUAL';
  if (kind === 'ONCE') return { kind, at: Number(value.at) || 0 };
  if (kind === 'DAILY') return { kind, start: String(value.start || '01:00'), end: String(value.end || '05:00'), interval: Math.max(1, Number(value.interval) || 30) };
  return { kind };
}

function nextAt(schedule) {
  if (schedule.kind === 'ONCE') return schedule.at > now() ? schedule.at : null;
  if (schedule.kind !== 'DAILY') return null;
  const [hour, minute] = String(schedule.start || '01:00').split(':').map(Number);
  const result = new Date();
  result.setHours(hour || 0, minute || 0, 0, 0);
  if (result.getTime() <= now()) result.setDate(result.getDate() + 1);
  return result.getTime();
}

async function responseBytes(response) {
  if (typeof response.bytes === 'function') return response.bytes();
  const chunks = [];
  for await (const chunk of response.body || []) chunks.push(chunk);
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

async function ensureTaskPayload(input, publisher) {
  const name = String(input?.name || '').trim();
  if (!name || name.length > 100) fail('活动名称应为 1–100 字', 'INVALID_TASK');
  const targetIds = [...new Set((Array.isArray(input?.targetIds) ? input.targetIds : []).map(safeId).filter(Boolean))];
  if (!targetIds.length) fail('请选择发布目标', 'TARGET_REQUIRED');
  const placeholders = targetIds.map(() => '?').join(',');
  const targets = await db.all(`SELECT id FROM targets WHERE bot_id=? AND can_publish=1 AND id IN (${placeholders})`, publisher.id, ...targetIds);
  if (targets.length !== targetIds.length) fail('有目标不存在或缺少发布权限', 'TARGET_INVALID');
  const mediaId = input?.mediaId ? safeId(input.mediaId) : null;
  if (mediaId && !await db.get('SELECT id FROM media WHERE id=:id', { ':id': mediaId })) fail('媒体不存在', 'MEDIA_NOT_FOUND');
  const delta = Array.isArray(input?.delta?.ops) ? input.delta.ops : [];
  const buttons = Array.isArray(input?.buttons) ? input.buttons : [];
  return { name, delta: JSON.stringify(delta), buttons: JSON.stringify(buttons), targetIds: JSON.stringify(targetIds), schedule: JSON.stringify(normaliseSchedule(input.schedule)), mediaId };
}

async function taskRun(task, publisher, source = 'MANUAL') {
  const runKey = `${task.id}:${source}:${now()}`;
  const run = await db.run(`INSERT INTO runs(task_id,run_key,source,slot_at,status,bot_id,delta_json,buttons_json,media_id,created_at)
    VALUES(:taskId,:runKey,:source,:slotAt,'PENDING',:botId,:delta,:buttons,:mediaId,:createdAt)`, {
    ':taskId': task.id, ':runKey': runKey, ':source': source, ':slotAt': now(), ':botId': publisher.id,
    ':delta': task.delta_json, ':buttons': task.buttons_json, ':mediaId': task.media_id, ':createdAt': now(),
  });
  const runId = Number(run.lastInsertRowid);
  const targets = await db.all(`SELECT id,chat_id,title FROM targets WHERE bot_id=:botId AND can_publish=1 AND id IN (${JSON.parse(task.target_ids_json).map(() => '?').join(',')})`, publisher.id, ...JSON.parse(task.target_ids_json));
  for (const target of targets) {
    await db.run(`INSERT INTO deliveries(run_id,target_id,chat_id,title,status,started_at) VALUES(:runId,:targetId,:chatId,:title,'SENDING',:startedAt)`, {
      ':runId': runId, ':targetId': target.id, ':chatId': target.chat_id, ':title': target.title, ':startedAt': now(),
    });
  }
  await db.run('UPDATE runs SET status=:status WHERE id=:id', { ':status': 'SENDING', ':id': runId });
  let success = 0;
  for (const target of targets) {
    const delivery = await db.get('SELECT id FROM deliveries WHERE run_id=:runId AND target_id=:targetId', { ':runId': runId, ':targetId': target.id });
    try {
      const media = task.media_id ? mediaBytes(await db.get('SELECT * FROM media WHERE id=:id', { ':id': task.media_id })) : null;
      const sent = media
        ? await botCall(publisher.token, media.mime.startsWith('image/') ? 'sendPhoto' : media.mime.startsWith('video/') ? 'sendVideo' : 'sendDocument', {
          chat_id: target.chat_id,
          caption: textFromDelta(parseJson(task.delta_json, [])) || undefined,
          reply_markup: { inline_keyboard: buttonsToMarkup(parseJson(task.buttons_json, [])) },
          [media.mime.startsWith('image/') ? 'photo' : media.mime.startsWith('video/') ? 'video' : 'document']: inputFile(media.bytes, `media-${task.media_id}`, media.mime),
        })
        : await sendMessage(publisher.token, target.chat_id, parseJson(task.delta_json, []), parseJson(task.buttons_json, []));
      success += 1;
      await db.run(`UPDATE deliveries SET status='SUCCESS',telegram_message_id=:messageId,completed_at=:completedAt WHERE id=:id`, { ':messageId': String(sent.message_id), ':completedAt': now(), ':id': delivery.id });
    } catch (error) {
      await db.run(`UPDATE deliveries SET status='FAILED',error_text=:error,completed_at=:completedAt WHERE id=:id`, { ':error': String(error.message || '发送失败').slice(0, 500), ':completedAt': now(), ':id': delivery.id });
    }
  }
  await db.run('UPDATE runs SET status=:status WHERE id=:id', { ':status': success === targets.length ? 'SUCCESS' : success ? 'UNKNOWN' : 'FAILED', ':id': runId });
  return runId;
}

async function handle(input, account) {
  const { path, query: routeQuery } = routeParts(input.route || input.path);
  const method = String(input.method || 'GET').toUpperCase();
  const body = input.body && typeof input.body === 'object' ? input.body : {};
  const query = { ...routeQuery, ...(input.query || {}) };

  if (path === 'bootstrap' && method === 'GET') {
    const publishers = account.can_manage_bots ? await db.all("SELECT id,username FROM publishers WHERE role='publisher' ORDER BY username") : await db.all(`SELECT p.id,p.username FROM publishers p JOIN publisher_permissions pp ON pp.publisher_id=p.id WHERE p.role='publisher' AND pp.user_id=:userId ORDER BY p.username`, { ':userId': account.id });
    const publisher = await publisherFor(input, account, { required: false });
    const targets = publisher ? await db.all('SELECT * FROM targets WHERE bot_id=:botId ORDER BY id DESC', { ':botId': publisher.id }) : [];
    const tasks = publisher ? await db.all('SELECT id,name,status,schedule_json,next_at,updated_at,bot_id FROM tasks WHERE bot_id=:botId ORDER BY id DESC LIMIT 100', { ':botId': publisher.id }) : [];
    return { admin: { id: account.telegram_id, name: account.display_name, username: account.login_username || account.username, canManageBots: Boolean(account.can_manage_bots), canManageAccounts: Boolean(account.can_manage_bots) }, timezone: 'Asia/Shanghai', publishers, publisher: publicPublisher(publisher), targets, tasks };
  }

  if (path === 'publisher' && method === 'POST') {
    if (!account.can_manage_bots) fail('仅管理员可配置机器人', 'FORBIDDEN');
    const token = String(body.token || '').trim();
    if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token)) fail('机器人 Token 格式不正确', 'INVALID_TOKEN');
    const identity = await botCall(token, 'getMe');
    if (!identity?.is_bot) fail('Token 不是机器人身份', 'INVALID_TOKEN');
    const id = String(identity.id);
    const timestamp = now();
    const role = body.role === 'entry' ? 'entry' : 'publisher';
    await db.run(`INSERT INTO publishers(id,username,token,role,created_at,updated_at) VALUES(:id,:username,:token,:role,:createdAt,:updatedAt)
      ON CONFLICT(id) DO UPDATE SET username=excluded.username,token=excluded.token,role=excluded.role,updated_at=excluded.updated_at`, { ':id': id, ':username': String(identity.username || id), ':token': token, ':role': role, ':createdAt': timestamp, ':updatedAt': timestamp });
    await db.run(`INSERT INTO publisher_permissions(publisher_id,user_id,role,created_at) SELECT :publisherId,:userId,'owner',:createdAt WHERE NOT EXISTS (SELECT 1 FROM publisher_permissions WHERE publisher_id=:publisherId AND user_id=:userId)`, { ':publisherId': id, ':userId': account.id, ':createdAt': timestamp });
    return publicPublisher({ id, username: identity.username });
  }

  const publisher = await publisherFor(input, account, { required: !['players', 'players/ids', 'ffa', 'ffa/sync', 'ffa/token', 'inbox/status', 'inbox/enable', 'inbox/disable'].includes(path) });
  if (path === 'targets' && method === 'POST') {
    const reference = String(body.reference || '').trim();
    const chat = await botCall(publisher.token, 'getChat', { chat_id: reference });
    if (!['group', 'supergroup', 'channel'].includes(chat.type)) fail('目标必须是群或频道', 'TARGET_INVALID');
    const member = await botCall(publisher.token, 'getChatMember', { chat_id: chat.id, user_id: Number(publisher.id) });
    const canPublish = ['administrator', 'creator'].includes(member.status) && (chat.type !== 'channel' || member.status === 'creator' || member.can_post_messages);
    const existing = await db.get('SELECT id FROM targets WHERE bot_id=:botId AND chat_id=:chatId', { ':botId': publisher.id, ':chatId': String(chat.id) });
    const values = { ':botId': publisher.id, ':chatId': String(chat.id), ':title': String(chat.title || chat.id), ':chatType': chat.type, ':username': chat.username || null, ':canPublish': canPublish ? 1 : 0, ':lastError': canPublish ? null : '机器人缺少发布权限' };
    if (existing) await db.run(`UPDATE targets SET title=:title,chat_type=:chatType,username=:username,can_publish=:canPublish,last_error=:lastError WHERE id=:id`, { ...values, ':id': existing.id });
    else await db.run(`INSERT INTO targets(bot_id,chat_id,title,chat_type,username,can_publish,last_error) VALUES(:botId,:chatId,:title,:chatType,:username,:canPublish,:lastError)`, values);
    return db.get('SELECT * FROM targets WHERE bot_id=:botId AND chat_id=:chatId', { ':botId': publisher.id, ':chatId': String(chat.id) });
  }
  const targetMatch = /^targets\/(\d+)$/.exec(path);
  if (targetMatch && method === 'DELETE') {
    await db.run('DELETE FROM targets WHERE id=:id AND bot_id=:botId', { ':id': Number(targetMatch[1]), ':botId': publisher.id });
    return { ok: true };
  }

  if ((path === 'players' || path === 'players/ids') && method === 'GET') return path === 'players/ids' ? { rows: [] } : { rows: [], total: 0, page: 1, size: 50 };
  if (path === 'ffa' || path === 'ffa/sync' || path === 'ffa/token') fail('玩家同步功能已停用', 'PLAYERS_DISABLED');

  const taskMatch = /^tasks\/(\d+)(?:\/(status|send))?$/.exec(path);
  if (path === 'tasks' && method === 'POST') {
    const item = await ensureTaskPayload(body, publisher); const timestamp = now();
    const result = await db.run(`INSERT INTO tasks(name,delta_json,buttons_json,target_ids_json,schedule_json,media_id,bot_id,status,next_at,created_at,updated_at)
      VALUES(:name,:delta,:buttons,:targetIds,:schedule,:mediaId,:botId,'DRAFT',NULL,:createdAt,:updatedAt)`, { ':name': item.name, ':delta': item.delta, ':buttons': item.buttons, ':targetIds': item.targetIds, ':schedule': item.schedule, ':mediaId': item.mediaId, ':botId': publisher.id, ':createdAt': timestamp, ':updatedAt': timestamp });
    return db.get('SELECT * FROM tasks WHERE id=:id', { ':id': result.lastInsertRowid });
  }
  if (taskMatch) {
    const id = Number(taskMatch[1]); const task = await db.get('SELECT * FROM tasks WHERE id=:id AND bot_id=:botId', { ':id': id, ':botId': publisher.id });
    if (!task) fail('任务不存在', 'NOT_FOUND');
    if (!taskMatch[2] && method === 'GET') return task;
    if (!taskMatch[2] && method === 'PUT') {
      const item = await ensureTaskPayload(body, publisher); const schedule = parseJson(item.schedule, { kind: 'MANUAL' }); const active = task.status === 'ACTIVE' && schedule.kind !== 'MANUAL';
      await db.run(`UPDATE tasks SET name=:name,delta_json=:delta,buttons_json=:buttons,target_ids_json=:targetIds,schedule_json=:schedule,media_id=:mediaId,status=:status,next_at=:nextAt,updated_at=:updatedAt WHERE id=:id`, { ...item, ':status': active ? 'ACTIVE' : ['PAUSED', 'STOPPED'].includes(task.status) ? task.status : 'DRAFT', ':nextAt': active ? nextAt(schedule) : null, ':updatedAt': now(), ':id': id });
      return db.get('SELECT * FROM tasks WHERE id=:id', { ':id': id });
    }
    if (!taskMatch[2] && method === 'DELETE') { await db.run('DELETE FROM deliveries WHERE run_id IN (SELECT id FROM runs WHERE task_id=:id)', { ':id': id }); await db.run('DELETE FROM runs WHERE task_id=:id', { ':id': id }); await db.run('DELETE FROM tasks WHERE id=:id', { ':id': id }); return { ok: true }; }
    if (taskMatch[2] === 'status' && method === 'POST') {
      const action = String(body.action || ''); if (!['activate', 'pause', 'stop'].includes(action)) fail('操作无效', 'INVALID_ACTION');
      const schedule = parseJson(task.schedule_json, { kind: 'MANUAL' }); const status = action === 'activate' ? schedule.kind === 'MANUAL' ? 'DRAFT' : 'ACTIVE' : action === 'pause' ? 'PAUSED' : 'STOPPED';
      await db.run('UPDATE tasks SET status=:status,next_at=:nextAt,updated_at=:updatedAt WHERE id=:id', { ':status': status, ':nextAt': action === 'activate' ? nextAt(schedule) : null, ':updatedAt': now(), ':id': id });
      return db.get('SELECT * FROM tasks WHERE id=:id', { ':id': id });
    }
    if (taskMatch[2] === 'send' && method === 'POST') return { runId: await taskRun(task, publisher, 'MANUAL') };
  }
  if (path === 'runs' && method === 'GET') return db.all(`SELECT r.id,r.task_id,r.source,r.slot_at,r.status,r.created_at,t.name,
    COUNT(d.id) total,SUM(CASE WHEN d.status='SUCCESS' THEN 1 ELSE 0 END) success_count,
    SUM(CASE WHEN d.status='FAILED' THEN 1 ELSE 0 END) failed_count,
    SUM(CASE WHEN d.status='UNKNOWN' THEN 1 ELSE 0 END) unknown_count
    FROM runs r JOIN tasks t ON t.id=r.task_id LEFT JOIN deliveries d ON d.run_id=r.id
    WHERE r.bot_id=:botId GROUP BY r.id,t.name ORDER BY r.id DESC LIMIT 50`, { ':botId': publisher.id });
  const runMatch = /^runs\/(\d+)$/.exec(path);
  if (runMatch && method === 'GET') { const run = await db.get('SELECT * FROM runs WHERE id=:id AND bot_id=:botId', { ':id': Number(runMatch[1]), ':botId': publisher.id }); if (!run) fail('发送记录不存在', 'NOT_FOUND'); return { ...run, deliveries: await db.all('SELECT * FROM deliveries WHERE run_id=:runId ORDER BY id', { ':runId': run.id }) }; }

  if (path === 'broadcasts' && method === 'GET') return [];
  if (path === 'broadcasts' && method === 'POST') fail('玩家群发已停用', 'PLAYERS_DISABLED');

  if (path === 'sticker-packs' && method === 'POST') {
    const name = /(?:^|\/addemoji\/)([A-Za-z0-9_]{5,64})\/?$/.exec(String(body.pack || '').trim())?.[1];
    if (!name) fail('请输入 Telegram addemoji 表情包链接或包名', 'INVALID_STICKER_PACK');
    const pack = await botCall(publisher.token, 'getStickerSet', { name });
    return { name, title: pack.title, stickers: (pack.stickers || []).filter((item) => item.custom_emoji_id).slice(0, 120).map((item) => ({ id: item.custom_emoji_id, alt: item.emoji || '🙂', thumbnailId: item.thumbnail?.file_id || (!item.is_animated && !item.is_video ? item.file_id : null) })) };
  }
  if (path === 'sticker-packs/saved' && method === 'GET') {
    const packs = await db.all('SELECT * FROM sticker_packs WHERE bot_id=:botId ORDER BY updated_at DESC', { ':botId': publisher.id });
    return { packs: await Promise.all(packs.map(async (pack) => ({ ...pack, stickers: await db.all('SELECT emoji_id AS id,alt,thumbnail_id AS thumbnailId FROM sticker_pack_items WHERE pack_id=:packId ORDER BY position', { ':packId': pack.id }) }))) };
  }

  const botAvatarMatch = /^chat\/bot-avatars\/([^/]+)$/.exec(path);
  if (botAvatarMatch && method === 'GET') {
    const photos = await botCall(publisher.token, 'getUserProfilePhotos', { user_id: Number(publisher.id), limit: 1 });
    const photo = photos?.photos?.[0]?.[0];
    if (!photo?.file_id) fail('头像不存在', 'NOT_FOUND');
    const file = await botCall(publisher.token, 'getFile', { file_id: photo.file_id });
    const response = await tgFetch(`https://api.telegram.org/file/bot${publisher.token}/${file.file_path}`);
    if (!response.ok) fail('头像读取失败', 'MEDIA_NOT_FOUND');
    return { __binary: true, mime: 'image/jpeg', base64: base64(await responseBytes(response)) };
  }
  const chatFileMatch = /^chat\/files\/(\d+)$/.exec(path);
  if (chatFileMatch && method === 'GET') {
    const message = await db.get('SELECT * FROM chat_messages WHERE id=:id AND bot_id=:botId', { ':id': Number(chatFileMatch[1]), ':botId': publisher.id });
    if (!message?.file_id) fail('附件不存在', 'NOT_FOUND');
    const file = await botCall(publisher.token, 'getFile', { file_id: message.file_id });
    const response = await tgFetch(`https://api.telegram.org/file/bot${publisher.token}/${file.file_path}`);
    if (!response.ok) fail('附件读取失败', 'MEDIA_NOT_FOUND');
    return { __binary: true, mime: message.media_kind === 'photo' ? 'image/jpeg' : message.media_kind === 'video' ? 'video/mp4' : 'application/octet-stream', base64: base64(await responseBytes(response)) };
  }

  const mediaMatch = /^media\/(\d+)$/.exec(path);
  if ((path === 'media' || path === 'chat/media') && method === 'POST') {
    const file = body.file || body.image; if (!file?.base64 || !file.mime) fail('请选择图片或文件', 'MEDIA_REQUIRED');
    const bytes = Uint8Array.from(atob(String(file.base64)), (char) => char.charCodeAt(0));
    if (bytes.length > 20 * 1024 * 1024) fail('文件不能超过 20 MB', 'MEDIA_TOO_LARGE');
    const digest = `${file.mime}:${bytes.length}:${base64(bytes).slice(0, 32)}`;
    const existing = await db.get('SELECT id,mime,size FROM media WHERE sha256=:sha', { ':sha': digest }); if (existing) return existing;
    const result = await db.run(`INSERT INTO media(sha256,mime,size,file_path,created_at) VALUES(:sha,:mime,:size,:path,:createdAt)`, { ':sha': digest, ':mime': String(file.mime), ':size': bytes.length, ':path': `data:${file.mime};base64,${file.base64}`, ':createdAt': now() });
    return { id: result.lastInsertRowid, mime: file.mime, size: bytes.length };
  }
  if (mediaMatch && method === 'GET') {
    const row = await db.get('SELECT * FROM media WHERE id=:id', { ':id': Number(mediaMatch[1]) }); const media = mediaBytes(row); if (!media) fail('媒体不存在', 'MEDIA_NOT_FOUND');
    return { __binary: true, mime: media.mime, base64: base64(media.bytes) };
  }

  if (path === 'chat/conversations' && method === 'GET') return { rows: await db.all('SELECT * FROM conversations WHERE bot_id=:botId ORDER BY last_message_at DESC LIMIT 100', { ':botId': publisher.id }), next: null, totalUnread: 0, cursor: 0 };
  const messagesMatch = /^chat\/conversations\/(-?\d+)\/messages$/.exec(path);
  if (messagesMatch && method === 'GET') return { rows: (await db.all('SELECT * FROM chat_messages WHERE bot_id=:botId AND chat_id=:chatId ORDER BY id DESC LIMIT 100', { ':botId': publisher.id, ':chatId': messagesMatch[1] })).reverse(), next: null };
  const readMatch = /^chat\/conversations\/(-?\d+)\/read$/.exec(path);
  if (readMatch && method === 'POST') { await db.run('UPDATE conversations SET unread_count=0,last_read_message_id=last_message_id,updated_at=:at WHERE bot_id=:botId AND chat_id=:chatId', { ':at': now(), ':botId': publisher.id, ':chatId': readMatch[1] }); return { ok: true }; }
  const sendChatMatch = /^chat\/conversations\/(-?\d+)\/send$/.exec(path);
  if (sendChatMatch && method === 'POST') {
    let sent;
    const media = body.mediaId ? mediaBytes(await db.get('SELECT * FROM media WHERE id=:id', { ':id': safeId(body.mediaId) })) : null;
    if (media) {
      const file = inputFile(media.bytes, `media-${body.mediaId}`, media.mime);
      const params = { chat_id: sendChatMatch[1], caption: textFromDelta(body.delta?.ops) || undefined, reply_markup: { inline_keyboard: buttonsToMarkup(body.buttons || []) }, reply_parameters: body.replyTo ? { message_id: Number(body.replyTo) } : undefined };
      if (media.mime.startsWith('image/')) sent = await botCall(publisher.token, 'sendPhoto', { ...params, photo: file });
      else if (media.mime.startsWith('video/')) sent = await botCall(publisher.token, 'sendVideo', { ...params, video: file });
      else sent = await botCall(publisher.token, 'sendDocument', { ...params, document: file });
    } else {
      sent = await sendMessage(publisher.token, sendChatMatch[1], body.delta?.ops, body.buttons || [], body.replyTo ? { reply_parameters: { message_id: Number(body.replyTo) } } : {});
    }
    return { message_id: String(sent.message_id), chat_id: sendChatMatch[1], text: textFromDelta(body.delta?.ops), direction: 'OUT', sent_at: Number(sent.date || Math.floor(now() / 1000)) * 1000 };
  }
  if (path === 'inbox/status' && method === 'GET') return { status: 'AVAILABLE', enabled: false, external: false };
  if (path === 'inbox/enable' && method === 'POST') return { status: 'READY', enabled: true };
  if (path === 'inbox/disable' && method === 'POST') return { status: 'AVAILABLE', enabled: false };
  if (path === 'sent' || path.startsWith('sent/')) return { ok: true };
  fail('接口不存在', 'NOT_FOUND');
}

export default async function apiEndpoint(input, ctx) {
  const account = await rememberUser(ctx);
  return handle(input || {}, account);
}
