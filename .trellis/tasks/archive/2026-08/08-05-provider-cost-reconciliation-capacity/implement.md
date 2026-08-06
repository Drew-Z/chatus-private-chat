# Provider cost reconciliation and capacity implementation plan

- [x] Run `trellis-before-dev`; import attempt-ledger contracts and inspect
      Provider adapter, admin projection, privacy, deletion and recovery owners.
- [x] Define normalized usage/cost/price/correction/reconciliation schemas.
- [x] Implement Provider usage adapters and immutable effective-dated catalog.
- [x] Implement append-only cost calculation and correction/reversal events.
- [x] Implement bounded reconciliation import and rebuildable projections.
- [x] Add operator capacity/spend APIs and UI with strict loading/ready/error,
      unknown/provisional states, pagination and authorization.
- [x] Add late/missing usage, price-change, correction, duplicate import,
      variance, privacy, deletion and export fixtures.
- [x] Run `trellis-check`, impact-path Workspace Playwright, focused tests and the
      full parent validation baseline.
- [x] Update accounting, Provider, privacy, admin and recovery specs; append
      `FIN-02`/`FIN-05` evidence and retain `FIN-04` as deferred.
- [x] Commit, PR, CI/deployment evidence, validation records and archive checks.

## Delivery Record

- Work commit `374e25cbba8acac295fd5606c07c4cb6817d241b` was delivered through
  PR #51 and merged as `48e8ecced8779fede59231516def0cf8eaf11669`.
- PR CI `31084089459`, Cloudflare deployment `31084921765`, and production
  acceptance `31085232339` all passed on the exact tracked revisions; their
  retained artifact names are recorded in `prd.md` and `task.json`.
- Archive preflight includes all AC, passed validation records, work commit,
  pull request, child status, waiver validation and workspace-index checks.

## Rollback Point

Disable new imports and views, rebuild or hide projections, and retain all
immutable attempt/usage/price/correction evidence for later reconciliation.
