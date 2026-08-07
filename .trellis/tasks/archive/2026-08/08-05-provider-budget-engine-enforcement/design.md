# Provider budget engine and enforcement design

## Boundary

`ProviderAttemptLedger` remains the single owner for one physical Provider.
Budget accounting is added to the same SQLite transaction boundary as attempt,
price, usage, and cost evidence. This deliberately limits the first hard scope
to one provider/currency/server-funded instance envelope; broader scopes need a
new coordinator or conservative partitioning and remain unsupported.

Message quota admission stays in `QuotaAdmissionService`. Budget release is a
separate capability and must never call or imitate quota `release()`.

## V1 Contracts

The finance contract gains exact-key decoders for:

- `ProviderBudgetPolicyV1`: server-issued `policyId`, monotonically increasing
  `version`, `scopeKind="instance_provider"`, `providerId`, ISO-4217 `currency`,
  `mode=disabled|shadow|soft|hard`, explicit UTC `periodStart/periodEnd`, integer
  `limitMicros`, `maxAttemptReserveMicros`, `holdReviewAfterMs=259200000`,
  `allowUnknownPrice=false`, actor, idempotency key, and timestamps.
- `ProviderBudgetDecisionV1`: policy/scope identity, attempt identity,
  `excluded|observed|would_deny|reserved|denied`, bounded reason code, requested
  micro-units, and optional reservation token. It contains no credential value,
  prompt, response, member label, or Provider payload.
- `ProviderBudgetReservationV1`: reservation identity, attempt identity,
  policy version, original/settled/released/held micro-units, status, fence,
  expiry/review timestamps, and evidence references.
- `ProviderBudgetProjectionV1`: settled, reserved, held, available, denial,
  alert, pending-settlement, and review-required totals for one scope/window.
- strict admin mutation inputs for policy creation and operator reconciliation.

All money is non-negative integer micro-units. Currency and policy version are
part of idempotent identity and cannot change on replay.

## SQLite Schema V3

Add these tables to the migration and authoritative capture allowlist:

1. `provider_budget_policies`: append-only policy versions with a unique
   `(scope_key, version)` and idempotency key. A partial/validated active-window
   rule prevents overlapping `hard` versions.
2. `provider_budget_events`: append-only `observed`, `would_deny`, `reserved`,
   `settled`, `released`, `held`, `review_required`, `reconciled`,
   `operator_released`, and `alerted` events. `event_id` and idempotency identity
   are unique.
3. `provider_budget_reservations`: one current projection per reservation and a
   unique attempt identity. Status changes are fenced and must match the event
   appended in the same transaction.
4. `provider_budget_projection`: one current balance per scope/window. It stores
   integer settled/reserved/held totals and bounded counters, never source data.

Schema/capture tag becomes `provider-attempt-ledger-v3`. Restore compatibility
accepts the v3 authoritative payload and retains the existing Wrangler class
migration tag `v5`; these are different concepts and must not be conflated.

## Admission State Machine

```text
planned
  -> excluded (BYOK / disabled)
  -> observed -> would_deny? (shadow or soft; never blocks)
  -> denied (hard; no attempt row and zero Provider calls)
  -> reserved -> settled + released
              -> held -> reconciled
                      -> review_required -> reconciled | operator_released
```

For a server-funded attempt, the runtime sends the planned attempt identity,
offering/model, credential class, conservative maximum output tokens, and the
active policy expectation to one atomic `startBudgetedAttempt` RPC. The Durable
Object resolves the immutable price catalog at attempt start and computes the
maximum charge. In hard mode it appends attempt start plus reserve event and
updates reservation/scope projections in one `transactionSync`. Denial appends
only a bounded budget decision and throws `ProviderBudgetDeniedError`; the
Provider attempt projection and network call are absent.

Unknown price in hard mode is denied because v1 fixes
`allowUnknownPrice=false`. Shadow/soft append a bounded observation/alert and
allow the existing attempt accounting path.

