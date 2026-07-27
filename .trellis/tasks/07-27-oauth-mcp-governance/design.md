# Design: OAuth MCP 授权与治理

## Config Contract

MCP auth 从旧 `authType/secretRef` 演进为 versioned union：none、bearer、x-api-key、oauth2。OAuth 配置含 issuer、clientId、scopes、固定 callbackPath 和 configRevision；完整 callback 由服务端 origin + 固定路径派生。dual-read/new-write 保证旧配置兼容。

## OAuth Flow

- start: 成员认证后生成 state/verifier/S256 challenge，短期 server-side state 绑定 member/session/server/revision，只返回 authorize URL。
- callback: 一次性消费 state，校验 TTL/session/server/revision，服务端换 token并加密保存，固定重定向到 Chatus UI。
- projection: 只返回 server id、connected/review-required、granted scope names 和 expiry 状态。
- revoke: 删除当前成员/server token 与相关短期 state。

## Token Storage

新增独立 `mcp-oauth-token` managed-secret namespace，key 与 AAD 绑定 member+server+v1。密文 payload 含 access/refresh token、expiry、grantedScopes、issuer/clientId/configRevision/reviewRevision。不可解密、revision mismatch 或 scope mismatch fail closed。

## Drift Review

discovery 保存 schema fingerprint、安全 annotation fingerprint、side-effect classification 和 reviewRevision。runtime 每次 call 前重取工具并比较；漂移持久写 review-required/disabled。conversation trust key 包含 reviewRevision，自然失效。管理员重审产生新 revision。

## Side Effects

read-only 可 first-per-conversation。write/destructive 只有管理员明确审查后可启用，并在 normalization 强制 always；审批只接受 once/deny，成功也不写 conversation trust。

## Deletion, Export, Backup

用户导出与 browser persistence 排除 token。账户 purge 按 member 精确删除 token/state。实例灾备 manifest 可包含 ciphertext prefix，但必须外部保管 master key；恢复后仍校验 config/review revision。

## Rollback

旧静态 auth 分支独立保留。关闭 OAuth 不删除密文；成员 connection fail closed。side-effect 工具可统一禁用作为紧急回滚。
