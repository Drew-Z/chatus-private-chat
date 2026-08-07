# Provider Attempt Ledger

## 1. Scope / Trigger

Use this contract when adding or changing a Provider execution path, retry,
fallback, Automatic Skill selection, tool continuation, auxiliary completion,
model discovery, attempt diagnostics, or the `ProviderAttemptLedger` Durable
Object.

The ledger proves which server-selected Provider/offering/model call was
attempted and owns the bounded usage, price, cost, reconciliation, and
instance/provider budget evidence attached to that call. It is the atomic hard
budget admission owner for one Provider shard. It never accepts browser
attribution or retains raw invoices.

## 2. Signatures

```typescript
createProviderAttemptRuntime({
  ledger: env.PROVIDER_ATTEMPT_LEDGER,
  mode: env.PROVIDER_ATTEMPT_LEDGER_MODE,
  operation: instanceFence.operation,
  turnId?,
}): ProviderAttemptRuntime

runtime.createRun(runKind).start({
  logicalRouteId, providerId, model, credentialClass, fallbackIndex, startedAt?,
}): Promise<ProviderAttemptHandle>

handle.budgetDecision?: ProviderBudgetDecisionV1
handle.succeed() | handle.fail(error) | handle.cancel() | handle.timeout()
```

```text
GET /api/admin/provider-attempts?providerId=<configured-id>&limit=<1..100>
GET /api/admin/provider-finance?providerId=<configured-id>&periodStart=<ms>&limit=<1..100>
POST /api/admin/provider-finance/prices
POST /api/admin/provider-finance/reconciliations
POST /api/admin/provider-finance/budgets
POST /api/admin/provider-finance/budget-reservations/:reservationId/reconcile
```

```text
Durable Object binding: PROVIDER_ATTEMPT_LEDGER -> ProviderAttemptLedger
Durable Object shard: providerId
Worker variable: PROVIDER_ATTEMPT_LEDGER_MODE = required | disabled
Capture schema: provider-attempt-ledger-v3
```

SQLite v3 owns `provider_attempt_schema_migrations`,
`provider_attempt_events`, `provider_attempt_projection`,
`provider_price_catalog`, `provider_attempt_price_binding`,
`provider_usage_evidence`, `provider_usage_projection`,
`provider_cost_evidence`, `provider_reconciliation_imports`,
`provider_budget_policies`, `provider_budget_events`,
`provider_budget_decisions`, `provider_budget_reservations`, and
`provider_budget_projection`.

## 3. Contracts

- `turnId` identifies one admitted user-message lifecycle. `runId` identifies
  one logical execution within that turn. `attemptId` identifies one exact
  Provider/offering/model request. All three are opaque server-issued UUIDs.
- Main-answer fallback attempts share one turn and run. Automatic Skill and
  every tool continuation receive distinct runs under the same turn. Memory
  suggestion, conversation summary, and administrator model discovery create
  their own server-side turn and run. TeamAgent schema v7 persists the current
  turn ID so an approval/tool continuation reuses it after hibernation.
- Run kinds are the closed set `main_answer`, `automatic_skill`,
  `memory_suggestion`, `conversation_summary`, `model_discovery`,
  `tool_continuation`, and `legacy_capability`.
- Start input is exact and content-free. It contains version, idempotency key,
  turn/run/run-kind, logical route, Provider, derived offering ID, model,
  fallback index, credential class, the exact instance operation fence, and
  start time. Prompt, completion, tool payload, raw Provider metadata,
  credentials, invoice data, and extra fields are rejected.
- The idempotency key is
  `provider-attempt:v1:<operation fenceId>:<run UUID>:<fallbackIndex>`. An
  identical replay returns the original projection without changing its
  timestamps. Any attribution conflict fails closed. A terminal replay is
  accepted only when status and error class match the immutable result.
