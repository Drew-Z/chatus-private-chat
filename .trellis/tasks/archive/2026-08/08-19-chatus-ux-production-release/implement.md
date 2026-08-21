# Chatus UX Production Release Implementation Plan

## 1. Activate The Reviewed Plan

- [x] Obtain explicit approval for the final `prd.md`, `design.md`, and `implement.md`.
- [x] Run `python ./.trellis/scripts/task.py start 08-19-chatus-ux-production-release`; planning approval alone is not execution approval.
- [x] Confirm the task status is `in_progress` and the candidate remains `e074560f208530d21b8e4e6442b650b45cadd601`.

Stop condition: do not dispatch any production workflow while the task is still `planning` or the final plan is not approved.

## 2. Refresh And Validate The Candidate

- [x] Fetch `origin/main` and require exact equality with the candidate immediately before release work.
- [x] Confirm no queued or in-progress deployment, production acceptance, or production model observation will make the evidence ambiguous; wait for serialized work to finish and then repeat every SHA guard.
- [x] Reconfirm PR #96 is merged and its required checks succeeded for the candidate.
- [x] Run `npm run check:frontend`.
- [x] Run `npm test`.
- [x] Run `npm run typecheck`.
- [x] Run `npx wrangler deploy --dry-run`.
- [x] Run `git diff --check`.
- [x] Run `python ./.trellis/scripts/task.py validate-all`.

Stop condition: any validation failure or `origin/main` drift keeps production unchanged and returns the task to review. Do not merge another PR, alter a legacy task, or redefine the candidate in place.

## 3. Deploy Through GitHub Actions

- [x] Dispatch `.github/workflows/deploy.yml` with `ref=main` only after a final remote-main equality check.
- [x] Capture the resulting run ID/URL and require its `headSha` to equal the candidate before treating any step as evidence.
- [x] Wait for terminal completion without cancelling any run in `chatus-production-mutation`.
- [x] Require validation, preparation, dry-run, Worker deployment, production smoke, manifest retention, and generated-file cleanup to succeed.
- [x] Record only the run URL, candidate SHA, UTC timestamps, conclusion, and `production-deployment-<candidate>` artifact name.

Rollback point: a pre-upload failure stops with production unchanged. If upload succeeds but smoke observes stale metadata, rerun the same GitHub Actions deployment only if remote `main` is still the candidate; otherwise stop for review.

## 4. Verify Production And Member Acceptance

- [x] Verify that the deployment workflow's production smoke and manifest identify the candidate in `/release.json`, `/react-chat/`, and `chatus-release` metadata.
- [x] Refresh remote `main` again and require it to remain the candidate.
- [x] Dispatch `.github/workflows/production-acceptance.yml` with `ref=main`.
- [x] Capture the run ID/URL, require `headSha` to equal the candidate, and wait for terminal success.
- [x] Require both `release=success` and `acceptance=success` in the bounded acceptance manifest.
- [x] Record the UTC observation start only after deployment, live metadata, and acceptance are all successful and the production release still equals the candidate.

Stop condition: a SHA mismatch, cleanup failure, release-critical member failure, or prohibited-data exposure triggers rollback review. Never repeat temporary-member acceptance concurrently and never generate a model request.

## 5. Hold The New 24-Hour Passive Window

- [x] Review pre-deadline `main` drift through `d67af302d97ce71469e7586cd0eac478bc19cac2`; confirm the candidate remains an ancestor, executable observation/acceptance blobs are unchanged, and the additive monitoring-contract change does not alter the passive observation semantics for the deployed candidate.
- [x] Keep the release task open for at least 24 hours from the recorded observation start.
- [x] Do not generate synthetic chat, completion, route-probe, or fallback traffic.
- [x] Record only release incidents or bounded aggregate/qualitative monitoring facts; never copy runtime content or identities.
- [x] If production changes away from the candidate, stop and classify the release as replaced or rolled back instead of observing mixed revisions.

## 6. Collect Observation Evidence

- [x] At or after the deadline, fetch `origin/main` and require the deployed candidate to remain an ancestor.
- [x] Repeat the candidate-to-tip drift comparison after the deadline. The reviewed additive drift through `d67af30` is permitted by the recorded compatibility review; stop for any additional relevant executable, passive-observation-contract, or deployed-release drift.
- [x] Dispatch `.github/workflows/production-model-observation.yml` from the exact current `main` tip with `deployed_sha=e074560f208530d21b8e4e6442b650b45cadd601` and the recorded ISO `observation_started_at`.
- [x] Require the observation run to succeed, retain `production-model-observation-<candidate>`, and complete the model-request-free member-availability acceptance.
- [x] Inspect only the aggregate artifact fields and prove `attempts = completed + inFlight`, `completed = succeeded + failures`, correct success-rate/null semantics, 24 buckets, exact group reconciliation, freshness, and stable release metadata.
- [x] Accept a legitimate zero-traffic result only as `attempts=0`, `completed=0`, `successRate=null`, with member availability allowed to remain `unknown`.
- [x] Record only aggregate totals, bounded group counts, exact/reconciled status, UTC timestamps, run URL, and release SHA.

