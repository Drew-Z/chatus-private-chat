# Provider budget engine and enforcement implementation plan

- [ ] Run `trellis-before-dev`; import ledger/cost contracts and resolve the
      named product decisions in the PRD before editing enforcement paths.
- [ ] Define strict versioned policy/event/reservation/projection contracts.
- [ ] Implement atomic idempotent reserve/settle/release/reconcile and unknown holds.
- [ ] Integrate reservation tokens immediately before every Provider execution.
- [ ] Add shadow/alert projections and operator reconciliation/hold controls.
- [ ] Add deterministic concurrency/crash/replay/retry/fallback/tool-loop/
      late-usage/unknown-price/settlement-outage exact-balance tests.
- [ ] Enable only the approved first scope behind a reversible versioned policy.
- [ ] Run `trellis-check`, impact-path Workspace Playwright/local fake Provider
      tests and the full parent validation baseline.
- [ ] Update Provider, accounting, quota, error, admin and recovery specs; append
      `FIN-03` closure evidence and `FIN-02` compatibility evidence.
- [ ] Commit, PR, CI/deployment evidence, production acceptance through GitHub
      Actions, validation records and archive checks.

## Rollback Point

Switch the approved scope to soft mode, stop new reservations, retain all events
and holds, and run reconciliation until no unexplained balance remains.
