2026-10-06
- 从 origin/main 59fdbe4 创建 feature/web-function-pages-v2。
- 修改 src/glass-theme-final.css：六个 Web 功能页共享浅色玻璃材质、表单/表格尺寸、非聊天滚动和纸飞机品牌图标；保留聊天与 Mini App。
- 新增/完成 tests/browser/web-function-pages.spec.js：六页内容与空状态、品牌颜色/阴影、页面错误检查。
- 验证：node --check src/main.js 通过；npm run build 通过（728 modules）；Playwright 2 passed。
- 回滚副本已恢复 BASELINE.css SHA256，源文件保持修改状态。
