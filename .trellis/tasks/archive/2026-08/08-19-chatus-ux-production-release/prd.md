# Chatus UX production release

## Goal

Safely release the merged Chatus workspace, member-settings, member-availability, and bounded administrator model-monitoring refinement from pull request #96, then prove that the exact reviewed `main` revision is running and usable in production.

This task owns release planning, GitHub Actions deployment, production metadata verification, member acceptance, a newly approved 24-hour passive observation, rollback evidence, and release records. It does not reopen the approved UX design or modify any legacy rollout.

Task creation and planning are approved. Production execution must not begin until the final `prd.md`, `design.md`, and `implement.md` are reviewed and the task is explicitly authorized to leave `planning`.

## Confirmed Facts

- Pull request #96, `Refine Chatus workspace, settings, and model monitoring`, was squash-merged into `main` as `e074560f208530d21b8e4e6442b650b45cadd601` after all four PR checks passed.
- As of the 2026-08-19 planning refresh, the release candidate is the exact `origin/main` tip. Other pull requests target `main`, so any intervening merge before deployment or acceptance invalidates this frozen candidate and must stop execution until scope is reviewed again.
- The latest successful production deployment is GitHub Actions run `31955998267` at `fd6a2690ac3bf5026fde3ee736f35e32d14f940d` from 2026-08-16.
- `.github/workflows/deploy.yml` is manual-only, refuses non-`main` or stale-`main` dispatches, runs frontend checks, tests, typecheck, Wrangler dry-run, Worker deployment, production smoke verification, and retains a deployment manifest.
- `.github/workflows/production-acceptance.yml` is manual-only, shares the serialized `chatus-production-mutation` concurrency group, verifies the deployed revision, and runs temporary-member acceptance without retaining access codes or member identity.
- `.github/workflows/production-model-observation.yml` can perform an exact-SHA-fenced, aggregate-only 24-hour passive observation after the window ends. It does not generate model traffic.
- The successful production model observation run `32118283425` belongs to an earlier deployed revision and cannot be reused as evidence for this candidate.
- The changes in #96 are frontend presentation, deterministic fixtures/tests, Figma/Trellis evidence, and frontend specification updates. They do not add a backend schema, storage migration, Provider route change, deployment workflow change, or legacy rollout change.
- Before the new observation window closed, `origin/main` advanced to `d67af302d97ce71469e7586cd0eac478bc19cac2`. The deployed candidate remains its ancestor. A bounded drift review found byte-identical observation workflow, collector, production-acceptance runner, and production-acceptance contract. The model-monitoring contract changed only to add the future `auxiliary_vision` run kind and a separate capability-monitoring scenario; the passive production-observation scenario remained byte-identical.
- After the window, the exact-SHA production model observation run `32432590580` from `d67af302d97ce71469e7586cd0eac478bc19cac2` succeeded. Its retained aggregate is fresh and exact with `attempts=0`, `completed=0`, `inFlight=0`, `successRate=null`, `fallbacks=0`, 24 trend buckets, and no route/provider/model/run-kind/failure-class groups. Post-observation production smoke still identifies the deployed candidate.

## Requirements

- R1. Freeze `e074560f208530d21b8e4e6442b650b45cadd601` as the only approved release candidate. Immediately stop before deployment or acceptance if `origin/main`, the workflow checkout SHA, or production release metadata resolves to another revision.
- R2. Dispatch `Deploy to Cloudflare` only through GitHub Actions on `main`; never deploy production from local Wrangler or from the release-planning branch.
- R3. Require the deployment workflow and its validation, production mutation, smoke verification, and retained manifest to succeed for the exact candidate SHA.
- R4. Verify production `/release.json`, `/react-chat/`, and the `chatus-release` metadata identify the candidate SHA before running acceptance.
- R5. Dispatch `Production member acceptance` from the same `main` SHA and require both the deployed-revision guard and temporary-member acceptance to succeed.
- R6. Treat release-critical authentication, workspace, settings, member availability, model-monitor visibility, privacy, or Worker regressions as rollback conditions. Because deployment refuses a stale `main` SHA, restore the last known-good behavior through a reviewed revert/corrective commit on `main`, deploy that new rollback SHA through the repository-owned workflow, then re-run live metadata verification and production acceptance. `fd6a2690ac3bf5026fde3ee736f35e32d14f940d` is the content/evidence baseline, not a bypass around the current-main guard.
- R7. Do not modify, advance, or use evidence from `legacy-api-chat-post-rollout`, `legacy-browser-shell-rollout`, any other legacy task, or any legacy production census as evidence for this release.
- R8. Do not print or retain secrets, credentials, access codes, prompts, responses, conversations, stored memories, raw Provider payloads, or member identities. Release records may contain only bounded workflow metadata, exact SHAs, timestamps, aggregate counts, and qualitative pass/fail states.
- R9. Do not generate synthetic model traffic. Treat each actual upstream Provider request as one attempt, count fallback attempts independently, exclude in-flight attempts from the success-rate denominator, and preserve completed success/failure reconciliation, success-rate null semantics, freshness, and member availability without interpreting zero traffic as success or failure.
- R10. Keep the release open for a new 24-hour passive observation window beginning only after exact-SHA deployment and production acceptance succeed. Close or archive the task only after the existing model-observation workflow succeeds for the deployed SHA, or after a required rollback is fully verified.
- R11. If `main` advances during the passive window, the observation may run from the newer exact `main` tip only when the deployed candidate remains its ancestor and the observation workflow, collector, production acceptance, and monitoring contracts have not changed. Otherwise stop for a new scope review; never redeploy merely to manufacture observation eligibility.
- R12. The reviewed `e074560..d67af30` additive monitoring drift is eligible only because production still serves `e074560`, the passive observation contract and executable evidence path are unchanged, and that deployed revision cannot emit the newly declared `auxiliary_vision` group. Repeat every SHA and drift guard after the deadline; any later relevant change reopens the stop condition.

## Acceptance Criteria

- [x] AC1: Final planning freezes the exact candidate and last known-good production SHA, with explicit stop and rollback conditions.
- [x] AC2: The candidate remained the `main` tip at dispatch and `Deploy to Cloudflare` run `32230681004` succeeded for that exact SHA.
- [x] AC3: Production `/release.json` and `/react-chat/` metadata both equal the candidate SHA and the member application is reachable.
- [x] AC4: `Production member acceptance` run `32231590373` succeeded for the same deployed SHA.
- [x] AC5: The new passive observation run `32432590580` proves `attempts = completed + inFlight`, `completed = succeeded + failures`, `successRate = succeeded / completed` or `null` when `completed = 0`, exact 24-bucket and group reconciliation, bounded freshness, and member-availability acceptance without synthetic traffic or prohibited data.
- [x] AC6: No release-critical regression remains open; post-observation production smoke still verifies the deployed candidate SHA and no rollback is required.
- [x] AC7: No legacy rollout task, gate, workflow, or evidence is changed or advanced.
- [x] AC8: Release evidence is recorded in this task and passes Trellis repository validation and `git diff --check`.

## Out Of Scope

- Further UI implementation, visual redesign, or Figma work.
- Backend, storage, model-routing, monitoring-aggregation, Cloudflare binding, secret, or workflow changes.
- Synthetic probes, billing telemetry, per-member monitoring, or production traffic generation.
- Any legacy browser/API rollout, census, gate, workflow state, or evidence mutation.
