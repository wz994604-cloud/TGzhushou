# Telegram Serverless 迁移说明

> 状态：Phase 1 盘点完成；当前不改变 Railway 生产运行方式。

## 目标架构

- Telegram Mini App 前端：Vite `dist/`，由 Telegram Serverless 静态托管。
- Telegram 后端：迁移到 `tgcloud/handlers`、`tgcloud/endpoints`、`tgcloud/lib` 和 `tgcloud/schema.js`。
- Tauri 桌面端：保留现有 `desktop/`，通过同一套云端接口访问。
- 迁移完成前：Railway/Express/PostgreSQL 继续作为生产实现。

## 当前实现到 Serverless 的映射

| 当前模块 | Serverless 目标 | 迁移方式 |
|---|---|---|
| `server/index.js` Express 路由 | `tgcloud/endpoints/*` | 按资源拆分，不保留 Express 启动器 |
| `server/telegram.js` | `tgcloud/lib/telegram.js` | 优先改用 Serverless `sdk/api` |
| `server/chat.js` | `handlers/*` + `endpoints/chat/*` | 消息接收与 Mini App 查询分离 |
| `server/routes-tasks.js` | `endpoints/tasks/*` | 将权限检查移到 endpoint 上下文 |
| `server/publishers.js` | `endpoints/publishers/*` + `lib/publishers.js` | 保留多机器人数据模型，重新实现凭据管理 |
| `server/schema.sql` / `server/db.js` | `tgcloud/schema.js` | PostgreSQL SQL 改写为 Serverless SQLite schema/query builder |
| `server/auth.js` / `server/browser-auth.js` | endpoint `ctx.initData` 鉴权 | 移除网页登录一次性链接作为主路径 |
| `server/scheduler.js` | 事件触发或外部调度 | 不保留常驻 `setInterval` |
| `server/media-store.js` / `sharp` | Telegram 文件或外部对象存储 | 不依赖本地持久化目录 |

## 不能直接复制的部分

- Express `app.listen()`、中间件和 `multer` 上传流程。
- PostgreSQL 连接池、`DATABASE_URL` 和 PostgreSQL 专用 SQL。
- 依赖常驻进程的 15 秒 Scheduler。
- `MEDIA_DIR` 本地文件持久化。
- Tauri 原生能力本身不迁移到 Serverless。

## 迁移顺序

1. 建立 `tgcloud/` 项目骨架并部署最小 handler/endpoint。
2. 迁移 schema 和只读 bootstrap 接口。
3. 迁移 Telegram `initData` 鉴权与机器人选择。
4. 迁移任务、聊天、玩家和发布接口。
5. 迁移媒体和调度能力。
6. 切换前端 API 客户端，执行测试机器人验收。
7. 完成数据迁移与正式机器人切换。

## 当前生产保护

- 不删除或覆盖 Railway 服务。
- 不迁移正式 PostgreSQL 数据。
- 不更改正式机器人 webhook。
- 不在仓库保存 Serverless CLI Token。
