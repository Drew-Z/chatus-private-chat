# Implementation Plan: R2 文件工作区

## Ordered Checklist

- [ ] 加载 file attachment、Agent persistence、deployment specs。
- [ ] 增加 R2 binding/deployment config contract 和本地 test binding。
- [ ] 先写 schema migration、path normalization、ownership、version pin 与 outbox 测试。
- [ ] 实现 Root SQLite tables/upgrader 和文件 domain methods。
- [ ] 实现文件 API、R2 object lifecycle、download 和 reconciliation。
- [ ] 把 conversation refs 与 send 精确版本读取接入 Agent；保留 inline attachment。
- [ ] 实现 conversation/file/account 三层级联清理与失败重试。
- [ ] 新增 frontend 文件 workspace、搜索、目录上传、rename/pin/delete/download/retry 和 composer picker。
- [ ] 覆盖越权、并发、tombstone、版本漂移与 R2 partial failure。
- [ ] 运行 `trellis-check`、两类浏览器测试和五项全量验证。
- [ ] 更新 file/persistence/deployment specs，记录验证、提交、PR、合并并归档。

## Risky Files

- `wrangler.jsonc`
- `scripts/deployment-config.mjs`
- `src/agent/team-agent.ts`
- `src/worker.ts`
- `client/src/components/ChatWorkspace.tsx`
- `client/src/components/ConversationSidebar.tsx`

## Rollback Points

- binding/schema、backend lifecycle、frontend 分开提交。
- 不通过代码回滚删除 R2 数据；使用 tombstone/reconciliation 恢复。

