# Model Monitoring And Member Availability Design

## Planning And Approval Gate

This document is the technical design for `08-16-model-monitoring-member-availability`. The PRD decisions are converged through the following product approvals:

- Administrators receive exact rolling 24-hour Provider-attempt monitoring.
- Members receive a compact, qualitative availability projection only: healthy, degraded, unavailable, or unknown, with freshness and a coarse response-speed band.
- Member availability is advisory. Passive telemetry never becomes a send gate; existing configuration, permission, credential, and candidate checks remain authoritative.
- A single terminal failure is degraded. Three consecutive terminal failures inside 15 minutes with no later success are unavailable. A later success clears that unavailable condition.
- Implementation must not begin until the user approves this design and `implement.md`, then activates the task with `task.py start`.

No production deployment, legacy rollout transition, or production gate change is part of this design.

## Design Intent

The system needs two projections of the same content-free Provider attempt evidence:

1. The administrator projection answers: “What happened in Chatus during the last 24 hours?” It can contain exact counts, normalized failure classes, and bounded operational groupings.
2. The member projection answers: “Which of my selectable logical models is a sensible choice right now?” It contains only a status, freshness, coarse latency band, and a safe recovery hint.

The member projection must not be a browser-side calculation over the administrator response. The Worker owns authorization, aggregation, thresholds, redaction, and route identity mapping. The client renders a validated projection and never receives Provider credentials, Provider IDs, raw attempt IDs, prompts, completions, or internal routing topology.

## Existing Boundaries And Reuse

| Boundary | Existing owner | Design relationship |
| --- | --- | --- |
| Attempt capture | `ProviderAttemptLedger` Durable Object, one shard per Provider | Add a read-only aggregate query over `provider_attempt_projection`; do not change append-only start/terminal semantics or store content. |
| Passive latest route health | `src/services/route-reliability.ts` and `CHAT_STORE` | Continue to provide a fast latest-result/freshness fallback and first-visible latency evidence. Expired records remain unknown. |
| Member route authorization | `getRouteAccess()` and `buildSessionProjection()` in `src/worker.ts` | Derive availability only for routes the current session can already use. Do not create a second permission list. |
| Admin authentication | Existing admin-session guard around `/api/admin/*` | Protect the detailed model-monitor endpoint with the same guard and bounded query parameters. |
| Browser response boundary | `client/src/lib/api.ts` | Add exact types and decoders. Components consume only validated projections. |
| Member route UI | `WorkspaceHeader`, `ConversationInspector`, `ChatWorkspace` | Keep the status beside model selection; do not add a member monitoring page or move it into global settings. |
| Admin Operations UI | `AdminOperationsPanel` | Add a top monitoring section while preserving the existing seven-day summary and finance sections. |

The existing `healthStatus` text in `WorkspaceHeader` and `ConversationInspector` is a compatible fallback, but it reflects the latest recent real task rather than the new rolling projection. The enhanced status must be additive and should degrade to that existing text when the monitoring read is unavailable.

## Data Flow

```text
Provider execution
  -> ProviderAttemptLedger shard (immutable attempt projection)
  -> per-shard monitoring aggregate query
  -> Worker fan-out and merge
       -> admin model-monitor projection (exact counts/groups/trend)
       -> member availability projection (authorized, redacted, qualitative)
  -> exact client decoder
       -> AdminOperationsPanel or model selector/header status
```

Every boundary validates its input. The ledger returns bounded numeric and enum fields; the Worker merges by server-known route/model keys; the client rejects unknown keys or invalid counts before rendering.

## Attempt And Window Semantics

### Attempt identity

- One actual upstream request is one Provider attempt.
- Fallback attempts therefore count separately and retain their `fallback_index`.
- `turn_id` and `run_id` are internal evidence. They are not rendered to members or administrators.
- All run kinds are included in the headline Provider-attempt count because each represents a real Provider request. The breakdown may show `run_kind` so auxiliary calls are not confused with main answers.
- If an exact distinct user-turn count cannot be deduplicated across Provider shards without returning raw turn IDs, omit it from the first release and label all headline values as Provider attempts.

### Rolling window

- `periodEnd` is the Worker's generated-at timestamp.
- `periodStart = periodEnd - 86_400_000` for the default 24-hour window.
- Include attempts with `started_at >= periodStart AND started_at <= periodEnd`.
- An attempt started before the window but still in progress is outside this window; do not backfill it into the current total.
- Hour buckets are epoch buckets. The first and last buckets may be partial; each bucket carries explicit start/end timestamps.

### Terminal semantics

