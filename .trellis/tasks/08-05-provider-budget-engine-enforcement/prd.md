# Provider budget engine and enforcement

## Goal

Add atomic, idempotent Provider budget accounting and enable one deliberately
narrow hard-enforcement scope after shadow evidence proves the accounting path.
A denied reservation must produce zero Provider calls, and failures must not
double reserve, silently release unknown cost, or consume another user-message
quota unit.

## Dependencies

- `08-05-provider-attempt-shadow-ledger` and
  `08-05-provider-cost-reconciliation-capacity` are completed and archived.
- `FIN-02`, `FIN-03`, and `FIN-05` remain normative. This child closes the
  runtime portion of `FIN-03` without weakening the evidence/privacy rules
  already delivered for `FIN-02` and `FIN-05`.

## Pre-Implementation Baseline

- Provider accounting is owned by one `ProviderAttemptLedger` SQLite Durable
  Object per `providerId`; its mutations use `transactionSync`, and its capture
  contract is an explicit schema/table allowlist
  (`src/provider-attempt-ledger.ts:38`, `src/provider-attempt-ledger.ts:199`).
- Attempt start freezes an immutable price binding. Unknown price is represented
  as `resolution="missing"`, while usage/cost evidence remains append-only
  (`src/provider-attempt-ledger.ts:684`, `src/provider-attempt-ledger.ts:950`).
- The runtime already fails closed before a Provider call when the required
  attempt ledger is unavailable, retries ledger RPCs at most twice, and emits a
  stable non-sensitive error (`src/services/provider-attempt-runtime.ts:22`,
  `src/services/provider-attempt-runtime.ts:234`).
- Member message quota and guest concurrency admission are separate from money:
  members consume one quota unit, Agent continuations reuse the turn admission,
  and `release()` is not a financial refund (`src/services/quota-admission.ts:87`,
  `src/services/quota-admission.ts:131`, `src/worker.ts:6822`).
- User-supplied BYOK credentials exist only for the current request and are
  identified by `credentialClass="user"`; managed, Worker, and legacy
  credentials are instance-funded classes (`src/services/provider-router.ts:131`,
  `src/contracts/provider-attempt.ts:22`).
- Chat fallback, Agent main execution, Automatic Skill selection, tool
  continuations, memory/summary runs, and model discovery each have independent
  physical Provider boundaries and therefore require independent budget
  decisions (`src/worker.ts:5638`, `src/worker.ts:6570`,
  `src/worker.ts:7065`, `src/worker.ts:8299`, `src/worker.ts:8804`).
- Before this child, the administrator finance API and React operations
  workspace exposed bounded price, cost, reconciliation, and capacity views,
  while hard enforcement was explicitly unsupported. This task replaces that
  marker with the versioned `instance_provider_v1` contract.

## Approved Initial Policy

These decisions are the only enforcement policy approved by this child:

1. **First hard scope:** one explicit UTC budget window for one Provider, one
   currency, and server-funded credential classes (`legacy`, `managed`, or
   `worker`). The provider-sharded ledger is the scope owner. No cross-Provider,
   member, team, tenant, or multi-currency hard budget is implied.
2. **Modes:** `disabled` performs no budget observation; `shadow` records
   would-reserve/would-deny evidence; `soft` additionally raises administrator
   alerts; neither blocks nor creates spend holds. `hard` is the only mode that
   reserves, denies, settles, releases, and holds funds.
3. **Unknown price:** `allowUnknownPrice=false` for the first hard scope. Missing
   or mismatched immutable price evidence denies before network execution.
4. **Unknown cost:** hard mode retains the full unused attempt reservation. At
   72 hours the hold becomes `review_required`, remains counted against the
   budget, and can leave that state only through idempotent late evidence,
   reconciliation, or an audited operator decision. It is never automatically
   released as zero.
5. **BYOK:** `credentialClass="user"` is excluded from the server-funded hard
   balance but remains visible as separate usage/cost evidence. This task does
   not create a member-funded or BYOK monetary budget.
6. **Ledger outage:** before network execution, required attempt/budget ledger
   failure is fail closed in every mode. After network execution, a durable
   reservation is already present; settlement RPC failure must not discard a
   successful response, and the full reserve remains pending for retry/review.
   A failed or billable fallback attempt must be durably settled or held before
   another Provider attempt may reserve.
7. **Rollout and rollback:** all policies start in `shadow`; a particular scope
   reaches `hard` only by an audited, versioned administrator mutation after
   deterministic acceptance. Rollback writes a new `soft` policy version,
   immediately stops new blocking/reservations, and preserves events, existing
   holds, fences, cost evidence, and reconciliation history.

## Requirements

### R1. Versioned contracts and ownership

- Define strict v1 contracts for policy, scope, decision, reservation,
  settlement, release, unknown hold, reconciliation, alert, and projection.
- Keep all monetary values integer micro-units with explicit currency. Generate
  event, reservation, scope, attempt, and idempotency identities on the server.
