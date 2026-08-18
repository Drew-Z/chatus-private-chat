# Chatus Production Release And Observation Implementation Plan

## 1. Freeze And Review The Candidate

- [x] Record the current PR head, base SHA, mergeability, Draft state, checks, and review state.
- [x] Update PR #90 title and body to disclose member UX/settings plus model monitoring/member availability.
- [x] Inspect the diff for authorization, privacy, aggregation, state ownership, responsive behavior, and deployment-boundary regressions.
- [x] Apply the scoped pre-merge corrections: strict 24-hour monitor decoding and bounds, segmented/paginated monitor groups, availability freshness/refresh copy, always-visible connection state, and availability request-generation fencing.
- [x] Add or update decoder and synthetic browser regressions for the corrected contracts.
- [x] Confirm the worktree is clean and the remote feature branch matches the reviewed head.
- [x] Mark PR #90 Ready only after the review has no release-blocking findings.

## 2. Merge

- [x] Re-read the PR immediately before merge and require the reviewed head SHA and successful checks.
- [x] Merge through GitHub without bypassing failed or pending checks.
- [x] Fetch `origin/main`, record the resulting merge SHA, and prove the reviewed PR head is contained in it.

Rollback point: before deployment, revert or correct `main` through a new reviewed PR if the merge result is wrong. Production is still unchanged.

## 3. Deploy Through GitHub Actions

- [x] Dispatch `.github/workflows/deploy.yml` on `main` after confirming its ref resolves to the merge SHA.
- [x] Wait for the workflow to finish; require the job and critical validation, deployment, and smoke steps to succeed.
- [x] Record the workflow URL and SHA without copying logs that may contain sensitive material.

Rollback point: if deployment fails before Worker promotion, fix through a new reviewed change. If promotion succeeds but smoke fails, deploy the last known-good `main` revision through the repository-owned workflow.

## 4. Verify Production And Acceptance

- [x] Fetch production `/release.json`; require the merge SHA.
- [x] Fetch production `/react-chat/`; require a successful response and the same release meta.
- [x] Dispatch `.github/workflows/production-acceptance.yml` on `main`.
- [x] Require its revision guard and temporary-member acceptance to succeed.

## 5. Observe For 24 Hours

- [x] Record the verified deployment timestamp as the observation start: `2026-08-16T15:37:12Z` (deployment Workflow terminal success after production smoke verification).
- [x] Add a main-only, serialized, exact-SHA observation Workflow that reads the admin aggregate through the existing session boundary and retains only bounded aggregate evidence.
- [x] Extend model-request-free production acceptance to validate the member `/api/model-availability` projection shape and privacy boundary.
- [x] Add contract and workflow-governance regressions for exact 24-hour buckets, reconciliation, release fencing, artifact bounds, and no model-call paths.
- [x] Inspect member route-availability presentation and administrator aggregate monitoring without recording prohibited data; the production observation Workflow's member availability acceptance and aggregate monitor decoder passed without retaining identities.
- [x] At or after 24 hours, record aggregate freshness and attempt/success/failure reconciliation or the legitimate no-data state; Workflow `32118283425` recorded the exact 24-hour no-data aggregate with `successRate=null`.
- [x] Confirm no release-critical UX, authorization, privacy, routing, or monitoring regression remains open; the observation Workflow, member acceptance, and release SHA fences passed with no rollback.

## 6. Close Out

- [x] Update `task.json` validation evidence with PR, merge, deployment, acceptance, and observation results.
- [x] Run `python ./.trellis/scripts/task.py validate-all` and `git diff --check` for task records.
- [x] Commit and push release evidence through a normal reviewed Git change if repository-tracked records changed; PR #94 merged as `5c1d61edf16996949cb1538e027167ade61f0e66`.
- [x] Archive the task only after the 24-hour observation gate is complete or after a completed rollback is verified.

## Guardrails

- Never run a local production Wrangler deploy.
- Never modify or advance any legacy rollout task or gate.
- Never print or store secrets, access codes, raw model content, conversations, memories, or member identities.
- Never treat another SHA's successful workflow as evidence for this release.
