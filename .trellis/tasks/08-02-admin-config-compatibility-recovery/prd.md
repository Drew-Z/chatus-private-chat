# 后台配置兼容性恢复

## Goal

恢复生产 React 后台配置加载，并建立 Worker 历史配置规范化投影与 React 解码器之间的可执行兼容合同。历史配置必须在不泄露凭据、不自动启用能力的前提下可读取、可修复、可删除并可安全往返保存。

## Background

- 第一轮修复 `7624ccaa` 已通过 PR CI、main 部署和生产验证，但生产 React 后台仍显示“无法读取管理配置 / 管理配置格式无效”；旧版管理台在同一 SHA 可用，因此不是登录、静态路由或 release cache 故障。
- `src/worker.ts:8841-8867` 会把治理字段不完整的旧 MCP 工具规范化为 `enabled: false`、`reviewRequired: true`，并让缺失的 `schemaFingerprint`、`securityFingerprint`、`sideEffect`、`reviewRevision` 在 JSON 中省略。
- `client/src/lib/api.ts:2586-2641` 当前无条件要求所有 MCP 工具具备四个治理字段，使一个安全降级的旧工具导致整份管理配置解码失败。
- `src/worker.ts:2801-2831` 的 PUT 路径会再次规范化并保存该 fail-closed 形态，当前后端验证不会因为四个字段缺失而拒绝无关配置保存。
- 第二轮审计确认 Worker GET 不调用 `validateAppConfig`，而 `sanitizeAdminConfig` 只隐藏明文凭据；历史配置中的重复 fallback、数字字符串/小数配额、越界 provider capacity、空白可选字段和不可执行 MCP server 仍可能原样进入 React 的更严格语义解码器。

## Requirements

- R1. React 管理配置解码器必须接受治理字段不完整的 MCP 工具，但仅限 `enabled === false` 且 `reviewRequired === true`，同时基础工具字段和 MCP executor/server identity 仍全部有效。
- R2. 任一治理字段若存在仍必须通过现有格式校验；治理字段不完整且启用、未标记复审或 executor 无效的 MCP 工具必须继续使快照校验失败。
- R3. 兼容读取不得自动补造 fingerprint/revision、不得自动启用工具、不得静默删除工具，也不得放宽完整治理工具和 builtin 工具的现有合同。
- R4. 旧工具必须可通过现有管理员删除流程移除，也可在同一 tool ID 被重新发现时替换为具备完整治理字段的禁用/待审核版本。
- R5. 保存与 MCP 无关的配置时，旧工具必须保持禁用/待复审且不丢失；服务端 GET/PUT 投影和 React 解码合同必须有跨层回归测试。
- R6. 修复通过正常 PR 和 GitHub Actions 生产部署；测试只使用本地 fixture/fake MCP，不读取或记录生产配置、cookie、token 或工具参数。
- R7. Worker 管理配置 GET 必须投影 canonical fallback 列表与正整数配额/容量字段；历史数字字符串可以安全转换，非法或越界值必须回退到明确、受限的默认值，不得产生可运行的越权配置。
- R8. 历史 MCP server 若 endpoint、auth 或 OAuth scope 不满足当前可执行合同，必须保持可识别、可编辑、可删除，但强制 `enabled: false`；PUT 必须允许这种 disabled 隔离形态往返，同时继续拒绝相同异常的 enabled server。
- R9. 历史可选字符串应 trim；空白 `authHeader`/reference 不得出现在投影中。有效的历史环境 Secret 引用和 `hasLegacyKey`/`hasCustomHeaders` 隐藏标记必须保持语义，不得暴露、伪造或静默删除凭据。
- R10. 测试必须把真实 Worker `GET /api/admin/config` 的 JSON 直接交给 `isAdminConfigSnapshot`，并使用一个同时包含多种历史缺陷的本地 fixture 证明跨层合同，而不是在 Worker 和 React 测试中维护两份易漂移的手写投影。

## Acceptance Criteria

- [x] AC1. Worker 测试证明旧 MCP 记录在 GET 中保留基础字段，并投影为 `enabled: false`、`reviewRequired: true`，四个缺失治理字段不被伪造。
- [x] AC2. React API 测试证明 AC1 的精确形态可解码；同一工具改为启用或取消待复审时被拒绝；完整 MCP/OAuth 治理形态行为不变。
- [x] AC3. 管理页面浏览器测试加载包含旧 MCP 工具的配置后进入正常后台，不出现全局“无法读取管理配置”错误。
- [x] AC4. 单元或浏览器测试证明旧工具可删除、同 ID 重新发现可升级其治理字段，且其他 server/tool/provider/user 配置保持不变。
- [x] AC5. 无关配置 PUT 往返不会重启用、静默删除或损坏旧工具；随后 GET 仍能被 React 解码。
- [x] AC6. `npm run check:frontend`、相关 Vitest、`npm test`、`npm run typecheck`、`npx wrangler deploy --dry-run`、Workspace Playwright、`git diff --check` 和 Trellis 全量一致性验证通过。
- [ ] AC7. work commit、PR CI、main 合并部署、exact SHA 生产后台验收及 artifacts 被记录后，任务才可归档。
- [x] AC8. 组合历史 fixture（至少包含重复 fallback、数字字符串/小数、隐藏凭据标记、越界 provider capacity 与治理不完整 MCP tool）经 Worker GET 后可被 React 精确解码，并在 PUT/GET 后保持安全语义。
- [x] AC9. 历史不可执行 MCP server 被强制禁用但仍可编辑、删除和保存；同样的 endpoint/auth/scope 异常在启用状态继续被 Worker 和 React 拒绝。
- [x] AC10. 第二轮修复不以移除 `/admin.html` 为前提；legacy 入口在 React 连续通过 exact-SHA 生产验收前继续作为紧急恢复面，其退役由 `08-02-frontend-legacy-experience` 独立治理。

## Out of Scope

- 不迁移或改写生产 KV 数据；不手工删除旧 MCP 工具。
- 不改变 MCP discovery 对“未返回的同 server 工具”的权威快照语义；本任务的“替换”仅指同 ID 重新发现。
- 不实现新的 MCP OAuth、side-effect 工具或治理字段生成逻辑。
- 不在本任务移除、隐藏或改造成只读 legacy admin；只记录其后续退役依赖。
- 不进行本地生产部署、live MCP 或 synthetic production probe。
