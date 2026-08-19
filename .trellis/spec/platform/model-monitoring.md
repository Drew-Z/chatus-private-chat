# Model Monitoring And Member Availability

## 1. Scope / Trigger

Use this contract when adding or changing the rolling model monitor, member-visible model availability, Provider attempt aggregate reads, or their React Operations/workspace projections. This feature is passive telemetry for calls that passed through Chatus; it is not account-wide Provider telemetry and never becomes a send gate.

## 2. Signatures

```text
GET /api/admin/model-monitor?window=24h&bucket=hour
GET /api/model-availability

ProviderAttemptLedger.getMonitoringAggregate({ periodStart, periodEnd })
ProviderAttemptLedger.listAvailabilityEvidence({ periodStart, periodEnd, routeIds })
```

The admin endpoint requires the existing admin session. The member endpoint requires a signed-in member session and derives route access from the existing `getRouteAccess()` projection.

## 3. Contracts

- The monitor window is exactly `periodEnd - 86_400_000` through server-generated `periodEnd`, inclusive by `started_at`. The server returns exactly 24 hourly buckets.
- One actual upstream request is one Provider attempt. `started` is in flight; `succeeded` is success; `failed`, `cancelled`, and `timed_out` are terminal failures. `successRate = succeeded / (succeeded + failures)` and is `null` with no completed attempts.
- Fallback attempts count independently and increment `fallbacks` when `fallback_index > 0`. Average latency includes only terminal rows with `ended_at >= started_at`; missing or invalid durations remain unknown.
- The admin projection may include bounded logical-route, configured Provider, actual-model, run-kind, hourly, and normalized failure-class aggregates. It must not include prompts, completions, raw errors, request headers, credentials, attempt IDs, turn IDs, idempotency keys, or operation fences.
- Run kind is closed and includes `auxiliary_vision`. Each physical helper
  request participates in totals, hourly buckets, fallback counts, latency, and
  the run-kind breakdown exactly once. `VisionEvidenceV1`, raw images, helper
  output, and source message IDs never enter aggregate rows or either public
  projection.
- The member projection contains only already-allowed logical route ID/label/model plus `healthy | degraded | unavailable | unknown`, confidence, coarse first-visible speed, freshness evidence, and a fallback-used hint. It must not include Provider identity, exact counts/rates, or raw failure classes.
- Member status is advisory: one recent failure is `degraded`; three latest terminal failures within 15 minutes with no later success are `unavailable`; later success recovers the route. Existing permission, configuration, credential, candidate, and send checks remain authoritative.
- Member availability refreshes on bootstrap, model inspector opening, and request settlement with a 60-second client guard. A read failure retains the last projection and must not block the composer. Admin monitoring is best-effort in Operations and must not remove the existing seven-day or finance projections.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Admin query is not `window=24h&bucket=hour` | `400 invalid_model_monitor_query` |
| Configured Provider ledger shard cannot be read | `503 model_monitor_unavailable` with `retryable: true`; no partial admin snapshot |
| Member is a guest or unauthenticated | `403 member_required` / existing session denial |
| Member route is not in `getRouteAccess()` | Omit it; never trust a browser-supplied route list |
| No recent route evidence | `unknown` with stale confidence and unknown speed |
| Only in-flight evidence | Keep it out of the success denominator and do not claim success |
| Auxiliary helper attempt is present | Count its bounded attempt fields under `auxiliary_vision`; discard no attempt and expose no private evidence |
| Decoder sees unknown fields, negative/fractional counts, duplicate IDs, impossible rates, invalid buckets, or Provider/secret/content fields | Reject the complete response before rendering |
| Monitoring fetch fails or evidence is stale | Preserve chat/send behavior and show stale/unknown guidance rather than changing routing |

## 5. Good / Base / Bad Cases

- Good: the Worker fans out to configured ledger shards, merges complete aggregate rows, reconciles every breakdown to totals, and returns exact null/unknown values where evidence is incomplete.
- Good: helper fallback attempts reconcile into the same totals and an
  `auxiliary_vision` run-kind row while the private evidence table and response
  payload remain unreachable from monitoring.
