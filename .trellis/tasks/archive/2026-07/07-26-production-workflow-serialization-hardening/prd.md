# Production Workflow Serialization Hardening

## Goal

Make production deployment and production member acceptance mutually safe: a new deployment must not cancel an in-flight production upload or interrupt acceptance cleanup, and destructive acceptance must prove it is still checking the intended deployed revision.

## Background

- `deploy.yml` currently cancels older deploy workflow runs in the same concurrency group.
- The stale-SHA guard runs early, before install, tests, preflight, dry-run, and the real deploy.
- `production-acceptance.yml` uses a different concurrency group from deploy, so it can mutate temporary production members while another deploy changes the running revision.
- Docs and specs already promise exact-SHA production smoke and GitHub-Actions-only deployment, but the workflow semantics leave a narrow unverified window.

## Requirements

### R1. Production Workflow Serialization

- Production deploy and production member acceptance must share one production-mutation concurrency group.
- The shared group must not use `cancel-in-progress: true`; newer runs wait instead of canceling upload, smoke, cleanup, or acceptance.
- Workflow naming should make the shared production mutation boundary obvious to maintainers.

### R2. Late Revision Proof

- Deploy must re-check that the checked-out commit is still the remote `main` tip immediately before the real Wrangler deploy.
- Production member acceptance must verify the deployed `/release.json` SHA before destructive checks and again after cleanup.
- A revision mismatch must fail before or at the end of the run rather than reporting acceptance success for the wrong commit.

### R3. Cleanup And Retry Semantics

- Acceptance cleanup must treat admin logout failure as a cleanup failure rather than silently ignoring it.
- Deployment docs and specs must accurately describe the retry behavior. If deploy retry classification remains broad, docs must not claim it is limited to Cloudflare `5xx`.
- Secret-file cleanup wording must avoid impossible guarantees for runner termination while keeping ordinary success/failure cleanup explicit.

### R4. Test Coverage

- Raw workflow tests must assert the shared concurrency group, no cancellation, late SHA guard, and acceptance release rechecks.
- Acceptance script tests or static checks must prove logout is checked.
- No production deploy, live model call, or production acceptance run happens in this task.

## Acceptance Criteria

- [x] Deploy and production acceptance workflows share a non-canceling production mutation concurrency group.
- [x] Deploy workflow checks remote `main` again immediately before `wrangler deploy`.
- [x] Production acceptance checks release SHA before destructive mutations and after cleanup.
- [x] Admin logout failure is surfaced as a cleanup failure.
- [x] README, operations, self-hosting docs, and deployment spec match the hardened behavior.
- [x] Focused workflow/script tests, full project tests, typecheck, browser workspace tests, Wrangler dry-run, Trellis validation, and `git diff --check` pass.
