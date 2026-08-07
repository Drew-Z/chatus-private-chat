# Provider budget engine and enforcement implementation plan

## Ordered Work

- [x] Run `trellis-before-dev` for platform, Durable Object, error, recovery,
      admin API, React component, type-safety, and test conventions. Record the
      task's related files before editing.
- [x] Add strict v1 policy/decision/reservation/event/projection/admin contracts,
      stable public errors, and contract decoder tests.
- [x] Add ProviderAttemptLedger schema v3 tables, atomic
      `startBudgetedAttempt`, settle/release/hold/reconcile transitions,
      replay/conflict fences, 72-hour review promotion, bounded snapshots, and
      exact integer-balance tests.
- [x] Update capture allowlist/schema registration, authoritative restore
      compatibility, and migration/capture/restore fixtures for v3.
- [x] Refactor `ProviderAttemptRuntime.start` into the single budget-aware
      pre-network gateway while preserving disabled/no-policy behavior.
- [x] Integrate and test chat/fallback, Agent/Automatic Skill, memory/summary,
      model discovery, initial tools, and every continuation. Require prior
      settle/hold before fallback and preserve one admitted message quota unit.
- [x] Add instance-fenced, audited admin policy/reconciliation routes and extend
      the bounded finance snapshot without exposing raw IDs or sensitive data.
- [x] Extend the React operations workspace, strict client decoder, 21-item
      pagination fixtures, desktop/390px Workspace Playwright coverage, loading,
      error, empty, disabled, shadow, soft, hard, denied, pending, and
      review-required states.
- [x] Add deterministic concurrency, crash/replay, duplicate callback, timeout,
      cancellation, billable failure, fallback, unknown price/cost, late usage,
      corrected cost, post-call settlement outage, BYOK exclusion, rollback, and
      zero-fake-Provider-call tests.

## Required Validation

- [x] Run focused Provider ledger/runtime/admin/client tests while iterating.
- [x] Run impact-path Workspace Playwright at desktop and 390px and the local
      fake-Provider Agent suite. Do not use a live Provider/MCP or synthetic
      production probe.
- [x] Run `trellis-check`, then the full baseline:
      `npm run check:frontend`, `npm test`, `npm run typecheck`,
      `npx wrangler deploy --dry-run`, and `git diff --check`.
- [x] Run `python ./.trellis/scripts/task.py validate-all` and record every
      command/result in task metadata.

## Spec And Delivery Gates

- [x] Update Provider ledger, plan/stream/tool runtime, public error, admin/API,
      Durable Object recovery, and frontend component/type-safety specs. Review
      quota and delivery governance as unchanged, and record `FIN-03` closure
      with `FIN-02`/`FIN-05` compatibility evidence.
- [x] Commit implementation on a `codex/` branch, push, create a PR, and wait for
      all required CI jobs/artifacts. All tests use local deterministic fakes.
- [x] After merge, retain exact work/PR/merge SHA, production deployment and
      production acceptance run IDs/artifacts from GitHub Actions. Never deploy
      production locally.
- [x] Complete every AC, validation record, work commit, parent/child status,
      archive preflight, archive commit, workspace index validation, and journal
      update with no implicit waiver.

## Rollback Points

1. Before runtime integration, schema/contract changes are additive and no
   policy exists, so behavior remains disabled.
2. Before any concrete hard policy, write a new `soft` policy version; no new
   call blocks or reserves, while observations continue.
3. If settlement health degrades after hard activation, promote `soft`, preserve
   full outstanding holds/reservations, and reconcile before considering hard
   mode again.
4. Never delete budget/attempt/cost history, applied SQLite migrations, holds,
   fences, or restore schema support as a rollback action.

## Planning Review Gate

- The initial scope, modes, unknown-price rule, 72-hour hold rule, BYOK policy,
  ledger outage behavior, admin ownership, rollout, rollback, and unsupported
  remainder are resolved in `prd.md` and `design.md`.
- Implementation may start because the user previously approved this roadmap and
  repeatedly instructed execution to continue; no additional task-creation or
  implementation permission is required.
