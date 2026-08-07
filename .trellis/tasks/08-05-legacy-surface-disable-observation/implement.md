# Legacy surface disable and observation implementation plan

- [x] Perform a repository-wide planning census and persist exact surface,
      caller, data, recovery, and blocker evidence in
      `research/legacy-surface-census.md`.
- [x] Obtain explicit approval to retain this task as a coordinating parent and
      create the registry/control-plane foundation child.
- [ ] In that child, run `trellis-before-dev` and bind exact paths/symbols to the
      initial registry entries before editing runtime code.
- [ ] Define the strict versioned surface registry/state/evidence contracts.
- [ ] Add bounded instrumentation and deterministic census checks.
- [ ] Implement per-surface parity, dual-read/shadow and stop-write controls.
- [ ] Integrate current DR manifest/restore evidence and per-surface rollback drills.
- [ ] Implement independently reversible read-disable controls and observation
      evidence; do not add destructive cleanup code.
- [ ] Add fixtures for hidden callers, divergence, rollback, stale clients,
      Queue/scheduled work, legacy routes and migration compatibility.
- [ ] Run `trellis-check`, impact-path Workspace Playwright/local fake Provider
      tests and the full parent validation baseline.
- [ ] Update legacy, recovery, compatibility and delivery specs; append per-
      surface `DR-06` evidence and retained residual risks.
- [ ] Commit, PR, exact-head/exact-main evidence, validations and archive checks.

The implementation checklist after the planning split belongs to the foundation
and per-surface rollout children. This umbrella must not ship one global legacy
disable switch or claim aggregate observation evidence.

## Rollback Point

Re-enable the specific surface's untouched read path, leave old data/migrations
intact, and reconcile any shadow divergence before another transition.
