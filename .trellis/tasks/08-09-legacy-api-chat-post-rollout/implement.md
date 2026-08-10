# Legacy API chat post rollout implementation plan

- [x] Run `trellis-before-dev`; map route admission, guest allowlist, browser,
      quota, Provider, Agent, tool/file, stream, error, and test callers.
- [x] Version only `legacy.api.chat-post` with owner `data`, 30-day windows, and
      a bounded phase ceiling.
- [x] Add exact content-free read/write use recording and fail-closed controls.
- [x] Add deterministic legacy-versus-Agent parity fixtures using local fake
      Provider/MCP only.
- [x] Persist identity migration/parity evidence for the ACL start gate.
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
- `evidence.md` records the pre-merge caller/identity handoff: browser, guest,
  Worker API, and test boundaries; deterministic local parity references; and
  the current label-derived TeamAgent identities that the ACL task must migrate
  without rebinding. It deliberately leaves production census, rollback, and
  observation gates open.
- Identity migration evidence and delivery/PR evidence are now retained.
  Production caller census, rollback rehearsal, the 30-day write/read
  observation windows, route read-disable, cleanup approval, and archive checks
  remain future gates and are intentionally unchecked.

## Delivery Evidence

- PR [#58](https://github.com/Drew-Z/chatus-private-chat/pull/58) passed
  `changes`, `quality`, and `agent-browser` on head
  `b199fb3f25b1ed8bba2829e2b5cc8c4f01e0317b` in [run
  31360685183](https://github.com/Drew-Z/chatus-private-chat/actions/runs/31360685183).
  Workspace Playwright was skipped by the path classifier; the earlier full
  local Workspace matrix remains retained in this task's validation records.
  Four content-free path, quality, coverage, and fake-Provider artifacts are
  retained through 2026-08-24.
- The squash merge produced exact main SHA
  `a0f8b30a4549dbf832827d6e54de4fbbb48790b3`. GitHub Actions [run
  31361000781](https://github.com/Drew-Z/chatus-private-chat/actions/runs/31361000781)
  passed both stale-main guards, full quality gates, Worker deployment, and
  production verification. Worker version
  `09624a59-5546-4a47-bd71-29c51d9a285f` is live.
- Deployment-path artifact `9052343216` is retained through 2026-09-09 and
  production-deployment artifact `9052434350` is retained through 2026-11-08.
  No local production deploy, live model/MCP call, or synthetic production probe
  was used.
- This delivery starts no observation clock by itself. Production caller census,
  routing rollback rehearsal, the real 30-day write window, reversible read
  disable, and the later 30-day read window remain open, so this task stays
  `in_progress` and unarchived.
