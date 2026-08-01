# Provider Usage, Cost, Budget, And Feedback Design

## Status And Scope

This document defines a future accounting and governance model. It does not implement usage capture, prices, cost estimates, budgets, feedback scoring, billing, or Provider calls.

## Current Evidence

- Quota admission counts accepted user message units in member `UserState`; it does not count Provider tokens or money (`src/services/quota-admission.ts:29`, `src/services/quota-admission.ts:87`, `src/worker.ts:649`).
- Passive reliability telemetry is keyed by logical route and physical Provider. It records real-task success, outcome, latency, fallback, and stream shape, capped at 1,000 samples (`src/services/route-reliability.ts:4`, `src/services/route-reliability.ts:21`, `src/services/route-reliability.ts:67`).
- Automatic Skill selection uses a separate `route-provider-skill-selection:` keyspace and must not affect chat reliability or user-message quota (`src/services/route-reliability.ts:5`, `.trellis/spec/frontend/agent-streaming.md`, section "Reliability And Quota").
- Provider planning resolves multiple physical attempts behind one logical route and may fall back before visible output (`.trellis/spec/platform/provider-plan-runtime.md:34`, `.trellis/spec/platform/provider-stream-runtime.md:41`).
- Feedback is one bounded KV array keyed by `${label}:${chatId}:${messageId}`. It records the logical `routeId`, not the actual Provider attempt, and concurrent read-modify-write can lose updates (`src/services/feedback-audit.ts:6`, `src/services/feedback-audit.ts:48`, `.trellis/spec/platform/feedback-audit-persistence.md:25`).
- Current operational metrics aggregate requests, errors, fallbacks, rate limits, and route results by day. They are not an immutable ledger (`src/worker.ts:1348`, `src/worker.ts:1375`).
- No code or spec currently defines token usage normalization, price versions, currency conversion, invoice reconciliation, budget reservation, or correction events.

## Non-goals

- Treating daily message quota as a financial budget.
- Deriving true cost from latency, message count, or reliability samples.
- Accepting browser-supplied Provider/offering/cost attribution.
- Making feedback a payment, credit, or automatic routing decision.
- Contacting a live Provider or billing API from tests.

## Required Identity Model

Three identities must remain distinct:

| Level | Meaning | Cardinality |
| --- | --- | --- |
| `turnId` | One admitted user message unit, including its complete answer lifecycle | one per quota-bearing user turn |
| `runId` | One logical execution such as main answer, Skill selection, title/summary, or approved tool continuation | one or more per turn |
| `attemptId` | One request to one exact Provider/offering/model with one credential source | zero or more per run |

Continuations that do not consume a new message quota still require a new `runId` linked to the original `turnId`. Retries and fallback always create new `attemptId` values. Tool calls have their own execution IDs and link to the run that requested them; they are not Provider attempts.

All IDs are generated server-side, opaque, and idempotent for the operation fence that owns them.

## Required Invariants

1. Actual Provider, offering, model, logical route, fallback index, and credential class are recorded at the server attempt boundary.
2. Browser fields and assistant metadata cannot create or rewrite accounting attribution.
3. Provider-reported usage, locally estimated usage, invoiced usage, and corrected usage are separate evidence classes.
4. Money always has currency, price-catalog version, unit precision, and provenance. Unknown is stored as unknown, never zero.
5. Ledger events are append-only. Corrections reverse or supersede prior events; they do not mutate history silently.
6. Budget enforcement uses reserve -> settle/release -> reconcile. A successful Provider response cannot be discarded merely because settlement storage is temporarily unavailable.
7. One turn may have several chargeable failed/fallback attempts. Only counting the visible answer underreports cost.
8. BYOK usage and cost are marked separately and are not charged to an instance Provider budget unless policy explicitly says so.
9. Feedback links to a server-issued answer receipt that identifies the final answer and its contributing attempts without exposing Provider secrets to the browser.
10. Prompts, completions, tool payloads, credentials, raw Provider metadata, and invoices do not enter ordinary telemetry or budget projections.

## Candidate Architectures

