# Model Monitoring And Member Availability

## Goal

Give administrators an accurate rolling 24-hour view of Chatus model traffic and reliability, while giving members a simple, privacy-safe indication of whether each model route is currently usable. The feature must help a member choose or switch models without exposing Provider credentials, raw logs, other members' activity, prompts, responses, or internal failure payloads.

This task monitors model calls made by Chatus. It does not claim to report account-wide traffic from OpenAI, DeepSeek, or any other Provider outside Chatus.

## Background And Existing Evidence

- The existing administrator statistics endpoint aggregates request metrics into UTC calendar-day buckets for seven days. It can report seven-day totals but cannot calculate a strict rolling 24-hour window (`src/worker.ts:4710-4856`).
- `ProviderAttemptLedger` stores exact `started_at`, `ended_at`, terminal status, logical route, Provider, model, fallback index, run, and turn identity. Its finance snapshot already accepts an epoch `periodStart` and calculates calls, successes, failures, retries, fallbacks, and average latency from attempts starting inside the requested window (`src/provider-attempt-ledger.ts:822-941`).
- `/api/admin/provider-finance` accepts `periodStart`, but its contract combines capacity, usage, cost, reconciliation, and budget concerns. A dedicated monitoring projection should reuse the ledger without making the monitoring UI depend on the finance contract (`src/worker.ts:10773-10799`).
- Members already receive `healthStatus` and `healthOutcome` for allowed routes in the session projection. The current value is based on the latest recent real task rather than a rolling aggregate (`src/worker.ts:3693-3733`, `src/worker.ts:6973-6982`).
- The workspace header and conversation inspector already surface the latest route health in text. This task should refine those existing ownership points instead of creating a separate member monitoring dashboard (`client/src/components/WorkspaceHeader.tsx:47-105`, `client/src/components/ConversationInspector.tsx:148-155`).

## Confirmed Decisions

- Administrator monitoring and member-visible availability are two projections of the same underlying attempt evidence, not the same UI or authorization scope.
- Exact rolling-window counts and operational drill-down belong in the administrator Operations surface.
- Member-visible availability belongs next to model selection in the workspace header and conversation inspector, not in member-global settings.
- The headline administrator request count uses the Provider-attempt definition: each actual upstream attempt counts once. Fallback can therefore produce more than one attempt for one user turn.
- User turns may be shown as a separate supporting count, but must not be mixed into Provider-attempt success rate.
- In-flight `started` attempts are reported separately and are excluded from the completed-attempt success-rate denominator.
- The first member-facing milestone shows only qualitative availability, freshness, and a coarse response-speed band. Exact request counts and exact 24-hour success rates remain administrator-only.
- One isolated terminal failure changes a route only to `degraded`. A route becomes `unavailable` only after three consecutive terminal failures within 15 minutes with no later successful recovery. Any later success clears `unavailable` and returns the route to the ordinary 24-hour evaluation.
- Member availability is advisory. `unavailable` does not disable a still-configured route or override routing/fallback; only the existing configuration, permission, credential, and candidate checks can block execution.
- The feature remains independent from `legacy-api-chat-post-rollout`, `legacy-browser-shell-rollout`, all other legacy rollout tasks, production deployment state, and rollout gates.
- No production deployment is authorized by this planning task.

## Requirements

### R1. Rolling 24-Hour Administrator Summary

- Default to a strict rolling 24-hour window using epoch timestamps, not UTC calendar-day buckets.
- Show total Provider attempts, succeeded attempts, failed attempts, in-flight attempts, success rate, fallback attempts, and average completed-attempt latency.
- Calculate success rate as `succeeded / (succeeded + failed)`; display no rate rather than `0%` when there are no completed attempts.
- Treat `failed`, `cancelled`, and `timed_out` as terminal failures. Keep `started` separate so an active or delayed request is not mislabeled as failed.
- Display the exact generated-at time and monitoring window so administrators can judge data freshness.
- Keep the existing seven-day operational summary available; the new 24-hour summary must not silently change the meaning of existing metrics.

### R2. Administrator Breakdown And Trend

- Provide route-, Provider-, and actual-model-level aggregations without deriving totals from a truncated list of recent attempts.
- Provide a 24-hour hourly trend for attempts, successes, failures, and fallback activity.
- Keep recent failure detail limited to normalized status and error class. Do not expose prompts, completions, raw Provider responses, request headers, credentials, conversation content, stored memory, or tool payloads.
- Clearly label Provider attempts separately from distinct user turns. If an exact cross-shard distinct-turn count is not available without exposing or retaining raw turn IDs, omit that supporting count from the first release rather than summing per-Provider counts.
- Use an explicit no-data state and preserve unknown latency or incomplete evidence as unknown rather than coercing it to zero.

### R3. Member-Visible Availability

