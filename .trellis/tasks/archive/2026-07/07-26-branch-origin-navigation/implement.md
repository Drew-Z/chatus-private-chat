# Branch Origin Navigation - Implementation Plan

## Execution

1. [x] Read applicable frontend and quality specs before editing.
2. [x] Update Worker branch title generation to accept action-specific suffixes and strip existing generated suffixes.
3. [x] Add focused branch API assertions for action-specific titles, bounded names, suffix stripping, idempotency, and source preservation.
4. [x] Derive parent-origin data in `ChatWorkspace` and pass it to `WorkspaceHeader`.
5. [x] Render the origin hint/return action in `WorkspaceHeader` with accessible labels and stable responsive dimensions.
6. [x] Add or update browser workspace fixture coverage for parent-present and parent-missing header states.
7. [x] Run focused tests and required validation gates.

## Validation

```powershell
npm.cmd test -- tests/worker-api.test.ts
npm.cmd run test:browser:workspace
npm.cmd run typecheck
git diff --check
python ./.trellis/scripts/task.py validate .trellis/tasks/07-26-branch-origin-navigation
```

Run `npm.cmd run check:frontend` if structural frontend checks are affected.

## Rollback Points

- If branch API idempotency changes unexpectedly, revert Worker naming changes and keep only the header origin hint.
- If the header becomes crowded on 390px layouts, keep the origin hint as a second-line compact button rather than moving it into the sidebar.
