# 飞机助手项目规则

## 项目范围

- 项目：飞机助手（TGzhushou）
- 技术栈：Vite、Node.js/Express、PostgreSQL、Railway、Telegram Mini App
- 运行形态：Telegram Mini App
- 正式项目目录由 Workspace 管理；不要在规则中写死用户目录、盘符或 Shell。

## 规则层级

遵循：Codex 个性化指令 → Workspace 根 `AGENTS.md` → 本文件 → `agent/` 角色文件 → 当前任务。

本文件只记录飞机助手长期有效的项目约束，不复制通用模型指令或 Workspace 管理规则。

## Git 与发布边界

- `main` 保持可部署；开发使用 `feature/*` 分支。
- 保留现有代码、业务逻辑、设计资料和 Git 历史；不使用 reset、clean、stash 或覆盖式恢复来清理现场。
- 不创建工作树，不重建项目，不无关升级依赖或更换技术栈。
- 未经用户明确确认，不合并 `main`、推送、部署 Railway 或修改生产配置。
- 变更前确认工作树状态；只提交当前任务明确允许且已检查的文件。

## 平台要求

- 保持 Telegram Mini App 所需的 WebApp API、移动端安全区和触控交互兼容。
- 不新增桌面客户端、原生容器或普通网页专用行为。

## 工作流边界

- `AGENTS.md`：长期规则。
- `agent/`：角色职责。
- `.design/`：设计、交接、验证、回滚及历史资料。
- `.planning/`：仅用于真正复杂、跨阶段且需要恢复的任务。
- `docs/`：项目技术和交接文档。

不新增第二套 Workflow、Rules、Status、Audit、Memory 或项目管理系统；不因文件数量多而删除无法确认用途的历史资料。Skills、MCP 和插件按任务需要复用，不复制系统能力到 Workspace。
