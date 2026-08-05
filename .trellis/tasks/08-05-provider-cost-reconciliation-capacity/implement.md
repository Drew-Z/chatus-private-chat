# Provider cost reconciliation and capacity implementation plan

- [ ] Run `trellis-before-dev`; import attempt-ledger contracts and inspect
      Provider adapter, admin projection, privacy, deletion and recovery owners.
- [ ] Define normalized usage/cost/price/correction/reconciliation schemas.
- [ ] Implement Provider usage adapters and immutable effective-dated catalog.
- [ ] Implement append-only cost calculation and correction/reversal events.
- [ ] Implement bounded reconciliation import and rebuildable projections.
- [ ] Add operator capacity/spend APIs and UI with strict loading/ready/error,
      unknown/provisional states, pagination and authorization.
- [ ] Add late/missing usage, price-change, correction, duplicate import,
      variance, privacy, deletion and export fixtures.
- [ ] Run `trellis-check`, impact-path Workspace Playwright, focused tests and the
      full parent validation baseline.
- [ ] Update accounting, Provider, privacy, admin and recovery specs; append
      `FIN-02`/`FIN-05` evidence and retain `FIN-04` as deferred.
- [ ] Commit, PR, CI/deployment evidence, validation records and archive checks.

## Rollback Point

Disable new imports and views, rebuild or hide projections, and retain all
immutable attempt/usage/price/correction evidence for later reconciliation.
