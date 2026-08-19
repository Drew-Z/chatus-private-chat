# Default capability packs delivery implementation plan

## Checklist

- [x] Record the current branch, `origin/main`, PR #97 head, merge base, and clean
  working tree before integration.
- [x] Merge `origin/main` into `codex/chatus-default-capability-packs` without
  rebase or force.
- [x] Resolve only the three expected Trellis workspace conflicts, preserving
  both journals and regenerating derived indexes.
- [x] Confirm the merge contains PR #98's CI fix and PR #99's task archive while
  retaining the complete capability task tree and PR #96 UI baseline.
- [x] Run the complete local validation sequence and fix only demonstrated
  integration defects.
- [x] Review the final diff for protected paths, secrets, content data, unrelated
  changes, and accidental product-scope expansion.
- [ ] Commit any required conflict/integration resolution, push without force,
  and wait for all PR #97 GitHub checks.
- [ ] Convert PR #97 from Draft to Ready after all checks pass and present the
  exact merge state for final confirmation.

## Validation Order

```powershell
npm run check:frontend
npm test
npm run test:browser:workspace
npm run test:browser:agent
npm run typecheck
npx wrangler deploy --dry-run
python ./.trellis/scripts/task.py validate-all
git diff --check
```

Do not run these commands concurrently. Do not substitute live services for
local fake Provider, MCP, OAuth, or browser fixtures.

## Integration Checks

```powershell
git rev-list --left-right --count origin/main...HEAD
git merge-tree --write-tree --name-only HEAD origin/main
git diff --name-status origin/main...HEAD
gh pr checks 97 --watch
```

Before push, assert the diff does not mutate production observation or any
legacy rollout task/gate/evidence. Verify that no raw prompt, response, image,
query, citation body, credential, conversation, or member identity entered task
or monitoring records.

## Risk And Rollback Points

- Workspace journal conflicts are append-only reconciliation, not a reason to
  choose one side wholesale.
- If application conflicts appear after a refreshed fetch, stop and return to
  planning because the audited merge boundary has changed.
- If a current test requires material capability behavior changes, stop and
  update the PRD/design before implementing them.
- Never force-push the published branch. Use merge commits and ordinary reverts.
