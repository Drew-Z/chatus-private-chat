# OAuth MCP 授权与治理

## Goal

为管理员可配置的 MCP server 增加成员级 Authorization Code + PKCE 授权、加密 token 生命周期、scope/schema 漂移重审和副作用工具逐次确认。

## Requirements

- R1. 管理员可配置 issuer、client ID、scopes 和固定 callback；endpoint/callback 校验阻止任意 redirect 和 SSRF，client secret（若需）只保存 secret ref。
- R2. 成员通过 Authorization Code + PKCE 授权；state/verifier 服务端短期保存、绑定 member session/server/config revision、一次性且有 TTL。
- R3. access/refresh token 按 `(member, server)` 用 AES-GCM 加密，AAD 绑定 owner/server/version；不得进入 browser persistence、URL、日志、审计、API projection 或用户导出。
- R4. token refresh 单飞、rotation 原子替换；invalid_grant/不可解密 fail closed 并要求重新连接，不回退静态 secret。
- R5. issuer/client/scopes/callback/config revision 或 granted scope 漂移会禁用 connection 并要求成员重新授权/管理员重审。
- R6. tool schema/annotations/side-effect classification 漂移持久禁用 tool/server，失效 conversation trust，管理员重审后才恢复。
- R7. 允许经过管理员审查的副作用工具；任何 write/destructive 工具强制 `confirmation=always`，每次调用只允许 once/deny，不建立 conversation trust。
- R8. read-only MCP 保留现有 first-per-conversation 行为；none/bearer/x-api-key 旧配置继续兼容。
- R9. 用户永久删除精确清理其 OAuth token 与 PKCE state；实例灾备只可包含密文 token 和明确 manifest，用户导出永不包含 token。
- R10. 全部测试使用本地 fake OAuth/MCP，不连接真实 issuer/server。

## Acceptance Criteria

- [x] AC1. 管理 OAuth 配置验证 HTTPS/issuer/client/scopes/fixed callback，旧 auth config 可 round-trip；响应和 audit 无 secret/endpoint 泄漏。
- [x] AC2. PKCE S256、state TTL/一次性/session/member/server/revision 绑定、callback replay/swap/code exchange failure 有测试。
- [x] AC3. 同 server 两成员使用不同 encrypted key/AAD；跨成员解密失败，浏览器/API/log/audit/user export 无 token。
- [x] AC4. refresh 并发单飞、rotation、expiry 和 invalid_grant 行为可重复验证；不可解密 fail closed。
- [x] AC5. scope/config/tool schema/annotation 漂移在远端 call 前持久禁用并使 trust revision 失效；重审后才可恢复。
- [x] AC6. 连续两次副作用调用要求两次确认，conversation 决定不能建 trust；deny/timeout/cancel 时远端调用数为 0。
- [x] AC7. 用户永久删除清除 OAuth token/临时 state；备份 manifest 只声明加密 token inventory，不输出明文。
- [x] AC8. fake MCP/OAuth、Agent/Workspace Playwright 和五项全量验证通过。

## Out of Scope

- 不对真实企业 OAuth issuer 做线上验收，不实现组织级共享 token。
