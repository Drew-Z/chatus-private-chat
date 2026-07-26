# Implementation Plan

## Preconditions

- Keep the task in `planning` until these artifacts are reviewed and the user approves `task.py start`.
- In Phase 2, load `trellis-before-dev` and read the relevant platform/frontend spec indexes and shared cross-layer/code-reuse guides before editing.
- Preserve unrelated dirty Trellis task metadata and do not deploy production locally.

## Ordered Checklist

1. Add `.trellis/spec/platform/backup-restore.md` as the authoritative instance recovery readiness contract.
   - Distinguish user restore, deployment rollback, and full-instance disaster recovery.
   - Inventory required, transitional, and rebuildable/expiring storage surfaces.
   - Define manifest, consistency, key custody, identity mapping, restore ordering, reconciliation, drill, and no-RPO/RTO-yet boundaries.
2. Link the new contract from `.trellis/spec/platform/index.md` and align the relevant cross-layer references without duplicating operational procedures.
3. Update `docs/operations.md` and `docs/self-hosting.md` so operators see the same support boundary and `ROUTE_KEYS_MASTER_KEY` custody requirement.
4. Update `src/agent/team-agent.ts`.
   - Delete `chatus:agent-identity:v1` after conversation state is cleared.
   - Delete the root identity after root tables/state are purged.
   - Keep existing SQL cleanup and anti-resurrection behavior intact.
5. Update `src/worker.ts` so `DELETE /api/user-data` deletes `chatIndexKey(session.label)` using the existing helper.
6. Extend the existing deletion regression in `tests/worker-api.test.ts`.
   - Seed a legacy chat index and branch-launch row.
   - Confirm root and conversation Agent identities exist before deletion.
   - Confirm legacy index, both identity records, and branch-launch rows are absent afterward.
   - Preserve current assertions for session revocation, chats/memory deletion, explicit restore, and stale merge rejection.
7. Review the final diff against the PRD and ensure docs do not imply that an instance restore tool now exists.

## Validation

Run focused checks first:

```powershell
npx.cmd vitest run tests/worker-api.test.ts -t "deletes all user conversations and long-term memory"
python ./.trellis/scripts/task.py validate .trellis/tasks/07-26-backup-restore-contract-purge-residue
git diff --check
```

Then run the project shipping gate:

```powershell
npm.cmd run check:frontend
npm.cmd test
npm.cmd run typecheck
npx.cmd wrangler deploy --dry-run
git diff --check
```

No validation may call a live model or print secrets/user content.

## Risk And Rollback Points

- `src/agent/team-agent.ts`: deleting identity storage must occur only after the corresponding persisted chat/root state is cleared. Focused tests must prove subsequent legitimate initialization still works through the existing relogin assertions.
- `src/worker.ts`: use `chatIndexKey()` exactly; do not list/delete broad KV prefixes.
- `tests/worker-api.test.ts`: direct Durable Object storage assertions should inspect only synthetic test data and stable storage keys/tables.
- Documentation: do not turn unverified Cloudflare export assumptions into supported commands.
- Rollback is a normal revert through GitHub Actions. Do not run a local production deployment.

## Review Gate Before Start

- Confirm the user accepts the scope: readiness contract plus the two confirmed residue fixes, with no automated backup/restore implementation.
- Confirm `prd.md`, `design.md`, and `implement.md` validate.
- Only then run `task.py start` and enter Phase 2.
