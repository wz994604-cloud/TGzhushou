import crypto from 'node:crypto';

export function parseAdminIds(raw) {
  const values = String(raw || '').split(/[,，;；\s]+/).map(value => value.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  if (!values.length || values.some(value => !/^\d+$/.test(value))) throw new Error('ADMIN_TG_IDS 必须是分隔的 Telegram 数字用户 ID');
  return [...new Set(values)];
}

export function verifyInitData(raw, botToken, adminId, now = Date.now()) {
  const allowedIds = (Array.isArray(adminId) ? adminId : String(adminId || '').split(','))
    .map(value => String(value).trim()).filter(Boolean);
  if (!raw || raw.length > 8192 || !botToken || !allowedIds.length || allowedIds.some(value => !/^\d+$/.test(value))) throw new Error('未授权');
  const params = new URLSearchParams(raw);
  if ([...params.keys()].some((key, index, keys) => keys.indexOf(key) !== index)) throw new Error('身份数据无效');
  const hash = params.get('hash');
  if (!/^[0-9a-f]{64}$/i.test(hash || '')) throw new Error('身份数据无效');
  const issued = Number(params.get('auth_date'));
  if (!Number.isSafeInteger(issued) || issued * 1000 > now + 60_000 || issued * 1000 < now - 86_400_000) throw new Error('登录已过期，请重新打开小程序');
  // Bot-token HMAC includes signature; only the third-party Ed25519 flow excludes it.
  const data = [...params.entries()].filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secret).update(data).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(hash, 'hex'))) throw new Error('身份签名无效');
  let user;
  try { user = JSON.parse(params.get('user') || '{}'); } catch { throw new Error('身份数据无效'); }
  if (!allowedIds.includes(String(user.id))) throw new Error('当前 Telegram 账号没有管理权限');
  return { id: String(user.id), name: [user.first_name, user.last_name].filter(Boolean).join(' ') };
}