- Base: a member sees a compact status beside model selection, can still choose a degraded/unavailable route, and receives a safe fallback hint without seeing the physical Provider.
- Bad: derive totals from a 25-row recent-attempt list, sum per-Provider user turns as if they were attempts, return a partial denominator, expose a Provider ID to a member, or disable sending because passive telemetry says unavailable.

## 6. Tests Required

- Contract tests cover no data, in-flight-only, success, failure, cancellation, timeout, fallback, mixed status, null latency, three-failure anti-flap, and recovery semantics.
- Contract tests include `auxiliary_vision` success/fallback/failure rows and
  assert exact total/run-kind reconciliation with zero evidence, image, or
  source-message fields.
- Ledger tests assert aggregate totals are independent of `listRecent` limits and contain no content or secret fields.
- Worker tests assert admin/member authorization, bounded query errors, exact reconciliation, shard-failure fail-closed behavior, allowed-route projection, privacy redaction, and advisory send behavior.
- Browser API tests reject unknown keys, invalid counts/rates/buckets, duplicate IDs, and Provider/credential/content leakage.
- Synthetic Workspace/Operations browser fixtures use no `/api` or Agent calls and cover model status copy, monitoring summary rendering, 1920px/1440px/780px/480px/390px containment, keyboard focus, and local table overflow.

## 7. Wrong vs Correct

### Wrong

```typescript
const attempts = await ledger.listRecent({ limit: 25 });
return { attempts: attempts.length, successRate: attempts.filter((item) => item.status === "succeeded").length / attempts.length };
```

This truncates the denominator, treats in-flight rows as failures or successes, and creates a misleading operational rate.

### Correct

```typescript
const rows = await ledger.getMonitoringAggregate({ periodStart, periodEnd });
const snapshot = mergeProviderAttemptMonitoringRows(rows, labels, generatedAt, periodStart, periodEnd);
```

The server merges bounded aggregate rows, keeps terminal semantics explicit, and produces separate privacy-scoped admin/member projections.

## Scenario: Content-free Capability Execution Monitoring

### 1. Scope / Trigger

Use this contract when recording or displaying orchestration outcomes for workflow
selection, auxiliary vision, explicit web research, or tool execution. These rows
describe logical capability work and must remain separate from physical Provider
attempt semantics.

### 2. Signatures

```text
GET /api/admin/capability-monitor?window=24h&bucket=hour

ProviderCoordinator.recordCapabilityMonitoringEvent(event)
ProviderCoordinator.getCapabilityMonitoringAggregate({ periodStart, periodEnd })
```

```typescript
type CapabilityMonitoringEventV1 = {
  version: 1;
  capabilityId: "chatus:workflow_selection" | "chatus:vision_assist"
    | "chatus:web_research" | "chatus:tool_execution";
  kind: "workflow_selection" | "auxiliary_vision" | "web_research" | "tool";
  status: "succeeded" | "failed" | "denied" | "cancelled" | "timed_out";
  latencyMs: number | null;
  occurredAt: number;
};
```

The singleton named `ProviderCoordinator` object `$capability-monitoring-v1` owns
the bounded aggregate. No new Durable Object binding or migration is required.

### 3. Contracts

- Capability monitoring is logical orchestration telemetry. It never creates a
  Provider attempt, changes Provider-attempt denominators, or affects chat outcome.
- The owner stores only the closed capability ID/kind/status dimensions, hourly
  bucket start, bounded count, latency sum/count, and last occurrence. Retention is
  48 hours; the public window is exactly 24 hours with hourly buckets.
- Event writes validate exact keys and ID-to-kind pairing, cap latency at 600,000 ms,
  and cap one row at 100,000 events. Scheduling creates a deferred microtask that
  checks a synchronous `accepted` flag; the cross-Durable-Object RPC starts only
  after `waitUntil(write)` returns successfully. A missing or synchronously throwing
  lifecycle owner therefore starts no RPC. Monitoring failure is caught and never
  allowed to fail an otherwise successful turn.
