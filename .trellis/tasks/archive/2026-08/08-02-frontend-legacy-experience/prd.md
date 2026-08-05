# 新版后台迁移与 legacy 管理页退役

## Goal

把仍以内联旧 route 表示的渠道安全迁移为新版 Provider + Offering，并在新版 React 管理后台具备完整日常闭环后删除旧静态管理页面。迁移不能泄露或丢失凭据，不能改变逻辑模型 ID、成员权限、fallback 顺序或实际模型行为。

## Background

- 新版后台已覆盖首次配置、成员、Provider、逻辑模型、Skill/MCP、公开访问、可靠性和运营视图；生产 React 管理页已在 exact SHA `5cda024c0756e7ccd60bef0b09e3e3e51731ecc0` 通过用户验收。
- `src/contracts/provider.ts` 仍把 route 级 `type/baseUrl/model/apiKey*` 定义为 provider pool 之前的 compatibility shadow；`src/services/provider-router.ts` 会把它投影为 `legacy:<routeId>`，因此这些旧渠道仍可能是运行时真源。
- `client/src/lib/admin-provider.ts:351` 和 `client/src/components/LogicalModelAdminPanel.tsx:175` 已有客户端“迁移旧线路”草稿，但浏览器看不到隐藏内联 Key，不能独立证明迁移后仍有可解析凭据。
- `src/worker.ts:2854` 只在同类对象往返时保留隐藏凭据；旧 route 改成新 Provider 时，必须由服务端预检安全 credential source，而不能由浏览器复制明文。
- `/admin.html`、`public/admin.js` 和 `public/admin-report.js` 仍作为旧静态后台存在，并被 `scripts/check-frontend.mjs`、`public/sw.js`、deploy release fingerprint 和文档引用。
- 旧后台独有的完整 JSON/整库重置和 CSV 报告不属于日常管理闭环；成员长期记忆已有成员工作区入口，不需要为退役旧后台复制一套管理员编辑器。

## Requirements

- R1. React Provider 视图必须显示待迁移旧渠道数量和逐项安全状态，并提供明确的批量迁移动作；迁移前不得把旧渠道伪装成已经持久化的 Provider。
- R2. 新增受管理员会话和 `expectedRevision` 保护的服务端迁移 API。它必须先对请求中的全部旧 route 完成预检，再一次写入配置；任一项目不安全时整体不写入。
- R3. 迁移仅在 credential 可从加密托管密钥、同名 Worker Secret 或明确的成员 BYOK 合同继续解析时通过。旧内联 `apiKey` 不进入请求、响应、日志、audit 或新 Provider；若它是唯一可用来源，返回稳定的阻断原因并要求管理员先保存对应 Key Ref。
- R4. 每个旧 route 迁移为一个碰撞安全、稳定可重试的 Provider 和一个 Offering。保留 route ID、label、enabled、fallbacks、maxTokens、temperature、能力标记，以及 defaults/users/publicAccess 中的所有 route 引用；Provider 保留协议、Base URL、Key Ref、auth header/prefix、自定义 headers、BYOK 和能力语义。
- R5. 成功迁移后，route 不再保存 `type/baseUrl/model/apiKey/apiKeyRef/authHeader/authPrefix/directEndpoint/headers` 等 compatibility shadow；GET/PUT/GET 必须保持 Provider、Offering 和隐藏 header 语义，重复迁移不得创建重复 Provider。
- R6. 删除旧静态管理实体 `public/admin.html`、`public/admin.js`、`public/admin-report.js` 及只为它们存在的测试、service-worker cache、release fingerprint 和结构断言。`/admin.html` 在当前 0.x 版本保留为到 `/react-chat/admin` 的同源永久重定向，旧 UI 不再可访问。
- R7. 旧后台独有的完整 JSON、整库重置和 CSV 报告随旧页退役，不迁入 React；文档必须把唯一后台入口、Provider 密钥管理和迁移阻断恢复步骤更新到新版路径。
- R8. 保留 `/legacy/` 聊天回滚页和运行时 legacy route reader，直到生产配置确认零内联旧 route；本任务不删除 `/api/chat`、旧聊天数据或 provider-router compatibility reader。
- R9. 同一任务补齐父任务原有的前端体验验收：React 流式消息保持贴底时自动滚动、用户主动上滚后不抢回；legacy 图片入口可用键盘操作；React/legacy 直接入口和 390px 布局有 Playwright 证据。admin 动态拆包只在压缩传输或启动 CPU 预算证明收益时实施。
- R10. 所有测试只使用本地 fixture/fake Provider/MCP；不读取或修改生产配置，不运行 live model、synthetic production probe 或本地生产部署。代码通过 PR，生产只由 GitHub Actions 部署并记录 exact SHA/artifacts。

## Acceptance Criteria

- [x] AC1. 本地组合 fixture 中多个旧 route 在 React Provider 视图中以“待迁移”状态可见，已迁移 Provider 不重复显示；阻断原因不含 endpoint、Key 或 header 值。
- [x] AC2. Worker 测试证明迁移 API 要求管理员会话与最新 revision，且全部预检成功后才原子写入；冲突、未知 route、非旧 route、Provider ID 碰撞和混合成功/失败批次均确定性处理。
- [x] AC3. 托管密钥、同名 Worker Secret 和 BYOK route 可迁移；仅有内联明文 Key 的 route 被 fail-closed 阻断。API、audit 和测试输出均不包含凭据或自定义 header 内容。
- [x] AC4. 迁移后 route ID、成员/default/public/fallback 引用、限制与能力保持不变，Provider + Offering 承接协议、endpoint、模型和安全 credential reference；第二次迁移为幂等 no-op。
- [x] AC5. Worker GET -> React decoder -> migration -> PUT/GET 的跨层测试证明零 compatibility shadow、零秘密泄露，运行时 provider plan 只使用持久化 Provider + Offering，聊天 fixture 行为不变。
- [x] AC6. `public/admin.html`、`public/admin.js`、`public/admin-report.js` 不再存在，service worker、frontend checker、deploy fingerprint、文档和测试没有失效引用；访问 `/admin.html` 返回到 `/react-chat/admin` 的永久重定向且不提供旧 UI。
- [x] AC7. React 新后台仍覆盖 Provider 密钥录入/轮换、模型发现、逻辑模型、能力/MCP、成员访问、公开访问、可靠性、运营与 logout；被退役的 JSON reset/CSV 控件有明确决策记录而非静默遗漏。
- [x] AC8. 流式自动滚动、legacy 图片键盘入口、React/legacy 直接入口和 390px 布局 Playwright 通过；admin 拆包有测量结论，未达预算则不实施。
- [x] AC9. `npm run check:frontend`、相关 Vitest、`npm test`、`npm run typecheck`、`npx wrangler deploy --dry-run`、Workspace Playwright、Agent fake-Provider Playwright、`git diff --check` 和 Trellis 全量一致性验证通过。
- [x] AC10. work commit、PR CI、main exact SHA、GitHub Actions 部署、artifacts、用户确认新版后台与迁移结果均记录后任务才归档；生产配置迁移动作由已登录管理员在新版页面执行，不由 CI 或本地脚本代做。

## Out of Scope

- 不删除 `/legacy/` 聊天页、`/api/chat`、tool approval 协议、旧聊天/记忆迁移器或 runtime legacy route reader。
- 不把生产配置、密钥或自定义 header 导出到仓库、artifact、日志或浏览器持久化。
- 不新增 live Provider 健康检查，不自动迁移生产配置，不从本地 Wrangler 部署生产。
- 不把旧后台的高级 JSON 编辑、整库重置或 CSV 报告复制到 React。
