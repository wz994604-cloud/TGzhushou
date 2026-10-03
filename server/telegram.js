async function readMedia(path){ if(String(path).startsWith('http')){const response=await fetch(path);if(!response.ok)throw new Error('media object unavailable');return Buffer.from(await response.arrayBuffer())} const fs=await import('node:fs/promises');return fs.readFile(path); }

const API = 'https://api.telegram.org/bot';

export function multipartCaptionEntities(text, entities) {
  const shift = index => (text.slice(0, index).match(/\n/g) || []).length;
  return entities.map(entity => {
    const start = entity.offset;
    const end = entity.offset + entity.length;
    return { ...entity, offset: start + shift(start), length: entity.length + shift(end) - shift(start) };
  });
}

export async function botCall(token, method, payload = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API}${token}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal
    });
    const body = await response.json();
    if (!body.ok) throw Object.assign(new Error(String(body.description || `Telegram ${response.status}`)), { telegramCode: body.error_code || response.status });
    return body.result;
  } finally { clearTimeout(timer); }
}

export async function sendPhoto(token, chatId, path, mime, caption, captionEntities, replyMarkup, replyTo = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const bytes = await readMedia(path);
    const form = new FormData();
    form.set('chat_id', String(chatId));
    form.set('photo', new Blob([bytes], { type: mime }), 'activity-image');
    if (caption) form.set('caption', caption);
    // Multipart form serialization writes LF text as CRLF. Telegram validates
    // entity offsets against that serialized caption, so account for the
    // inserted CR code unit without changing the stored task Delta.
    if (captionEntities.length) form.set('caption_entities', JSON.stringify(multipartCaptionEntities(caption, captionEntities)));
    if (replyMarkup) form.set('reply_markup', JSON.stringify(replyMarkup));
    if (replyTo) form.set('reply_parameters', JSON.stringify({ message_id:Number(replyTo) }));
    const response = await fetch(`${API}${token}/sendPhoto`, { method: 'POST', body: form, signal: controller.signal });
    const body = await response.json();
    if (!body.ok) throw Object.assign(new Error(String(body.description || `Telegram ${response.status}`)), { telegramCode: body.error_code || response.status });
    return body.result;
  } finally { clearTimeout(timer); }
}

export async function sendMedia(token, chatId, media, caption, entities, markup, replyTo = null) {
  const method = media.mime.startsWith('video/') ? 'sendVideo' : 'sendDocument';
  const field = method === 'sendVideo' ? 'video' : 'document';
  const form = new FormData();
  form.set('chat_id', String(chatId));
  form.set(field, new Blob([await readMedia(media.file_path)], { type:media.mime }), `activity-${field}`);
  if (caption) form.set('caption', caption);
  if (entities.length) form.set('caption_entities', JSON.stringify(multipartCaptionEntities(caption, entities)));
  if (markup) form.set('reply_markup', JSON.stringify(markup));
  if (replyTo) form.set('reply_parameters', JSON.stringify({ message_id:Number(replyTo) }));
  const response = await fetch(`${API}${token}/${method}`, { method:'POST', body:form, signal:AbortSignal.timeout(30000) });
  const body = await response.json();
  if (!body.ok) throw Object.assign(new Error(String(body.description || `Telegram ${response.status}`)), { telegramCode:body.error_code || response.status });
  return body.result;
}

export function safeTelegramError(error) {
  return String(error?.message || 'Telegram 请求失败').replace(/\b\d{5,}:[A-Za-z0-9_-]{20,}\b/g, '[REDACTED]').slice(0, 300);
}

export async function editPhoto(token, payload, media, caption, entities, replyMarkup) {
  const form=new FormData();
  form.set('chat_id',String(payload.chat_id));form.set('message_id',String(payload.message_id));
  form.set('photo',new Blob([await readMedia(media.file_path)],{type:media.mime}),'edited-image');
  form.set('media',JSON.stringify({type:'photo',media:'attach://photo',caption,caption_entities:multipartCaptionEntities(caption, entities)}));
  form.set('reply_markup',JSON.stringify(replyMarkup));
  const response=await fetch(`${API}${token}/editMessageMedia`,{method:'POST',body:form,signal:AbortSignal.timeout(30000)});
  const body=await response.json();
  if(!body.ok)throw Object.assign(new Error(body.description||'图片修改失败'),{telegramCode:body.error_code||response.status});
  return body.result;
}