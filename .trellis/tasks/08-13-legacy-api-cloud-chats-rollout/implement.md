# Legacy API cloud chats rollout implementation plan

- [x] Run `trellis-before-dev`; map all four route methods, browser/Agent/
      operator/test/Worker callers, scheduled jobs, UserState sync, migration,
      cleanup, pagination, and hidden deletion paths.
- [x] Version only `legacy.api.cloud-chats` with owner `data`, 30-day windows,
      and the minimum enforceable phase ceiling.
- [x] Add method- and caller-specific content-free read/write instrumentation
      with exact-SHA evidence and fail-closed classification.
- [x] Build deterministic legacy-versus-Agent parity fixtures for list/read,
      upsert/delete/migrate, ordering, pagination, tombstones, retries,
      metadata, cleanup, import/sync, identity mappings, and stable errors.
- [ ] Persist census and one-to-one identity/resource reconciliation evidence for
      the ACL identity gate.
- [ ] Rehearse compatibility-read rollback and capture/restore, then stop legacy
      writes only after every caller and hidden mutation path is migrated.
- [ ] Retain the complete 30-day write evidence, disable legacy reads
      reversibly, and retain the separate 30-day read evidence.
- [ ] Advance only this record to `approved_for_cleanup`; delete no route or
      transitional state.
- [x] Run `trellis-check`, focused/full tests, impacted browser suites, shipping
      baseline, spec update, commit/PR/delivery evidence, AC, and archive checks.

## Validation Commands

- `npm run check:frontend`
- `npm test`
- `npm run typecheck`
- `npx wrangler deploy --dry-run`
- `git diff --check`
- `python ./.trellis/scripts/task.py validate-all`

## Rollback Point

Re-enable the exact legacy route methods against retained compatible state,
reconcile any Agent/UserState divergence, preserve all evidence, and restart the
affected observation window.

## Current Evidence

- The four compatibility methods now perform read admission before parsing or
  route access and write admission immediately before legacy mutation.
- The code-owned manifest record is version 2, owned by `data`, capped at
  `instrumented`, with 30-day read/write windows and caller classes
  `agent_runtime`, `browser`, `operator`, `test`, and `worker_api`.
- Local Worker tests cover method-level caller/read/write counters, server-owned
  zero-SHA evidence, read/write disable responses, and zero persistence for a
  disabled PUT. Existing deterministic cloud-chat tests cover CRUD/migrate
  conflict, tombstone, cleanup, and Agent synchronization behavior.
- Production census is now policy-gated for manual 30-day cloud-chats runs, but
  no production census has been run for this surface and no observation window
  has started. Capture/restore, compatibility rollback, identity reconciliation,
  write/read observation, and cleanup approval remain open.
- Local quality gates pass: focused manifest/census/Worker tests, full Vitest
  (51 files, 794 tests), `npm run check:frontend`, `npm run typecheck`,
  `npx wrangler deploy --dry-run`, Agent Playwright (3 passed), Workspace
  Playwright (110 passed, 55 configured skips), `git diff --check`, and
  repository-wide Trellis consistency. Commit, PR, deployment, and production
  census evidence are recorded only after their respective actions complete.
