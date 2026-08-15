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
| Decoder sees unknown fields, negative/fractional counts, duplicate IDs, impossible rates, invalid buckets, or Provider/secret/content fields | Reject the complete response before rendering |
| Monitoring fetch fails or evidence is stale | Preserve chat/send behavior and show stale/unknown guidance rather than changing routing |

## 5. Good / Base / Bad Cases

- Good: the Worker fans out to configured ledger shards, merges complete aggregate rows, reconciles every breakdown to totals, and returns exact null/unknown values where evidence is incomplete.
- Base: a member sees a compact status beside model selection, can still choose a degraded/unavailable route, and receives a safe fallback hint without seeing the physical Provider.
- Bad: derive totals from a 25-row recent-attempt list, sum per-Provider user turns as if they were attempts, return a partial denominator, expose a Provider ID to a member, or disable sending because passive telemetry says unavailable.

## 6. Tests Required

- Contract tests cover no data, in-flight-only, success, failure, cancellation, timeout, fallback, mixed status, null latency, three-failure anti-flap, and recovery semantics.
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
