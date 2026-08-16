# Model Monitoring And Member Availability Implementation Plan

## Planning Gate

This plan was approved and activated after the user reviewed the PRD, `design.md`, and this checklist. Implementation and the final quality gate are complete on the active branch.

The implementation must not modify `legacy-api-chat-post-rollout`, `legacy-browser-shell-rollout`, any other production rollout gate, or production deployment state.

## Ordered Work

### 0. Final Planning And Baseline

- [x] Record the Provider-attempt definition, rolling-window semantics, terminal-state semantics, member four-state projection, advisory behavior, privacy boundary, and status anti-flapping rule in `prd.md`.
- [x] Map existing `ProviderAttemptLedger`, route-reliability, session projection, `WorkspaceHeader`, `ConversationInspector`, `AdminOperationsPanel`, API decoder, and relevant tests to `design.md`.
- [x] Review `prd.md`, `design.md`, and this plan with the user.
- [x] Activate the task only after explicit planning-artifact approval.
- [x] Record an implementation baseline and preserve unrelated worktree changes.

### 1. Define Shared Contracts And Pure Aggregation Helpers

- [x] Add a versioned content-free contract under `src/contracts/` for the administrator 24-hour snapshot and member availability projection.
- [x] Keep closed unions for window, terminal/result status, member status, confidence, speed band, run kind, and normalized failure class.
- [x] Add pure server helpers for rate derivation, weighted latency, hourly bucket boundaries, cross-shard group merging, and member status classification.
- [x] Add focused tests for zero, one, in-flight-only, mixed terminal, cancellation, timeout, fallback, stale, insufficient-sample, and consecutive-failure cases.
- [x] Define concrete minimum-sample, healthy/degraded success-rate, and speed-band constants in one server-owned module. Do not duplicate thresholds in React.

### 2. Add Read-Only Provider Ledger Aggregation

- [x] Add a read-only `ProviderAttemptLedger` method that aggregates attempts by period, hour bucket, logical route, actual model, run kind, and normalized failure class.
- [x] Count `started`, `succeeded`, `failed`, `cancelled`, and `timed_out` without coercion; compute terminal duration only when `ended_at >= started_at`.
- [x] Count `fallback_index > 0` as a fallback attempt and retain route/model identity only as bounded aggregate dimensions.
- [x] Do not return raw attempt IDs, turn IDs, idempotency keys, operation fences, prompts, completions, headers, credentials, or Provider payloads.
- [x] Do not change append-only ledger events, capture schema, migration tags, budget behavior, quota behavior, or Provider execution semantics.
- [x] Add ledger tests proving aggregate totals reconcile to synthetic projections and that a truncated recent-attempt list cannot affect totals.

### 3. Implement Administrator Model Monitor Endpoint

- [x] Add an admin-authenticated `GET /api/admin/model-monitor?window=24h&bucket=hour` handler with bounded query validation and server-owned `generatedAt`.
- [x] Fan out only to configured Provider ledger shards; merge route/provider/model/run-kind/hour groups by server-owned keys.
- [x] Compute exact totals, terminal success rate, fallback count, weighted average latency, and normalized failure-class counts after the merge.
- [x] Reject or return a bounded retryable error for an unavailable shard rather than presenting an incomplete snapshot as complete.
- [x] Map logical-route and Provider labels from the current sanitized configuration. Never echo credentials, endpoints, raw error strings, or internal operation identifiers.
- [x] Add Worker integration tests for admin authorization, invalid query parameters, exact keys, empty providers, no data, mixed statuses, cross-shard fallback reconciliation, and shard failure.

### 4. Implement Member Availability Projection

