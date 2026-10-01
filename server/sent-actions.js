import { renderDelta, normalizeButtons, keyboard } from './format.js';
import { botCall, editPhoto, safeTelegramError } from './telegram.js';

export function sentActions(db, publisher, call = botCall, photo = editPhoto) {
  db.exec(`CREATE TABLE IF NOT EXISTS sent_changes(
    kind TEXT NOT NULL, delivery_id INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
    delta_json TEXT, buttons_json TEXT, media_id INTEGER, state TEXT, error TEXT, updated_at INTEGER,
    PRIMARY KEY(kind,delivery_id));
    CREATE TRIGGER IF NOT EXISTS sent_changes_delivery_cleanup AFTER DELETE ON deliveries
    BEGIN DELETE FROM sent_changes WHERE kind='runs' AND delivery_id=OLD.id; END;
    CREATE TRIGGER IF NOT EXISTS sent_changes_broadcast_cleanup AFTER DELETE ON broadcast_deliveries
    BEGIN DELETE FROM sent_changes WHERE kind='broadcasts' AND delivery_id=OLD.id; END;
    UPDATE sent_changes SET state='UNKNOWN',error='上次操作中断，请核对 Telegram 消息后再操作' WHERE state='PROCESSING';`);
  const busy = new Set();
  function read(kind, id) {
    if (!['runs','broadcasts'].includes(kind)) throw new Error('记录类型无效');
    const table=kind==='runs'?'deliveries':'broadcast_deliveries', parent=kind==='runs'?'run_id':'broadcast_id';
    const row=db.prepare(`SELECT d.*,b.bot_id,b.delta_json,b.buttons_json,b.media_id FROM ${table} d JOIN ${kind} b ON b.id=d.${parent} WHERE d.id=?`).get(id);
    if(!row || row.status!=='SUCCESS' || !row.telegram_message_id) throw new Error('请选择发送成功的消息');
    const change=db.prepare('SELECT * FROM sent_changes WHERE kind=? AND delivery_id=?').get(kind,id);
    return {...row, media_id:change?.media_id??row.media_id,delta_json:change?.delta_json??row.delta_json,buttons_json:change?.buttons_json??row.buttons_json,deleted:!!change?.deleted,last_action:change?.state,last_error:change?.error};
  }
  async function act(kind,id,body) {
    const row=read(kind,id), bot=publisher(), key=kind+':'+id;
    if(!bot || bot.id!==row.bot_id) throw new Error('请使用原发送机器人操作');
    if(busy.has(key)) throw new Error('该消息正在处理中');
    if(!['edit','delete'].includes(body.action)) throw new Error('操作无效');
    if(row.deleted) throw new Error('消息已经删除');
    if(body.action==='delete' && Date.now()-(row.started_at||row.completed_at)>=48*3600000) throw new Error('已超过 Telegram 48 小时删除期限');
    let formatted,buttons,media;
    if(body.action==='edit') {
      formatted=renderDelta(body.delta?.ops);buttons=normalizeButtons(body.buttons||[]);
      if(body.mediaId){media=db.prepare('SELECT * FROM media WHERE id=?').get(Number(body.mediaId));if(!media)throw new Error('图片不存在');}
      if((row.media_id||media) && formatted.text.length>1024) throw new Error('图片说明最多 1024 字符');
    }
    busy.add(key);
    db.prepare(`INSERT INTO sent_changes(kind,delivery_id,state,updated_at) VALUES(?,?,'PROCESSING',?) ON CONFLICT(kind,delivery_id) DO UPDATE SET state='PROCESSING',error=NULL,updated_at=excluded.updated_at`).run(kind,id,Date.now());
    try {
      const payload={chat_id:row.chat_id||row.telegram_id,message_id:Number(row.telegram_message_id)};
      if(body.action==='delete') await call(bot.token,'deleteMessage',payload);
      else {
        const markup=keyboard(buttons)||{inline_keyboard:[]};
        try { if(media)await photo(bot.token,payload,media,formatted.text,formatted.entities,markup);else await call(bot.token,row.media_id?'editMessageCaption':'editMessageText',{...payload,...(row.media_id?{caption:formatted.text,caption_entities:formatted.entities}:{text:formatted.text,entities:formatted.entities}),reply_markup:markup}); }
        catch(error){if(!/message is not modified/i.test(error.message))throw error;}
      }
      db.prepare(`UPDATE sent_changes SET deleted=?,delta_json=?,buttons_json=?,state=?,error=NULL,updated_at=? WHERE kind=? AND delivery_id=?`).run(body.action==='delete'?1:0,body.action==='edit'?JSON.stringify(body.delta.ops):row.delta_json,body.action==='edit'?JSON.stringify(buttons):row.buttons_json,body.action==='edit'?'EDITED':'DELETED',Date.now(),kind,id);
      db.prepare('UPDATE sent_changes SET media_id=? WHERE kind=? AND delivery_id=?').run(media?.id||row.media_id||null,kind,id);
      return {ok:true,id,state:body.action==='edit'?'EDITED':'DELETED'};
    } catch(error) {
      db.prepare('UPDATE sent_changes SET state=?,error=?,updated_at=? WHERE kind=? AND delivery_id=?').run(error.telegramCode?'FAILED':'UNKNOWN',safeTelegramError(error),Date.now(),kind,id);
      throw error;
    } finally {busy.delete(key);}
  }
  return {read,act};
}