- The admin snapshot contains rows plus summaries only. It contains no member,
  conversation, prompt, image, query, citation, instruction, credential, endpoint,
  raw tool body, Provider identity, attempt identity, or memory field.
- `total` reconciles exactly to the five terminal status counts. `successRate` uses
  that total; average latency uses only rows with latency evidence. Summary values,
  evidence, staleness, time window, row uniqueness, and row bounds are recomputed by
  the shared decoder before either server or React code accepts a snapshot.
- `no_data` means an available aggregate with no rows. `unavailable` is permitted
  only with empty rows/summaries and `stale: true`. Non-empty evidence is `fresh` or
  becomes `stale` when the latest event is older than six hours.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Query differs from exact `window=24h&bucket=hour` | `400 invalid_capability_monitor_query` |
| Aggregate read fails | `503 capability_monitor_unavailable`, `retryable: true` |
| Event has unknown keys, mismatched ID/kind, invalid status/time/latency | Discard it; do not mutate aggregate state |
| Row is duplicated, out of window, misaligned, over-bounded, or internally inconsistent | Reject the complete aggregate/snapshot |
| Summary differs from recomputed rows | Reject the complete snapshot before rendering |
| Evidence/stale combination contradicts rows | Reject the complete snapshot |
| Monitoring write fails during a chat turn | Preserve the original turn result and expose no raw failure payload |
| No lifecycle `waitUntil` owner exists | Skip the passive write; do not launch an untracked RPC |
| Lifecycle `waitUntil` throws synchronously | Leave `accepted` false; deferred work resolves without launching an RPC |

### 5. Good / Base / Bad Cases

- Good: one timed-out research operation increments one hourly research row, the
  summary reconciles, and the original user-visible timeout remains unchanged.
- Base: no capability work occurred; the endpoint returns exact `no_data` evidence
  and empty rows/summaries.
- Bad: reuse a Provider-attempt row for a tool invocation, store a query or member
  label for debugging, accept client-side summary math, or await telemetry on the
  successful-turn critical path.

### 6. Tests Required

- Contract tests cover exact decoding, all terminal statuses, retention, future and
  old events, saturation, duplicate rows, latency bounds, stale/no-data/unavailable
  evidence, summary reconciliation, unknown keys, and privacy-field rejection.
- Coordinator tests cover persistence, invalid-event no-op behavior, range reads,
  alarm cleanup, and best-effort write failures.
- Worker tests cover admin authentication, exact query bounds, content-free output,
  successful turns when monitoring writes reject, and zero rows/RPCs for missing or
  synchronously throwing lifecycle owners. An accepting owner records exactly one row.
- Client tests import the shared snapshot decoder and reject malformed summaries or
  evidence instead of maintaining a second browser contract.

### 7. Wrong vs Correct

#### Wrong

```typescript
await providerAttemptLedger.start({ runKind: "tool", prompt, member });
await coordinator.recordCapabilityMonitoringEvent({ ...event, query, providerId });
```

This corrupts physical-attempt accounting, stores prohibited content/identity, and
can put passive telemetry on the user-visible critical path.

#### Correct

```typescript
let accepted = false;
const write = Promise.resolve().then(async () => {
  if (!accepted) return;
  await coordinator.recordCapabilityMonitoringEvent(event).catch(() => undefined);
});
try {
  waitUntil(write);
  accepted = true;
} catch {
  // No lifecycle owner means no RPC.
}
```

One bounded logical event reaches the existing coordinator owner only after
lifecycle ownership is accepted; Provider attempts remain physical-call only and
chat success cannot be downgraded.

## Scenario: Passive 24-Hour Production Observation Evidence

### 1. Scope / Trigger

Use this contract when a deployed Chatus revision needs a release-level observation result. The observation is a read-only evidence gate for the existing monitor and member availability endpoints; it is not a deployment, health probe, routing gate, or synthetic model test.