- [x] Add an authenticated `GET /api/model-availability` handler using the current session and `getRouteAccess()`; return only already-allowed logical routes.
- [x] Query only Provider shards referenced by the member's allowed logical routes and merge evidence back to logical route IDs without exposing Provider identity.
- [x] Derive `healthy`, `degraded`, `unavailable`, and `unknown` with the server-owned sample, freshness, consecutive-failure, fallback, and speed rules.
- [x] Prefer existing passive first-visible latency evidence for the speed band; return `unknown` speed when the evidence is absent or expired rather than using a misleading completion-duration proxy.
- [x] Keep the endpoint advisory. Monitoring errors and passive `unavailable` status must not mutate route access or send eligibility.
- [x] Add member permission, guest/member scope, stale evidence, insufficient evidence, unauthorized route, endpoint failure, and privacy-redaction tests.

### 5. Extend Browser API Boundary

- [x] Add exact TypeScript projections and decoders in `client/src/lib/api.ts` for both endpoints.
- [x] Reject unknown keys, invalid enums, non-safe counts, impossible rates, duplicate IDs, future timestamps, invalid bucket order, and forbidden Provider/credential/content fields.
- [x] Add fetch helpers with bounded query construction and typed `ApiError` mapping. Do not cast raw JSON in components.
- [x] Add pure client helpers for qualitative status copy and speed labels; retain prior state on advisory refresh failure.

### 6. Add Member Workspace Status UI

- [x] Extend `ChatWorkspace` or a focused member status boundary to fetch availability by session generation, selector opening, and request completion/failure while retaining a 60-second freshness guard.
- [x] Keep the existing `WorkspaceHeader` route control as the entry point; add non-color status markers and compact text to allowed model options.
- [x] Add a small accessible status detail surface with state, freshness, speed band, fallback hint, and an action to switch model. Do not add a global settings page.
- [x] Keep degraded/unavailable routes selectable and preserve existing configuration/candidate send gates.
- [x] Render monitoring read failures as non-blocking stale-preserving state. Announce only meaningful request-result changes through existing bounded status surfaces.
- [x] Preserve drawer focus, Escape, opener restoration, reduced-motion, 44px touch targets, and no page-level horizontal overflow.

### 7. Add Administrator Operations UI

- [x] Add a full-width “模型监控 · 最近 24 小时” section to `AdminOperationsPanel` without changing the existing seven-day summary or finance semantics.
- [x] Render headline totals, generated-at/window metadata, hourly trend, route/provider/model groupings, run-kind labels, and bounded failure classes.
- [x] Show `—`/“无数据” for null rates and unknown latency; never turn incomplete evidence into zero.
- [x] Keep the Operations layout unframed and scannable, with the existing 20-item pagination/containment conventions where lists can grow.
- [x] Render a best-effort refresh/error state that does not replace a ready snapshot until an authoritative refresh succeeds.

### 8. Tests And Browser Fixtures

- [x] Extend `tests/provider-attempt-ledger.test.ts` and pure monitoring tests for aggregate and status helpers.
- [x] Extend Worker/API tests for exact response envelopes, admin/member authorization, cross-shard merge, stale/unknown status, and privacy scans.
- [x] Extend focused client tests for decoder rejection, rate reconciliation, member status copy, and advisory behavior.
- [x] Validate the existing synthetic Workspace fixture across 1920px/1440px/780px/480px/390px viewports; Agent E2E covers the real route/branch paths without live Providers.
- [x] Validate Operations containment through the existing browser geometry suite and the typed Operations fixture.

### 9. Quality Gate Before Any Release Discussion

- [x] Run `npm run check:frontend` before the test suite.
- [x] Run `npm test` with the serial Cloudflare pool (53 files, 805 tests passed).
- [x] Run `npm run test:browser:workspace` (112 passed, 58 conditional skips).
- [x] Run `npm run test:browser:agent` if shared Provider/Agent runtime files are touched (3 passed).
- [x] Run `npm run typecheck`.
- [x] Run `npx wrangler deploy --dry-run` only as packaging validation; never deploy production locally.
- [x] Run `git diff --check` against the task diff and inspect that no `public/` legacy source, rollout gate, secret, prompt, completion, memory, or raw Provider payload changed.
- [x] Run `python ./.trellis/scripts/task.py validate-all` before task finish and record validation evidence in task metadata.

## Verification Notes

