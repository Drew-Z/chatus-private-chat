# Implementation Plan: Production Acceptance Cleanup Recovery

## Ordered Checklist

- [x] Run `trellis-before-dev`; load platform production-acceptance, deployment, delivery-governance, and frontend quality contracts.
- [x] Add pure cleanup helpers for strict acceptance-label recognition, bounded `503` deletion retries, and all-steps cleanup orchestration.
- [x] Add deterministic unit tests for retry classes, cleanup ordering/continuation, bounded errors, and strict stale-label matching.
- [x] Add revision-checked stale access-entry cleanup before the production acceptance baseline snapshot.
- [x] Replace the `Promise.all` cleanup boundary with the shared sequential all-steps orchestrator while preserving current-run exact restoration and conflict behavior.
- [x] Extend workflow/source structural tests for stale-cleanup ordering, sequential cleanup, main-only exact-SHA checks, and retained manifest behavior.
- [x] Run focused syntax/tests, then `trellis-check` across the platform delivery scope.
- [x] Run the complete local project gate using only local fake Provider fixtures.
- [x] Run `trellis-update-spec` and record the reusable retry, stale-label recovery, and all-steps cleanup contract.
- [x] Treat a retry `401` after the same deletion observed `503` as persisted-cleanup recovery while preserving strict initial-`401` failure, then rerun all gates and production acceptance.
- [x] Align the acceptance `503` retry window with the Root Agent's eight persisted cleanup attempts, then rerun focused/full gates and production acceptance.
- [x] Add bounded old-session revocation polling with delayed idempotent re-delete for KV list visibility, then rerun focused/full gates and production acceptance.
- [x] Commit, push a code PR, pass CI, merge, deploy through GitHub Actions, run exact-SHA production acceptance, record evidence, and archive.

## Focused Validation

```powershell
node --check scripts/acceptance-production.mjs
npx vitest run tests/production-acceptance-cleanup.test.ts tests/deployment-config.test.ts
```

## Full Validation

```powershell
npm run check:frontend
npm test
npm run test:browser:workspace
npm run test:browser:agent
npm run typecheck
npx wrangler deploy --dry-run
git diff --check
python ./.trellis/scripts/task.py validate-all
```

## Risky Files

- `scripts/acceptance-production.mjs`
- `scripts/production-acceptance-cleanup.mjs`
- `tests/production-acceptance-cleanup.test.ts`
- `tests/deployment-config.test.ts`
- `.trellis/spec/platform/production-acceptance.md`

## Rollback Points

- Keep application cleanup code untouched; rollback affects only acceptance orchestration.
- Do not archive or waive a failed production acceptance. A successful exact-SHA rerun is required.
- Do not run production cleanup from the local machine; recovery is exercised only by the GitHub Actions workflow.
