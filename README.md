# TGzhushou 活动助手

独立 Telegram Mini App，入口机器人负责打开后台，发布机器人负责发消息。此项目与 PCJND28 下注项目分开，使用独立 Railway 服务和数据库。

## 本地工作区

- 正式源码：`C:\Users\win11\Documents\GitHub\TGzhushou`
- U 盘源码备份：`F:\机器人和下注程序\TGzhushou`
- GitHub：<https://github.com/wz994604-cloud/TGzhushou>

## 开发与部署

使用 Node.js 24，执行 `npm ci`、`npm run build`。运行 `npm start` 前填写 `.env.example` 列出的环境变量。

Railway 沿用现有独立服务及 `main` 分支，不创建第二套生产机器人实例。

数据库和图片位于 `DATA_DIR`；生产部署应挂载持久卷到同一目录，避免重部署后丢失配置和任务。不要更换现有 `CONFIG_KEY`，否则原发布机器人 Token 解密会失败。

U 盘备份保存 GitHub 当前源码，不含 Token、密码、生产数据库、`node_modules`、构建产物或旧测试副本。

## 功能

- 图文、文字链接、自定义表情、彩色跳转按钮和纯表情按钮。
- 群/频道发布，手动、单次和每日时段定时任务。
- 停止后可重新开始，任务支持确认删除；按目标查看发布结果。
- 使用入口机器人的 Telegram 签名和 `ADMIN_TG_IDS` 管理员列表校验身份。
