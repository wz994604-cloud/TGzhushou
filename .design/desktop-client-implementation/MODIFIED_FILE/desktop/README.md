# 个人内部 Windows 客户端

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



