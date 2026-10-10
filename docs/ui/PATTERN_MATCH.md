# PATTERN_MATCH

## 产品类型与业务对象
- 类型：SaaS / 后台 dashboard。
- 主业务对象：Telegram 活动发布任务、发布目标、发布记录与机器人配置。
- 用户主任务：编写活动内容，选择目标，立即或按计划发布，并核对结果。

## 选用 recipe
- `recipes/saas-dashboard.md`：页面具备多模块导航、任务状态、设置表单、记录列表和高风险发布动作。

## 选用 patterns
1. `patterns/app-shell/shadcn-dashboard-shell`：借用稳定的品牌 shell、上下文 header、主操作靠近标题区的层级。
2. `patterns/states/loading-empty-error-set`：把 bootstrap、任务、记录、设置的 loading/empty/error/disabled 状态靠近对应区块表达。
3. `patterns/settings/settings-form-page`：设置页保持分组表单、保存状态和敏感配置隔离。

## 目标项目映射
- AppSidebar/SiteHeader -> 当前品牌 header 与 tab 导航；保留 Telegram Mini App 的窄屏优先特性。
- Task/DataTable -> 发布任务卡片与发布记录列表；继续使用现有 DOM/事件流，不引入 React。
- SettingsForm -> 机器人、目标、管理账号设置卡片。
- StateBlock -> locked、空任务、无目标、toast 错误和保存状态。

## 不照搬内容
- 不复制第三方品牌、示例数据、认证、计费或多租户逻辑。
- 不把当前工具改成营销 landing page。

## 许可与人工确认
- 仅借鉴公开 pattern 的布局关系和 token，未复制第三方代码。
- 发布、删除、Token 配置、目标外链等业务动作保持现有人工确认和后端校验边界。