- Extend the provider-sharded Durable Object schema, capture allowlist, restore
  schema, and migration tests together; no browser-supplied attribution is
  authoritative.

### R2. Atomic accounting

- Start an attempt and reserve its conservative maximum in one authoritative
  transaction, or return a stable denial without an attempt/network call.
- Update append-only budget events and the current scope/reservation projection
  atomically. Duplicate operations replay; conflicting identities fail closed.
- Settle known cost, release only proven unused reserve, retain unknown exposure,
  and apply late/corrected evidence without double charging.

### R3. Provider execution coverage

- Apply a budget decision immediately before every chat, fallback, Agent,
  Automatic Skill, tool-continuation, memory/summary, and model-discovery call.
- Give every physical attempt its own reservation. The current attempt must be
  settled or held before fallback proceeds.
- Automatic Skill and continuation attempts count financially but reuse the
  original admitted turn and never consume another message quota unit.

### R4. Administration and recovery

- Add fenced, audited admin mutations for policy versions and hold resolution;
  reject stale versions, overlapping hard windows, invalid currency, unknown
  Provider identities, and non-idempotent replay.
- Extend the React operations workspace with bounded policy, balance, hold,
  denial, and alert views. Do not expose credentials, prompts, responses, raw
  invoice payloads, conversation content, or member money.
- Surface reservation/settlement health independently from Provider health.
  Overdue pending reservations and review-required holds remain operator-visible.

### R5. Compatibility and delivery

- Existing deployments with no policy behave as `disabled` until an explicit
  shadow policy is created. Existing attempts/cost evidence remain readable.
- Preserve 0.x SemVer and existing quota, routing, reliability, deletion,
  capture/restore, and public-error contracts except for the explicitly
  versioned additions above.
- Use only deterministic local fake Provider/MCP fixtures. Production deployment
  and production acceptance may run only through GitHub Actions.

## Acceptance Criteria

- [x] AC1. The approved scope, modes, 72-hour unknown-cost policy, BYOK policy,
      outage behavior, rollout, and rollback are present in the PRD and v1
      runtime policy contract.
- [x] AC2. Concurrent hard reservations cannot overspend, double reserve, or
      leak balances across duplicate callbacks, retry, crash, and replay.
- [x] AC3. Insufficient balance, unknown price, stale policy, and pre-call ledger
      outage produce exactly zero fake Provider calls and stable non-sensitive
      errors.
- [x] AC4. Success, billable failure, cancellation, timeout, fallback, late
      usage, correction, and reconciliation converge to exact integer balances.
- [x] AC5. Unknown-cost reservations retain the full conservative remainder,
      become review-required after 72 hours, stay visible, and never release as
      zero without append-only evidence or an audited operator action.
- [x] AC6. Chat, fallback, Agent, Automatic Skill, memory/summary, discovery, and
      every tool continuation are covered by independent budget decisions.
- [x] AC7. Automatic Skill and continuation tests prove financial attempts are
      recorded while one admitted user message still consumes one quota unit.
- [x] AC8. Admin API/React views expose bounded policies, balances, holds,
      denials, alerts, and degraded settlement state without sensitive payloads.
- [x] AC9. A new soft policy version immediately stops new blocking/reservations
      while preserving history and allowing existing holds to reconcile.
- [ ] AC10. Schema migration, authoritative capture/restore, frontend fixtures,
      Workspace Playwright, local fake-Provider Agent tests, full repository
      gates, PR/CI/exact-SHA deployment evidence, spec updates, and archive
      validation all pass.

## Local Acceptance Evidence

- AC1-AC2: schema v3 and the Provider-sharded `transactionSync` boundary own
  versioned first-shadow policy, atomic hard reservation, denial, replay, and
  exact projections. Concurrent and duplicate callback tests preserve one
  balance without overspend.
- AC3-AC7: deterministic local tests cover unknown price, exhausted balance,
  stale/invalid policy mutation, ledger outage, known and unknown terminal cost,
  fallback ordering, every Provider execution surface, Automatic Skill, and
  tool continuations. Denied admission makes zero fake Provider calls and does
  not consume a second message quota unit.
- AC8-AC9: strict admin/API/browser decoders and Operations fixtures expose
  bounded policies, aggregate denial/alert counts, balances, pending settlement,
  and review holds. Versioned soft rollback stops new reservations while late
  evidence reconciles retained holds.
- Final local gate on 2026-08-07: frontend structure passed; Vitest passed 45
  files / 688 tests; Workspace Playwright passed 86 with 49 intentionally
  skipped across 135 cases; fake-Provider Agent passed 3/3; typecheck, Wrangler
  dry-run, diff check, spec sync, and repository consistency all passed.

## Out of Scope

- Member/team/tenant, cross-Provider, rolling, prepaid-credit, or multi-currency
  hard budgets; charging BYOK; customer billing/invoicing; currency conversion;
  feedback capture/scoring; legal retention changes; or live Provider/MCP tests.
- Automatically enabling hard mode in production. This child ships the
  mechanism and approved policy shape; each concrete hard window still requires
  an explicit audited administrator mutation.