- Monitoring is additive: existing seven-day Operations statistics, Provider finance, routing, quota, and send-time checks retain their prior semantics.
- The final Agent run also caught and verified two compatibility fixes: the React login submit control keeps the stable accessible name `进入 Chatus` while displaying the BIAU/泊语 copy, and a one-time `conversation_conflict` refresh/retry keeps branch creation reliable after long streaming flows.
- No files under `public/`, legacy rollout task directories, production rollout gates, or deployment workflows were changed.

## Affected Files And Ownership

Likely implementation ownership is:

- Shared contract and pure helpers: `src/contracts/model-monitoring.ts`, a focused service/helper under `src/services/`, and corresponding unit tests.
- Ledger aggregation: `src/provider-attempt-ledger.ts` and `tests/provider-attempt-ledger.test.ts`.
- Worker routes and merge: `src/worker.ts` plus Worker integration tests.
- Browser contract: `client/src/lib/api.ts` and focused client tests.
- Member UI: `client/src/components/WorkspaceHeader.tsx`, `ConversationInspector.tsx`, `ChatWorkspace.tsx`, `client/src/styles.css`, and a focused status component if needed.
- Admin UI: `client/src/components/AdminOperationsPanel.tsx` and its existing styles/tests.
- Browser fixtures: `tests/browser/` workspace and Operations coverage.

Do not modify `public/`, legacy rollout manifests, deployment workflows, Provider execution semantics, quota admission, conversations, memory, or member settings ownership.

## Risk And Rollback Points

| Risk | Detection | Rollback point |
| --- | --- | --- |
| Cross-shard merge double-counts fallback or run kinds | Synthetic shard fixtures reconcile each group and total | Remove the merge adapter; retain existing finance/stats endpoints |
| A paginated attempt list is mistaken for the aggregate source | Ledger test compares aggregate to >100 synthetic attempts | Revert the UI endpoint and keep aggregation read-only in the ledger |
| Status flaps or one failure makes a route red | Consecutive-failure and recovery tests | Revert to the existing latest-task `healthStatus` text |
| Passive status becomes a hidden send gate | Tests send while status is unavailable and assert routing is unchanged | Remove only the availability guard; preserve warning UI |
| Missing first-visible telemetry is shown as fast/slow using total duration | Decoder/pure-helper tests with null evidence | Return speed `unknown` until a valid passive sample exists |
| Member endpoint leaks Provider identity or global counts | Exact decoder and secret/content scan | Disable member detail fetch and use existing route health text |
| A monitoring read blocks login or Composer | Network-blocked fixtures and send-path tests | Make fetch best-effort and retain last/stale projection |
| Fan-out to many Provider shards causes excessive read load | Bounded shard selection, timing fixture, and refresh guard | Reduce member query to referenced shards or hide detail while keeping admin refresh |
| New ledger field appears to require migration | Schema/capture tests | Return to planning and defer first-visible aggregation; do not add an unreviewed migration |

## Review Gates

1. Product gate: user approves the exact admin metrics, member four-state projection, advisory behavior, and status anti-flapping rule.
2. Contract gate: shared types, exact decoders, cross-shard aggregate semantics, and route authorization are documented and tested.
3. Privacy gate: no Provider credentials, raw payloads, prompts, completions, memory, conversation content, attempt IDs, turn IDs, or operation fences enter browser state or diagnostics.
4. UX gate: member status is compact, understandable, keyboard/focus-safe, responsive, reduced-motion compliant, and never a passive send gate.
5. Quality gate: required checks and synthetic browser fixtures pass; production remains GitHub Actions-owned and all legacy rollout gates remain unchanged.

## Explicit Non-Goals

- Do not create scheduled completion probes or spend quota to keep the status indicator current.
- Do not expose exact global monitoring data to members.
- Do not redesign billing, token cost, budgets, Provider reconciliation, or finance entry tools.
- Do not modify legacy browser/API surfaces, production workflows, or rollout gate state.
- Do not start implementation before the user approves all planning artifacts and the task is activated.
