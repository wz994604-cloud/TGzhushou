# Pattern Match

- 产品类型：SaaS / 运营工作台；主业务对象是 Telegram 会话、发布任务、素材和机器人配置。
- Recipe：`saas-dashboard`，因为页面有固定导航、会话列表、任务/记录表格和设置表单。
- 采用模式：`app-shell/vite-shadcn-admin-shell`（固定侧栏 + 顶栏 + 工作区）；`states/loading-empty-error-set`（空状态、加载、错误状态保持现有真实数据路径）。
- 页面映射：app rail 对应功能导航；chat list 对应会话集合；editor/settings 对应工作流表单；logs/tasks 对应运营记录。
- 只借鉴布局和状态层级，不复制品牌资产、假数据或外部代码。
- 人工确认点：颜色/背景为视觉改动；不改变 API、权限、Token 或发送行为。
