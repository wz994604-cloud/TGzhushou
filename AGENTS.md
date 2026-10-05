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
- 未经用户确认，不合并 `main`，不部署 Railway 或 Vercel。

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

- GitHub / GitLab：读取仓库、分支、提交、PR 和 CI；代码任务优先使用，不要先操控浏览器。
- Railway / Vercel：读取部署、日志、域名和健康状态；只有用户明确确认才部署、回滚或修改配置。
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