- `succeeded` is success.
- `failed`, `cancelled`, and `timed_out` are terminal failures.
- `started` is in-flight and excluded from the completed-attempt denominator.
- `completed = succeeded + failures`.
- `successRate = completed > 0 ? succeeded / completed : null`.
- Missing end times produce unknown latency, never a zero duration.

## Administrator Projection

The proposed endpoint is additive:

```text
GET /api/admin/model-monitor?window=24h&bucket=hour
```

The server owns the current time; callers cannot provide an arbitrary future end or a Provider shard outside the configured registry. The response contract should be a shared versioned type under `src/contracts/` and an exact client decoder under `client/src/lib/api.ts`.

Proposed shape:

```typescript
type ModelMonitorSnapshotV1 = {
  version: 1;
  window: "24h";
  generatedAt: number;
  periodStart: number;
  periodEnd: number;
  totals: {
    attempts: number;
    succeeded: number;
    failures: number;
    inFlight: number;
    completed: number;
    successRate: number | null;
    fallbacks: number;
    averageLatencyMs: number | null;
  };
  trend: Array<{
    bucketStart: number;
    bucketEnd: number;
    attempts: number;
    succeeded: number;
    failures: number;
    inFlight: number;
    fallbacks: number;
  }>;
  routes: Array<ModelMonitorGroupV1>;
  providers: Array<ModelMonitorGroupV1>;
  models: Array<ModelMonitorGroupV1>;
  runKinds: Array<ModelMonitorRunKindV1>;
  failureClasses: Array<{ errorClass: string; count: number }>;
};

type ModelMonitorGroupV1 = {
  id: string;
  label: string;
  model?: string;
  attempts: number;
  succeeded: number;
  failures: number;
  inFlight: number;
  completed: number;
  successRate: number | null;
  fallbacks: number;
  averageLatencyMs: number | null;
};
```

The exact final field set must remain bounded and content-free. `routes` use configured logical-route labels; `providers` use configured Provider labels only in the admin projection; `models` use server-known actual model names. Attempt IDs, idempotency keys, operation fences, turn IDs, prompts, completions, and raw exceptions never cross the response boundary.

### Cross-shard aggregation

The Worker fans out only to configured Provider ledger shards. Each shard returns aggregate rows grouped by route/model/run kind/hour and failure class, not an unbounded attempt list. The Worker merges rows by stable server-owned keys, sums counts, computes a weighted latency average from terminal duration sums/counts, and derives rates from merged counts. A paginated recent-attempt list must never be used as the source of totals.

If a configured Provider shard is unavailable, the endpoint returns a bounded retryable error rather than presenting a partial snapshot as complete. A future design may add an explicit partial-data projection, but the first release should fail closed for the administrator summary so operators do not trust an incomplete denominator.

## Member Availability Projection

The member endpoint is intentionally separate from admin monitoring:

```text
GET /api/model-availability
```

It uses the current session, `getRouteAccess()`, and route offerings to query only the Provider shards needed for the member's allowed logical routes. The Worker maps physical evidence back to logical route IDs and omits Provider identity.

Proposed shape:

```typescript
type MemberModelAvailabilityV1 = {
  version: 1;
  generatedAt: number;
  window: "24h";
  routes: Array<{
    routeId: string;
    label: string;
    model: string;
    status: "healthy" | "degraded" | "unavailable" | "unknown";
    confidence: "recent" | "limited" | "stale";
    speed: "fast" | "normal" | "slow" | "unknown";
    observedAt: number | null;
    fallbackRecentlyUsed: boolean;
    message: "healthy" | "degraded" | "unavailable" | "unknown";
  }>;
};
```

`routeId`, label, and model are already member-safe logical-route fields. No Provider ID, exact count, exact rate, error class, or raw timestamp from an individual attempt is returned.

### Status derivation

The Worker owns these rules; the browser does not reimplement them:

1. `unavailable`: three consecutive terminal failures within 15 minutes with no later success, or a route that fails the existing configuration/candidate checks. The passive status itself does not set a send gate.
2. `degraded`: one or more recent failures, an elevated fallback signal, a slow speed band, or a completed-attempt rate below the healthy threshold.
3. `healthy`: enough recent evidence, no active unavailable sequence, and the completed-attempt rate meets the healthy threshold.
4. `unknown`: no recent evidence, fewer than the minimum evidence sample, expired evidence, or an unavailable monitoring read.

The first implementation must choose and test concrete constants for the minimum sample and healthy/degraded rate and latency thresholds in one server-owned helper. They must not be duplicated in React. The helper should prefer first-visible latency evidence from the existing passive route-reliability projection; if it is absent, speed is `unknown` rather than pretending total completion latency represents perceived responsiveness.

