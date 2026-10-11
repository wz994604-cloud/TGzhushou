import { db } from 'sdk';
import { requireTelegramUser, canManageBots } from '../lib/auth.js';

export default async function bootstrap(_input, ctx) {
  const account = await requireTelegramUser(ctx);
  const publishers = canManageBots(account)
    ? await db.all('SELECT id, username FROM publishers ORDER BY username')
    : await db.all(`SELECT p.id, p.username FROM publishers p
      JOIN publisher_permissions pp ON pp.publisher_id=p.id
      WHERE pp.user_id=:userId ORDER BY p.username`, { ':userId': account.id });
  const publisherId = publishers[0]?.id || '';
  const targets = publisherId ? await db.all('SELECT * FROM targets WHERE bot_id=:botId ORDER BY id DESC', { ':botId': publisherId }) : [];
  const tasks = publisherId ? await db.all(`SELECT id, name, status, schedule_json, next_at, updated_at, bot_id
    FROM tasks WHERE bot_id=:botId ORDER BY id DESC LIMIT 100`, { ':botId': publisherId }) : [];
  return {
    admin: {
      id: account.telegram_id,
      name: account.display_name,
      username: account.login_username || account.username,
      canManageBots: canManageBots(account),
      canManageAccounts: canManageBots(account),
    },
    timezone: 'Asia/Shanghai',
    publishers,
    publisher: publisherId ? publishers[0] : null,
    targets,
    tasks,
  };
}
