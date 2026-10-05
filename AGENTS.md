# 飞机助手项目协作规则

## 唯一工作目录

`C:\Users\win11\Projects\飞机助手`

## 固定身份

- UI 设计师：只读取 Figma、源码和方案，输出视觉规范，不修改代码。
- 桌面端架构工程师：只输出页面结构、布局、滚动和响应式方案，不修改代码。
- 开发工程师：唯一可以修改代码、运行验证、提交和推送的人。

## Git 规则

- `main` 保持可部署，不直接修改。
- 开发任务使用 `feature/*` 分支。
- 一次只允许一个开发任务修改代码。
- 不创建工作树，不复制 `.git`，不创建临时 Agent。
- 未经用户确认，不合并 `main`，不部署 Railway。

## 标准流程

需求 → UI 方案 → 桌面端架构方案 → 用户确认 → 开发实现 → 相关验证 → 提交推送 → 用户确认合并 → 用户确认部署。

## 开始任务必须读取

1. `AGENTS.md`
2. 当前身份文件
3. `README.md`
4. 与任务相关的 `.design`、`docs` 和测试文件
5. `git status --short --branch`、`git rev-parse HEAD`、`git fetch origin`

## 完成报告必须包含

当前目录、身份、分支、修改文件、提交哈希、验证命令及结果、推送/合并/部署状态和未解决项。

## 插件与本地工具调用规则

先判断任务类型，再调用最合适的已安装插件或本地工具；不要为了简单任务操控电脑。

### 已确认的本地工具

- Git：`C:\Users\win11\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe`
- Node.js：`C:\Users\win11\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`
- pnpm：`C:\Users\win11\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd`
- ripgrep：系统 `rg`
- PowerShell：系统 PowerShell / bundled `pwsh`
- 浏览器自动化：Browser Use、Chrome、统一计算机使用工具
- 文档/表格/PDF：bundled Python、Documents、Spreadsheets、PDF、Presentations 工具

### 可调用的插件类别

- GitHub：读取仓库、分支、提交、PR 和 CI；代码任务优先使用，不要先操控浏览器。
- Railway：读取部署、日志、域名和健康状态；只有用户明确确认才部署、回滚或修改配置。
- Figma：读取设计稿、页面和组件；UI 对齐任务优先使用 Figma。
- Browser Use / Chrome：只有需要真实页面交互、截图或验收时使用。
- Documents / Spreadsheets / PDF / Presentations：处理对应文件时使用专用插件。
- SQL Expert：需要数据库查询、结构或性能分析时使用。
- Notion / Sites：用户明确要求知识库或站点操作时使用。

### 调用优先级

1. 专用插件或 Git/API。
2. 本地命令行工具。
3. 浏览器自动化。
4. 只有前面都不能完成时，才进行电脑界面操作。

每次报告使用了哪些插件、本地工具、命令和结果；未使用的工具不需要调用。

## 执行效率与验证规则

### 先判断影响范围

- 文案、颜色、间距、单个组件或单个样式：只检查相关文件和相关页面。
- 单个函数、接口或服务：只运行对应单元测试、接口测试或构建步骤。
- 跨模块、认证、数据库、路由、权限、部署配置：才扩大到依赖链验证。
- 只有用户明确要求“全面检查”或变更影响全局时，才运行全局检查。

### 禁止浪费性重复工作

- 不重复读取已经确认且未变化的文件。
- 不因小修改重复运行全量测试、全量构建或全站浏览器测试。
- 不反复执行同一失败命令；先读取错误、定位原因，再做一次针对性修复。
- 不为了“看起来完整”新增无关测试、重构或格式化全项目。
- 不重复验证同一个事实；已有可靠结果时，验证下一个受影响环节。

### 修改前后边界

- 修改前先记录基线：当前分支、HEAD、工作树状态和受影响文件。
- 每次只处理一个明确需求，禁止顺手修其他问题。
- 修改后优先执行最小验证集：语法/类型检查 → 相关测试 → 必要构建 → 需要时再做页面验收。
- 验证失败时保留原始错误，修复后只重跑失败项及其直接依赖。
- 不把“命令启动了”写成“验证通过”；必须看到明确退出码或通过结果。

### 任务停止条件

- 需求已实现、相关验证通过、工作树状态清楚后停止。
- 如果出现需求不明确、基线不一致、分支异常或文件缺失，先报告事实并暂停，不猜测、不扩大修改。
- 一次任务最多输出一个实现分支和一份完成报告。

## Skills 使用规则

按任务需要调用，不默认全部启用：

- `codex-ui-designer-kit`：网页 UI 视觉和组件优化。
- `figma:figma-use`：读取 Figma 设计稿。
- `figma:figma-design-to-code`：确认设计稿后再转代码。
- `browser-use`：浏览器页面验收和问题复现。
- `planning-with-files`：仅用于真正跨阶段的长任务。
- `vercel:agent-browser-verify`：仅用于本地开发服务器验证，不用于部署。

### Skills 调用边界

- 不使用 Vercel 部署相关 Skills。
- 不默认调用全部插件或 Skills。
- 小改动只调用直接相关的 Skill。
- 调用前先读取对应 Skill 说明。
- Railway、GitHub、Figma 等服务优先使用专用插件或 API；本地文件和测试优先使用 CLI。
