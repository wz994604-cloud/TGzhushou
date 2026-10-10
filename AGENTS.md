# 飞机助手项目规则

## 项目范围

- 项目：飞机助手（TGzhushou）
- 技术栈：Vite、Node.js/Express、PostgreSQL、Railway、Tauri 2
- 长期支持平台：Windows 11 和 macOS
- 正式项目目录由 Workspace 管理；不要在规则中写死用户目录、盘符或 Shell。

## 规则层级

遵循：Codex 个性化指令 → Workspace 根 `AGENTS.md` → 本文件 → `agent/` 角色文件 → 当前任务。

本文件只记录飞机助手长期有效的项目约束，不复制通用模型指令或 Workspace 管理规则。

## 角色入口

- `agent/design-ui-designer.md`：UI 与 Figma 视觉规范，只读设计和源码，不修改业务代码。
- `agent/desktop-architect.md`：桌面端结构、布局、滚动和响应式方案，不修改业务代码。
- `agent/engineering-developer.md`：经用户确认后负责代码修改、必要验证和 Git 提交。

## Git 与发布边界

- `main` 保持可部署；开发使用 `feature/*` 分支。
- 保留现有代码、业务逻辑、设计资料和 Git 历史；不使用 reset、clean、stash 或覆盖式恢复来清理现场。
- 不创建工作树，不重建项目，不无关升级依赖或更换技术栈。
- 未经用户明确确认，不合并 `main`、推送、部署 Railway 或修改生产配置。
- 变更前确认工作树状态；只提交当前任务明确允许且已检查的文件。

## 双平台要求

- 新功能优先使用跨平台 API，不写死单平台路径、用户目录或 Shell。
- 必须使用平台专属能力时，采用最小范围的条件分支，避免复制整套业务逻辑。
- 不为适配 macOS 破坏 Windows 功能，也不为兼容 Windows 取消 macOS 支持。
- 当前机器无法验证的平台必须在报告中明确标记为未验证。
- Windows 构建说明仍以项目现有文档为准；macOS 构建入口只有在实际验证后才补充。

## 工作流边界

- `AGENTS.md`：长期规则。
- `agent/`：角色职责。
- `.design/`：设计、交接、验证、回滚及历史资料。
- `.planning/`：仅用于真正复杂、跨阶段且需要恢复的任务。
- `docs/`：项目技术和交接文档。

不新增第二套 Workflow、Rules、Status、Audit、Memory 或项目管理系统；不因文件数量多而删除无法确认用途的历史资料。Skills、MCP 和插件按任务需要复用，不复制系统能力到 Workspace。