### Advisory behavior

- The status is a warning and decision aid, not a route-selection authority.
- A degraded or unavailable route remains selectable if it is still present in the member's allowed route projection.
- Existing configuration, permission, credential, and candidate resolution remain the only send blockers.
- A successful fallback is communicated as “已自动切换备用线路” without naming the physical Provider.
- A monitoring fetch failure, stale response, or unknown state never disables Composer submission.

## Refresh And Caching

### Member

- Fetch on session/bootstrap as a best-effort enhancement, when the model selector/inspector opens, and after a request completes or fails.
- Keep a client-side 60-second freshness window per session generation. Do not poll continuously while the selector is closed.
- Retain the last projection while refreshing and add a non-blocking “正在更新状态” label.
- If the fetch fails, retain the previous projection with a stale/unknown treatment and preserve normal chat behavior.

### Administrator

- Fetch when Operations loads and on an explicit refresh; a visible 60-second refresh affordance is acceptable, but no hidden high-frequency poll is required for the first release.
- The response includes `generatedAt`, `periodStart`, and `periodEnd`; UI displays them in the monitoring section.
- Do not cache admin data in a shared browser store or persist it to member-scoped local storage.

## UI Placement And Interaction

### Member workspace

- Keep the current model/route control in `WorkspaceHeader` as the compact entry point.
- Add status text and a non-color status marker to each option in the existing model selector/`ConversationInspector`.
- The selected route may open a small status detail panel containing the qualitative state, freshness, speed band, fallback hint, and “切换模型” action.
- Keep status text compact so the title, route identity, and connection state remain readable at 480px and 390px.
- Use a live `role="status"` only for state changes caused by a completed/failed request; do not repeatedly announce passive refreshes.
- Preserve existing focus, Escape, drawer, and opener restoration behavior.

### Administrator Operations

- Add a full-width “模型监控 · 最近 24 小时” summary band near the existing seven-day summary.
- Show headline totals first, then an hourly trend and compact route/provider/model groups.
- Keep the existing seven-day trend and Provider finance sections semantically unchanged.
- Use restrained separators and the current Operations visual system rather than introducing a separate dashboard shell.

## Privacy, Security, And Error Projection

- Admin endpoint uses the existing admin auth and validates `window`, `bucket`, and any limit before opening a shard.
- Member endpoint uses the current session and route access; it never trusts route IDs supplied by the browser to expand access.
- Every response has an exact decoder and rejects unknown fields, negative/fractional counts, invalid timestamps, duplicate group IDs, and impossible rate relationships.
- Normalize failure classes through the existing bounded Provider error taxonomy. Never include raw `Error.message`, request headers, credentials, URLs, operation fences, or attempt IDs.
- Monitoring logs remain operational and content-free. The feature does not add scheduled probes or live model calls.

## Compatibility And Rollback

- The design is additive. Existing `healthStatus`/`healthOutcome` fields and routing behavior remain valid if the new endpoint is unavailable.
- The first implementation should add read-only SQL aggregation methods without changing the ledger's append-only event schema or migration tag. If implementation proves a schema change is necessary for first-visible latency, return to planning rather than silently adding a migration.
- Rolling back the feature removes the new endpoints and hides the monitoring/member status sections; no chat, configuration, quota, route, Provider, or conversation data migration is required.
- `public/`, legacy API/browser shells, rollout manifests, deployment workflows, and production acceptance remain untouched.

## Trade-offs

- A per-Provider shard fan-out keeps the existing ledger ownership and avoids a new global telemetry Durable Object, at the cost of more read work per snapshot.
- A dedicated monitoring contract avoids coupling the UI to finance/budget fields, at the cost of one additional decoder and endpoint.
- Qualitative member status protects privacy and avoids false precision, at the cost of not showing users an exact percentage.
- Advisory unavailable status avoids stale telemetry becoming a hard outage, at the cost of allowing an informed user to retry a degraded route.
- Passive evidence avoids quota-consuming health probes, at the cost of unknown status during quiet periods.

## Acceptance Mapping

R1 and R2 map to the admin snapshot, cross-shard merge, terminal semantics, and trend sections. R3 and R4 map to the member projection, advisory status, and privacy sections. R5 maps to refresh/caching. R6 maps to UI placement and accessibility behavior. R7 maps to compatibility, rollback, and approval gates. AC1-AC3 are backend/decoder contracts; AC4-AC7 are member projection and refresh contracts; AC8 covers cross-layer tests; AC9-AC10 remain release and product gates.
