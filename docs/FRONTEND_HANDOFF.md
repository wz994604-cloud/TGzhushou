# 前端开发交接说明

> 交接对象：前端开发者
>
> 依据：当前工作区源码和最近几轮部署后的运行时调整。
>
> 当前状态：代码已在本地完成清理和重构验证；本次工作没有执行合并或部署。由于期间已经多次部署，请以前端实际连接的 Railway 环境变量和 `/healthz` 结果为准。

## 已完成的运行时调整

项目运行目标已经统一为：

- Railway Node 服务
- Railway PostgreSQL
- Railway 持久化卷中的 `MEDIA_DIR`
- Telegram Bot API

以下旧运行方式已经删除：

- Vercel Functions、`vercel.json`、`api/index.js`
- Vercel Blob 媒体存储
- Turso / SQLite / 本地数据库分支
- 旧单机器人字段和旧玩家数据迁移
- `ADMIN_LOGIN_USERNAME` / `ADMIN_LOGIN_PASSWORD` 登录回退
- 人工 `POST /api/cron/tick` 和 `CRON_SECRET`
- 依赖 SQLite 的旧后端测试、浏览器测试和本地测试服务器

## 前端必须配合的配置

前端不再假设旧登录配置存在。网页登录账号来自 `ADMIN_LOGIN_ACCOUNTS`，由后端读取 JSON 数组。

媒体上传和读取依赖后端的 `MEDIA_DIR`。Railway 必须挂载持久化卷，否则服务重启后新上传的媒体会丢失。

入口机器人和浏览器登录仍依赖 `PUBLIC_URL`。该地址必须是对外可访问的 HTTPS 域名。

## 前端代码调整

已新增：

- `src/api-client.js`：统一 API 请求、Telegram 身份头和当前机器人头
- `src/main.js` 使用 `createApiClient()`，当前机器人切换会自动影响后续请求

后端相关上下文模块：

- `server/request-context.js`：统一当前机器人、权限和请求包装
- `server/media-store.js`：统一媒体文件读写
- `server/routes-tasks.js`：任务、任务状态、立即发布和发布记录路由

## 前端需要核对的行为

### 登录

验证以下路径：

- 账号密码登录
- Telegram `/login` 一次性链接登录
- 登出后 Cookie 被清除
- 账号没有机器人权限时不能切换或操作未授权机器人

旧的单账号环境变量不会再生效。

### 机器人选择

所有 API 请求都应使用：

```http
x-publisher-id: <当前机器人 ID>
```

`src/api-client.js` 已自动添加该请求头。不要在业务模块中重新实现一套请求函数。

切换机器人后应重新加载：

- 会话列表和消息
- 用户名单
- 目标群/频道
- 任务列表
- 素材和专属表情
- 发布记录

### 媒体

上传接口仍然返回数据库媒体记录：

```json
{ "id": 1, "mime": "image/jpeg", "size": 12345 }
```

媒体读取仍使用 `/api/media/:id` 或聊天附件对应接口。前端不应假设返回 Vercel Blob URL，也不要把媒体文件路径暴露给浏览器。

### 任务与发布

任务路由已经从入口文件拆到 `server/routes-tasks.js`，URL 保持不变：

- `POST /api/tasks`
- `PUT /api/tasks/:id`
- `GET /api/tasks/:id`
- `DELETE /api/tasks/:id`
- `POST /api/tasks/:id/status`
- `POST /api/tasks/:id/send`
- `GET /api/runs`
- `GET /api/runs/:id`

调度器对发送记录增加了 `claim_token` 和 `claimed_at`。前端不要把 `UNKNOWN` 自动当作失败重发，应该提示用户到 Telegram 核实。

### 草稿

浏览器草稿键已经升级到 v2：

```text
tgzhushou:draft:<publisher-id>:v2
```

旧的 `tgzhushou:draft:v1` 草稿不会恢复，这是有意行为。

## 前端继续开发建议

`src/main.js` 仍然包含较多页面逻辑，后续可以按下面边界继续拆分：

- `chat-ui.js`：会话列表、消息列表、回复、附件和轮询
- `publisher-ui.js`：机器人切换、绑定和目标管理
- `players-ui.js`：用户搜索、选择、导入和同步
- `tasks-ui.js`：活动编辑、任务状态和发布记录
- `assets-ui.js`：素材和专属表情包
- `auth-ui.js`：网页登录、登出和管理员账号

这些模块应通过共享状态和 `createApiClient()` 访问 API，不要重新引入旧的全局请求逻辑。

## 验证清单

部署前：

```bash
npm install
npm run check
npm test
npm run build
```

部署后：

1. `GET /healthz` 返回 `{ "ok": true, "database": true }`。
2. 登录一个有机器人权限的账号。
3. 切换两个机器人，确认数据不会串机器人。
4. 上传图片并重启服务，确认媒体仍可读取。
5. 创建手动任务并立即发布。
6. 创建定时任务，确认状态和下次发送时间正确。
7. 模拟请求超时，确认记录显示 `UNKNOWN`，不会自动重复发送。
8. 检查 Railway 日志中没有 PostgreSQL、媒体目录或认证错误。

