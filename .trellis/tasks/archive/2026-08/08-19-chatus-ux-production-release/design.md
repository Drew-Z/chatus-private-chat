# Chatus UX Production Release Design

## Release Boundary

The release unit is the already reviewed and merged pull request #96 at exact `main` commit `e074560f208530d21b8e4e6442b650b45cadd601`. This task promotes that revision and records release evidence. It does not change UI code, backend contracts, deployment workflows, production configuration, or any legacy rollout.

The previous known-good production deployment is `fd6a2690ac3bf5026fde3ee736f35e32d14f940d`, evidenced by successful deployment run `31955998267` and production acceptance run `31956295236`. It is the rollback behavior baseline.

## Revision And Evidence Chain

Deployment and initial acceptance preserve one exact revision chain:

```text
origin/main
  = e074560f208530d21b8e4e6442b650b45cadd601
  = Deploy to Cloudflare workflow head SHA
  = deployment manifest commit
  = production /release.json commit
  = /react-chat/ chatus-release meta
  = Production member acceptance workflow head SHA
```

Any mismatch stops progression. A successful run or artifact for another SHA is not evidence for this release.

The observation chain deliberately distinguishes the deployed release from the workflow checkout:

```text
deployedSha = e074560f208530d21b8e4e6442b650b45cadd601
observationStartedAt = timestamp recorded after deployment and acceptance succeed
observation workflow head = exact main tip at observation dispatch
deployedSha must be an ancestor of observation workflow head
production release before read = production release after read = deployedSha
```

If `main` advances during the 24-hour wait, observation remains eligible only when the candidate is still an ancestor and no change between the candidate and the new tip alters `.github/workflows/production-model-observation.yml`, `scripts/collect-production-model-observation.mjs`, `scripts/acceptance-production.mjs`, or the production-acceptance/model-monitoring contracts. Relevant drift requires a new review instead of silently using changed evidence semantics.

## Pre-Deadline Main Drift Review

At `2026-08-19T19:36:31Z`, `origin/main` was `d67af302d97ce71469e7586cd0eac478bc19cac2` and the deployed candidate remained its Git ancestor. The candidate-to-tip review found:

- `.github/workflows/production-model-observation.yml`, `scripts/collect-production-model-observation.mjs`, `scripts/acceptance-production.mjs`, and `.trellis/spec/platform/production-acceptance.md` have identical Git blob IDs at the candidate and current tip;
- the `Passive 24-Hour Production Observation Evidence` section has identical normalized content at both revisions, with SHA-256 `ab29f27108af88197fe15b70fc6f407ad80614568efa1ba95c9c22b56cfac78e`;
- `.trellis/spec/platform/model-monitoring.md` and `src/contracts/model-monitoring.ts` changed additively for `auxiliary_vision`, while the spec also gained a separate content-free capability-monitoring scenario;
- the deployed candidate predates auxiliary vision and therefore cannot emit the new run-kind value; the unchanged collector remains aligned with the old deployed response contract.

This is the required new review, not silent reuse of drifted evidence. It finds no change to the observation arithmetic, privacy boundary, exact 24-bucket reconciliation, member-availability acceptance, or no-synthetic-traffic rule. Observation may continue from the exact current `main` tip after the deadline only if production still serves the candidate and a fresh candidate-to-tip comparison shows no additional relevant drift. Any later change to the executable evidence path, passive-observation section, or deployed release stops dispatch for another review.

## Deployment Gate

Production deployment runs only through `.github/workflows/deploy.yml` using `workflow_dispatch` on `refs/heads/main`. Immediately before dispatch, the operator refreshes remote state and requires the remote tip to equal the frozen candidate. The workflow repeats early and late exact-main guards, validates the frontend and Worker bundle, deploys, verifies production, and retains `production-deployment-<sha>`.

No local Wrangler command may mutate production. Local validation and `wrangler deploy --dry-run` are preflight only.

All production workflows share `chatus-production-mutation` with `cancel-in-progress: false`. A competing run is allowed to finish; it is never cancelled to accelerate this release. After it finishes, all SHA and production metadata guards are re-evaluated before the next mutation.

