# Legacy API chat post rollout implementation plan

- [x] Run `trellis-before-dev`; map route admission, guest allowlist, browser,
      quota, Provider, Agent, tool/file, stream, error, and test callers.
- [x] Version only `legacy.api.chat-post` with owner `data`, 30-day windows, and
      a bounded phase ceiling.
- [x] Add exact content-free read/write use recording and fail-closed controls.
- [x] Add deterministic legacy-versus-Agent parity fixtures using local fake
      Provider/MCP only.
- [x] Persist identity migration/parity evidence for the ACL start gate.
- [x] Expose a strict read-only production census API and retain exact-SHA,
      content-free census artifacts through a main-only GitHub Actions workflow.
- [x] Schedule the 30-day chat-post census daily, serialize census runs, retain
      artifacts before a content-free nonzero/caller/SHA anomaly failure, and
      preserve manual bounded collection for other bundled surfaces.
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
  A follow-up delivery adds the production census projection and evidence
  workflow without changing the surface phase ceiling or observation clocks.
  The first production collection exposed a cold-start 404 for a bundled surface
  with no coordinator state; a follow-up fixes that read-only projection to
  return an empty census without initialization and adds a direct regression.
  Production caller census, rollback rehearsal, the 30-day write/read
  observation windows, route read-disable, cleanup approval, and archive checks
  remain future gates and are intentionally unchecked.
- The census workflow now has daily 02:17 UTC collection with exact scheduled
  defaults and non-canceling serialization. Its chat-post anomaly gate reads the
  retained strict artifact and emits only aggregate counts/status; any nonzero
  use, unknown declared caller, or deployment-SHA mismatch fails for attention.
  This monitoring optimization neither advances the surface nor claims that a
  30-day observation window has begun or completed.

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
- PR #63 merged as `393f0578e1cb6a3cee3a832b715b3a4fdfed60b9`.
  Exact-main deployment run `31560695880` passed. Census run `31561044924`
  targeted the same SHA but failed before artifact upload because the bundled
  surface had no initialized coordinator and the read-only endpoint returned
  HTTP 404. No census artifact or observation claim was produced.
- PR #65 merged as `48affb8c7f957e8afef168b0c2874810f77397ee` and fixed the
  cold-start projection without coordinator initialization. Exact-main deploy
  run `31565553898` passed, and census run `31565995047` passed with canonical
  30-day artifact `9129468576` containing zero rows, retained through
  2026-11-10.
- PR #67 passed `changes`, `quality`, `workspace-browser`, and `agent-browser`
  in run `31617086427`, then squash-merged as exact main SHA
  `81ee52c65ff90504f6238aa6063493d677781605`. The delivery schedules daily
  chat-post census and aggregate anomaly detection only; it performs no local
  or workflow-triggered production deploy and advances no rollout phase.
