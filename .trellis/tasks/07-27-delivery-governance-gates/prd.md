# PR, CI, and Trellis Delivery Gates

## Goal

Establish reliable and traceable pull-request gates before code reaches `main`, and make deployment, production acceptance, and Trellis archival prove the exact commit, validation results, and task state.

## Background

- `.github/workflows/` currently has a main deployment workflow and a manual production-acceptance workflow, but no `pull_request` workflow.
- Main deployment already has stale-SHA guards, release metadata, and production smoke, but it retains no build or acceptance artifact.
- `task.py archive` does not validate acceptance criteria, validation evidence, a work commit, waivers, unfinished children, or repository-wide parent/child consistency.
- `.trellis/workspace/index.md` has drifted from the real developer indexes.

## Requirements

- R1. Add a stable PR CI workflow that runs the frontend check, Vitest, type-check, Wrangler dry-run, and diff check.
- R2. Run Workspace Playwright and the local fake-Provider Agent suite based on affected paths. Stable required checks must remain present when a conditional suite is skipped.
- R3. Tests use only local fixtures and fake Providers. They must not call a live model, production, or a synthetic production probe.
- R4. Merges to `main` deploy automatically. Documentation- and Trellis-only commits skip deployment and retain explicit classification evidence.
- R5. Deployment and production acceptance record the exact SHA and retain non-sensitive build, test, and acceptance artifacts. Production acceptance remains protected and GitHub-Actions-only.
- R6. Before archive, Trellis validates that no acceptance criterion or `TBD` remains, validation evidence exists, the work commit resolves, all children are complete, parent/child references are consistent, no duplicate/cycle/orphan exists, and the archive destination is free.
- R7. A waiver is structured persisted data with at least a gate ID, reason, approver, and timestamp. Free-form notes cannot bypass a gate.
- R8. Repair the workspace root-index drift and add repository-wide task/workspace consistency validation.
- R9. Keep the current 0.x SemVer line and do not present these gates as a 1.0 stability promise.

## Acceptance Criteria

- [x] AC1. A `pull_request` workflow has a stable base-quality job, and any of the five baseline commands can block a PR.
- [x] AC2. Path-classification tests cover frontend/workspace, Agent/provider, shared configuration, and docs/Trellis-only changes; each Playwright suite runs only for its affected paths.
- [x] AC3. The main workflow deploys code merges, clearly skips docs/Trellis-only changes, and preserves stale-main and serialized-production guards.
- [x] AC4. Workflow artifacts contain the commit SHA, lockfile/bundle digests, test or acceptance summaries, and bounded failure diagnostics without credentials, Wrangler state, or user content.
- [x] AC5. Archive has allow/deny tests for every R6 condition, and a rejection does not move the task directory or write completed state.
- [x] AC6. Structured waivers are persisted, validated, and included in audit output; free-form text cannot bypass a gate.
- [x] AC7. A repository-wide consistency command detects reverse-reference errors, duplicates/cycles, active/archive conflicts, and workspace root-index drift.
- [x] AC8. Deployment-contract tests, Trellis Python tests, and all five baseline shipping checks pass.

## Out of Scope

- Do not deploy production from this machine or automatically run live production acceptance.
- Do not implement other quarterly product features in this task.