## 当前验证结果

当前工作区最近一次验证结果：

- `npm run check`：通过
- `npm test`：14 个通过
- `npm run build`：通过

旧的数据库集成测试和浏览器测试已经删除，因为项目不再支持本地 SQLite/Turso 测试运行方式。生产环境验证需要在 Railway PostgreSQL 和持久化媒体卷上完成。

## 版本、分支、推送和 PR 信息

- 当前分支：`work`
- 当前基线提交：`64e57c2291099bdb13e190a9fcccd0ec540a97cd`
- 短提交哈希：`64e57c2`
- 基线提交时间：`2026-10-05 10:07:17 +0700`
- 基线提交说明：`Merge pull request #6 from wz994604-cloud/style/final-glass-theme`
- 远程仓库：`https://github.com/wz994604-cloud/TGzhushou.git`
- 当前分支上游：未配置
- 当前修改推送状态：未推送；工作区存在未提交修改
- 当前修改对应 PR：尚未创建
- 最近一个已存在的 PR：[#6](https://github.com/wz994604-cloud/TGzhushou/pull/6)

注意：`64e57c2` 是当前本地基线提交，不包含本次工作区的未提交修改。交接前需要由负责人创建提交、推送分支，再创建新的 PR。

## 最新规则和配置文件变更清单

以下文件承载了本轮运行规则、部署规则或前端交接规则的变化：

- `.env.example`
  - 删除旧单账号登录变量
  - 删除 Vercel Blob 和人工 Cron 配置
  - 增加 `ADMIN_LOGIN_ACCOUNTS`、`MEDIA_DIR`
  - `PUBLIC_URL` 改为 Railway 域名示例
- `README.md`
  - 运行平台统一为 Railway + PostgreSQL
  - 增加持久化媒体目录要求
  - 删除 Vercel、SQLite 和外部 Cron 说明
- `docs/CHANGES.md`
  - 记录运行时收敛、旧迁移删除和草稿版本升级
- `docs/UI_TELEGRAM_REDESIGN.md`
  - 删除隐藏兼容选择器描述
- `package.json`
  - 删除 Vercel、Turso 和 SQLite 依赖
  - `check` 增加新拆分模块
  - `test` 仅保留不依赖旧本地数据库的测试
- `server/schema.sql`
  - 删除旧 `players` 表
  - 增加发送记录租约字段：`claim_token`、`claimed_at`
- `docs/FRONTEND_HANDOFF.md`
  - 当前交接规则、接口行为、部署变量、验证清单和本版本信息

当前没有发现仓库内独立的 `AGENTS.md`、`RULES.md` 或其他额外规则文件；以上清单就是本轮实际变更的规则和配置文件。

## 云端最新提交核对（2026-10-06）

已执行：

```bash
git fetch --all --prune
```

云端最新状态：

- 远程默认分支：`origin/main`
- 云端最新提交：`4b334633be9def4b14fdac9406a2dfbf543acc02`
- 短提交哈希：`4b33463`
- 提交说明：`Merge pull request #8 from wz994604-cloud/feature/web-chat-refinement`
- 最新 PR：[PR #8](https://github.com/wz994604-cloud/TGzhushou/pull/8)
- 云端相对本地基线新增 5 个提交
- 当前本地 `work` 分支没有 upstream，且没有推送本次工作区修改
- 当前工作区存在未提交修改，不能把本地改动等同于云端最新代码

云端比本地基线新增的主要文件和规则：

- `AGENTS.md`：新增项目协作、分支、提交、推送、合并和部署规则
- `agent/design-ui-designer.md`：UI 设计师职责与禁止事项
- `agent/desktop-architect.md`：桌面端架构职责与禁止事项
- `agent/engineering-developer.md`：开发分支、验证、提交推送和等待合并确认规则
- `src/glass-theme-final.css`：最新版网页版聊天视觉调整
- `src/main.js`：网页版聊天和侧栏机器人入口调整
- `src/workbench-shell.js`：机器人选择器移动到侧栏
- `tests/browser/web-chat-refinement.spec.js`：网页版聊天验收测试
- `tests/web-chat-refinement.config.js`：对应 Playwright 配置

## 差异核对结论

当前本地工作区与 `origin/main` 不是同一基线。云端最新代码包含网页版聊天精修和新的项目规则，而当前本地清理改动仍基于 `64e57c2`。

因此，本地清理结果不能直接覆盖云端最新版本。后续应先从 `origin/main` 创建 `feature/*` 分支，再把需要保留的 Railway/PostgreSQL 清理和前端改动逐项迁移，解决 `src/main.js`、`src/glass-theme-final.css`、测试文件和规则文件的冲突，完成针对云端最新版本的验证后再提交、推送和创建 PR。

本交接文档此前的“已完成”描述仅代表旧本地工作区，不代表云端 `origin/main` 已包含这些改动。
