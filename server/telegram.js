import fs from 'node:fs/promises';

const API = 'https://api.telegram.org/bot';

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

export async function sendPhoto(token, chatId, path, mime, caption, captionEntities, replyMarkup) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const bytes = await fs.readFile(path);
    const form = new FormData();
    form.set('chat_id', String(chatId));
    form.set('photo', new Blob([bytes], { type: mime }), 'activity-image');
    if (caption) form.set('caption', caption);
    if (captionEntities.length) form.set('caption_entities', JSON.stringify(captionEntities));
    if (replyMarkup) form.set('reply_markup', JSON.stringify(replyMarkup));
    const response = await fetch(`${API}${token}/sendPhoto`, { method: 'POST', body: form, signal: controller.signal });
    const body = await response.json();
    if (!body.ok) throw Object.assign(new Error(String(body.description || `Telegram ${response.status}`)), { telegramCode: body.error_code || response.status });
    return body.result;
  } finally { clearTimeout(timer); }
}

export function safeTelegramError(error) {
  return String(error?.message || 'Telegram 请求失败').replace(/\b\d{5,}:[A-Za-z0-9_-]{20,}\b/g, '[REDACTED]').slice(0, 300);
}
