# 变更记录

2026-10-04：Railway 生产数据库切换为同项目 PostgreSQL，使用 DATABASE_URL 内网连接，按空库初始化，不迁移 Turso 数据。保留同步查询接口和本地 SQLite 测试，适配绑定参数、自增 ID、忽略重复插入、统计和删除清理触发器。部署通过后清理应用旧 Turso 连接变量；媒体 Blob 不变。

2026-10-03：运行时从本地 SQLite/Railway 迁移到 Turso、Vercel Functions 和 Vercel Blob。旧 SQLite 数据不迁移；空 Turso 由 `server/schema.sql` 初始化。

2026-10-03：修复 Turso 事务实际未提交/回滚的问题，Schema 改为批量初始化；私信入队改为原子批量写入。Vercel 发送与入口机器人回复使用函数后台任务，外部 Cron 每分钟处理最多 5 条并自动配置入口 Webhook；相关数据库、批量队列和消息测试已更新。
