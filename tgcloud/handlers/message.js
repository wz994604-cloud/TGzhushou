import { api, db } from 'sdk';
import { now } from '../lib/serverless.js';

function messageText(message) {
  return String(message?.text || message?.caption || '').slice(0, 4096);
}

export default async function messageHandler(message) {
  const chatId = message?.chat?.id;
  if (chatId == null) return;
  const bot = await api.getMe();
  const botId = String(bot.id);
  const text = messageText(message);
  const timestamp = Number(message.date || Math.floor(now() / 1000)) * 1000;
  await db.run(`INSERT INTO conversations(bot_id,chat_id,chat_type,title,username,last_message_id,last_message_text,last_message_at,unread_count,updated_at)
    VALUES(:botId,:chatId,:chatType,:title,:username,:messageId,:text,:at,1,:updatedAt)
    ON CONFLICT(bot_id,chat_id) DO UPDATE SET title=excluded.title,username=excluded.username,
      last_message_id=excluded.last_message_id,last_message_text=excluded.last_message_text,
      last_message_at=excluded.last_message_at,unread_count=conversations.unread_count+1,updated_at=excluded.updated_at`, {
    ':botId': botId,
    ':chatId': String(chatId),
    ':chatType': String(message.chat?.type || ''),
    ':title': String(message.chat?.title || [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || ''),
    ':username': String(message.chat?.username || message.from?.username || ''),
    ':messageId': String(message.message_id || ''),
    ':text': text,
    ':at': timestamp,
    ':updatedAt': now(),
  });
  await db.run(`INSERT OR IGNORE INTO chat_messages(bot_id,chat_id,telegram_message_id,direction,from_id,text,sent_at,status)
    VALUES(:botId,:chatId,:messageId,'IN',:fromId,:text,:sentAt,'SUCCESS')`, {
    ':botId': botId, ':chatId': String(chatId), ':messageId': String(message.message_id || ''),
    ':fromId': String(message.from?.id || ''), ':text': text, ':sentAt': timestamp,
  });
  await db.run('INSERT INTO chat_events(bot_id,chat_id,created_at) VALUES(:botId,:chatId,:createdAt)', { ':botId': botId, ':chatId': String(chatId), ':createdAt': now() });
  if (/^\/start(?:@\w+)?(?:\s|$)/.test(text)) {
    await api.sendMessage({ chat_id: chatId, text: '欢迎使用飞机助手。请打开下方 Mini App 进入工作台。' });
  }
}
