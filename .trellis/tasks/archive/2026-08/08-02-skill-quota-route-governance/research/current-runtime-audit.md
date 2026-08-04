# Current Runtime Audit

## Scope

This audit covers Automatic Skill turn admission, cancellation, BYOK reliability isolation, aggregate persistence, Provider capacity, and the pre-visible-output stream boundary on current `main`.

## Confirmed Findings

### Automatic Skill and quota ordering

- `prepareTeamAgentTurn()` starts Automatic Skill selection at `src/worker.ts:6281-6310`, but does not call `quotaAdmissionService(env).admitTurn(...)` until `src/worker.ts:6380`.
- The selector obtains a Provider lease and calls the Provider at `src/worker.ts:6545-6567`. An exhausted member can therefore consume Provider work before the turn is rejected.
- Continuations use the same preparation path with `consumeQuota=false`; `src/services/quota-admission.ts:131-147` makes member release a no-op and preserves the existing no-second-charge contract.
- Selector cancellation has a five-second independent boundary at `src/worker.ts:6475-6498`, and `completeOnce()` forwards the signal to the AI SDK at `src/worker.ts:7755-7764`.
- A parent abort currently becomes selector fallback metadata and preparation continues. The main stream later receives the already-aborted signal through `src/agent/team-agent.ts:2491-2500`, but preparation can still perform avoidable work.

### BYOK reliability isolation

- `recordRouteReliability()` separates `operation: "skill_selection"` first, then excludes only BYOK `401/403` from shared quality at `src/services/route-reliability.ts:87-117`.
- BYOK success, timeout, `429`, `5xx`, protocol, and network samples can therefore update shared logical-route and exact route/provider quality.
- Several success/protocol call sites do not pass `usedUserKey`, including `src/worker.ts:6108-6114`, `src/worker.ts:6402-6410`, `src/worker.ts:7695-7711`, and `src/worker.ts:8194-8200`. Optional typing cannot detect those leaks.
- Selector attempts already write only to `route-provider-skill-selection:` at `src/worker.ts:6571-6604` and must keep that separate, redacted telemetry.

### Aggregate concurrency

- Shared Provider quality performs KV read-modify-write at `src/services/route-reliability.ts:337-371`; selector telemetry repeats the same pattern at `src/services/route-reliability.ts:224-260`.
- Concurrent writers can read the same previous value and overwrite one another, losing attempts and derived counters.
- `ProviderCoordinator` is already a SQLite Durable Object, is addressed by exact `providerId` in `src/services/provider-lease.ts:30-40`, and serializes mutations with `blockConcurrencyWhile()` in `src/provider-coordinator.ts:65-130`. It is the narrowest existing single-writer authority for cross-member Provider aggregates.
- Provider quality readers currently use the KV projection in the route planner and admin reliability view at `src/worker.ts:5008-5009` and `src/worker.ts:7454-7455`; a compatible write-through projection avoids a cross-layer API change.

### Capacity and no-visible-output boundary

- Members have atomic daily/minute quota admission but no member-turn lease (`src/services/quota-admission.ts:131-147`). Guests alone have a ten-minute one-turn lease.
- Provider capacity is already explicit and shared across users/models through `ProviderCoordinator`; queue waiting is bounded to ten seconds in `src/services/provider-lease.ts:4-5,47-52`.
- The Agent fallback primer waits indefinitely for the first visible AI SDK stream part at `src/services/fallback-language-model.ts:136-176`.
- The legacy streaming adapter likewise waits indefinitely for the first visible SSE content at `src/services/provider-stream-runtime.ts:51-64,137-180`.
- Existing `firstVisibleLatencyMs` measures the first non-empty text/reasoning delta, not an HTTP byte (`src/services/fallback-language-model.ts:299-308`). The fallback commitment boundary is broader: tool/source/file/approval parts are visible and commit the Provider.

## Decisions for Planning

1. Automatic member turns obtain one reusable turn admission before any selector Provider lease/request. Quota rejection performs zero selector and main Provider calls. Continuations keep `consumeQuota=false`.
2. A request already aborted before admission is not charged. Once an admitted Automatic selector attempt begins, the message consumes exactly one unit even if later preparation fails; it has already used Provider work. Parent cancellation stops further preparation and main Provider work.
3. Every shared chat reliability write must explicitly carry `usedUserKey`; all BYOK samples are excluded from shared route and route/provider quality. Selector telemetry remains separate and may record redacted BYOK attempt outcomes.
4. `ProviderCoordinator` becomes the single writer for shared route/provider aggregates and selector aggregates. Durable Object storage is authoritative after first valid KV seed; the existing KV keys remain write-through read projections.
5. Each streaming Provider attempt gets a 60,000 ms hard deadline from request start to the first visible output. Timeout is a pre-commit failure eligible for configured fallback; user cancellation never falls back; the deadline is cleared after commitment.
6. This task does not add a member-level concurrency lease. Atomic message quotas plus configured Provider capacity remain the current member policy. A later capacity task may change this only with measured demand and an explicit product limit.

## Test Gaps

- No deterministic test proves an exhausted member causes zero selector Provider requests.
- No Automatic continuation test proves selector plus main preparation remains quota-free without a second admission.
- BYOK tests cover only `401/403` and only the logical-route key, not all outcomes and exact route/provider aggregates.
- No test submits concurrent samples to the same aggregate and proves both survive.
- No Agent or legacy stream test proves a non-cooperative Provider is cancelled/fallen back after a bounded period without visible output.
- No test proves parent cancellation during selection prevents the main Provider from starting.