## Settlement And Recovery

- Terminal usage/cost evidence settles the known charge and releases only the
  proven remainder in the same owner transaction. Duplicate terminal/evidence
  callbacks replay without changing balances.
- Missing or indeterminate cost changes the unused reservation to `held`; the
  full conservative remainder stays counted. Reads and mutations promote a hold
  older than 72 hours to `review_required`; this is a status/event transition,
  not a release.
- The reservation already exists durably before network execution. Therefore a
  post-call RPC/storage failure leaves a visible pending reservation at the
  conservative maximum. Response completion performs bounded retry in
  `waitUntil`; if retry still fails, the successful response is preserved and
  the reservation remains pending/reviewable.
- A failed primary attempt must settle or become held before fallback can start.
  If that transition cannot be persisted, fallback fails closed, so parallel or
  repeated attempts cannot consume the same ceiling invisibly.
- Late usage, cost corrections, reconciliation imports, and operator decisions
  append new events and recompute the projection from the prior fenced state.
  Operator release requires a non-sensitive reason, audit entry, and idempotency
  key; it never edits cost evidence.

## Provider Execution Integration

`ProviderAttemptRuntime.start` becomes the single pre-network budget gateway.
Every existing call site already constructs a physical attempt there or will be
adapted to do so:

- legacy chat and each fallback route;
- Agent main response and `completeOnce` auxiliary runs;
- Automatic Skill selection;
- initial tool call and every tool continuation;
- memory suggestion and session summary;
- administrator model discovery.

The returned handle owns terminal settle/hold/release. The integration keeps
quota admission outside the handle so auxiliary runs and continuations remain
linked to one admitted user turn while retaining separate run/attempt/budget
identities.

## Administrator Contract

The existing finance surface gains:

- `POST /api/admin/provider-finance/budgets` for an instance-fenced, audited,
  append-only policy version;
- `POST /api/admin/provider-finance/budget-reservations/:id/reconcile` for an
  idempotent audited operator decision;
- bounded policies/projections/reservations/alerts in
  `GET /api/admin/provider-finance`.

Strict decoders reject unknown keys, unknown Provider IDs, mismatched currencies,
stale versions, invalid time windows, non-integer money, unsafe reasons, and
overlapping hard windows. The ledger rejects any first version other than
`shadow` with a stable transition conflict; `hard` is reachable only through a
later compare-and-set policy version. The React operations workspace shows status, window,
limit, settled/reserved/held/available values, denials, alerts, and review queue
as unframed sibling sections. No member-facing money UI is added.

## Rollout And Rollback

No policy means `disabled`. Administrators create `shadow`, compare would-deny
and actual cost evidence, then create `soft` for explicit alerting. Only a new
audited version can select `hard`. The task's deterministic tests validate the
mechanism, but production hard mode is never auto-enabled by deployment.

Rollback creates a later `soft` version. New requests stop blocking/reserving
immediately, while old reservation projection rows, holds, budget events,
attempt/cost evidence, fences, and reconciliation remain available. Restore and
rollback never delete an applied Durable Object class migration or historical
table.

## Security, Privacy, And Compatibility

- Budget data is content-free and excludes credentials, access codes, prompts,
  completions, tool payloads, raw Provider metadata/invoices, conversations,
  memory, and member labels.
- Public errors expose only stable classes such as `provider_budget_exceeded`,
  `provider_budget_policy_unknown`, and `provider_budget_unavailable`.
- BYOK is visible only as excluded usage/cost classification and never joins the
  server-funded balance.
- Existing v2 rows migrate without synthesized money. With no v1 policy they
  continue exactly as `disabled`.

## Unsupported After Delivery

Cross-Provider, member/team/tenant, rolling, multi-currency, credit, BYOK-funded,
and customer billing budgets remain unsupported. Production still requires an
operator to create and promote each concrete policy window.
