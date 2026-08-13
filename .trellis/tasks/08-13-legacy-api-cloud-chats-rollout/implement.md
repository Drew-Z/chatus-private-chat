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
- PR #76 merged as exact `main` SHA
  `36db0f0b048db75dc0943672d352d052cf1f29e1`. GitHub Actions deployment run
  `31719901675` passed exact-main guards, full quality, Worker upload, and
  production smoke; Worker version
  `e9f203a2-ed4a-4768-8dd3-15f23219f158` is live. Deployment artifact
  `9188977636` is retained through 2026-11-11. No local production deployment
  was used.
- Exact-main cloud-chats census run `31720354544` passed fresh collection,
  stale-main recheck, aggregate anomaly gate, and artifact upload. Its
  aggregate-only result was `rowCount=0`, `totalCount=0`,
  `unknownCallerRows=0`, `unexpectedAccessRows=0`,
  `deploymentMismatchRows=0`, and `status=clear`; artifact `9189023771` is
  retained through 2026-11-11. Raw census rows were not inspected or retained
  here. This is a clean read-only baseline and does not start the 30-day write
  or read observation windows; rollback, disable, identity reconciliation, and
  cleanup gates remain open.