Stop condition: a short window, stale or changed release, unreconciled snapshot, member-availability failure, logout failure, workflow drift, or prohibited field invalidates the observation. Do not fabricate traffic and do not reuse run `32118283425`.

## 7. Roll Back If Required

- [ ] Stop further candidate acceptance/observation activity and retain bounded failure metadata.
- [ ] Create and review a revert/corrective PR restoring the behavior evidenced by `fd6a2690ac3bf5026fde3ee736f35e32d14f940d`.
- [ ] Merge the recovery change to a new `main` rollback SHA; do not dispatch the stale known-good SHA directly.
- [ ] Deploy the rollback SHA through `.github/workflows/deploy.yml` and require exact live metadata.
- [ ] Run `.github/workflows/production-acceptance.yml` for the rollback SHA and require success.
- [ ] Record the rollback SHA and bounded workflow evidence; leave the failed candidate observation incomplete.

## 8. Close And Preserve Evidence

- [x] Update this task's acceptance criteria and validation records with exact run metadata and the aggregate-only observation result.
- [x] Run `python ./.trellis/scripts/task.py validate-all` and `git diff --check`.
- [ ] Commit and push task evidence on the release branch, open or update a normal reviewed record-only PR, and merge it without bypassing checks.
- [ ] Set the task work commit and PR URL to resolving evidence before archive validation.
- [ ] Archive only after the new observation succeeded for the candidate or the rollback path was fully verified.
- [ ] Commit the archive move through a follow-up record-only PR if required by the Trellis archive workflow.

## Permanent Guardrails

- Never deploy production from local Wrangler or a non-`main` ref.
- Never treat a different SHA's workflow, manifest, or observation as evidence for this release.
- Never print or retain credentials, access codes, prompts, responses, conversations, memories, Provider payloads, cookies, raw errors, or member identities.
- Never modify or advance a legacy rollout task, gate, workflow, census, or evidence.

## Release Evidence

- Deployment: GitHub Actions run `32230681004`, `headSha=e074560f208530d21b8e4e6442b650b45cadd601`, created `2026-08-19T08:02:40Z`, completed successfully `2026-08-19T08:06:56Z`.
- Deployment artifact: `production-deployment-e074560f208530d21b8e4e6442b650b45cadd601`, retained for 90 days.
- Independent post-deploy smoke: production release metadata and member application routes matched the candidate SHA.
- Production member acceptance: GitHub Actions run `32231590373`, `headSha=e074560f208530d21b8e4e6442b650b45cadd601`, created `2026-08-19T08:13:56Z`, completed successfully `2026-08-19T08:15:19Z`.
- Acceptance artifact: `production-acceptance-e074560f208530d21b8e4e6442b650b45cadd601`, retained for 90 days.
- Passive observation start: `2026-08-19T08:16:20.6547820Z`; earliest collection time: `2026-08-20T08:16:20.6547820Z`.
- Observation continuation: same-thread heartbeat `chatus-production-observation-check`, scheduled daily at `08:20 UTC`, with exact-SHA, privacy, no-synthetic-traffic, and legacy-isolation guardrails.
- Pre-deadline drift review: `origin/main=d67af302d97ce71469e7586cd0eac478bc19cac2`; candidate ancestor check passed; observation workflow, collector, acceptance runner, and production-acceptance contract blobs were identical; the passive-observation section SHA-256 remained `ab29f27108af88197fe15b70fc6f407ad80614568efa1ba95c9c22b56cfac78e`.
- Production model observation: GitHub Actions run `32432590580`, `headSha=d67af302d97ce71469e7586cd0eac478bc19cac2`, created `2026-08-21T00:25:14Z`, completed successfully `2026-08-21T00:27:03Z`.
- Observation artifact: `production-model-observation-e074560f208530d21b8e4e6442b650b45cadd601`, retained for 90 days; aggregate-only summary passed exact key, arithmetic, freshness, and privacy-boundary validation.
- Observation aggregate: `attempts=0`, `completed=0`, `inFlight=0`, `successRate=null`, `fallbacks=0`, `averageLatencyMs=null`, `trendBuckets=24`, all bounded group counts zero, `reconciliation.exact=true`.
- Post-observation production smoke: candidate release metadata remained verified after the observation run.
