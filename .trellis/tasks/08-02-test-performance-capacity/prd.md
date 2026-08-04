# 测试性能与容量可观测性

## Goal

在不引入未经验证的并发或流式行为变更的前提下，缩短本地 Vitest 周期、建立可执行的覆盖率下限，并让成员能够看到有明确定义的 Workspace 元数据占用。

## Background

- 当前 40 个 Vitest 文件、581 项测试全部运行在 Cloudflare Workers pool；同机三次 `npm test` 用时为 184.964 秒、107.723 秒和 104.500 秒，中位数 107.723 秒。
- 8 个测试文件直接依赖 `cloudflare:workers` 或 `cloudflare:test`，另有 `image-input.test.ts` 通过 Worker/TeamAgent 形成 Cloudflare 传递依赖；其余 31 个文件可在 Node 环境运行。
- Cloudflare Workers Vitest pool 不支持 V8 coverage，覆盖率必须使用 Istanbul。
- `src/services/quota-admission.ts:145-146` 对成员 turn 直接准入；现有产品决定是成员并发保持 unlimited，由消息桶和 Provider 容量租约约束实际负载。
- `src/services/provider-first-visible-deadline.ts:1-38` 已提供统一的 60 秒首个可见输出 deadline；首个可见输出之后没有 idle timeout。
- `src/agent/team-agent.ts:1075-1077` 以非 `deleting` 源文件版本的 `size` 执行 250 MiB 成员配额；同一元数据表还记录 `extracted_bytes` 和待删除状态，但当前 API/UI 不投影这些占用。
- 生产代码不枚举 R2 bucket，无法发现元数据之外的孤儿对象，因此不能把元数据聚合称为 R2 bucket 实际占用。

## Requirements

- R1. Vitest 必须拆为 Node 与 Workers 两个显式 project；只有直接或传递依赖 Cloudflare 运行时的测试进入 Workers project，Workers project 保持 `maxWorkers: 1`，Node project允许并行。
- R2. 分池后必须保留全部 40 个现有测试文件和至少 581 项基线测试，并包含本任务新增回归用例。连续三次 post-change `npm test` 的中位数必须不高于 91.564 秒，即相对 107.723 秒基线至少改善 15%；未达门槛必须撤回分池配置。
- R3. 必须增加 Istanbul 覆盖率命令和显式 statements、branches、functions、lines 全局阈值。阈值以本任务测得的现状为基线并向下取整固定，覆盖率低于任一阈值时命令必须失败；不得使用 V8 coverage。
- R4. PR 的 Vitest 门禁必须在单次完整测试运行中启用覆盖率，避免为了覆盖率重复执行完整套件；本地 `npm test` 保持无插桩，供快速反馈和性能基准使用。
- R5. 成员 turn concurrency 保持 `unlimited`，本任务不新增成员 lease、拒绝码或并发上限。确定性测试必须锁定多个成员 turn 可同时准入且不会申请访客 lease 的合同。
- R6. 保留从 Provider 尝试开始到首个可见输出的 60 秒 deadline 和首输出前 fallback 语义。首输出后的 idle timeout 仅登记为容量风险，不在本任务实现。
- R7. Workspace API 必须返回仅基于 Root TeamAgent SQLite 元数据的 `usage`：`quotaBytes`、`extractedBytes`、`pendingCleanupBytes`、`trackedBytes`、`limitBytes`。
- R8. `quotaBytes` 必须等于当前 250 MiB 合同计费的非 `deleting` 源文件字节；`extractedBytes` 必须为这些版本的已知解析产物字节；`pendingCleanupBytes` 必须为 `deleting` 版本的已知源文件与解析产物字节；`trackedBytes` 必须是前三类占用之和。
- R9. API 类型、测试、React 文件工作区和用户可见文案必须明确这些数字是 metadata-tracked occupancy，而不是 R2 bucket actual usage；不得暴露对象键、文件路径、checksum 或其他敏感元数据。
- R10. 所有验证只使用本地 fixture、fake Provider/MCP 和 Miniflare；不得调用 live model、真实 MCP/OAuth、production probe 或本地生产部署，并保持 0.x SemVer。

## Acceptance Criteria

- [x] AC1. Node/Workers project 的 include/exclude 边界互斥且覆盖全部 40 个现有测试文件；8 个直接依赖与 1 个传递依赖 Cloudflare 的文件只在 Workers project 运行，Workers `maxWorkers` 为 1，Node project可并行。
- [x] AC2. 三次 post-change `npm test` 均通过不少于 581 项测试且没有基线文件消失，中位数不高于 91.564 秒；研究记录包含三次原始时长、计算方式与保留或撤回决定。
- [x] AC3. `npm run test:coverage` 使用 Istanbul 并通过；四项全局阈值为显式整数，低于阈值会返回非零状态，PR CI 用一次带 coverage 的完整 Vitest 运行执行该门禁。
- [x] AC4. 确定性测试证明两个成员 turn 均可同时准入、均不获取访客 lease，且成员配额拒绝语义保持不变。
- [x] AC5. 现有 fake-timer 测试证明 60 秒首可见输出 deadline、父取消、首输出前 fallback 和首输出后长流合同保持通过；风险登记明确首输出后永久停滞仍依赖客户端取消。
- [x] AC6. Workspace usage 单元/API 测试覆盖空空间、活跃源文件、解析产物、待清理版本、失败/重试状态和 250 MiB 边界，并验证五个字段的精确算术。
- [x] AC7. React 文件工作区以可访问、响应式的占用摘要显示配额、解析物和待清理占用；文案明确为元数据跟踪值，loading、ready、error 与刷新状态不互相覆盖。
- [x] AC8. API/UI 不声称 R2 实际占用，不返回对象键或其他私有存储细节；相关类型检查、组件测试或 Playwright 验收通过。
- [x] AC9. `npm run check:frontend`、`npm test`、`npm run test:coverage`、`npm run typecheck`、`npx wrangler deploy --dry-run`、`git diff --check`、Workspace Playwright、Trellis 全量一致性验证均通过。
- [ ] AC10. spec 记录测试 project 边界、Istanbul 约束、成员 unlimited 决策、60 秒 deadline 与 metadata-tracked occupancy 合同；work commit、PR exact-head CI 和归档证据完整。

## Out of Scope

- 不新增成员 turn lease、成员并发拒绝、管理端并发配置或并发遥测。
- 不实现首个可见输出之后的 idle/no-byte timeout，不改变 fallback 或流生命周期。
- 不通过 R2 listing/head 计算 bucket 实际占用，不清理本任务无法枚举的孤儿对象，也不把解析产物计入现有 250 MiB 上传配额。
- 不改变 Workspace 文件大小、批次、成员容量或文档解析限制。
- 不引入 live Provider/MCP、生产 synthetic probe 或本地生产部署。
