import { renderDelta, keyboard, normalizeButtons } from './format.js';
import { botCall, sendPhoto, sendMedia } from './telegram.js';

// One formatting path for scheduled, broadcast and direct-chat deliveries.
export async function sendFormatted({ token, chatId, delta, buttons = [], media = null, replyTo = null,
  api = { botCall, sendPhoto, sendMedia } }) {
  const formatted = media && (!Array.isArray(delta) || delta.every(op => typeof op.insert === 'string' && !op.insert.trim()))
    ? { text:'', entities:[], customCount:0 } : renderDelta(delta);
  const markup = keyboard(normalizeButtons(buttons));
  if (media && formatted.text.length > 1024) throw new Error('媒体说明文字超过 1024 字符');
  const reply = replyTo ? { reply_parameters: { message_id: Number(replyTo) } } : {};
  let sent;
  if (!media) sent = await api.botCall(token, 'sendMessage', {
    chat_id: chatId, text: formatted.text, entities: formatted.entities,
    ...(markup ? { reply_markup: markup } : {}), ...reply
  });
  else if (media.mime.startsWith('image/')) sent = await api.sendPhoto(token, chatId,
    media.file_path, media.mime, formatted.text, formatted.entities, markup, replyTo);
  else sent = await api.sendMedia(token, chatId, media, formatted.text, formatted.entities, markup, replyTo);
  return { sent, formatted, markup };
}
