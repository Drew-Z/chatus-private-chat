# GitHub Actions minute optimization

## Goal

Reduce billed GitHub-hosted runner minutes for the private Chatus repository while preserving useful pull-request feedback and the rule that production deployments run only through GitHub Actions.

## Background

- The personal account has a zero-dollar Actions budget with stop-usage enabled, so the remaining risk is interrupted CI rather than unexpected charges.
- From 2026-08-01 through 2026-08-10, the repository ran about 42 pull-request quality workflows and 40 Cloudflare deployment workflows.
- The pull-request workflow does not cancel obsolete runs for the same PR. Its baseline quality job also runs for documentation/Trellis-only changes even though browser jobs are already path-aware.
- The production workflow runs on every push to `main` and repeats the complete quality suite before deployment.
- The private repository cannot use branch protection on the current GitHub plan, so skipped documentation-only workflow jobs do not create a required-check deadlock.
- Other Chatus work is active in a dirty worktree. This task is isolated in its own branch and worktree from `origin/main`.

## Requirements

- Keep PR-triggered baseline quality for executable/runtime changes and keep the existing local fake-provider browser boundaries.
- Cancel obsolete PR workflow runs when a newer commit is pushed to the same PR.
- Classify documentation/Trellis-record-only changes and skip the expensive baseline quality job for that class.
- Change production deployment to explicit `workflow_dispatch` from `main`; remove automatic deployment on every `main` push.
- Preserve non-canceling production mutation, exact-main SHA guards, production environment protection, redacted artifacts, and GitHub-Actions-only production deployment.
- Group npm and GitHub Actions Dependabot updates into bounded weekly batches with at most one open PR per ecosystem.
- Update structural workflow tests and the delivery-governance code spec together with the YAML changes.
- Do not run production deployment, production acceptance, live provider checks, or expose repository secrets during validation.

## Acceptance Criteria

- [x] `.github/workflows/ci.yml` still runs for pull requests, uses per-PR cancel-in-progress concurrency, and skips baseline quality when the classifier reports documentation-only changes.
- [x] The classifier exposes a deterministic `quality` output and its unit tests cover docs-only, executable, empty, and manual-all cases.
- [x] `.github/workflows/deploy.yml` has only `workflow_dispatch`, refuses non-`main` refs, and preserves exact-main, non-canceling, deployment, smoke, and artifact contracts.
- [x] `.github/dependabot.yml` groups all npm updates and all GitHub Actions updates into weekly batches with one open PR per ecosystem.
- [x] Delivery-governance structural tests enforce the new trigger, concurrency, path classification, and deployment contracts.
- [x] `npm run check:frontend`, `npm test`, `npm run typecheck`, `npx wrangler deploy --dry-run`, `python ./.trellis/scripts/task.py validate-all`, and `git diff --check` pass locally.
- [ ] The branch is pushed and reviewed through a PR without touching the existing dirty Chatus worktree.

## Out Of Scope

- Self-hosted runners, paid GitHub plans, or making the repository public.
- Local Wrangler production deployment.
- Changing production secrets, Cloudflare resources, application behavior, or current legacy-surface work.
- Running a real production deployment as part of this optimization.
