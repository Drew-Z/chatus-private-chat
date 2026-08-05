# 项目可靠性、安全与体验优化

## Goal

把 2026-08-02 项目健康度审计发现的确定性缺口转化为可独立验收的修复任务，优先保护数据删除、错误隐私、配额公平性和交付安全，再改善 legacy 体验与测试容量。

## Background

- 生产部署、PR 门禁、Trellis 归档和 Q3 产品治理已完成；本父任务随后把健康度审计拆为八个独立交付子任务。
- 访客清理、Workspace outbox 和会话级联清理在 `src/worker.ts:8168-8223`、`src/worker.ts:3877-3926`、`src/worker.ts:3834-3839` 存在流量驱动重试或失败吞掉问题。
- Provider/MCP 错误边界在 `src/services/provider-tool-runtime.ts:197-206`、`src/worker.ts:5960-5967`、`src/worker.ts:8081-8089` 可能把上游响应体或原始异常投影给客户端。
- Automatic Skill 在 `src/worker.ts:5874-5900` 先于 `src/worker.ts:5970-5981` 配额 admission；BYOK 质量隔离和 KV 聚合并发性不足，见 `src/services/route-reliability.ts:95`、`:233-260`、`:344-371`。
- React 流式滚动、legacy 图片键盘入口和 legacy 浏览器覆盖存在缺口；CI job 无 timeout，workflow 测试主要为字符串断言。
- 生产 React 后台当前会因缺失新版治理字段的旧 MCP 工具而拒绝整份 `/api/admin/config`；服务端已将该工具降级为禁用且待复审，客户端却未接受这一 fail-closed 兼容形态。

## Requirements

- R1. 所有删除和 purge 标记必须在每个后端成功后才清除；失败必须可自主重试、可观测且幂等，不能依赖用户再次访问。
- R2. 任何 Provider、MCP、Capability、模型发现或 SSE 公共错误都只返回 allowlist 的稳定错误码和安全摘要，不返回原始上游 body、URL、token、成员标识或异常 message。
- R3. Automatic Skill 选择必须受成员配额/并发/取消策略约束，不得绕过计量；BYOK 失败不得污染共享路由质量；聚合写入必须有并发安全方案。
- R4. legacy 聊天与 React 支持面具备可访问键盘操作、流式滚动和移动布局验收；旧静态管理页在 route 渠道安全迁移到 Provider + Offering 后退役，admin bundle 拆分仅在性能预算证明收益后实施。
- R5. PR CI、生产部署和 docs/Trellis-only 路径分类必须有结构化、可超时、精确 SHA、可追踪 artifact 的治理证据。
- R6. 成员并发、无字节 Provider 流、R2 提取物容量和实际删除滞留必须有明确的容量限制、指标或产品决策；不把未经确认的容量建议直接当成行为变更。
- R7. React 后台必须安全读取旧 MCP 工具：仅当工具已禁用且待复审时允许治理字段不完整，并保留管理员删除、重新发现和保存其他配置的恢复路径。
- R8. 测试只使用本地 fake Provider/MCP；生产只通过 GitHub Actions；保持 0.x SemVer，不记录访问码、cookie、token、对话或草稿。

## Acceptance Criteria

- [x] AC1. 八个子任务均有独立 PRD、验收证据和 work commit；父任务记录依赖、状态和最终整体验证。
- [x] AC2. 访客、Workspace 文件、会话、账户删除的失败注入测试证明后台重试最终完成，且不会重复删除或丢失 marker。
- [x] AC3. 上游/运行时错误 fuzz 或 secret-bearing synthetic tests 证明公共响应和日志不含原始 body、URL、token 或成员标识。
- [x] AC4. automatic Skill 配额顺序、BYOK 隔离、聚合并发、Provider 无字节 deadline 均有 deterministic tests；容量策略有明确成员并发决策。
- [x] AC5. React/legacy 浏览器测试覆盖键盘、390px、自动滚动和直接入口；旧 `/admin.html` 只重定向到 React 后台，旧 route 渠道的 Provider + Offering 迁移有密钥安全与引用保持证据；性能拆包有前后压缩传输与 CPU 证据，未达预算则记录不实施。
- [x] AC6. CI/deploy workflow 使用 YAML 结构校验、job timeout、精确路径分类和 artifact 证据；Trellis docs-only 提交仍跳过部署。
- [x] AC7. 全量 frontend、Vitest、typecheck、Wrangler dry-run、Workspace/Agent Playwright、Trellis 和交付治理测试通过；生产验收只使用 exact main SHA。
- [x] AC8. React 后台可加载服务端投影的禁用/待复审旧 MCP 工具；治理字段不完整的启用工具仍被拒绝，旧工具可删除或通过同 ID 重新发现升级，且无关配置保存不丢失、不重启用该工具。

## Out of Scope

- 不在本父任务内实现成员分享/ACL、Provider finance/budget/feedback、实例备份恢复/RPO/RTO、legacy 聊天/API/数据退役；旧静态管理页退役由 `08-02-frontend-legacy-experience` 子任务负责。
- 不在没有容量预算和产品决策时强行改变成员并发上限或把提取物计入现有 250 MiB 合同。
- 不引入 live model、真实 MCP/OAuth、synthetic production probe 或本地生产部署。

## Child Tasks

1. `08-02-admin-config-compatibility-recovery`（P0）
2. `08-02-background-cleanup-reliability`（P0）
3. `08-02-public-error-redaction`（P0）
4. `08-02-skill-quota-route-governance`（P0）
5. `08-02-frontend-legacy-experience`（P1）
6. `08-02-ci-delivery-hardening`（P1）
7. `08-02-test-performance-capacity`（P2）
8. `08-04-production-acceptance-cleanup-recovery`（P0）