- Budget policy v1 is exact, append-only, and scoped to one Provider, one
  ISO-4217 currency, one fixed UTC window, and instance-funded credentials.
  Monetary fields are non-negative safe integer micro-units. The first version
  for a policy must be `shadow`; a direct initial `disabled`, `soft`, or `hard`
  version fails with `provider_budget_policy_transition`. Later versions use
  `expectedPreviousVersion` compare-and-set. No policy behaves as disabled.
- Budget modes are closed: `disabled` performs no observation, `shadow` records
  `observed`/`would_deny`, `soft` additionally increments bounded alert
  evidence, and `hard` alone creates reservations or denies. A user credential
  is `byok_excluded` and never joins the server-funded balance.
- `start()` resolves the immutable price binding, budget policy, and balance in
  the same `transactionSync` as attempt creation. A hard reservation appends
  the decision/event and updates reservation/balance projections atomically.
  Unknown price or insufficient balance appends only bounded denial evidence,
  returns `provider_budget_policy_unknown` or `provider_budget_exceeded`, and
  creates neither an attempt nor a Provider call.
- Each hard attempt owns one conservative reservation. Known cost settles exact
  integer micros and releases only the proven remainder. Unknown cost moves the
  full remainder to `held`; after `259200000` ms it becomes
  `review_required` while staying counted. Late evidence, corrections,
  reconciliation, or an idempotent audited operator `reconcile|release` action
  append new evidence and update the fenced projection without double charge.
- `ProviderAttemptLedger`, addressed by `providerId`, appends one `started`
  event and at most one `terminal` event while maintaining a query projection
  in the same SQLite transaction. Append-only semantics are enforced by its
  private RPC/application boundary; do not add update/delete triggers without
  verifying capture and isolated restore compatibility.
- A Provider attempt must start after candidate/credential selection but before
  Provider network execution. Terminal states are `succeeded`, `failed`,
  `cancelled`, and `timed_out`; failure classes are the bounded public Provider
  classes, never raw exception messages.
- In `required` mode, ledger RPCs receive one bounded retry. A start failure
  raises `ProviderAttemptLedgerError`, blocks Provider execution, and is never
  eligible for Provider fallback. `disabled` is the explicit rollback mode and
  performs no ledger RPC while leaving routing, quota, and telemetry unchanged.
  Any value other than exact `disabled` normalizes to `required`.
- A non-success terminal write or consistency conflict is propagated after
  admission/lease cleanup. For a successful Provider response, infrastructure
  failure does not replace the response: the runtime schedules at most three
  additional terminal retries through `waitUntil`. Retry exhaustion leaves the
  conservative reservation pending and operator-visible; it is never released
  as zero. Any recovery appends terminal/budget evidence rather than rewriting
  the start event.
- Stream ownership settles success on complete, failure on stream error,
  cancellation on consumer/request cancellation, and protocol failure for a
  bodyless response. Automatic Skill's five-second boundary calls `timeout()`
  directly and rejects late results; the selector rechecks abort after plan and
  ledger-start dependencies.
- User-message quota remains one admission per user message. Selector,
  fallback, retry, and continuation attempts add ledger evidence but never
  increment that quota again.
- Usage evidence is append-only and normalized per token dimension. Cumulative
  readings are converted to non-negative deltas against the attempt projection;
  delta readings are accepted as-is; missing/late dimensions remain `null`.
  A partially known projection is `usageState: "partial"`, never a zero-filled
  total. A terminal attempt may settle before a usage tail arrives; late usage
  appends evidence and does not rewrite terminal identity.
- `ProviderStreamAttempt.usage` and tool-turn usage are provider-local evidence
  promises. A rejected/truncated usage collector returns unknown dimensions and
  must not turn an otherwise successful terminal attempt into a failure.
- Effective-dated price catalogs are immutable. An attempt binds one catalog
  version at `startedAt`; later price imports never rewrite that binding.
  Calculated cost evidence uses `estimated`/`reported`/`reconciled` classes;
  reversal, replacement, and correction events use `corrected` and append a
  `supersedesEventId` chain. A calculated event may not claim `corrected`.
