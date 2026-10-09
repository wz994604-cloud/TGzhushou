# 个人内部 Windows 11 / macOS 桌面客户端

## 开发

```powershell
npm run desktop:dev
```

## 构建内部便携版

`npm run desktop:build` 输出 `desktop/src-tauri/target/release/feiji-auto-desktop.exe`，可直接运行。

## 构建 NSIS 安装包（需要本机 NSIS 资源）

```powershell
npm run desktop:package
```

`npm run desktop:package` 仅在本机已有 NSIS 资源时使用。

本版本不配置代码签名、自动更新地址或 WebView2 运行时安装包；目标机器需已安装 WebView2。客户端只连接现有 `PUBLIC_URL` 服务，不启动 Express、PostgreSQL 或 Scheduler。




## macOS 说明

仓库包含 macOS 专用 Tauri 配置和界面适配文件。macOS 构建命令与签名流程尚未在本机验证，完成实际验证前不将其写成已通过的构建步骤。
