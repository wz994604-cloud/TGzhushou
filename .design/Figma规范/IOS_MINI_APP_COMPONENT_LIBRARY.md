# 飞机助手 Mini App · Apple iOS 组件库整理稿

状态：已完成（Figma 原位组件库已写入并通过结构与截图检查）  
更新时间：2026-10-10  
适用范围：Telegram Mini App，不适用于 macOS 桌面端。

## 1. 设计基准

- 视觉基准：Apple iOS / iPadOS Human Interface Guidelines。
- 字体：`-apple-system`、SF Pro Text/Display、PingFang SC、系统中文回退。
- 主色：System Blue `#007AFF`；深色模式 `#0A84FF`。
- 背景：Light `#F2F2F7`；卡片 `#FFFFFF`；Dark `#000000` / `#1C1C1E`。
- 文本：Primary `#1C1C1E`、Secondary `#3C3C43`、Tertiary `rgba(60,60,67,.60)`。
- 状态：Red `#FF3B30`、Orange `#FF9500`、Green `#34C759`、Blue `#007AFF`。
- 间距：4 / 8 / 12 / 16 / 20 / 24 / 32 px；主要布局遵循 8pt。
- 触控：可操作区域不小于 44×44 px。
- 安全区：顶部 `env(safe-area-inset-top)`，底部 `env(safe-area-inset-bottom)`。
- 禁用夸张渐变、品牌专属渐变、厚重阴影和复杂玻璃卡片。

## 2. Figma 页面结构

1. `Design System｜iOS`：颜色变量、文字样式、间距、圆角、阴影、无障碍说明。
2. `Components｜Mini App`：共享组件、Variants、状态矩阵和组件说明。
3. `Pages｜Mini App`：聊天、编写、素材、用户、任务、记录、设置七个页面实例。
4. `Prototype｜Flows`：返回、Tab 切换、Sheet、Alert、发布确认、删除确认和键盘态。

## 3. 组件清单与状态

### Navigation Bar

- `状态=默认/滚动后/返回态/机器人选择展开/禁用`
- 高度 52 px + 顶部安全区；标题 17/22 Semibold；返回按钮 44 px。
- 机器人选择使用原生 Picker 语义，不使用自定义渐变下拉框。

### Tab Bar

- `状态=默认/选中/按压/禁用`
- 高度 50 px + 底部安全区；图标 22 px；标签 10/13；选中使用 System Blue。
- 选中态使用颜色和字重表达，不使用大面积胶囊背景。

### Grouped List / Section

- `状态=默认/选中/按压/禁用/加载/空/错误`
- 背景 `systemGroupedBackground`，列表容器 `secondarySystemGroupedBackground`。
- 行高 52 px；分隔线 1 px；容器圆角 12 px。

### Button

- `样式=Filled/Tinted/Plain/Destructive`
- `状态=默认/按压/禁用/加载/成功/错误`
- Filled 使用 System Blue；Destructive 使用 System Red；加载时保留按钮宽度并显示进度。

### Text Field / Search Bar

- `状态=默认/聚焦/输入完成/错误/禁用/加载`
- 44 px 最小高度，16–17 px 文字，浅灰填充 `secondarySystemFill`，聚焦 2 px System Blue 外描边。
- 始终保留可见 Label；placeholder 不承担字段名称。

### Segmented Control / Picker / Toggle

- 使用系统分段控件和选择器语义。
- Toggle：`关闭/开启/禁用/加载`；开启使用 System Green。
- Picker：`默认/展开/选中/取消`；底部 Sheet 不遮挡安全区。

### Sheet / Alert / Action Sheet / Toast

- Sheet：从底部出现，圆角 14 px，支持拖拽指示条和取消。
- Alert：仅用于确认高风险操作；标题、说明、取消、危险动作顺序固定。
- Action Sheet：动作按风险排序，危险动作独立红色行。
- Toast：轻量状态反馈，不替代错误信息；距 Tab Bar 64 px 以上。

### Chat Bubble / Composer

- `方向=接收/发送`；`状态=默认/发送中/成功/失败/待核实/已编辑/已删除`
- 接收气泡白色，发送气泡浅绿色；最大宽度 84%；时间信息右下角。
- Composer 使用系统输入背景、圆形输入容器和 44 px 工具按钮。
- 键盘出现时保持输入区可见，滚动只发生在消息历史区域。

### User Cell / Task Cell / Media Cell

- `状态=默认/选中/按压/禁用/加载/空/错误`
- 头像 44 px；标题 17/22；辅助信息 13/18；操作区不小于 44 px。
- 任务状态使用文字 + 系统色，不只依赖颜色。

## 4. 页面交接要求

- `聊天`：Navigation Bar → 会话列表 → 消息历史 → Composer → Tab Bar。
- `编写活动`：标题 → 五步 Segmented Stepper → Grouped Form → Preview → 发布确认 Alert。
- `素材`：搜索 → Filter → Media Cell 列表 → 空态 / 上传错误。
- `用户`：搜索 → User Cell 列表 → 批量选择 → 空态 / 加载态。
- `自动化任务`：筛选 Segmented Control → Task Cell → Sheet 编辑 → 删除 Alert。
- `发布记录`：分组记录 → 展开详情 → 成功/失败/待核实状态。
- `设置`：Grouped List 分类 → Sheet/Form → 保存成功或错误反馈。

## 5. 无障碍与交互验收

- 所有按钮、图标、返回、关闭、筛选、上传控件有可读标签。
- 所有触控目标 ≥44 px；焦点环不裁切。
- 文本对比度：普通文字目标 ≥4.5:1，大字目标 ≥3:1。
- 支持 `prefers-reduced-motion`；不依赖动画理解状态。
- 发布、删除、停止任务均必须确认；失败状态保留输入内容并提供重试。
- 浅色与深色变量不改变信息层级和交互位置。

## 6. 与代码的对应关系

- CSS 实现：`src/mini-ios-glass.css`
- Mini App 结构：`src/workbench-shell.js`
- 业务与事件绑定：`src/main.js`（本次不改业务逻辑）
- Figma 组件命名使用本文件英文主名 + 中文说明；所有页面使用组件实例，不复制局部样式。