### 2. Signatures

```text
Workflow: .github/workflows/production-model-observation.yml
Collector: node scripts/collect-production-model-observation.mjs
Input: deployed_sha, observation_started_at
Read: GET /api/admin/model-monitor?window=24h&bucket=hour
Acceptance: npm run acceptance:production
```

### 3. Contracts

- The workflow is `workflow_dispatch` only, runs from `refs/heads/main`, uses the non-canceling `chatus-production-mutation` concurrency group, and has a 15-minute timeout.
- `deployed_sha` and `observation_started_at` are required inputs. The collector requires the deployed SHA to be a lowercase 40-character SHA, the start timestamp to be valid, and the current time to be at least 86,400,000 ms after the start.
- The collector verifies `/release.json` before and after the read, requires the deployed release to be an ancestor of the current main SHA, logs in through the existing admin session, reads exactly the 24-hour hourly monitor contract, and logs out before producing evidence.
- The retained JSON may contain only the deployed SHA, observation timestamps, period timestamps, totals, and bounded group counts. It must not contain route, Provider, model, failure-class, attempt, turn, member, prompt, response, conversation, credential, cookie, or raw error identifiers.
- The same serialized run invokes model-request-free production acceptance, including the member `/api/model-availability` projection check. It must never call `/api/chat`, Wrangler, or a completion endpoint.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Workflow ref is not `refs/heads/main` | Stop before production reads |
| Observation window is shorter than 24 hours | Stop without an artifact |
| Deployed SHA is not current or not a main ancestor | Stop before monitor read |
| Monitor response has unknown fields, fewer/more than 24 contiguous buckets, invalid counts/rates, or unreconciled groups | Reject the complete snapshot |
| Admin logout fails | Fail the run even if the monitor read passed |
| Release marker changes after the read | Fail the run and do not retain a success result |
| Artifact contains a prohibited identity or content field | Governance test fails and the evidence contract is invalid |
| No real model traffic exists | Retain a reconciled no-data/unknown aggregate, never a fabricated success |

### 5. Good / Base / Bad Cases

- Good: the exact deployed release remains stable, all 24 buckets reconcile to totals and breakdowns, admin logout succeeds, member availability is checked without a model request, and the artifact contains only aggregates.
- Base: no attempts occurred, so `completed=0` and `successRate=null`; availability may be unknown while chat remains usable.
- Bad: issue a hidden completion prompt to create traffic, truncate the monitor to a recent-attempt list, retain Provider or route labels in the artifact, or accept a different deployed SHA.

### 6. Tests Required

- Unit-test the exact 24-hour period, 24 contiguous buckets, terminal/in-flight semantics, fallback totals, success-rate denominator, all breakdown reconciliations, unknown-key rejection, and content/identity leakage rejection.
- Parse the workflow structurally and assert main-only dispatch, exact inputs, non-canceling concurrency, bounded timeout, early/late main guards, artifact path/retention, and absence of Wrangler or model-call commands.
- Assert production acceptance requests `/api/model-availability` and rejects Provider, credential, content, and duplicate-route fields without issuing `/api/chat`.
- Retain only aggregate counters and group counts in the artifact fixture; assert route, Provider, model, failure-class, prompt, response, cookie, and member identifiers are absent.

### 7. Wrong vs Correct

#### Wrong

```js
const attempts = await fetch("/api/admin/model-monitor?window=24h");
await fetch("/api/chat", { method: "POST", body: syntheticPrompt });
writeArtifact({ attempts, provider: "upstream" });
```

This uses an incomplete query, generates traffic, and leaks Provider identity into evidence.

#### Correct

```js
const snapshot = await read("/api/admin/model-monitor?window=24h&bucket=hour");
assert(isModelMonitorSnapshot(snapshot));
writeArtifact(summarizeModelMonitorSnapshot(snapshot, { deployedSha, observedAt }));
```

The correct path reads the exact existing aggregate contract, validates every reconciliation, and writes a content-free summary after release and session fences pass.
