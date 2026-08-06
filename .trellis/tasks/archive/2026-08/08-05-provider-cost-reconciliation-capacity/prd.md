# Provider cost reconciliation and capacity

## Goal

Turn shadow attempts into explainable usage, cost and capacity evidence with
immutable pricing and reconciliation, while representing incomplete data as
unknown/provisional and keeping hard budgets disabled.

## Dependencies

- `08-05-provider-attempt-shadow-ledger` completed and archived.

## Applicable Decisions and Risks

- `FIN-02`: reported, estimated, reconciled, corrected and unknown evidence are
  distinct; unknown never means zero and historical prices are not rewritten.
- `FIN-05`: projections are content-free and purpose-bounded; retention,
  deletion, export and aggregation policy precede production capture.
- `FIN-04` is deferred to a future feedback task and is not implemented here.

## Requirements

- Normalize Provider cumulative/delta/late/missing usage with source provenance
  and idempotent correction behavior.
- Select an immutable effective-dated price catalog version at attempt start;
  retain currency, precision, units, approver and provenance.
- Append reversal/replacement/superseding cost evidence instead of mutating
  history.
- Import secret-safe invoice/usage reconciliation evidence with fingerprint,
  period, account, currency, totals, unmatched variance and status.
- Show capacity and spend dimensions separately: calls, tokens, latency,
  failures, retries, fallback, unknown usage, provisional/settled/corrected cost.
- Mark incomplete totals provisional and keep hard budgets unavailable.

## Acceptance Criteria

- [x] AC1. Missing/late/cumulative/delta usage fixtures normalize idempotently and
      display unknown rather than zero.
- [x] AC2. Cross-day price changes preserve attempt-time catalog versions and do
      not rewrite historical totals.
- [x] AC3. Correction/reversal/replacement fixtures retain an append-only audit
      trail and converge to the exact reconciled total.
- [x] AC4. Matched/partial/disputed/corrected/closed imports expose unmatched
      variance without leaking raw invoice or credential material.
- [x] AC5. Operator views distinguish provisional, unknown, estimated, reported,
      reconciled and corrected values plus retry/fallback capacity.
- [x] AC6. Retention/deletion/export policy and leak scans pass before any
      production capture or member-visible money claim.
- [x] AC7. Feedback capture/aggregation/routing and hard budget enforcement remain
      absent and explicitly unsupported.
- [x] AC8. Full gates, specs, PR/commit/deployment evidence and archive checks pass.

## Delivery Evidence

- Work commit: `374e25cbba8acac295fd5606c07c4cb6817d241b`.
- PR #51: `https://github.com/Drew-Z/chatus-private-chat/pull/51`, merged to
  `main` at `48e8ecced8779fede59231516def0cf8eaf11669`.
- PR CI run `31084089459` passed `changes`, `quality`, `workspace-browser` and
  `agent-browser`; retained artifacts are `pr-path-classification-ac2ff55fa672e1488041247d75a5386365d7e318`,
  `pr-quality-ac2ff55fa672e1488041247d75a5386365d7e318`,
  `pr-coverage-ac2ff55fa672e1488041247d75a5386365d7e318`,
  `workspace-playwright-ac2ff55fa672e1488041247d75a5386365d7e318`, and
  `agent-playwright-ac2ff55fa672e1488041247d75a5386365d7e318`.
- Production deploy run `31084921765` succeeded for the merge SHA; retained
  artifacts are `deployment-paths-48e8ecced8779fede59231516def0cf8eaf11669`
  and `production-deployment-48e8ecced8779fede59231516def0cf8eaf11669`.
- Production member acceptance run `31085232339` succeeded for the same merge
  SHA; retained artifact is
  `production-acceptance-48e8ecced8779fede59231516def0cf8eaf11669`.
- `task.py validate-all` and archive preflight pass with no waiver.

## Out of Scope

- Hard budget enforcement, member billing, Provider feedback, route scoring, raw
  invoice browsing, or claiming provisional cost as settled truth.
