# Legacy API chat post rollout implementation plan

- [x] Run `trellis-before-dev`; map route admission, guest allowlist, browser,
      quota, Provider, Agent, tool/file, stream, error, and test callers.
- [x] Version only `legacy.api.chat-post` with owner `data`, 30-day windows, and
      a bounded phase ceiling.
- [x] Add exact content-free read/write use recording and fail-closed controls.
- [x] Add deterministic legacy-versus-Agent parity fixtures using local fake
      Provider/MCP only.
- [ ] Persist identity migration/parity evidence for the ACL start gate.
- [ ] After shell read observation and full caller migration, rehearse routing
      rollback and disable legacy POST writes with zero hidden side effects.
- [ ] Retain 30-day write evidence, refresh recovery proof, disable route reads,
      and retain 30-day read evidence.
- [ ] Advance only this record to `approved_for_cleanup`; delete no route/data.
- [ ] Run `trellis-check`, focused/full tests, impacted browser suites, shipping
      baseline, spec update, commit/PR/delivery evidence, AC, and archive checks.

## Rollback Point

Re-enable the exact route, cancel/reconcile fenced in-flight work, preserve all
conversation/accounting evidence, and restart the affected observation window.

## Evidence

- Focused parity, quota, fallback, legacy-surface, and cancellation tests pass.
- Full `worker-api` coverage passes 132/132 tests; full repository Vitest passes
  48 files and 740/740 tests.
- `npm run check:frontend`, both browser suites (Workspace 90 passed / 55 matrix
  skips; Agent 3/3 passed), `npm run typecheck`, `npx wrangler deploy --dry-run`,
  `git diff --check`, and `python ./.trellis/scripts/task.py validate-all` pass.
- The control-plane drift fixture restores the exact code-owned manifest in a
  `finally` block so later legacy callers remain isolated and fail-closed tests
  do not contaminate the suite.
- Identity migration evidence, rollback rehearsal, the 30-day write/read
  observation windows, route read-disable, cleanup approval, and delivery/PR
  evidence remain future gates and are intentionally unchecked.