### A. Extend Current KV Aggregates

Add token and money counters beside reliability records.

Rejected for authoritative accounting: bounded aggregates lose individual attempt provenance, current KV writes are not atomic, and corrections/reconciliation cannot be represented safely.

### B. Append-only Durable Ledger

Use one SQLite Durable Object owner per accounting shard. Append immutable attempt usage, reservation, settlement, adjustment, and reconciliation events; materialize bounded projections separately.

Recommended: it provides idempotency, atomic event/projection updates within a shard, and explicit correction history. Cross-shard organization budgets still need a coordinator or conservative reservation partitioning.

### C. External Billing/Analytics System

Stream normalized events to an external warehouse or billing service.

Useful later for invoice reconciliation, but not sufficient as the request-time enforcement source unless availability, idempotency, privacy, and failure behavior are independently designed.

## Recommended Conceptual Data Model

```text
turn(turnId, principalId, conversationId, admittedAt, quotaUnit)
run(runId, turnId, kind, logicalRouteId, startedAt, completedAt, outcome)
attempt(attemptId, runId, providerId, offeringId, modelId, fallbackIndex,
        credentialClass, startedAt, completedAt, outcome)
usage_event(eventId, attemptId, source, inputUnits, outputUnits,
            cachedInputUnits, toolUnits, observedAt, supersedesEventId?)
price_catalog(priceVersion, providerId, offeringId, modelId, currency,
              effectiveFrom, unitPrices, source)
cost_event(eventId, attemptId, usageEventId, priceVersion, currency,
           amountMinor, classification, supersedesEventId?)
budget_event(eventId, budgetId, turnId?, attemptId?, kind,
             amountMinor, currency, idempotencyKey, at)
feedback_receipt(receiptId, principalId, conversationId, messageId,
                 turnId, finalRunId, issuedAt, expiresAt?)
```

`source` is one of `provider_reported`, `estimated`, `invoice_reconciled`, or `operator_corrected`. `classification` is one of `known`, `estimated`, `unknown_price`, `byok`, or `credit`.

## Usage And Cost State Machine

```text
attempt_started
  -> usage_unknown
  -> usage_reported | usage_estimated
  -> cost_priced | cost_unknown
  -> invoice_reconciled
  -> corrected (append reversal + replacement)
```

- Missing Provider usage produces `usage_unknown`, not zero.
- A late Provider callback or stream-final usage event appends evidence to the same `attemptId` if its idempotency key is new.
- If a Provider reports cumulative totals more than once, the adapter normalizes them into one canonical usage event or explicit deltas.
- Price selection uses the attempt start time and immutable effective-dated catalog. Later price edits do not rewrite prior cost.
- Invoice reconciliation records variance at Provider/account/period granularity and may append attempt-level corrections only when the source supports exact mapping.

## Budget Hierarchy And Enforcement

Candidate scopes, from narrowest to broadest:

```text
member -> team/tenant -> instance -> provider account
```

First implementation should support instance and member budgets only. A request must satisfy every applicable scope.

Recommended flow:

1. Estimate a conservative maximum for the planned attempt using configured token/tool limits and the current price version.
2. Atomically reserve that amount against each applicable budget using one turn/attempt idempotency key.
3. If the reservation fails, do not call the Provider; return a stable budget error.
4. When the attempt completes, settle known cost and release unused reserve.
5. If cost is unknown, retain a bounded conservative hold until timeout, then classify it for operator review rather than silently releasing it.
6. Append reconciliation or correction events later; enforcement projections consume the corrected balance.

Fallback reserves per attempt. A failed chargeable attempt settles before the next attempt reserves. Tool loops use the remaining turn ceiling and cannot bypass the budget by continuation. Automatic Skill selection has its own auxiliary budget class and remains outside user message quota.

## Candidate Budget Policies

| Policy | Behavior at limit | Trade-off |
| --- | --- | --- |
| Hard | deny before Provider call | predictable spend, more user-visible failures |
| Soft | allow and alert | continuity, no enforcement guarantee |
| Hybrid | hard per-member, soft instance alert, emergency hard ceiling | recommended initial policy after product approval |

