# Chatus Production Release And Observation Design

## Release Boundary

The release unit is pull request #90 after its metadata accurately discloses both delivered capabilities:

1. The approved member workspace and member settings redesign.
2. The approved rolling 24-hour model monitoring and member-safe route availability projection.

The release task permits narrowly scoped pre-merge corrective changes when review finds a release-blocking correctness or discoverability gap in the already approved feature. It does not add product capability or reopen the visual design. After those corrections are reviewed, the task merges the feature head and promotes the resulting `main` revision through repository-owned GitHub Actions.

## Pre-Merge Corrective Review

The approved monitoring and workspace behavior has four release-blocking corrections:

- The browser monitor decoder requires a 24-hour period, 24 contiguous one-hour buckets, bounded aggregate arrays, and the existing count/rate reconciliation.
- The administrator monitor keeps every route, Provider, and model group discoverable through a segmented view with the existing 20-item pagination pattern; no silent `slice` truncation is allowed.
- Member model availability shows its generated/update time and refresh state in the conversation inspector.
- Connection state remains visible for parent/shared conversations, and availability refreshes use a monotonically increasing request generation so an older response cannot overwrite a newer one.

These changes remain inside the existing API contracts and approved member/admin information architecture. They are validated with decoder regressions and synthetic browser fixtures; no production model calls are added.

## Revision Chain

Every gate must preserve one traceable revision chain:

```text
reviewed PR head
  -> GitHub merge commit on main
  -> Deploy to Cloudflare workflow head SHA
  -> public/release.json commit
  -> /react-chat/ chatus-release meta
  -> Production member acceptance workflow head SHA
```

Any mismatch stops progression. A successful workflow for another SHA is not evidence for this release.

## Review Gate

Before merge:

- Confirm PR #90 is open, mergeable, and based on the current `main`.
- Confirm the reviewed head SHA has not changed after inspection.
- Confirm all status checks are complete and successful.
- Review the backend monitoring endpoint, member authorization projection, failure aggregation, privacy redaction, frontend decoders, member settings ownership, responsive states, and test coverage.
- Correct the PR title/body so it does not describe backend/API work as absent.

Because `main` is not protected by GitHub branch protection, this task treats the review and SHA checks as explicit operational gates rather than relying on repository enforcement.

## Deployment Gate

Production deployment uses `.github/workflows/deploy.yml` from `main`. The workflow owns dependency installation, frontend checks, tests, typecheck, whitespace checks, resource provisioning, deployment configuration, Wrangler dry-run, release metadata injection, Worker deployment, smoke verification, and delivery manifest retention.

No local command may deploy production. The workflow must be dispatched after merge so `GITHUB_SHA` is the merge revision. The task waits for terminal completion and inspects the deployment job and its critical steps.

## Production Verification

After a successful deployment:

- Fetch `/release.json` and require `commit` to equal the merge SHA.
- Fetch `/react-chat/`, require an expected success response, and require its `chatus-release` meta to equal the merge SHA.
- Dispatch `.github/workflows/production-acceptance.yml` from the same `main` revision.
- Require both its deployed-revision guard and temporary-member acceptance to succeed.

## Observation And Privacy

The 24-hour window begins at the verified deployment timestamp. Observation is passive: real Chatus Provider attempts populate the monitoring ledger. No synthetic model call is made solely to produce a green status.

Evidence may record aggregate attempt, success, failure, in-flight, fallback, latency, freshness, and qualitative member-availability states. It must not record prompts, responses, conversations, memories, credentials, access codes, Provider payloads, or member identifiers.

If no real model traffic occurs, the correct result is a no-data or unknown state, not a fabricated success rate. UI reachability and production acceptance remain independently verifiable.

### Observation Evidence Path

The final gate uses `.github/workflows/production-model-observation.yml`, a manual, main-only Workflow that is separate from deployment and legacy census workflows. It receives the exact deployed SHA and verified observation start timestamp as explicit inputs, checks that the deployed release is an ancestor of the current main revision, and refuses to run before the 24-hour window ends.

The collector logs in through the existing admin session boundary, reads only `GET /api/admin/model-monitor?window=24h&bucket=hour`, validates the exact 24-bucket contract and all aggregate reconciliations, logs out, and verifies the deployed release did not change. Its retained artifact contains only the deployed SHA, timestamps, totals, and bounded group counts; it never writes route, Provider, model, failure-class, prompt, response, conversation, credential, or member data to evidence. The existing model-request-free production acceptance is run in the same serialized environment and now validates the member `/api/model-availability` projection shape and privacy boundary for temporary members.

## Rollback

Rollback is required for release-critical authentication, chat, settings, authorization, monitoring privacy, or Worker regressions. Select the last known-good `main` revision already evidenced by a successful production deploy, dispatch the repository deployment workflow for that revision through the approved GitHub mechanism, and verify the resulting live release metadata. Do not use local Wrangler or modify legacy rollout gates.

## Compatibility

- No production schema migration is expected from PR #90.
- Existing production data and routing remain authoritative.
- Monitoring read failure must not block chat.
- Member availability remains advisory and must not become a routing gate.
