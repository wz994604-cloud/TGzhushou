# TGzhushou Vercel 部署

本项目运行于 Vercel Functions，数据库使用全新 Turso，媒体使用 Vercel Blob。旧 SQLite、Railway、Docker 和本地持久化数据不再使用，也不会迁移旧数据。

## 必需环境变量

- `ENTRY_BOT_TOKEN`：Telegram 入口机器人 Token，从 BotFather 获取。
- `ADMIN_TG_IDS`：允许管理后台的 Telegram 数字用户 ID。
- `CONFIG_KEY`：32 字节 Base64 密钥，用于加密机器人 Token。
- `ADMIN_LOGIN_USERNAME` / `ADMIN_LOGIN_PASSWORD`：兼容的单个浏览器登录账号密码。`ADMIN_LOGIN_ACCOUNTS` 可配置 JSON 数组（例如 `[{"username":"admin","password":"..."},{"username":"operator","password":"..."}]`）以启用多个严格校验的账号；密码只来自环境变量，不写入数据库。
- `PUBLIC_URL`：Vercel 生产域名。
- `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`：Vercel Storage 的 Turso 集成面板获取。
- `BLOB_READ_WRITE_TOKEN`：Vercel Blob Storage 面板获取；未配置时媒体上传明确返回配置错误。
- `CRON_SECRET`：cron-job.org 请求 `POST /api/cron/tick` 时使用 `Authorization: Bearer <CRON_SECRET>`。

首次启动会按 `server/schema.sql` 在空 Turso 数据库初始化表结构。旧 SQLite 数据不读取、不迁移。

## 定时任务

使用 cron-job.org **每 1 分钟**调用：`POST https://<PUBLIC_URL>/api/cron/tick`，请求头 `Authorization: Bearer <CRON_SECRET>`。Vercel 会先确认接收，再在函数后台执行一批发送；每批最多 5 条，剩余消息由后续调用继续处理。首次调用还会为入口机器人设置菜单和 Webhook。

## 验证

```bash
npm run build
npm run check
```
