# Legacy surface registry and control plane implementation plan

## Planning and activation

- [x] Complete repository census and obtain approval for the coordinating parent
      plus foundation-child topology.
- [x] Define the foundation boundary: registry/control plane only; no concrete
      legacy caller is disabled or moved past `discovered`.
- [x] Review `prd.md`, `design.md`, and this plan with the user and receive
      explicit implementation approval.
- [x] Run `task.py start` only after approval, then load `trellis-before-dev` for
      platform and frontend layers before editing runtime code.

## Contract and durable owner

- [x] Add the strict legacy-surface contract, 13-record bundled manifest, stable
      enums, exact decoders, evidence matrix, and deterministic manifest digest.
- [x] Extend the existing `INSTANCE_COORDINATOR` namespace with deterministic
      per-surface `InstanceCoordinator` objects, SQLite schema initialization,
      fail-closed manifest synchronization, atomic record/event transitions,
      idempotency fencing, separate read/write rollback, bounded daily counters,
      and strict snapshot RPCs. Do not route surface traffic through the global
      `$instance-maintenance` object.
- [x] Add exhaustive coordinator tests for manifest drift, every phase/gate,
      replay/conflict, crash/retry, rollback, bounds, malformed state, and
      content-bearing payload rejection.

## Recovery boundary

- [x] Add `legacy_surface_registry` to capture contracts/adapters as
      authoritative/restore state with before/after digest stability checks.
- [x] Extend isolated restore parsing, target preflight/application, receipts,
      retry, and fixtures for exact schema/count/digest/event validation.
- [x] Prove all existing Durable Object bindings and append-only migration tags
      remain unchanged and all initial records restore at `discovered`.

## Admin Worker and React

- [x] Add admin-only bounded GET/advance/rollback routes, exact validation,
      instance fencing, stable error mapping, and content-free audit projection.
- [x] Extend `client/src/lib/api.ts` with exact snapshot/mutation types and
      decoders; reject unknown keys, enums, unsafe integers, invalid SHA/digests,
      duplicate IDs, and oversized arrays.
- [x] Extend React Operations with filtering, 20-item pagination, current/total
      counts, blocker/control/evidence state, a bounded transition form, shared
      `ConfirmDialog`, server refresh, dirty state, and recoverable errors.
- [x] Add Worker API, client decoder/component, and Workspace Playwright fixtures
      for auth, exact shapes, 20/21 boundaries, desktop/390px layout, confirmation,
      blocked transitions, mutation failure, and refresh success.

## Quality and delivery

- [x] Run focused coordinator, capture/restore, Worker API, client, browser, and
      local fake-Provider Agent tests using deterministic local fixtures only.
- [x] Run `trellis-check`, then the full gate:
      `npm run check:frontend`, `npm test`,
      `npm run test:browser:workspace`, `npm run test:browser:agent`,
      `npm run typecheck`, `npx wrangler deploy --dry-run`,
      `git diff --check`, and `python ./.trellis/scripts/task.py validate-all`.
- [x] Update backup/restore, future governance, delivery, frontend component,
      type-safety, and a dedicated legacy-surface governance spec. Record `DR-06`
      as mitigated only for the control plane, not closed for any surface.
- [x] Commit on `codex/legacy-surface-registry-control-plane`, push, open a PR,
      wait for required CI/artifacts, merge, and retain exact-head/exact-main
      GitHub Actions deployment and production acceptance evidence.
- [x] Verify every AC, validation record, work commit, parent/child state,
      persisted waiver, archive preflight, archive commit, workspace index, and
      journal update before closing the child.

## Rollback point

Disable new admin registry mutations and hide the Operations projection while
retaining coordinator state, events, capture/restore support, and all legacy
runtime paths. Do not delete records, lower phase ceilings, rewrite evidence, or
change existing Durable Object migration tags.

## Local validation evidence

- `npx vitest run tests/legacy-surface.test.ts tests/instance-restore.test.ts`:
  2 files and 37 tests passed after isolated-restore and delayed-event fixes.
- `npx vitest run tests/worker-api.test.ts -t "legacy-surface"`: 1 test passed
  and 122 unrelated tests skipped after manifest-policy inspection hardening.
- `npx vitest run tests/client-api.test.ts -t "legacy surface control-plane client contract"`:
  3 tests passed after adding semantic rollback-response validation.
- `npm run check:frontend`: Vite build and frontend structural checks passed.
- `npm test`: 46 files and 716 tests passed.
- `npm run test:browser:workspace`: 140 discovered cases, 88 passed and 52
  intentionally skipped by viewport targeting. Desktop and touch-390 legacy
  governance error/success screenshots were inspected with no overlap or
  horizontal overflow.
- `npm run test:browser:agent`: the first complete run had one existing branch
  navigation timeout after the fake Provider flow; an immediate complete rerun
  passed 3 of 3 in 14.8 seconds without a code change.
- `npm run typecheck`: Worker, React client, and browser fixture checks passed.
- `npx wrangler deploy --dry-run`: Wrangler 4.110.0 packaged the unchanged
  bindings and migration topology without deploying.
- `git diff --check` and `python ./.trellis/scripts/task.py validate-all` passed;
  final repetitions are required after task/spec evidence edits.

## Delivery evidence

- Work commit `39aee8e738a871e89343290cfff652fa78bf1565` plus the deterministic
  pending-state CI fix `cde8c1cf8815b59150d6da4fb0dd32a2aeb25a54` were delivered
  through PR #53 and merged as exact main SHA
  `083cb24f8e1aa25f142b8e5ad3626ebfde5728ef` at 2026-08-09T00:59:01Z.
- PR CI run `31287009343` passed `changes`, `quality`, `agent-browser`, and
  `workspace-browser` on head `cde8c1cf8815b59150d6da4fb0dd32a2aeb25a54`.
  Five artifacts were retained through 2026-08-23: path classification
  `9030153355`, fake-Provider Agent Playwright `9030168698`, quality
  `9030196281`, coverage `9030196425`, and Workspace Playwright `9030241336`.
- GitHub Actions deployment run `31287320428` passed on the exact main SHA,
  deployed Worker version `ed875cde-8d9e-4178-bd3c-a9f381af107e`, and passed
  production release-SHA smoke after bounded edge-propagation retries. The
  production deployment manifest artifact `9030294645` is retained through
  2026-11-07; deployment-path artifact `9030253562` is retained through
  2026-09-08.
- No waiver was required. All 13 manifest records remain code-owned at maximum
  phase `discovered`; this delivery does not disable a legacy read or write path.
