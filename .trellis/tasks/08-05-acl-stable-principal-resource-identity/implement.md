# ACL stable principal and resource identity implementation plan

- [x] Run `trellis-before-dev`; census session/login, managed-member lifecycle,
      Root/UserState/conversation routing, Agent identity, migration, export,
      deletion, capture/restore, config, Workspace, OAuth, and cleanup owners.
- [x] Add strict identity contracts and a dedicated `IdentityRegistry` SQLite
      Durable Object with v6 binding/migration, schema, RPCs, capture/restore,
      registration, idempotency, and content-free inspection.
- [x] Bind member sessions and managed access lifecycle to `principalId`; upgrade
      legacy sessions only through exact active alias resolution and retire alias
      bindings on revoke/removal.
- [x] Backfill existing principals/resources with pinned legacy Root/UserState/
      conversation routes; create native routes from stable IDs; retain exact
      markers and bounded unresolved reports.
- [x] Extend TeamAgent and UserState with additive stable identity assertions and
      route all owner-only chat, memory, Workspace, OAuth, quota, export, cleanup,
      and deletion operations through authenticated registry projections.
- [x] Add per-record backfilled/reconciled/authoritative transitions and exact
      dual-read route/marker parity; fail closed before side effects on drift.
- [x] Add bounded admin migration/reconciliation APIs with revision and
      idempotency preconditions; expose no content, labels paired with topology,
      credentials, tokens, object keys, or raw errors.
- [x] Add deterministic legacy/native/rename/reuse/session-upgrade/replay/
      duplicate/orphan/wrong-Agent/stale-revision/cross-principal tests, plus
      explicit absence tests for ACL/share/transfer/discovery/shared execution.
- [x] Update identity, Agent, member access, OAuth, Workspace, deletion, recovery,
      deployment, capture/restore, and compatibility specs with `ACL-01` evidence.
- [ ] Run focused tests, `trellis-check`, Workspace and local fake-Provider Agent
      Playwright, full shipping baseline, diff/Trellis consistency, PR/CI,
      exact-main GitHub Actions deployment evidence, AC, and archive checks.

## Local Validation Evidence

- `npm run check:frontend` passed (Vite build and frontend structure checks).
- `npm test` passed: 49 files, 758 tests.
- `npm run test:browser:workspace` passed: 90 passed, 55 project-filtered skips.
- `npm run test:browser:agent` passed: 3 local fake-Provider tests.
- `npm run typecheck` passed for Worker, client, and browser projects.
- `npx wrangler deploy --dry-run` passed with Wrangler 4.110.0 and the
  `IDENTITY_REGISTRY -> IdentityRegistry` binding.
- `git diff --check` passed with line-ending notices only.
- `python ./.trellis/scripts/task.py validate-all` reported repository
  consistency OK.
- Remaining in the final checklist item: work commit, PR/CI, exact-main GitHub
  Actions deployment/acceptance evidence, final AC10 completion, and archive.

## Validation Commands

```text
npm run check:frontend
npm test
npm run test:browser:workspace
npm run test:browser:agent
npm run typecheck
npx wrangler deploy --dry-run
git diff --check
python ./.trellis/scripts/task.py validate-all
```

## Risky Boundaries

- `src/contracts/session.ts`, new identity contracts, and every session decoder.
- `src/worker.ts` login/member lifecycle, all `getUserState`/TeamAgent routing,
  export, cleanup, deletion, OAuth, quota, and admin migration boundaries.
- `src/agent/team-agent.ts` identity persistence and Root/conversation assertions.
- New registry Durable Object, Wrangler/deployment config, instance capture and
  isolated restore binding/schema matrices.

## Rollback Point

Stop new authority transitions and stable-only member creation, retain every
principal/resource/alias/marker/pinned route, use stored legacy routes for
migrated principals and stable routes for native principals, preserve current
owner access, and repair mappings without copying, deleting, or rebinding Agent
or UserState data.