- Reconciliation imports contain only fingerprint, period, currency, totals,
  variance, status, and timestamps. A fingerprint chain accepts strictly newer
  revisions, retains `supersedesReconciliationId`, and rejects identity or time
  conflicts. Raw invoice files, credentials, prompts, and Provider responses
  are never stored or projected.
- Administrator diagnostics require admin authentication, accept only a
  currently configured Provider shard, default to 25 and cap at 100, and omit
  the idempotency key and complete operation fence. They expose only bounded
  identity, route, status/error class, timing, credential class, and operation
  kind fields.
- The ledger is instance-level operational evidence. Account deletion retains
  it, user export excludes it, and the first release has no automatic expiry.
  These policies are explicit rather than inferred from missing cleanup code.
- Capture registers every Provider shard as `authoritative/restore` with schema
  `provider-attempt-ledger-v3`. Restore accepts it only when the target exposes
  the exact same ledger schema; a v1/v2-only target rejects a v3 archive before
  any target mutation. The Worker Durable Object binding remains
  `PROVIDER_ATTEMPT_LEDGER -> ProviderAttemptLedger` at migration tag `v5`.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Start payload has extra/content/secret fields or the shard differs from `providerId` | `provider_attempt_start_invalid`; no event or Provider call |
| Same idempotency key and same semantic start | Return the original attempt; do not append or rewrite |
| Same idempotency key with changed attribution | `provider_attempt_conflict`; preserve original evidence |
| First budget policy is not `shadow` | `provider_budget_policy_transition`; no policy or projection write |
| Budget policy version is stale or idempotent identity changes | `provider_budget_policy_conflict`; preserve prior version |
| Budget window overlaps another policy or has invalid integer/currency/window fields | `provider_budget_policy_overlap` or `provider_budget_policy_invalid`; write nothing |
| Hard admission has unknown price | `provider_budget_policy_unknown` / HTTP 503; append bounded denial only; zero attempt and Provider calls |
| Hard admission lacks available balance | `provider_budget_exceeded` / HTTP 429; append bounded denial only; zero attempt and Provider calls |
| Credential class is `user` | Record `excluded/byok_excluded`; create no server-funded reservation |
| Terminal status/error pair is inconsistent or ends before start | `provider_attempt_terminal_invalid` |
| Terminal replay matches | Return existing projection with `updated=false` |
| Terminal replay differs | `provider_attempt_conflict`; preserve the first terminal event |
| Required ledger start remains unavailable after retry | Block Provider execution with `ProviderAttemptLedgerError` |
| Required non-success terminal write remains unavailable | Clean up admission/lease, propagate failure, retain reservation/evidence for review |
| Successful response terminal write remains unavailable | Preserve response, schedule bounded retry, retain pending conservative reservation on exhaustion |
| Mode is exact `disabled` | Execute Provider without ledger I/O; preserve all other runtime behavior |
| Usage has missing or mixed token dimensions | Return `unknown` or `partial` fields (`null` per dimension), never zero-fill |
| Usage arrives after terminal settlement | Append idempotent late evidence and update usage projection only; preserve terminal event |
| Price catalog has overlapping/invalid effective dates or no token price | Reject with `provider_price_catalog_invalid`; do not bind an attempt |
| Cost correction uses calculated/incorrect evidence class, an unknown superseded event, or an older timestamp | Reject with the corresponding cost validation error; preserve prior evidence |
| Reconciliation fingerprint identity changes or imported time is not newer | `provider_reconciliation_conflict`; preserve the prior revision |
| Reconciliation payload includes raw invoice/secret fields | `provider_reconciliation_invalid`; store nothing |
| Hard terminal cost remains unknown | Move full remaining reserve to `held`; after 72 hours promote to `review_required`, never release as zero |
| Duplicate budget start, terminal, evidence, or operator callback | Replay original result without changing integer balances; conflicting identity fails closed |
| Automatic Skill reaches five seconds with an active attempt | Record `timed_out/upstream_timeout`, abort Provider work, ignore late result |
| Stream handoff has no body | Record `failed/provider_protocol_error`, cancel upstream, release lease/admission |
| Diagnostics are unauthenticated, limit is outside 1..100, or Provider is unconfigured | `401`, `400 invalid_limit`, or `400/404` without opening an arbitrary shard |
| Account deletion or user export runs | Retain ledger / exclude ledger respectively |
| Restore target has a missing/wrong binding, class, or migration tag | Reject before target mutation |

