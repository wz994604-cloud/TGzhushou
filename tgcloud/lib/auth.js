import { db, EndpointError } from 'sdk';

export async function requireTelegramUser(ctx) {
  const user = ctx?.initData?.user;
  if (!user?.id) throw new EndpointError('需要从 Telegram Mini App 打开', { code: 'TELEGRAM_INIT_DATA_REQUIRED' });
  const telegramId = String(user.id);
  const now = Math.floor(Date.now() / 1000);
  await db.run(`INSERT INTO users (telegram_id, username, display_name, created_at, updated_at)
    VALUES (:telegramId, :username, :displayName, :now, :now)
    ON CONFLICT(telegram_id) DO UPDATE SET username=excluded.username, display_name=excluded.display_name, updated_at=excluded.updated_at`, {
    ':telegramId': telegramId,
    ':username': String(user.username || ''),
    ':displayName': [user.first_name, user.last_name].filter(Boolean).join(' ') || String(user.username || telegramId),
    ':now': now,
  });
  const account = await db.get(`SELECT u.id, u.telegram_id, u.username, u.display_name,
      a.can_manage_bots, a.login_username
    FROM users u JOIN administrators a ON a.user_id=u.id
    WHERE u.telegram_id=:telegramId`, { ':telegramId': telegramId });
  if (!account) throw new EndpointError('当前 Telegram 账号尚未配置为管理员', { code: 'ADMIN_NOT_CONFIGURED' });
  return account;
}

export function canManageBots(account) {
  return Boolean(account?.can_manage_bots);
}
