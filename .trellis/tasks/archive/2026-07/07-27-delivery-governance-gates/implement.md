# Implementation Plan: PR, CI, and Trellis Delivery Gates

## Ordered Checklist

- [x] Activate the task and load frontend, platform, delivery, and Trellis workflow guidance.
- [x] Add contract tests for path classification, PR CI, deployment skipping, artifacts, and the SHA contract.
- [x] Add the PR workflow with five baseline checks and conditional Workspace/Agent Playwright suites.
- [x] Make browser runners retain caller-owned artifact directories while preserving redaction.
- [x] Extend deployment and production acceptance with code-path gating, manifests, and artifact retention.
- [x] Add Python fixtures and tests for task validation and archive behavior.
- [x] Implement structured waivers, acceptance/validation/work-commit/child/tree/root-index checks, and fail-before-mutate archival.
- [x] Repair workspace root-index generation or validation and expose a repository-wide consistency CLI.
- [x] Run `trellis-check` and resolve every finding.
- [x] Run both browser suites and all five baseline shipping checks.
- [x] Update delivery/Trellis specs, record evidence and work commit, commit, open and merge a PR, then archive.

## Risky Files

- `.github/workflows/*.yml`
- `.trellis/scripts/common/task_store.py`
- `.trellis/scripts/common/task_validation.py`
- `.trellis/scripts/task.py`
- `scripts/run-browser-*.mjs`

## Validation Commands

```text
python -m unittest discover .trellis/tests
npm run test:browser:workspace
npm run test:browser:agent
npm run check:frontend
npm test
npm run typecheck
npx wrangler deploy --dry-run
git diff --check
```

## Rollback Points

- Keep workflow/runner changes separate from Trellis archive changes so either can be reverted independently.
- Do not exercise archive on a real task until tests prove fail-before-mutate behavior.
