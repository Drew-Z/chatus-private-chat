# Automatic Skill 配额与 Provider 路由治理

## Goal

让 Automatic Skill 和主回答共享一次公平、可取消的 turn admission，阻止 BYOK 样本改变共享路由质量，并为 Provider 聚合与首个可见输出建立并发安全、可确定性验证的边界。

## Background

- Automatic Skill 当前先调用 selector Provider，之后才执行成员配额 admission，见 `src/worker.ts:6281-6310,6380`。
- 共享路由质量只排除 BYOK `401/403`；BYOK success、timeout、限流、服务端、协议和网络样本仍可能写入，见 `src/services/route-reliability.ts:87-117`。
- Provider/chat 与 selector 聚合都在 KV 上读改写，并发样本可能丢失，见 `src/services/route-reliability.ts:224-260,337-371`。
- Agent 和 legacy Provider 流都可能无限等待首个可见输出，见 `src/services/fallback-language-model.ts:136-176` 与 `src/services/provider-stream-runtime.ts:137-180`。
- 现有 `ProviderCoordinator` 已按 Provider 跨成员串行化容量状态；成员本身只有原子日/分钟配额，当前没有成员级 turn lease。

## Requirements

- R1. 有可用 Automatic Skill 候选的成员 turn 必须在任何 selector Provider lease 或请求之前完成一次 turn admission；失败立即返回稳定的 quota 错误，selector 和主回答都不得接触 Provider。
- R2. 同一 Automatic turn 复用这一份 admission，主回答不得二次消费；continuation 继续使用 `consumeQuota=false`，旧 manual turn 的 admission 时机与计量语义保持兼容。
- R3. 请求在 admission 前已经取消时不得消费配额；selector 期间收到父请求取消后必须停止 selector、释放 Provider lease、阻止主 Provider 启动，并返回稳定的取消分类。已开始 selector Provider work 的 admitted turn 仍只计一个消息单位。
- R4. 所有共享 chat reliability 调用必须显式声明 `usedUserKey`。任意 BYOK success 或 failure 都不得写入 `route-reliability:` 或 `route-provider-reliability:`；`skill_selection` 继续只写独立、脱敏的 selector telemetry。
- R5. `route-provider-reliability:` 与 `route-provider-skill-selection:` 的 bounded aggregates 必须由按 `providerId` 寻址的单写者更新；并发样本不得丢失，现有 KV key、版本校验、上限 1,000 和只读投影保持兼容。
- R6. 每个流式 Provider attempt 从实际请求开始到首个可见输出必须有 60,000 ms 硬边界，覆盖 fetch/AI SDK 建流和 pre-visible primer。超时属于 pre-commit failure，可按现有计划 fallback；用户取消不可 fallback；首个可见输出后清除 deadline，不能中断已提交的正常长流。
- R7. “首个可见输出”沿用现有 fallback commitment 语义，而非 HTTP 首字节：Agent 的 text/reasoning/tool/source/file/approval 可提交 Provider；legacy SSE 以首个非空文本内容提交。`firstVisibleLatencyMs` 仍只统计首个非空 text/reasoning delta，不伪造网络 TTFB。
- R8. 本任务明确保持成员 turn 并发不限，不新增成员级 lease。成员公平性继续由原子日/分钟配额保证，资源容量继续由 Provider concurrency/queue lease 保证；后续只有在容量证据和产品上限明确后才可改变成员并发行为。
- R9. telemetry、deadline、释放或镜像写入失败不得改变公共错误安全边界，不得记录 Provider body、凭据、用户标识、prompt 或 completion。

## Acceptance Criteria

- [x] AC1. deterministic TeamAgent 测试证明配额耗尽的 automatic member 产生零次 selector/main Provider 请求，且返回既有稳定 rate-limit 分类。
- [x] AC2. automatic selector 与主回答合计只消费一个消息单位；automatic continuation 不消费新单位；manual turn 的成功、失败和 continuation 基线不回归。
- [x] AC3. admission 前取消不计费；selector 中取消会中止 selector、释放 lease、产生零次 main Provider 请求，并且不触发 fallback。
- [x] AC4. 参数化测试覆盖 BYOK success、401、403、429、5xx、timeout、protocol 和 network，证明共享 route 与 exact route/provider 记录均不变；同批 selector 测试证明独立 telemetry 仍记录脱敏 attempt。
- [x] AC5. 两个受控并发 chat 样本和两个受控并发 selector 样本写入同一 Provider/route 后，attempts、successes、fallback、stream samples 与 bounded invariants 精确保留两份输入；DO 重启后结果仍可读取。
- [x] AC6. Agent AI SDK 与 legacy SSE 均以 fake Provider 证明：达到 60 秒边界仍无可见输出时取消上游并允许 pre-output fallback；父取消不 fallback；首个可见输出后 deadline 不再终止流；晚到结果不能覆盖已返回状态。
- [x] AC7. route planner 和管理员 reliability API 继续读取原有 KV 投影；有效旧 v2/provider 与 v1/selector 聚合可作为首次 seed，畸形数据仍 fail closed，telemetry 故障不影响聊天。
- [x] AC8. spec 明确记录成员并发保持不限、Provider lease 为当前容量权威，且本任务没有新增成员并发配置、租约或静默上限。
- [x] AC9. `npm run check:frontend`、`npm test`、`npm run test:browser:workspace`、本地 fake Provider `npm run test:browser:agent`、`npm run typecheck`、`npx wrangler deploy --dry-run`、`git diff --check` 和 Trellis 全量一致性验证通过。

## Out of Scope

- 不新增成员级 active-turn lease、管理员成员并发字段或新的配额价格模型。
- 不实现 Provider usage/cost/budget/feedback，也不把 selector 计为第二条用户消息。
- 不改变 Provider 优先级、logical fallback、offering fallback、guest 单 turn lease 或 10 秒 Provider queue deadline。
- 不调用 live model，不运行 synthetic production probe，不从本地部署生产。
