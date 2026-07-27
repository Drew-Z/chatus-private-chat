# Implementation Plan: 管理员安全与错误恢复

## Ordered Checklist

- [ ] 加载 frontend/platform specs 与任务文档。
- [ ] 添加 logout 成功/失败服务端与客户端行为测试。
- [ ] 修正 `adminLogout`、AdminWorkspace 和服务端 logout 契约。
- [ ] 为 AdminWorkspace/operations 建立显式初始状态与 retry。
- [ ] 增加运营列表分页/展开和 N/总数显示，覆盖 21 条边界。
- [ ] 新增共享 ConfirmDialog，替换 AdminWorkspace、Provider、LogicalModel、Memory 中全部 `window.confirm`。
- [ ] 增加焦点、键盘、busy/error 和原危险动作回归测试。
- [ ] 运行 `trellis-check`、Workspace Playwright 和五项全量验证。
- [ ] 更新管理员 frontend/platform spec，记录验证、提交、PR、合并并归档。

## Risky Files

- `src/worker.ts`
- `client/src/lib/api.ts`
- `client/src/components/AdminWorkspace.tsx`
- `client/src/components/AdminOperationsPanel.tsx`
- `client/src/components/*AdminPanel.tsx`

## Rollback Points

- logout 契约、状态机、列表与 Dialog 分成可审阅 commits。
- 如果 Dialog 回归影响破坏性动作，保留动作 API 不变并仅回滚共享 UI 层。
