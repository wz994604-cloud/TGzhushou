import { getPublisher } from './publishers.js';
import { botCall, sendPhoto, safeTelegramError } from './telegram.js';
import { renderDelta, keyboard } from './format.js';
import { sendFormatted } from './sender.js';
import { nextSlot } from './schedule.js';

export function createScheduler(db, config, api = { botCall, sendPhoto }) {
  let running = false, timer = null;
  const publisher = async id => await getPublisher(db, config.configKey, id);

  const createRun = db.transaction(async (task, source, slotAt, key) => {
    const existing = await db.prepare('SELECT id FROM runs WHERE run_key=?').get(key);
    if (existing) return existing.id;
    const result = await db.prepare(`INSERT INTO runs(task_id,run_key,source,slot_at,status,bot_id,delta_json,buttons_json,media_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(task.id, key, source, slotAt, 'PENDING', task.bot_id, task.delta_json, task.buttons_json, task.media_id, Date.now());
    const targetIds = JSON.parse(task.target_ids_json);
    const add = db.prepare(`INSERT INTO deliveries(run_id,target_id,chat_id,title,status) VALUES(?,?,?,?,'PENDING')`);
    for (const id of targetIds) {
      const target = await db.prepare('SELECT * FROM targets WHERE id=? AND bot_id=?').get(id, task.bot_id);
      if (target) await add.run(result.lastInsertRowid, target.id, target.chat_id, target.title);
      else await db.prepare("INSERT INTO deliveries(run_id,target_id,chat_id,title,status,error_text,completed_at) VALUES(?,?,?,?,?,?,?)")
        .run(result.lastInsertRowid, id, '', `已删除目标 #${id}`, 'FAILED', '目标已删除，未发送', Date.now());
    }
    return Number(result.lastInsertRowid);
  });

  async function queueNow(taskId, requestKey, botId) {
    const key = String(requestKey || '');
    if (!/^[0-9a-f-]{36}$/i.test(key)) throw new Error('立即发布请求标识无效');
    const task = await db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId);
    if (!task || task.status === 'STOPPED') throw new Error('任务不存在或已停止');
    const bot = await publisher(botId);
    if (!bot || task.bot_id !== bot.id) throw new Error('任务所属发布机器人已变化');
    return await createRun(task, 'IMMEDIATE', Date.now(), `now:${task.id}:${key}`);
  }

  async function queueBroadcast(item, botId) {
    const bot = await publisher(botId);
    if (!bot) throw new Error('请先配置发布机器人');
    const players = Array.isArray(item.players) ? item.players : [];
    if (!players.length || players.length > 100000) throw new Error('请选择 1–100000 个有效用户');
    const now = Date.now();
    return await db.transaction(async () => {
      const result = await db.prepare(`INSERT INTO broadcasts(name,delta_json,buttons_json,media_id,bot_id,status,total_count,created_at)
        VALUES(?,?,?,?,?,'PENDING',?,?)`).run(item.name, item.deltaJson, item.buttonsJson, item.mediaId || null, bot.id, players.length, now);
      for (let offset = 0; offset < players.length; offset += 100) {
        const chunk = players.slice(offset, offset + 100);
        const values = chunk.flatMap(player => [result.lastInsertRowid, String(player.telegramId), String(player.displayName || '')]);
        await db.prepare(`INSERT INTO broadcast_deliveries(broadcast_id,telegram_id,display_name,status) VALUES ${chunk.map(() => "(?,?,?,'PENDING')").join(',')}`).run(...values);
      }
      return Number(result.lastInsertRowid);
    })();
  }

  async function queueDue(now) {
    const tasks = await db.prepare("SELECT * FROM tasks WHERE status='ACTIVE' AND next_at<=? ORDER BY next_at LIMIT 30").all(now);
    for (const task of tasks) {
      const schedule = JSON.parse(task.schedule_json);
      const next = schedule.kind === 'ONCE' ? null : nextSlot(schedule, Math.max(task.next_at + 1, now + 1));
      await db.transaction(async () => {
        const fresh = await db.prepare("SELECT * FROM tasks WHERE id=? AND status='ACTIVE' AND next_at=?").get(task.id, task.next_at);
        if (!fresh) return;
        if (schedule.kind === 'DAILY' && now - task.next_at > 60_000) {
          const runId = await createRun(fresh, 'SCHEDULED', task.next_at, `slot:${task.id}:${task.next_at}`);
          await db.prepare("UPDATE deliveries SET status='SKIPPED',error_text='服务错过时段，未补发；从下一个时间点继续',completed_at=? WHERE run_id=? AND status='PENDING'").run(now, runId);
          await db.prepare("UPDATE tasks SET next_at=?,updated_at=? WHERE id=?").run(next, now, task.id);
          return;
        }
        await createRun(fresh, 'SCHEDULED', task.next_at, `slot:${task.id}:${task.next_at}`);
        await db.prepare('UPDATE tasks SET next_at=?,status=?,updated_at=? WHERE id=?').run(next, next ? 'ACTIVE' : 'COMPLETED', now, task.id);
      })();
    }
  }

  async function sendOne(row, now) {
    const claimed = await db.prepare("UPDATE deliveries SET status='SENDING',started_at=? WHERE id=? AND status='PENDING'").run(now, row.id);
    if (!claimed.changes) return;
    let attempted = false;
    try {
      const bot = await publisher(row.bot_id);
      if (!bot || bot.id !== row.bot_id) throw new Error('发布机器人身份已变更');
      const target = await db.prepare('SELECT * FROM targets WHERE id=? AND bot_id=?').get(row.target_id, bot.id);
      if (!target || !target.can_publish) throw new Error('目标未登记或无发布权限');
      const member = await api.botCall(bot.token, 'getChatMember', { chat_id: row.chat_id, user_id: Number(bot.id) });
      if (!['administrator', 'creator'].includes(member.status) || target.chat_type === 'channel' && member.status !== 'creator' && !member.can_post_messages) throw new Error('目标管理员或发布权限不足');
      const formatted = renderDelta(JSON.parse(row.delta_json));
      const buttons = keyboard(JSON.parse(row.buttons_json));
      const media = row.media_id ? await db.prepare('SELECT * FROM media WHERE id=?').get(row.media_id) : null;
      if (row.media_id && !media) throw new Error('图片不存在');
      if (media && formatted.text.length > 1024) throw new Error('图片说明文字超过 1024 字符');
      attempted = true;
      const { sent } = await sendFormatted({ token:bot.token, chatId:row.chat_id,
        delta:JSON.parse(row.delta_json), buttons:JSON.parse(row.buttons_json), media, api });
      const returned = sent.entities || sent.caption_entities || [];
      const shown = returned.filter(entity => entity.type === 'custom_emoji').length;
      const notes = [];
      if (shown < formatted.customCount) notes.push(`正文专属表情返回 ${shown}/${formatted.customCount}，请核对目标实际显示`);
      const expectedIcons = buttons?.inline_keyboard?.flat().filter(button => button.icon_custom_emoji_id).map(button => button.icon_custom_emoji_id) || [];
      const returnedIcons = sent.reply_markup?.inline_keyboard?.flat().filter(button => button.icon_custom_emoji_id).map(button => button.icon_custom_emoji_id) || [];
      if (expectedIcons.some((id, index) => id !== returnedIcons[index])) notes.push('Telegram 返回的按钮专属表情与配置不一致，请核对目标实际显示');
      await db.prepare("UPDATE deliveries SET status='SUCCESS',telegram_message_id=?,error_text=?,completed_at=? WHERE id=?")
        .run(String(sent.message_id), notes.join('；') || null, Date.now(), row.id);
    } catch (error) {
      const status = !attempted || error.telegramCode ? 'FAILED' : 'UNKNOWN';
      await db.prepare('UPDATE deliveries SET status=?,error_text=?,completed_at=? WHERE id=?').run(status, safeTelegramError(error), Date.now(), row.id);
    }
  }

  async function sendBroadcastOne(row, now) {
    const claimed = await db.prepare("UPDATE broadcast_deliveries SET status='SENDING',started_at=? WHERE id=? AND status='PENDING'").run(now, row.id);
    if (!claimed.changes) return;
    let attempted = false;
    try {
      const bot = await publisher(row.bot_id);
      if (!bot || bot.id !== row.bot_id) throw new Error('发布机器人身份已变更');
      const formatted = renderDelta(JSON.parse(row.delta_json));
      const buttons = keyboard(JSON.parse(row.buttons_json));
      const media = row.media_id ? await db.prepare('SELECT * FROM media WHERE id=?').get(row.media_id) : null;
      if (row.media_id && !media) throw new Error('图片不存在');
      if (media && formatted.text.length > 1024) throw new Error('图片说明文字超过 1024 字符');
      attempted = true;
      const { sent } = await sendFormatted({ token:bot.token, chatId:row.telegram_id,
        delta:JSON.parse(row.delta_json), buttons:JSON.parse(row.buttons_json), media, api });
      await db.prepare("UPDATE broadcast_deliveries SET status='SUCCESS',telegram_message_id=?,completed_at=? WHERE id=?").run(String(sent.message_id), Date.now(), row.id);
    } catch (error) {
      const status = !attempted || error.telegramCode ? 'FAILED' : 'UNKNOWN';
      await db.prepare('UPDATE broadcast_deliveries SET status=?,error_text=?,completed_at=? WHERE id=?').run(status, safeTelegramError(error), Date.now(), row.id);
    }
  }

  async function tick({ maxDeliveries = 5, maxRuntimeMs = 20_000 } = {}) {
    if (running) return;
    running = true;
    try {
      const now = Date.now();
      const deadline = now + maxRuntimeMs;
      let sent = 0;
      await db.prepare("UPDATE deliveries SET status='UNKNOWN',error_text='发送过程被中断，请到 Telegram 核实；未自动重发',completed_at=? WHERE status='SENDING' AND started_at<?")
        .run(now, now - 300_000);
      await queueDue(now);
      const rows = await db.prepare(`SELECT d.*,r.bot_id,r.delta_json,r.buttons_json,r.media_id FROM deliveries d
        JOIN runs r ON r.id=d.run_id WHERE d.status='PENDING' ORDER BY d.id LIMIT ?`).all(maxDeliveries);
      for (const row of rows) {
        if (sent >= maxDeliveries || Date.now() > deadline - 5_000) break;
        await sendOne(row, Date.now()); sent++;
      }
      const broadcasts = await db.prepare(`SELECT d.*,b.bot_id,b.delta_json,b.buttons_json,b.media_id FROM broadcast_deliveries d
        JOIN broadcasts b ON b.id=d.broadcast_id WHERE d.status='PENDING' ORDER BY d.id LIMIT ?`).all(maxDeliveries - sent);
      for (const row of broadcasts) {
        if (sent >= maxDeliveries || Date.now() > deadline - 5_000) break;
        await sendBroadcastOne(row, Date.now()); sent++;
      }
      await db.prepare(`UPDATE broadcasts SET status='RUNNING',started_at=COALESCE(started_at,?) WHERE status='PENDING' AND EXISTS
        (SELECT 1 FROM broadcast_deliveries d WHERE d.broadcast_id=broadcasts.id AND d.status IN ('SENDING','SUCCESS','FAILED','UNKNOWN'))`).run(now);
      await db.prepare(`UPDATE broadcasts SET status='COMPLETED',completed_at=? WHERE status IN ('PENDING','RUNNING') AND NOT EXISTS
        (SELECT 1 FROM broadcast_deliveries d WHERE d.broadcast_id=broadcasts.id AND d.status IN ('PENDING','SENDING'))`).run(now);
      await db.prepare(`UPDATE runs SET status='COMPLETED' WHERE status='PENDING' AND NOT EXISTS
        (SELECT 1 FROM deliveries d WHERE d.run_id=runs.id AND d.status IN ('PENDING','SENDING'))`).run();
    } finally { running = false; }
  }

  function start() {
    if (timer) return;
    const run = () => tick().catch(error => console.error('Scheduler tick:', safeTelegramError(error)));
    run();
    timer = setInterval(run, 15_000);
    timer.unref?.();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  return { start, stop, tick, queueNow, queueDue, queueBroadcast, publisher };
}