Unknown prices must fail closed for a hard budget unless an explicit `allowUnknownPrice` policy with a conservative reserve exists.

## Feedback Attribution And Anti-forgery

The current browser submits route/chat/message IDs. A future design should instead issue a bounded signed or server-stored `feedbackReceiptId` with the final assistant projection.

Submission flow:

1. Authenticate the current principal.
2. Load the receipt and require the same principal, conversation, visible assistant message, and unexpired/revocable state.
3. Upsert one rating per receipt using an idempotency key.
4. Store the rating/reason separately from Provider telemetry.
5. Join to `turnId` and contributing attempts only in an authorized server projection.

Feedback never proves Provider quality by itself. Edited, regenerated, branched, or partially failed answers retain distinct receipts. Administrators may view aggregate feedback only after minimum-count privacy thresholds are defined.

## Privacy, Retention, And Export

- Operational projections expose counts, known/estimated/unknown classifications, currency totals, and bounded dimensions. They exclude content and credentials.
- Provider IDs may be administrative metadata but remain absent from user export unless needed to explain a user-visible charge.
- User export may include the member's budget debits and feedback history only after a separate portability policy; it must not include shared account invoices or other members' activity.
- Raw attempt events and invoices require an operator retention policy, deletion policy, and legal basis. Aggregate retention cannot outlive its declared purpose by default.
- Account deletion must decide whether financial records are deleted, pseudonymized, or retained for legal/accounting requirements. That decision cannot be inherited from conversation purge behavior.

## Reconciliation

Reconciliation imports provider invoice/usage statements through a versioned, secret-safe adapter. It records source file fingerprint, period, Provider account, currency, totals, unmatched amount, and reconciliation status. Raw invoices remain outside ordinary application artifacts.

Required statuses:

```text
pending -> matched | partially_matched | disputed -> corrected | closed
```

The system must surface unknown, late, and corrected usage separately. A dashboard that shows only a single total is insufficient acceptance evidence.

## Migration And Rollback

1. Introduce identifiers and ledger writes in shadow mode without enforcement.
2. Compare turn/run/attempt counts with existing real-task reliability and quota metrics.
3. Add usage and immutable price catalogs; keep all cost labeled estimated/unknown until reconciliation proves accuracy.
4. Enable alerts before reservation enforcement.
5. Enable one budget scope at a time after over/under-count drills.

Rollback disables enforcement but keeps append-only events and idempotency fences. It must not delete or rewrite cost history. If the ledger is unavailable, existing Provider execution policy must follow an explicitly approved fail-open or fail-closed mode; it cannot vary implicitly by exception type.

## Acceptance Scenarios For A Future Implementation

1. One turn falls back across two Providers: two attempts are recorded, both chargeable usage records remain, and feedback links to the final answer receipt.
2. A Provider omits usage: the attempt is `unknown`, a hard budget uses the approved conservative hold, and dashboards do not display zero cost.
3. Late usage settles the same attempt idempotently without double charging.
4. A price catalog changes tomorrow; yesterday's attempt retains the old price version.
5. An invoice correction appends reversal/replacement events and preserves the audit trail.
6. A forged feedback receipt, wrong principal, edited message, or replayed request is rejected.
7. Tool continuations and Automatic Skill selection do not create extra user quota units but remain visible as separate runs/attempts.
8. No Provider call occurs when a hard reservation is denied.

## Open Product Decisions

- Which budget scopes ship first, and which are hard versus soft?
- Who owns and approves price catalogs and currency conversion sources?
- How long may an unknown-cost reserve remain outstanding?
- Are BYOK attempts excluded from all budgets or included for usage visibility?
- What minimum aggregation threshold is required before Provider feedback is shown?
- What accounting/legal retention applies after member deletion?
- Is feedback editable indefinitely, time-limited, or frozen after reconciliation?

## Risks

The consolidated entries `FIN-01` through `FIN-05` in `risk-register.md` are normative inputs to future implementation planning.
