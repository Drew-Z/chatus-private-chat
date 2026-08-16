# Chatus production release and 24-hour observation

## Goal

Safely integrate and release the completed Chatus member workspace, member settings, and model-monitoring work in pull request #90, then prove that the exact merged revision is running in production and remains usable during a 24-hour passive observation window.

This task begins after product design, implementation, and pre-production validation have completed. It owns integration and release evidence only; it does not reopen the approved UX design or advance any legacy-surface rollout.

## Confirmed Facts

- Pull request #90 targets `main` from `codex/chatus-ux-settings-redesign-ui`; it is no longer a Draft and merged after all required checks passed.
- The reviewed PR head is `28f9a6f10df3efc716e3c3748ebbca0d083ddca8`; the resulting `main` merge SHA is `fd6a2690ac3bf5026fde3ee736f35e32d14f940d`.
- The pull request contains both the approved Chatus member UX/settings work and the separately approved model-monitoring/member-availability implementation, including the Worker/API and Provider-attempt ledger scope.
- Production deployment is manually dispatched from `main` through `.github/workflows/deploy.yml`; local production Wrangler deployment is prohibited.
- Production member acceptance is manually dispatched from `main` through `.github/workflows/production-acceptance.yml`.
- The exact merge SHA is now running in production; the 24-hour passive observation window is in progress and is not complete yet.

## Requirements

- R2a. Resolve the pre-merge review findings without expanding product scope: enforce the exact 24-hour monitor contract at the browser boundary, preserve all monitor groups through a discoverable segmented/paginated view, expose availability freshness and connection state, and fence overlapping availability refreshes so older results cannot win.

- R1. Update pull request #90 metadata so reviewers can see the complete UX, Worker/API, monitoring, privacy, and test scope. Do not claim that backend or API contracts are unchanged.
- R2. Keep the pull request branch clean and all required checks successful. Review the actual diff for security, privacy, authorization, regression, and production-boundary risks before marking it Ready or merging it.
- R3. Merge pull request #90 into `main` only if it remains mergeable, its head SHA is unchanged from the reviewed revision, and all checks are successful.
- R4. Dispatch `Deploy to Cloudflare` only from the exact merged `main` revision. Do not deploy from a local Wrangler account or from the feature branch.
- R5. Require the deployment workflow, Worker deployment step, and production smoke verification to succeed. Verify that both `/release.json` and the `/react-chat/` release meta identify the merged revision.
- R6. Dispatch `Production member acceptance` from the same deployed `main` revision and require the release guard plus temporary-member acceptance to succeed.
- R7. Observe the release for 24 hours using passive Chatus request evidence. Check model attempts, completed successes/failures, success rate semantics, stale/unknown member availability, and UI reachability without generating synthetic model traffic merely to improve health status.
- R8. Treat any release-critical regression as a rollback condition. Use the repository-owned GitHub Actions deployment workflow for rollback to the last known-good `main` revision; do not mutate production locally.
- R9. Do not modify, advance, or use evidence from `legacy-api-chat-post-rollout`, `legacy-browser-shell-rollout`, or any other legacy rollout as proof for this Chatus release.
- R10. Do not expose or record secrets, access codes, prompts, responses, conversation content, stored memories, raw Provider payloads, or member identities in task evidence.

## Acceptance Criteria

- [x] AC1: Pull request #90 accurately describes both member UX/settings and model-monitoring/member-availability changes and is no longer a Draft.
- [x] AC2: The reviewed PR head has successful checks and is merged into `main`; the exact merge SHA is recorded.
- [x] AC3: `Deploy to Cloudflare` succeeds for the exact merge SHA, including validation, Worker deployment, and production smoke steps.
- [x] AC4: Production `/release.json` and `/react-chat/` release metadata both equal the merge SHA and the member workspace returns an expected successful response.
- [x] AC5: `Production member acceptance` succeeds for the same SHA.
- [ ] AC6: A 24-hour passive observation records monitoring freshness and reconciled attempt/success/failure evidence without exposing prohibited data or running synthetic health probes.
- [ ] AC7: No release-critical regression remains open at the end of observation; otherwise rollback evidence and the resulting live SHA are recorded.
- [ ] AC8: No legacy rollout task, gate, workflow state, or evidence is changed or advanced by this task.

## Release Evidence

- PR checks: GitHub Actions run `31954615529`, attempt 2; `changes`, `quality`, `workspace-browser`, and `agent-browser` passed.
- Merge: PR #90 merged at `2026-08-16T15:31:08Z`; merge SHA `fd6a2690ac3bf5026fde3ee736f35e32d14f940d` contains reviewed head `28f9a6f10df3efc716e3c3748ebbca0d083ddca8`.
- Deployment: `Deploy to Cloudflare` run `31955998267` succeeded for `main` at the merge SHA; validation, Worker deployment, and production smoke verification passed.
- Production metadata: `/release.json` and `/react-chat/` `chatus-release` both returned `fd6a2690ac3bf5026fde3ee736f35e32d14f940d`; `/react-chat/` returned HTTP 200.
- Acceptance: `Production member acceptance` run `31956295236` passed its deployed-revision guard and temporary-member acceptance for the same SHA.
- Observation start: `2026-08-16T15:37:12Z`, after the deployment Workflow completed its production smoke verification. The release metadata was generated at `2026-08-16T15:36:42.875Z`; observation is passive and remains open until `2026-08-17T15:37:12Z`.
- Observation collector: draft PR #91 adds `.github/workflows/production-model-observation.yml` and `scripts/collect-production-model-observation.mjs`; it is main-only, serialized, exact-SHA fenced, aggregate-only, and does not call `/api/chat` or Wrangler.

## Out Of Scope

- Further visual redesign or new Figma work.
- New model-monitoring features, synthetic probes, billing telemetry, or per-member surveillance.
- Legacy browser/API rollout work and production legacy census governance.
- Changing Cloudflare bindings, credentials, storage schemas, routing configuration, or deployment workflows.
