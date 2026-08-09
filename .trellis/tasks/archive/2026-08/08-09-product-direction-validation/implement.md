# Product direction validation implementation plan

## Review gate

- [x] User reviews `prd.md`, `design.md`, and this plan.
- [x] Do not run `task.py start` until the user explicitly approves the final
      planning artifacts.
- [x] Confirm the current dirty worktree is preserved and record which existing
      Trellis changes predate this task.

## 1. Freeze research and baseline

- [x] Revalidate the official repository/README/license sources in
      `research/reference-project-adoption-map.md` before relying on a changeable
      external claim.
- [x] Record the exact commit, dirty-state fingerprint, runtime versions, and
      existing relevant test entry points.
- [x] Run the existing focused setup, Agent, workspace-file, document-ingest,
      Automatic Skill, MCP, and OAuth contract tests to distinguish pre-existing
      failures from validation-harness changes.
- [x] Prepare a secret-safe evidence directory and schema for `run.json`,
      `steps.jsonl`, screenshots, failure traces, counters, and observations.

## 2. Add the ordered local validation harness

- [x] Extend the established real-Worker Agent Playwright runner or extract its
      reusable orchestration without creating a second runtime architecture.
- [x] Start loopback-only deterministic fake Providers with generated per-run
      credentials and bounded counters; keep OAuth/MCP in focused protocol tests
      because production SSRF policy rejects loopback issuers and endpoints.
- [x] Start the local Worker with isolated KV/Durable Object/R2/Queue persistence,
      an incomplete first-use business configuration, and no production account.
- [x] Add one ordered owner-to-member product-validation spec while keeping
      focused hidden invariants in independent tests.
- [x] Redact generated credentials from process output, assertion messages,
      traces, screenshots, artifacts, and cleanup errors.
- [x] Make cleanup idempotent for processes, browser state, Wrangler persistence,
      R2/Queue data, OAuth tokens, and temporary files.

Rollback point: if orchestration changes destabilize the existing Agent runner,
revert the extraction and keep the validation wrapper isolated around the
unchanged runner.

## 3. Execute owner onboarding in visible order

- [x] Authenticate to `/react-chat/admin` with the generated token.
- [x] Capture loading, ready/error behavior, the six setup steps, and the start
      timestamp for the five-minute metric.
- [x] Configure Provider, managed key, logical model/offering, first member,
      permissions, Automatic Skill candidates, and a bounded built-in tool
      through visible React controls.
- [x] Run model-free smoke, confirm ready status, retain the member access code
      only in process memory, and complete server-confirmed admin logout.
- [x] Record elapsed time, navigation friction, visible terminology, screenshots,
      and any finding without embedding secret values.

## 4. Execute member workflow A

- [x] Authenticate in a clean member browser context.
- [x] Create an Automatic Skill conversation and complete the deterministic
      programming/project task.
- [x] Verify selected Skill visibility, logical-model clarity, truthful progress,
      progressive output, durable reload, and physical-Provider secrecy.
- [x] Branch/regenerate or continue once and prove the source result remains.
- [x] Record human-style clarity and repeat-use observations.

## 5. Execute member workflow B

- [x] Upload synthetic text plus a generated PDF or Office fixture in the file
      workspace and observe queued/extracting/ready states.
- [x] Pin an exact version, rename or supersede the current file, and complete the
      deterministic analysis task using only verified extracted text.
- [x] Trigger one failed-ingest/retry path and prove zero premature Provider calls.
- [x] Verify user-facing source identity, version stability, bounded errors,
      download/delete expectations, and no R2/parser internals in artifacts.
- [x] Record human-style clarity and repeat-use observations.

## 6. Execute member workflow C

- [x] Complete the deterministic operations workflow through the assigned Skill.
- [x] Use focused OAuth/MCP tests for Authorization Code + PKCE, server-side token
      custody, schema drift, administrator review, and per-invocation side-effect
      confirmation without weakening production SSRF policy.
- [x] Scan browser persistence, logs, Provider inputs, and artifacts for generated
      credential or OAuth/MCP token leakage.
- [x] Record human-style clarity and repeat-use observations.

## 7. Execute cross-cutting recovery cases

- [x] Pre-visible Provider failure falls back within the bounded plan, consumes
      one message quota unit, and correlates attempts without exposing internals.
- [x] Post-visible failure does not splice Providers; verify the recovery action
      and record the missing member-visible request reference as a finding.
- [x] Verify reload/branch and member logout retry visibly; retain cancel and
      later-turn recovery evidence in the focused Agent browser suite.
- [x] Confirm the restricted guest regression boundary remains intact without
      adding it to the primary workflows.

## 8. Audit product direction

- [x] Inspect every required screenshot at desktop and 390px; do not accept an
      assertion-only result when text overlaps, clips, or becomes unintelligible.
- [x] Classify all observations as pass/friction/blocked/invalid and all findings
      as P0-P3 with exact reproduction/evidence links.
- [x] Complete the reference-project adoption map with `adopt now`, `adapt later`,
      and `do not pursue` conclusions grounded in the baseline.
- [x] Produce no more than three next-cycle product outcomes.
- [x] Give each existing roadmap stream an advisory `continue`, `change`, or
      `stop` recommendation without changing its Trellis status.
- [x] Identify follow-up tasks but do not create or start them until the user
      reviews the final evidence and approves their scope.

## 9. Quality and closeout

- [x] Run focused tests for every changed validation helper: 13 files / 228
      tests passed.
- [x] Run `npm run check:frontend`: client build and structure checks passed.
- [x] Run `npm test`: 48 files / 728 tests passed.
- [x] Run `npm run typecheck`: Worker, client, and browser TypeScript checks
      passed.
- [x] Run `npx wrangler deploy --dry-run` without production deployment:
      Wrangler 4.110.0 packaged 19 assets and validated bindings.
- [x] Run `npm run test:browser:workspace`: 90 passed, 55 configured skips.
- [x] Run `npm run test:browser:agent`: 3 passed, and the ordered
      `test:browser:product-validation` entry: 1 passed.
- [x] Run `python ./.trellis/scripts/task.py validate-all`: repository
      consistency OK.
- [x] Run `git diff --check`: passed with existing line-ending warnings only.
- [x] Run `trellis-check`, update executable specs with the deterministic
      product-validation contract, and record exact commands/results in
      `validation-report.md` and the retained evidence directory.
- [x] Commit validation code intentionally as work commit `a2d6a86`; task
      artifacts and executable spec follow in the approved evidence commit.
      Code changes use a PR and no deployment is performed locally.
- [ ] Do not deploy or run production acceptance for a validation-only local
      change unless a later separately approved code task reaches delivery.

## Stop conditions

- Stop immediately for secret exposure, authorization bypass, destructive data
  corruption, or contaminated evidence.
- Stop the ordered run for a P1 blocker only when the remaining evidence would be
  invalid; otherwise record it and continue the other independent steps.
- Never repair runtime/UI behavior inline. Preserve evidence and propose a
  separately reviewed task after the complete baseline.