- Project only routes the signed-in member is already allowed to use.
- Represent route availability with four member-safe states: `healthy`, `degraded`, `unavailable`, and `unknown`.
- Surface the selected route state in the existing header model control and all allowed-route states inside the model/route selector or conversation inspector.
- Provide a last-updated time and explain that the state is based on recent Chatus traffic and cannot guarantee the next request.
- Give an actionable alternative when a route is degraded or unavailable: choose another allowed model, retry when appropriate, or rely on automatic fallback when configured.
- Keep degraded/unavailable routes selectable as an explicit user choice. The UI warns and offers alternatives, but passive monitoring never becomes a send gate.
- Distinguish browser/network connection state from model-route availability.
- When a live request falls back successfully, show that an automatic backup route was used without exposing the physical Provider or internal routing plan.
- When evidence is stale or insufficient, show `unknown` rather than claiming the route is healthy.
- Avoid status flapping: one terminal failure is degraded; three consecutive terminal failures inside 15 minutes with no later success are unavailable; a later success clears the unavailable condition.

### R4. Member Privacy And Disclosure

- Do not expose exact global request counts, other member identities, Provider IDs, credential state, internal route topology, raw error classes, or account-wide Provider telemetry to members.
- Member-visible availability must be a server-produced sanitized projection. The browser must not calculate health by downloading administrator telemetry.
- Do not show a member-visible numeric success rate in the first milestone. A later numeric projection would require a separate minimum-sample and rounding/bucketing decision.
- Preserve existing member permission checks and return health only for allowed logical routes.

### R5. Freshness And Refresh Behavior

- Refresh availability on session/bootstrap load, when the model selector is opened, and after a model request completes or fails.
- Use a bounded cache or refresh interval to avoid turning monitoring into a high-frequency polling load.
- Show stale or refreshing states without blocking chat composition.
- A monitoring read failure must not prevent sending a message; current routing and send-time error handling remain authoritative.

### R6. Accessibility And Responsive UX

- Do not rely on color alone; every state needs visible text and an accessible name.
- Status popovers, drawers, and model selection controls must preserve keyboard operation, focus containment/restoration, Escape behavior, and 44px touch targets on touch layouts.
- The member status treatment must remain compact enough not to compete with the transcript or composer.
- Administrator tables and trends must avoid page-level horizontal overflow at existing accepted desktop, tablet, and mobile viewport boundaries.

### R7. Planning And Delivery Boundaries

- Produce `design.md` covering monitoring aggregation, authorization boundaries, member projection, endpoint contracts, refresh behavior, privacy, compatibility, and rollback.
- Produce `implement.md` with an ordered backend, contract, frontend, test, and validation sequence.
- Do not start implementation until the user reviews and approves the final PRD, `design.md`, and `implement.md`.
- Production releases must remain GitHub Actions-owned; local Wrangler may be used only for dry-run validation after implementation approval.

## Acceptance Criteria

- [x] AC1: An administrator can view exact rolling 24-hour Provider-attempt totals, successes, failures, in-flight attempts, success rate, fallbacks, average latency, and data freshness.
- [x] AC2: Success-rate and terminal-status semantics are documented and covered by fixtures for no data, only in-flight data, success, failure, cancellation, timeout, and mixed states.
- [x] AC3: Route-, Provider-, and actual-model aggregates and hourly trend reconcile exactly to the 24-hour summary without relying on a paginated attempt list.
- [x] AC4: A member can judge the selected and selectable logical routes as healthy, degraded, unavailable, or unknown and can act on a degraded/unavailable state.
- [x] AC5: The member projection contains only allowed logical routes and no Provider identity, exact global request count, raw failure details, credentials, prompts, responses, conversation content, memory, or tool payloads.
- [x] AC6: Network connection and model availability are presented as distinct states, and successful fallback is communicated without exposing internal routing topology.
- [x] AC7: Monitoring refresh failures and stale evidence do not block chat, mutate routing, or misrepresent unknown health as success.
- [x] AC8: Administrator and member views pass decoder, permission, aggregation, no-data, stale-data, accessibility, responsive containment, and privacy tests.
- [x] AC9: No legacy rollout task, production rollout gate, deployment state, or legacy browser/API surface is modified or advanced.
- [x] AC10: The user approves the final planning artifacts before implementation begins.

## Out Of Scope

- Provider-account-wide metrics that did not pass through Chatus.
- Prompt, response, conversation, memory, secret, credential, or raw Provider-payload inspection.
- Per-member surveillance or a member-visible leaderboard of usage.
- Billing, token-cost, budget-policy, or Provider reconciliation redesign.
- Synthetic active health probes that consume model quota merely to keep a status light green; the first design should use passive real-task evidence.
- Production deployment, rollout, or changes to any legacy-surface gate.
