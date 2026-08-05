# Legacy surface disable and observation implementation plan

- [ ] Run `trellis-before-dev`; perform a repository-wide surface/caller/data
      census and bind exact paths/symbols to registry entries.
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

## Rollback Point

Re-enable the specific surface's untouched read path, leave old data/migrations
intact, and reconcile any shadow divergence before another transition.
