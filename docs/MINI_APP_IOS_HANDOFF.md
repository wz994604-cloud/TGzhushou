# 飞机助手 Telegram Mini App · Apple iOS UI 开发交接

## 交接结论

本轮已完成 Mini App Apple iOS 视觉实现与 Figma 组件库交付，开发者可直接基于现有代码继续接入和完善，不需要修改 Telegram API、登录、机器人切换、任务、发布或数据库逻辑。

## 代码范围

- 已实现：`src/mini-ios-glass.css`
- 结构入口：`src/workbench-shell.js`
- 事件与业务：`src/main.js`（保持不变）
- 设计规范：`.design/Figma规范/IOS_MINI_APP_COMPONENT_LIBRARY.md`

## 设计 Token

```css
--ios-blue: #007aff;
--ios-bg: #f2f2f7;
--ios-grouped: #ffffff;
--ios-secondary: #f2f2f7;
--ios-tertiary: #e5e5ea;
--ios-label: #1c1c1e;
--ios-secondary-label: #3c3c43;
--ios-tertiary-label: rgba(60,60,67,.60);
--ios-separator: rgba(60,60,67,.18);
```

深色模式已预留 `prefers-color-scheme: dark` 变量结构。

## 开发验收

1. Mini App 只使用 Apple iOS 风格，不恢复桌面端玻璃渐变。
2. 顶部安全区、底部 Tab Bar 安全区和键盘弹出不遮挡内容。
3. 所有触控目标不小于 44×44 px。
4. 页面组件使用统一 System Blue、Grouped Background、Label 层级。
5. 高风险操作保留确认弹窗。
6. 失败、加载、空态和禁用态必须可见且可恢复。
7. Telegram WebApp 初始化、身份头、机器人选择和现有 API 行为保持不变。

## 已验证

- `npm run build`：通过。
- `npm test`：17 项通过。
- 回滚脚本：通过。

## Figma 交付

- Figma 文件：https://www.figma.com/design/W2pYNFrAmwsKX1MsUDdUZa?node-id=286-147
- 页面：`13｜Mini App｜Apple iOS Design System`
- 组件集：Button、Tab Bar Item、Text Field、List Row、Chat Bubble、Alert、Navigation Bar、Search Bar、Toggle、Segmented Control、Sheet、Feedback State、Toast。

## 尚需人工验收

真实 iPhone 与 Telegram 内置 WebView 的字体渲染、键盘高度、返回手势和深色模式需要在设备上确认。
