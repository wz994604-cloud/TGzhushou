export function registerTaskRoutes(app, deps) {
  const { db, route, currentBot, selectedBotId, scheduler, nextSlot, normalizeSchedule, renderDelta, normalizeButtons, kickScheduler } = deps;
  async function taskPayload(body, bot) {
    const name = String(body?.name || '').trim();
    if (!name || name.length > 100) throw new Error('活动名称应为 1–100 字');
    const delta = body?.delta?.ops;
    const formatted = renderDelta(delta);
    const buttons = normalizeButtons(body?.buttons || []);
    if (!Array.isArray(body?.targetIds)) throw new Error('请选择发布目标');
    const ids = [...new Set(body.targetIds.map(Number))];
    if (!ids.length || ids.length > 50 || ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('请选择 1–50 个发布目标');
    const placeholders = ids.map(() => '?').join(',');
    const targets = await db.prepare(`SELECT id FROM targets WHERE bot_id=? AND can_publish=1 AND id IN (${placeholders})`).all(bot.id, ...ids);
    if (targets.length !== ids.length) throw new Error('有目标不存在或缺少发布权限');
    const mediaId = body.mediaId ? Number(body.mediaId) : null;
    if (mediaId && !(await db.prepare('SELECT id FROM media WHERE id=?').get(mediaId))) throw new Error('图片不存在');
    if (mediaId && formatted.text.length > 1024) throw new Error('图片说明最多 1024 字符');
    const schedule = normalizeSchedule(body.schedule);
    return { name, delta: JSON.stringify(delta), buttons: JSON.stringify(buttons), ids: JSON.stringify(ids), schedule: JSON.stringify(schedule), mediaId };
  }

  app.post('/api/tasks', route(async (req, res) => {
    const bot = currentBot(req);
    if (!bot) throw new Error('请先配置发布机器人');
    const item = await taskPayload(req.body, bot), now = Date.now();
    const result = await db.prepare(`INSERT INTO tasks(name,delta_json,buttons_json,target_ids_json,schedule_json,media_id,bot_id,status,next_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(item.name,item.delta,item.buttons,item.ids,item.schedule,item.mediaId,bot.id,'DRAFT',null,now,now);
    res.json(await db.prepare('SELECT * FROM tasks WHERE id=?').get(result.lastInsertRowid));
  }));

  app.put('/api/tasks/:id', route(async (req, res) => {
    const bot = currentBot(req), id = Number(req.params.id);
    const old = await db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
    if (!old || old.bot_id !== bot?.id) throw new Error('任务不存在或所属机器人已变更');
    const item = await taskPayload(req.body, bot), now = Date.now();
    const schedule = JSON.parse(item.schedule);
    const active = old.status === 'ACTIVE' && schedule.kind !== 'MANUAL';
    await db.prepare(`UPDATE tasks SET name=?,delta_json=?,buttons_json=?,target_ids_json=?,schedule_json=?,media_id=?,status=?,next_at=?,updated_at=? WHERE id=?`)
      .run(item.name,item.delta,item.buttons,item.ids,item.schedule,item.mediaId,active?'ACTIVE':['PAUSED','STOPPED'].includes(old.status)?old.status:'DRAFT',active?nextSlot(schedule,now):null,now,id);
    res.json(await db.prepare('SELECT * FROM tasks WHERE id=?').get(id));
  }));

  app.get('/api/tasks/:id', route(async (req, res) => {
    const task = await db.prepare('SELECT * FROM tasks WHERE id=?').get(Number(req.params.id));
    if (!task || task.bot_id !== selectedBotId(req)) return res.sendStatus(404);
    res.json(task);
  }));

  app.delete('/api/tasks/:id', route(async (req, res) => {
    const id = Number(req.params.id), task = await db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
    if (!task || task.bot_id !== selectedBotId(req)) return res.sendStatus(404);
    if (task.status === 'ACTIVE' || (await db.prepare("SELECT 1 FROM deliveries WHERE status IN ('PENDING','SENDING') AND run_id IN (SELECT id FROM runs WHERE task_id=?)").get(id))) throw new Error('请先停止任务并等待正在发送的消息处理完毕');
    await db.transaction(async () => {
      await db.prepare('DELETE FROM deliveries WHERE run_id IN (SELECT id FROM runs WHERE task_id=?)').run(id);
      await db.prepare('DELETE FROM runs WHERE task_id=?').run(id);
      await db.prepare('DELETE FROM tasks WHERE id=?').run(id);
    })();
    res.json({ ok:true });
  }));

  app.post('/api/tasks/:id/status', route(async (req, res) => {
    const task = await db.prepare('SELECT * FROM tasks WHERE id=?').get(Number(req.params.id));
    if (!task || task.bot_id !== currentBot(req)?.id) throw new Error('任务不存在或所属机器人已变更');
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
    await db.transaction(async () => {
      await db.prepare('UPDATE tasks SET status=?,next_at=?,updated_at=? WHERE id=?').run(status,next,Date.now(),task.id);
      if (action !== 'activate') await db.prepare(`UPDATE deliveries SET status='CANCELLED',error_text='任务已暂停或停止',completed_at=? WHERE status='PENDING' AND run_id IN
        (SELECT id FROM runs WHERE task_id=? AND (?='stop' OR source='SCHEDULED'))`).run(Date.now(), task.id, action);
    })();
    res.json(await db.prepare('SELECT * FROM tasks WHERE id=?').get(task.id));
  }));

  app.post('/api/tasks/:id/send', route(async (req, res) => {
    const runId = await scheduler.queueNow(Number(req.params.id), req.body?.requestKey, selectedBotId(req));
    await kickScheduler('Immediate tick:');
    res.json({ runId });
  }));

  app.get('/api/runs', route(async (req, res) => {
    res.json(await db.prepare(`SELECT r.id,r.task_id,r.source,r.slot_at,r.status,r.created_at,t.name,
      COUNT(d.id) total,SUM(CASE WHEN d.status='SUCCESS' THEN 1 ELSE 0 END) success_count,SUM(CASE WHEN d.status='FAILED' THEN 1 ELSE 0 END) failed_count,SUM(CASE WHEN d.status='UNKNOWN' THEN 1 ELSE 0 END) unknown_count
      FROM runs r JOIN tasks t ON t.id=r.task_id LEFT JOIN deliveries d ON d.run_id=r.id
      WHERE r.bot_id=? GROUP BY r.id,t.name ORDER BY r.id DESC LIMIT 50`).all(selectedBotId(req)));
  }));

  app.get('/api/runs/:id', route(async (req, res) => {
    const run = await db.prepare('SELECT * FROM runs WHERE id=?').get(Number(req.params.id));
    if (!run || run.bot_id !== selectedBotId(req)) return res.sendStatus(404);
    res.json({ ...run, deliveries: await db.prepare(`SELECT d.*,c.deleted,c.state AS last_action,c.error AS last_error FROM deliveries d LEFT JOIN sent_changes c ON c.kind='runs' AND c.delivery_id=d.id WHERE d.run_id=? ORDER BY d.id`).all(run.id) });
  }));
}
