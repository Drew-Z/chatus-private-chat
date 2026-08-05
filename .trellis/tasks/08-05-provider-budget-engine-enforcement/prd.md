# Provider budget engine and enforcement

## Goal

Add atomic idempotent budget accounting, first in shadow/alert mode and then for
one explicitly approved scope, so a denied reservation produces zero Provider
calls and failures cannot double reserve or silently release unknown cost.

## Dependencies

- `08-05-provider-attempt-shadow-ledger` and
  `08-05-provider-cost-reconciliation-capacity` completed and archived.
- Before enforcement, the child plan must record approved initial scope(s), hard
  versus soft behavior, unknown-cost hold duration, BYOK policy, and ledger
  outage fail-open/fail-closed policy.

## Applicable Decisions and Risks

- `FIN-03`: reserve/settle/release/reconcile is atomic and idempotent per scope;
  every Provider call is preceded by a successful reservation.
- `FIN-02`: unknown price fails hard enforcement closed unless an explicitly
  approved conservative `allowUnknownPrice` policy exists.
- Rollback disables enforcement but preserves ledger, fences, holds and history.

## Requirements

- Define versioned budget scope, policy, reservation, settlement, release, hold,
  reconciliation and projection contracts.
- Reserve before a Provider attempt; deny with a stable error and zero Provider
  calls when insufficient or policy-unknown.
- Settle billable failed/successful attempts, release unused reserve, and retain
  bounded conservative holds for unknown cost until reconciliation/operator review.
- Reserve fallback attempts separately after settling prior billable attempts;
  keep continuations/tool loops inside the remaining turn ceiling.
- Prove exact balances under concurrency, crash, duplicate callback, retry,
  timeout, fallback and settlement-storage outage before enabling one scope.

## Acceptance Criteria

- [ ] AC1. Approved scope/policy/outage/unknown-cost decisions are persisted in
      the PRD and versioned runtime policy before enforcement.
- [ ] AC2. Atomic concurrent reservations cannot overspend, double reserve or
      leak balances across retry/crash recovery.
- [ ] AC3. Reservation denial and unknown-price denial produce exactly zero fake
      Provider calls and a stable non-sensitive error.
- [ ] AC4. Settle/release/reconcile converges to exact balances for success,
      billable failure, fallback, late usage and corrected cost.
- [ ] AC5. Unknown-cost holds remain bounded, visible and operator-reviewable;
      they are never silently released as zero.
- [ ] AC6. Tool loops/continuations and Automatic Skill auxiliary runs cannot
      bypass ceilings or double-count user-message quota.
- [ ] AC7. Rollback to approved soft mode stops new blocking/reservations while
      preserving all history and reconcilable holds.
- [ ] AC8. Full gates, specs, PR/commit/deployment evidence and archive checks pass.

## Out of Scope

- Feedback, billing/invoicing customers, credit purchase, multi-currency FX not
  explicitly approved, or enabling all scopes in one release.
