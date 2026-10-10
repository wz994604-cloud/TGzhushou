# TGzhushou Railway 部署

本项目生产环境运行在 Railway，应用服务连接同项目 PostgreSQL，媒体文件保存到 Railway 持久化卷中的 `MEDIA_DIR`。

## 必需环境变量

- `ENTRY_BOT_TOKEN`：Telegram 入口机器人 Token。
- `ADMIN_TG_IDS`：允许管理后台的 Telegram 数字用户 ID。
- `CONFIG_KEY`：32 字节 Base64 密钥，用于加密机器人 Token。
- `ADMIN_LOGIN_ACCOUNTS`：网页登录账号 JSON 数组。
- `PUBLIC_URL`：Railway 对外 HTTPS 域名。
- `DATABASE_URL`：Railway PostgreSQL 连接地址。
- `MEDIA_DIR`：媒体文件目录，生产环境应挂载持久化卷。
- `FFA_API_BASE_URL`：可选，发发娱乐接口基础地址。

## 运行方式

```bash
npm install
npm run build
npm start
```

应用启动后 Scheduler 会持续检查定时任务。

## 健康检查

应用提供 `GET /healthz`，会同时验证 HTTP 服务与数据库连接。Railway 生产服务应将 Healthcheck Path 设置为 `/healthz`。

## 数据库

首次启动会按 `server/schema.sql` 初始化 PostgreSQL。生产数据库访问使用异步连接池。
