import fs from 'node:fs';

function replaceOnce(path, oldText, newText) {
  const source = fs.readFileSync(path, 'utf8');
  const count = source.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${path}: expected 1 replacement, found ${count}`);
  fs.writeFileSync(path, source.replace(oldText, newText));
}

replaceOnce('server/chat.js',
  '  const botAvatars = new Map();\n',
  '  const botAvatars = new Map();\n  const missingChatAvatars = new Map();\n  const missingChatAvatarTtl = 6 * 60 * 60_000;\n');

replaceOnce('server/chat.js',
  "  async function refreshAvatar(bot, chatId) {\n    const chat = await botApi(bot.token, 'getChat', { chat_id: String(chatId) });\n    const fileId = chat?.photo?.big_file_id || chat?.photo?.small_file_id || null;\n    if (fileId) db.prepare('UPDATE conversations SET avatar_file_id=? WHERE bot_id=? AND chat_id=?').run(fileId,bot.id,String(chatId));\n  }\n",
  "  async function refreshAvatar(bot, chatId) {\n    const key = bot.id + ':' + chatId;\n    if ((missingChatAvatars.get(key) || 0) > Date.now()) return false;\n    const chat = await botApi(bot.token, 'getChat', { chat_id: String(chatId) });\n    const fileId = chat?.photo?.big_file_id || chat?.photo?.small_file_id || null;\n    if (fileId) {\n      db.prepare('UPDATE conversations SET avatar_file_id=? WHERE bot_id=? AND chat_id=?').run(fileId,bot.id,String(chatId));\n      missingChatAvatars.delete(key);\n      return true;\n    }\n    missingChatAvatars.set(key, Date.now() + missingChatAvatarTtl);\n    while (missingChatAvatars.size > 1000) missingChatAvatars.delete(missingChatAvatars.keys().next().value);\n    return false;\n  }\n");

replaceOnce('src/main.js',
  '  for (const img of document.querySelectorAll(\'#chatConversations [data-avatar-path]\')) {\n    try {\n',
  '  for (const img of document.querySelectorAll(\'#chatConversations [data-avatar-path]\')) {\n    if (!img.dataset.avatarPath) { img.remove(); continue; }\n    try {\n');

replaceOnce('src/main.js',
  'data-avatar-path="/chat/avatars/${encodeURIComponent(avatarBotId)}/${encodeURIComponent(c.chat_id)}"',
  'data-avatar-path="${c.avatar_file_id ? \'/chat/avatars/\' + encodeURIComponent(avatarBotId) + \'/\' + encodeURIComponent(c.chat_id) : \'\'}"');

replaceOnce('server/browser-auth.js',
  "      if (!/^[A-Za-z0-9_-]{3,64}$/.test(username) || password.length < 10 || password.length > 128 ||\n          !Array.isArray(publisherIds) || !publisherIds.length || publisherIds.length > 100 ||\n          publisherIds.some(id => typeof id !== 'string' || !/^\\d+$/.test(id) || !db.prepare('SELECT 1 FROM publishers WHERE id=?').get(id)))\n        return res.status(400).json({error:'账号须为 3–64 位字母数字或下划线，密码须为 10–128 位，并选择有效机器人'});\n",
  "      const validPublisherIds = new Set(db.prepare('SELECT id FROM publishers').all().map(row => String(row.id)));\n      if (!/^[A-Za-z0-9_-]{3,64}$/.test(username) || password.length < 10 || password.length > 128 ||\n          !Array.isArray(publisherIds) || !publisherIds.length || publisherIds.length > 100 ||\n          publisherIds.some(id => typeof id !== 'string' || !/^\\d+$/.test(id) || !validPublisherIds.has(id)))\n        return res.status(400).json({error:'账号须为 3–64 位字母数字或下划线，密码须为 10–128 位，并选择有效机器人'});\n");

replaceOnce('tests/entry.test.js',
  "    app: { post: (_path, fn) => { handler = fn; } },\n",
  "    app: { post: (route, fn) => { if (route === '/tg/entry') handler = fn; } },\n");

replaceOnce('tests/publisher-selection.test.js',
  "function request(path, method = 'GET', authenticated = true, selected = 'old-bot') {\n",
  "async function request(path, method = 'GET', authenticated = true, selected = 'old-bot') {\n");
replaceOnce('tests/publisher-selection.test.js',
  "  handler(req, { status(code) { status = code; return this; }, json(body) { error = body.error; } }, () => { next = true; });\n",
  "  await handler(req, { status(code) { status = code; return this; }, json(body) { error = body.error; } }, () => { next = true; });\n");
replaceOnce('tests/publisher-selection.test.js',
  "test('authenticated bootstrap recovers a stale selection without bypassing other routes', () => {\n  const recovered = request('/bootstrap');\n  assert.equal(recovered.next, true);\n  assert.equal(recovered.req.get('x-publisher-id'), undefined);\n  assert.equal(request('/bootstrap','GET',false).status, 401);\n  assert.equal(request('/publisher','POST').status, 401);\n  assert.equal(request('/players').status, 401);\n  const valid = request('/bootstrap','GET',true,'valid-bot');\n  assert.equal(valid.next, true);\n  assert.equal(valid.req.get('x-publisher-id'), 'valid-bot');\n});\n",
  "test('authenticated bootstrap recovers a stale selection without bypassing other routes', async () => {\n  const recovered = await request('/bootstrap');\n  assert.equal(recovered.next, true);\n  assert.equal(recovered.req.get('x-publisher-id'), undefined);\n  assert.equal((await request('/bootstrap','GET',false)).status, 401);\n  assert.equal((await request('/publisher','POST')).status, 401);\n  assert.equal((await request('/players')).status, 401);\n  const valid = await request('/bootstrap','GET',true,'valid-bot');\n  assert.equal(valid.next, true);\n  assert.equal(valid.req.get('x-publisher-id'), 'valid-bot');\n});\n");

const readme = [
  '# TGzhushou Railway 部署',
  '',
  '本项目生产环境运行在 Railway，应用服务连接同项目 PostgreSQL；媒体文件继续使用 Vercel Blob。SQLite 仅用于本地自动化测试。',
  '',
  '## 必需环境变量',
  '',
  '- `ENTRY_BOT_TOKEN`：Telegram 入口机器人 Token。',
  '- `ADMIN_TG_IDS`：允许管理后台的 Telegram 数字用户 ID。',
  '- `CONFIG_KEY`：32 字节 Base64 密钥，用于加密机器人 Token。',
  '- `ADMIN_LOGIN_USERNAME` / `ADMIN_LOGIN_PASSWORD`：兼容的单个网页登录账号密码；也可使用 `ADMIN_LOGIN_ACCOUNTS` 配置多个账号。',
  '- `PUBLIC_URL`：Railway 对外 HTTPS 域名。',
  '- `DATABASE_URL`：Railway PostgreSQL 连接地址，推荐使用同项目私网引用。',
  '- `BLOB_READ_WRITE_TOKEN`：Vercel Blob Token，用于媒体上传。',
  '- `FFA_API_BASE_URL`：可选，发发娱乐接口基础地址。',
  '',
  '## 运行方式',
  '',
  '```bash',
  'npm run build',
  'npm start',
  '```',
  '',
  '应用启动后内部 Scheduler 会持续检查定时任务，不依赖外部 cron 才能运行。`POST /api/cron/tick` 仅保留为兼容/人工触发入口；如果启用该入口，再配置 `CRON_SECRET`。',
  '',
  '## 健康检查',
  '',
  '应用提供 `GET /healthz`，会同时验证 HTTP 服务与数据库连接。Railway 生产服务应将 Healthcheck Path 设置为 `/healthz`。',
  '',
  '## 数据库',
  '',
  '首次启动会按 `server/schema.sql` 初始化 PostgreSQL。生产数据库访问使用异步连接池；本地测试继续使用 SQLite。',
  '',
  '## 验证',
  '',
  '```bash',
  'npm run check',
  'npm test',
  'npm run build',
  '```',
  ''
].join('\n');
fs.writeFileSync('README.md', readme);
