# DESIGN

## 主题
深海蓝工作台：`#101D32` 导航、白色顶栏、`#F5F8FC` 内容底、`#E3E9F1` 边框、`#2586F5` 主强调、`#152238` 正文。

## 变更位置
- `src/style.css`：增加 web surface token，统一 rail/topbar/card/chat/preview 表面；补充聊天空态抽象插画和已选聊天低对比点阵背景。
- 不新增页面、不改 `src/main.js` 业务逻辑；现有 `workbench-shell.js` 继续负责桌面/ Mini App 结构。

## 页面分工
- 未选聊天：抽象蓝色空态仅出现在 `.chat-empty-state`。
- 已选聊天：极浅蓝灰点阵只出现在 `.chat-main`，消息气泡和输入区保持白色主视觉。
- 活动编辑：仅 `.telegram-preview-body` 使用聊天背景；其他编辑模块使用白色卡片。
- 素材、用户、任务、记录、设置：统一浅蓝灰底 + 白色卡片。
- Mini App：不覆盖 `html[data-surface=mini]` token 和单栏结构。

## 视觉 QA
先执行 `npm run build`；如启动本地服务，再运行现有截图审查。此轮不触碰业务 API 和真实数据。
