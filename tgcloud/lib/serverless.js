import { db, EndpointError, fetch as tgFetch, InputFile } from 'sdk';

export const now = () => Date.now();

export function fail(message, code = 'BAD_REQUEST') {
  throw new EndpointError(message, { code });
}

export function parseJson(value, fallback) {
  try { return value == null || value === '' ? fallback : JSON.parse(value); }
  catch { return fallback; }
}

export function textFromDelta(delta) {
  return (Array.isArray(delta) ? delta : []).map((op) => {
    if (typeof op?.insert === 'string') return op.insert;
    return op?.insert?.customEmoji?.alt || '';
  }).join('').replace(/\n+$/, '');
}

export function buttonsToMarkup(buttons) {
  const rows = new Map();
  for (const button of Array.isArray(buttons) ? buttons : []) {
    const row = Number.isInteger(button?.row) ? button.row : 0;
    const item = { text: String(button?.text || button?.iconAlt || '打开').slice(0, 64), url: String(button?.url || '') };
    if (!/^https:\/\//i.test(item.url) && !/^tg:\/\//i.test(item.url)) continue;
    const values = rows.get(row) || [];
    values.push(item);
    rows.set(row, values);
  }
  return [...rows.entries()].sort(([a], [b]) => a - b).map(([, values]) => values);
}

export async function botCall(token, method, params = {}) {
  if (!token) fail('机器人尚未配置', 'BOT_NOT_CONFIGURED');
  const response = await tgFetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true) {
    fail(String(payload?.description || `Telegram API ${method} 失败`), 'TELEGRAM_API_ERROR');
  }
  return payload.result;
}

export async function publisherFor(input, account, { required = true } = {}) {
  const requested = String(input?.publisherId || '').trim();
  const allowed = account?.can_manage_bots
    ? await db.all("SELECT id, username, token, role FROM publishers WHERE role='publisher' ORDER BY username")
    : await db.all(`SELECT p.id, p.username, p.token, p.role FROM publishers p
      JOIN publisher_permissions pp ON pp.publisher_id=p.id WHERE pp.user_id=:userId ORDER BY p.username`, { ':userId': account.id });
  const publisher = requested ? allowed.find((item) => String(item.id) === requested) || null : allowed[0] || null;
  if (requested && !publisher) fail('当前账号未授权该发布机器人', 'PUBLISHER_FORBIDDEN');
  if (!publisher && required) fail('请先配置发布机器人', 'PUBLISHER_REQUIRED');
  return publisher;
}

export function publicPublisher(row) {
  return row ? { id: String(row.id), username: String(row.username || '') } : null;
}

export async function rememberUser(ctx) {
  const user = ctx?.initData?.user;
  if (!user?.id) fail('需要从 Telegram Mini App 打开', 'TELEGRAM_INIT_DATA_REQUIRED');
  const telegramId = String(user.id);
  const timestamp = now();
  await db.run(`INSERT INTO users (telegram_id, username, display_name, created_at, updated_at)
    VALUES (:telegramId, :username, :displayName, :now, :now)
    ON CONFLICT(telegram_id) DO UPDATE SET username=excluded.username,
      display_name=excluded.display_name, updated_at=excluded.updated_at`, {
    ':telegramId': telegramId,
    ':username': String(user.username || ''),
    ':displayName': [user.first_name, user.last_name].filter(Boolean).join(' ') || String(user.username || telegramId),
    ':now': timestamp,
  });
  const account = await db.get(`SELECT u.id, u.telegram_id, u.username, u.display_name,
      a.can_manage_bots, a.login_username FROM users u JOIN administrators a ON a.user_id=u.id
      WHERE u.telegram_id=:telegramId`, { ':telegramId': telegramId });
  if (!account) fail('当前 Telegram 账号尚未配置为管理员', 'ADMIN_NOT_CONFIGURED');
  return account;
}

export async function sendMessage(token, chatId, delta, buttons = {}, extra = {}) {
  const text = textFromDelta(delta);
  const reply_markup = buttonsToMarkup(buttons);
  const params = { chat_id: chatId, text: text || ' ', ...extra };
  if (reply_markup.length) params.reply_markup = { inline_keyboard: reply_markup };
  return botCall(token, 'sendMessage', params);
}

export function mediaBytes(row) {
  const source = String(row?.file_path || '');
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(source);
  if (!match) return null;
  return { mime: row.mime || match[1], bytes: Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0)) };
}

export function base64(bytes) {
  let result = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) result += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(result);
}

export function safeId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function inputFile(bytes, name, mime) {
  return new InputFile(bytes, name, { type: mime });
}
