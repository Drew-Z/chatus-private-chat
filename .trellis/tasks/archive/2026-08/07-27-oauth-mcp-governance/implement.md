# Implementation Plan: OAuth MCP 授权与治理

## Ordered Checklist

- [x] 加载 MCP、managed secrets、audit、backup specs。
- [x] 写 fake issuer/MCP fixtures 和 config/PKCE/token isolation 测试。
- [x] 扩展 versioned MCP auth contract、admin API/UI 和旧配置兼容。
- [x] 实现 server-side PKCE state、start/callback/status/revoke。
- [x] 新增 member/server AES-GCM token namespace、refresh single-flight 和 fail-closed 处理。
- [x] 扩展 discovery review record、scope/config/schema/annotation drift 持久禁用和 trust revision。
- [x] 放开经审查副作用工具并强制每次 once/deny 确认。
- [x] 扩展 user purge、user export exclusion 和 encrypted backup inventory。
- [x] 覆盖 token/log/audit/browser 泄漏扫描及连续副作用确认。
- [x] 运行 `trellis-check`、fake MCP/OAuth、两类浏览器测试和五项全量验证。
- [x] 更新 MCP/security/backup specs，记录验证、提交、PR、合并并归档。

## Risky Files

- `src/contracts/capability.ts`
- `src/services/managed-secrets.ts`
- `src/services/mcp-runtime.ts`
- `src/worker.ts`
- MCP admin/member React components

## Rollback Points

- config migration、OAuth flow、drift/side-effects 分开提交。
- 任何异常默认 disabled/reconnect，不回退成匿名或静态共享 token。