## 5. Good / Base / Bad Cases

- Good: one admitted message performs Automatic Skill selection, a failed main
  offering, a successful fallback, and a tool continuation; every Provider call
  has one attempt, all share one turn, logical executions have separate runs,
  and quota increments once.
- Good: a policy begins in shadow, advances by version to hard, atomically
  reserves before I/O, settles known cost, and retains unknown exposure for
  review without changing message quota.
- Base: capture is disabled during rollback; Provider behavior and quota remain
  unchanged and operators make no ledger completeness claim for that interval.
- Base: terminal evidence is available before a usage tail; the attempt remains
  settled while its usage/cost state is `unknown` or `provisional` until a later
  append closes the evidence gap.
- Bad: trust `turnId`, Provider, model, usage, or cost fields from the browser;
  retry Provider execution after a required ledger-start failure; classify a
  lingering `started` row as success; zero-fill missing usage; mutate a prior
  price/reconciliation row; or expose operation fences/raw errors/invoice data
  in diagnostics or export; create the first policy directly as hard; or release
  an unknown reservation as zero after a settlement outage.

## 6. Tests Required

- Unit-test exact input decoding, opaque IDs, error projection, start/terminal
  replay, attribution conflicts, event/projection counts, and disabled mode.
- Exercise fake Provider main answer, pre-visible fallback, cancellation,
  timeout, bodyless stream, Automatic Skill, Agent and legacy tool
  continuations, memory suggestion, conversation summary, and model discovery.
- Assert every fake Provider request maps to exactly one attempt and that one
  admitted message is not charged again for selector/fallback/continuation.
- Inject ledger start and terminal failures; assert zero Provider calls on start
  failure and admission/lease cleanup before terminal failure is surfaced.
- Scan SQL columns, diagnostics, logs, account deletion, and user export for
  prompt/completion/tool/credential/raw metadata/invoice markers.
- Cover cumulative/delta/missing/late usage, partial projections, effective-date
  price selection, append-only cost corrections, duplicate/revisioned
  reconciliation imports, and strict finance response decoding.
- Cover first-shadow transition enforcement, concurrent hard admission,
  duplicate/crash-style replay, exact success/failure/cancellation/timeout
  balances, BYOK exclusion, unknown-price zero-call denial, 72-hour holds,
  soft rollback, and idempotent operator recovery.
- Capture and restore `provider-attempt-ledger-v3`; reject a v3 archive on a
  v1/v2-only target and any target whose five exact Durable Object migration tags
  differ from v1 through v5.
- Run the full local quality gate with fake Providers/MCP only. Never use a live
  model, synthetic production probe, or local production deployment.

## 7. Wrong vs Correct

### Wrong

```typescript
const response = await callProvider(route);
await ledger.put({ ...body, providerId: body.providerId, response, usage: 0 });
```

This executes before durable attribution, trusts browser identity, and stores
content after the fact.

### Correct

```typescript
const run = providerAttempts.createRun("main_answer");
const attempt = await run.start({
  logicalRouteId: route.routeId,
  providerId: route.providerId,
  model: route.model,
  credentialClass: route.credential.source,
  fallbackIndex: route.planIndex,
});
const response = await callProvider(route);
await attempt.succeed();
```

The server-selected execution boundary records immutable content-free identity
before I/O and appends only bounded terminal/usage/cost evidence afterward.
