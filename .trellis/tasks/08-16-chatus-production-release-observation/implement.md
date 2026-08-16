# Chatus Production Release And Observation Implementation Plan

## 1. Freeze And Review The Candidate

- [ ] Record the current PR head, base SHA, mergeability, Draft state, checks, and review state.
- [ ] Update PR #90 title and body to disclose member UX/settings plus model monitoring/member availability.
- [ ] Inspect the diff for authorization, privacy, aggregation, state ownership, responsive behavior, and deployment-boundary regressions.
- [ ] Apply the scoped pre-merge corrections: strict 24-hour monitor decoding and bounds, segmented/paginated monitor groups, availability freshness/refresh copy, always-visible connection state, and availability request-generation fencing.
- [ ] Add or update decoder and synthetic browser regressions for the corrected contracts.
- [ ] Confirm the worktree is clean and the remote feature branch matches the reviewed head.
- [ ] Mark PR #90 Ready only after the review has no release-blocking findings.

## 2. Merge

- [ ] Re-read the PR immediately before merge and require the reviewed head SHA and successful checks.
- [ ] Merge through GitHub without bypassing failed or pending checks.
- [ ] Fetch `origin/main`, record the resulting merge SHA, and prove the reviewed PR head is contained in it.

Rollback point: before deployment, revert or correct `main` through a new reviewed PR if the merge result is wrong. Production is still unchanged.

## 3. Deploy Through GitHub Actions

- [ ] Dispatch `.github/workflows/deploy.yml` on `main` after confirming its ref resolves to the merge SHA.
- [ ] Wait for the workflow to finish; require the job and critical validation, deployment, and smoke steps to succeed.
- [ ] Record the workflow URL and SHA without copying logs that may contain sensitive material.

Rollback point: if deployment fails before Worker promotion, fix through a new reviewed change. If promotion succeeds but smoke fails, deploy the last known-good `main` revision through the repository-owned workflow.

## 4. Verify Production And Acceptance

- [ ] Fetch production `/release.json`; require the merge SHA.
- [ ] Fetch production `/react-chat/`; require a successful response and the same release meta.
- [ ] Dispatch `.github/workflows/production-acceptance.yml` on `main`.
- [ ] Require its revision guard and temporary-member acceptance to succeed.

## 5. Observe For 24 Hours

- [ ] Record the verified deployment timestamp as the observation start.
- [ ] Inspect member route-availability presentation and administrator aggregate monitoring without recording prohibited data.
- [ ] At or after 24 hours, record aggregate freshness and attempt/success/failure reconciliation or the legitimate no-data state.
- [ ] Confirm no release-critical UX, authorization, privacy, routing, or monitoring regression remains open.

## 6. Close Out

- [ ] Update `task.json` validation evidence with PR, merge, deployment, acceptance, and observation results.
- [ ] Run `python ./.trellis/scripts/task.py validate-all` and `git diff --check` for task records.
- [ ] Commit and push release evidence through a normal reviewed Git change if repository-tracked records changed.
- [ ] Archive the task only after the 24-hour observation gate is complete or after a completed rollback is verified.

## Guardrails

- Never run a local production Wrangler deploy.
- Never modify or advance any legacy rollout task or gate.
- Never print or store secrets, access codes, raw model content, conversations, memories, or member identities.
- Never treat another SHA's successful workflow as evidence for this release.
