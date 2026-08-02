# 成员退出登录安全与恢复优化

## Goal

让成员退出登录具备端到端 fail-closed 语义：只有服务端确认 session 撤销并返回精确成功响应后，React 才离开当前成员工作区并清理成员草稿；任何网络、HTTP 或响应契约失败都保留工作区和草稿，向用户显示可重试错误。

## Background

- 成员客户端 `logout()` 当前吞掉网络失败且不检查 HTTP 状态或响应体（`client/src/lib/api.ts:1081-1083`）。
- `ChatWorkspace.handleLogout()` 在服务端确认前调用 `clearUserDrafts()`（`client/src/components/ChatWorkspace.tsx:309-314`）。
- `App` 在 `logout()` 返回后无条件进入 loading 并刷新 session（`client/src/App.tsx:79-83`）；当前 API 的吞错行为可使失败的成员会话重新挂载或进入不可解释的错误页。
- Worker 已等待 `session:<token>` 删除成功后才返回 `200`, `{ ok: true }` 和 clearing cookie（`src/worker.ts:2089-2103`）；顶层异常响应是无 clearing cookie 的 `500`（`src/worker.ts:1541-1549`）。
- 管理员退出已经有 exact `{ ok: true }` decoder、失败保留工作区和重试测试（`client/src/lib/api.ts:695-699`, `tests/client-api.test.ts:219-270`），但该合约尚未覆盖普通成员。
- 候选审计见 `research/candidate-audit.md`；用户选择按推荐优先完成本修复，其他候选不捆绑进入本任务。

## Requirements

- R1. `logout()` 必须通过共享 JSON 请求边界处理 network/non-2xx，并且只接受无额外字段的精确 `{ ok: true }`；空 body、非 JSON、`ok !== true` 和未知字段均以稳定 `ApiError` 拒绝。
- R2. 普通成员点击退出后，退出请求 pending 期间禁用重复退出和冲突账号操作，并通过可访问名称表达“正在退出登录”。
- R3. 退出失败时保持当前认证工作区、active conversation、输入草稿和本地 draft keys 不变；显示 `role=alert` 的同位错误及“重试退出”动作。
- R4. 只有 R1 的精确成功完成后，才清理当前成员的 draft keys，并让 `App` 刷新为当前部署允许的 guest/login 状态。
- R5. Worker 行为保持 fail-closed：session KV delete 失败返回 `500`、不发送 clearing cookie、原 session 仍可使用；后续重试成功才删除 session 并清 cookie。
- R6. 既有 revoke-all 和 permanent-delete 流程继续在其服务端操作成功后退出，不改变数据删除、MCP OAuth 或 guest cleanup 语义。
- R7. 错误、pending 和 retry UI 在桌面与 touch 390px 下不遮挡标题、连接状态、侧栏或 Composer，支持键盘和屏幕阅读器。
- R8. 测试只使用本地 Worker、deterministic fixtures 和 fake Provider；禁止 live model、真实 MCP/OAuth、synthetic production probe 和本地生产部署。
- R9. 生产仍只由 GitHub Actions 部署，保持 0.x SemVer，任何日志/artifact 不包含 access code、cookie、token、对话或草稿内容。

## Acceptance Criteria

- [x] AC1. Client API tests 证明 network、4xx/5xx、空/非 JSON 2xx、`ok:false` 和额外字段全部 reject；仅精确 `{ ok: true }` resolve。
- [x] AC2. Worker integration test 注入 member session KV delete 失败并证明 `500`、无 `Set-Cookie`、原 session 可继续访问；正常重试返回精确成功、清 cookie 且 session 失效。
- [x] AC3. 第一次退出失败后，React 成员工作区、active conversation、Composer 草稿和对应 localStorage draft 均保留，并显示可访问错误与“重试退出”。
- [x] AC4. 重试成功后才清除当前成员 draft keys，并进入 guest/login 状态；失败尝试和 retry 本身产生 0 次 Provider 调用。
- [x] AC5. pending 期间退出请求最多一个，退出按钮和冲突账号/MCP/会话操作不可重复触发，按钮具有准确的 pending label/tooltip。
- [x] AC6. Workspace Playwright 覆盖桌面和 touch 390px 的 pending/error/retry containment；本地 fake-Provider Agent Playwright 覆盖真实 App/Worker 的 fail-then-success 流程。
- [x] AC7. 现有 revoke-all、permanent-delete、管理员退出、guest/login 和 OAuth MCP 测试保持通过。
- [x] AC8. `npm run check:frontend`、`npm test`、`npm run test:browser:workspace`、`npm run test:browser:agent`、`npm run typecheck`、`npx wrangler deploy --dry-run`、`git diff --check` 和 `task.py validate-all` 全部通过。
- [ ] AC9. 相关 frontend code-spec 扩展为成员退出 fail-closed 合约；工作 commit、PR、exact-SHA CI/部署/验收和归档证据可追踪。

## Out of Scope

- R2/Queue readiness、配额感知 Composer、会话置顶、CI classifier 和测试池拆分；这些保留在候选审计中供后续独立任务处理。
- 修改管理员退出合约、成员登录凭据、session TTL 或 cookie 格式。
- 新增全账户 purge 屏障、ACL/分享、Provider finance、实例恢复或 legacy 退役能力。
- 任何真实 Provider/MCP/OAuth 或生产用户数据测试。
