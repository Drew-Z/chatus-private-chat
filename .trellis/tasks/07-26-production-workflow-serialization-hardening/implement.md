# Production Workflow Serialization Hardening - Implementation Plan

## Execution

1. [x] Create child task and capture requirements/design.
2. [x] Read deployment specs and current workflow/script/tests before editing.
3. [x] Update deploy and production acceptance workflow concurrency and late SHA checks.
4. [x] Update production acceptance script to re-check release after cleanup and fail on logout failure.
5. [x] Update raw workflow/script tests and deployment docs/specs.
6. [x] Run focused checks and full release gates.

## Validation

```powershell
npm.cmd test -- tests/deployment-config.test.ts
node --check scripts/acceptance-production.mjs
npm.cmd run check:frontend
npm.cmd test
npm.cmd run test:browser:workspace
npm.cmd run typecheck
npx.cmd wrangler deploy --dry-run
python ./.trellis/scripts/task.py validate .trellis/tasks/07-26-production-workflow-serialization-hardening
git diff --check
```
