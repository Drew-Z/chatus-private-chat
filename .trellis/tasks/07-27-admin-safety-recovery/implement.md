# Implementation Plan: Admin Safety and Error Recovery

## Ordered Checklist

- [x] Load the frontend/platform specs and task artifacts.
- [x] Add server and client behavior tests for successful and failed logout.
- [x] Fix the `adminLogout`, AdminWorkspace, and server logout contract.
- [x] Establish explicit initial state and retry behavior for AdminWorkspace and operations.
- [x] Add operations pagination and displayed/total counts, covering the 21-item boundary.
- [x] Add a shared ConfirmDialog and replace every `window.confirm` in AdminWorkspace, ProviderAdminPanel, and LogicalModelAdminPanel.
- [x] Add focus, keyboard, pending/error, and prior dangerous-action regression coverage.
- [x] Run `trellis-check`, Workspace Playwright, and all full validation commands.
- [x] Update the admin frontend/platform specs and record validation evidence.
- [ ] Commit, open and merge the PR, record deployment evidence, and archive the task.

## Risky Files

- `src/worker.ts`
- `client/src/lib/api.ts`
- `client/src/components/AdminWorkspace.tsx`
- `client/src/components/AdminOperationsPanel.tsx`
- `client/src/components/*AdminPanel.tsx`

## Rollback Points

- Keep the logout contract, view state, lists, and dialog reviewable as separate commits.
- If the dialog causes a destructive-action regression, preserve the action APIs and roll back only the shared UI layer.
