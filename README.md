# TGzhushou Railway 部署

本项目生产环境运行在 Railway，应用服务连接同项目 PostgreSQL；媒体文件继续使用 Vercel Blob。SQLite 仅用于本地自动化测试。

## 必需环境变量

- `ENTRY_BOT_TOKEN`：Telegram 入口机器人 Token。
- `ADMIN_TG_IDS`：允许管理后台的 Telegram 数字用户 ID。
- `CONFIG_KEY`：32 字节 Base64 密钥，用于加密机器人 Token。
- `ADMIN_LOGIN_USERNAME` / `ADMIN_LOGIN_PASSWORD`：兼容的单个网页登录账号密码；也可使用 `ADMIN_LOGIN_ACCOUNTS` 配置多个账号。
- `PUBLIC_URL`：Railway 对外 HTTPS 域名。
- `DATABASE_URL`：Railway PostgreSQL 连接地址，推荐使用同项目私网引用。
- `BLOB_READ_WRITE_TOKEN`：Vercel Blob Token，用于媒体上传。
- `FFA_API_BASE_URL`：可选，发发娱乐接口基础地址。

## 运行方式

```bash
npm run build
npm start
```

应用启动后内部 Scheduler 会持续检查定时任务，不依赖外部 cron 才能运行。`POST /api/cron/tick` 仅保留为兼容/人工触发入口；如果启用该入口，再配置 `CRON_SECRET`。

## 健康检查

应用提供 `GET /healthz`，会同时验证 HTTP 服务与数据库连接。Railway 生产服务应将 Healthcheck Path 设置为 `/healthz`。

## 数据库

首次启动会按 `server/schema.sql` 初始化 PostgreSQL。生产数据库访问使用异步连接池；本地测试继续使用 SQLite。

## 验证

```bash
npm run check
npm test
npm run build
```