## Production Acceptance Boundary

After deployment succeeds and live metadata identifies the candidate, `.github/workflows/production-acceptance.yml` is dispatched from the same candidate on `main`. The workflow verifies the release before mutation, creates bounded temporary members, checks member session, storage, isolation, concurrency, WebSocket, deletion, and member availability contracts, then restores access configuration and logs out.

Acceptance never sends a chat turn or model request. Evidence retains only the run URL, head SHA, timestamps, conclusion, and bounded manifest status. Temporary labels, access codes, cookies, response bodies, member identities, conversations, and memories are never copied into task records.

## Passive Observation Boundary

The observation window begins only after both deployment and production acceptance have succeeded for the candidate and the live release remains exact. The recorded UTC timestamp is the input `observation_started_at`; the release stays open for at least 86,400,000 milliseconds from that point.

No synthetic request is generated during the window. At or after the deadline, `.github/workflows/production-model-observation.yml` receives the candidate as `deployed_sha` and the recorded timestamp. It reads exactly `GET /api/admin/model-monitor?window=24h&bucket=hour`, logs out, verifies release stability, and runs model-request-free member acceptance.

An `attempt` is one actual upstream Provider request, not one member message or logical turn. A fallback upstream call is an independent attempt and increments `fallbacks`; an in-flight attempt remains outside the completed success-rate denominator. Terminal failures include failed, cancelled, and timed-out attempts.

The retained summary may contain only release/timing metadata, totals, and group counts. Completion requires:

- `attempts = completed + inFlight`;
- `completed = succeeded + failures`;
- `successRate = succeeded / completed`, or `null` when `completed = 0`;
- exactly 24 contiguous hourly buckets and exact total-to-breakdown reconciliation;
- a fresh 24-hour snapshot and successful member-availability privacy/shape acceptance;
- no Provider, route, model, failure-class, attempt, turn, member, credential, prompt, response, conversation, memory, cookie, or raw-error identifiers in retained evidence.

Zero real traffic is valid evidence: `attempts=0`, `completed=0`, and `successRate=null`. It is neither a successful-model claim nor a release failure by itself. Member availability may remain `unknown`, and passive telemetry never becomes a send gate.

## Completed Observation Evidence

The post-deadline run `32432590580` was dispatched from exact current `main` `d67af302d97ce71469e7586cd0eac478bc19cac2`, with `deployed_sha=e074560f208530d21b8e4e6442b650b45cadd601` and the recorded observation start. The run passed its early/late SHA fences, aggregate monitor validation, model-request-free member availability check, and artifact retention. The artifact contains only the approved summary fields and reports a fresh exact no-data aggregate: 24 trend buckets, zero group rows, zero attempts, zero completed attempts, `successRate=null`, and null average latency. A post-observation production smoke still matches the deployed candidate, so no rollback is indicated.

## Failure And Rollback

Before Worker promotion, any failure stops the release with production unchanged. After an upload whose smoke verification temporarily sees stale metadata, the same deployment run may be rerun only while remote `main` is still the candidate; it must repeat the full workflow and exact-SHA smoke.

A release-critical regression after promotion requires rollback. The deployment workflow cannot legally deploy the stale `fd6a2690...` commit because it enforces current `main`. The recovery path is therefore:

1. Stop acceptance/observation progression and retain bounded failure metadata.
2. Prepare and review a revert or corrective PR that restores the behavior evidenced at `fd6a2690...`.
3. Merge it to produce a new rollback SHA at the `main` tip.
4. Deploy that new SHA through `.github/workflows/deploy.yml`.
5. Verify live release metadata and run production member acceptance for the rollback SHA.

The failed candidate's observation is abandoned. A new observation is a separate decision after rollback verification. No legacy gate, task, census, workflow, or evidence participates in rollback.

## Release Records

Task records contain exact SHAs, workflow names, run IDs/URLs, UTC timestamps, conclusions, artifact names, aggregate totals, reconciliation state, and qualitative pass/fail decisions only. Records are committed through the normal reviewed Git path. The task remains open until the new 24-hour observation succeeds or rollback is fully verified.
