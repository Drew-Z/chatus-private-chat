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
- [x] Persist census and one-to-one identity/resource reconciliation evidence for
      the ACL identity gate.
- [x] Rehearse compatibility-read rollback and capture/restore against retained
      UserState, Agent, stable-identity, and exact surface-control state.
- [ ] Stop legacy writes only after every caller and hidden mutation path is
      migrated.
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
- Production census is policy-gated for exact 30-day cloud-chats runs. The first
  exact-main aggregate is clear, but no observation window has started.
- Local quality gates pass: focused cloud-chats rollback and restore tests, full
  Vitest (51 files, 795 tests), `npm run check:frontend`, `npm run typecheck`,
  `npx wrangler deploy --dry-run`, Agent Playwright (3 passed), Workspace
  Playwright (110 passed, 55 configured skips), `git diff --check`, and
  repository-wide Trellis consistency. Commit and PR delivery evidence is
  recorded below.
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
  or read observation windows; production disable, observation, and cleanup
  gates remain open.
- The completed stable-principal/resource task and the current isolated restore
  mapping now prove one-to-one principal, Root, UserState, and conversation-Agent
  target identities without using browser labels as authority. AC3 is complete;
  this does not imply a disable or observation transition.
- The local cloud-chats route rehearsal captures the complete pre-test surface
  atom, proves a disabled write changes neither legacy UserState nor Agent state,
  executes real write rollback to `shadowing`, executes real compatibility-read
  rollback to `recovery_proven`, and proves the retained read works while writes
  remain disabled. The exact original atom is restored in `finally`.
- The isolated restore drill uses the runtime-exported UserState and TeamAgent
  schema versions, restores non-empty compatible rows to unique stable targets,
  retains the exact cloud-chats control projection, reports zero loss/unresolved
  references, and keeps target writes closed. AC5 is complete. Production write
  disable, both 30-day windows, read-disable, cleanup approval, and archive remain
  open.
- PR #86 final head `b48a1f91863fc4956f0292824685de9a1501368e` passed
  `changes` and `quality` in CI run `31776316693`; the browser jobs were correctly
  path-classified out after their impacted suites passed locally. It squash-merged
  as exact main SHA `11006c32d5aa5158bb6ad0583597769254c27908`, which has no
  associated Actions run and triggered no production deployment. The
  `instrumented` phase ceiling and every remaining rollout gate are unchanged.
- Daily monitoring now adds an exact 02:37 UTC cloud-chats / 30-day run to the
  existing serialized, main-only, read-only census workflow. It reuses the strict
  zero-count policy and cannot deploy or advance the surface. Because production
  instrumentation became live at `2026-08-13T16:21:12Z`, the first scheduled
  slot eligible to prove a full 30-day quiet period is `2026-09-13T02:37:00Z`
  (Beijing `2026-09-13 10:37`); earlier snapshots are monitoring evidence only.
- PR #88 final head `8417ae8d46785e501088cda0e6406f06e89e12d1` passed all
  four CI jobs in run `31781128802` and squash-merged as exact main SHA
  `c319fe851f37060ba568bb607b2844e0044b99bc`. The merge triggered no production
  deployment and did not change the `instrumented` ceiling or start a window.
