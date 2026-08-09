# Provider turn deadline and fallback progress implementation plan

## Planning and activation

- [x] Create this independent P1 child under `post-hardening-roadmap` after the
      legacy control-plane child is fully delivered and archived.
- [x] Confirm the repeated long wait is sequential 60-second candidate deadlines,
      not a browser cache, old admin surface, or synthetic health-check issue.
- [x] Preserve pre-visible-only fallback, post-visible long streams, parent
      cancellation, budget/ledger blocking, one-message quota, and fake-only test
      constraints in `prd.md` and `design.md`.
- [ ] Review all three planning artifacts with the user and run `task.py start`
      only after approval.

## Shared deadline and runtime

- [ ] Add strict run-deadline/progress contracts and code-owned 90-second constant.
- [ ] Extend the deadline helper for an absolute/remaining budget while preserving
      parent cancellation and idempotent commit/dispose behavior.
- [ ] Race the initial Team Agent candidate preparation against the transferred
      run deadline and reject late planning without Provider I/O.
- [ ] Apply one outer deadline across capacity acquisition, every candidate
      attempt, pre-visible reads, required settlement, and fallback in both
      `doStream()` and `doGenerate()`.
- [ ] Recheck deadline/cancellation before lease acquisition, attempt start, and
      fallback; cancel/release/settle exactly once under every race.

## Progress, errors, and passive evidence

- [ ] Emit exact secret-free monotonic progress frames from the conversation
      Agent for planning, capacity, primary attempt, and fallback.
- [ ] Add a strict client decoder and ephemeral request-scoped progress state;
      ignore malformed/stale/foreign messages and never persist it.
- [ ] Replace the unbounded first-output counter with generic-or-evidenced bounded
      progress and remaining time, preserving screen-reader status and terminal
      cleanup on desktop and touch layouts.
- [ ] Preserve canonical `upstream_timeout` projection and assert the same request
      reference reaches progress, Agent error, failure log, and passive reliability.
- [ ] Keep BYOK excluded and telemetry/broadcast failures isolated from routing.

## Verification and delivery

- [ ] Add fake-timer unit coverage for three stalled candidates, fast fallback,
      plan/lease/read late completion, remaining-budget truncation, cancellation,
      committed long streams, generate, and no post-deadline Provider call.
- [ ] Extend attempt/budget/quota/reliability/Agent tests for identity, settlement,
      request correlation, BYOK exclusion, and telemetry failure.
- [ ] Extend client/component tests plus Workspace Playwright at desktop and 390px;
      run the complete local fake-Provider Agent acceptance suite.
- [ ] Run `trellis-check`, update Provider runtime and frontend specs, then run:
      `npm run check:frontend`, `npm test`,
      `npm run test:browser:workspace`, `npm run test:browser:agent`,
      `npm run typecheck`, `npx wrangler deploy --dry-run`,
      `git diff --check`, and `python ./.trellis/scripts/task.py validate-all`.
- [ ] Commit on `codex/provider-turn-deadline-fallback-progress`, push a PR, retain
      exact-head CI/artifacts, merge, verify exact-main GitHub Actions deployment
      and production smoke, record all AC/delivery evidence, and archive.

## Risky files and rollback point

- `src/services/provider-first-visible-deadline.ts`: shared abort semantics.
- `src/services/fallback-language-model.ts`: attempt/fallback/lease settlement.
- `src/worker.ts`: plan preparation, request correlation, reliability callbacks.
- `src/agent/team-agent.ts`: ephemeral conversation broadcast lifecycle.
- `client/src/components/ChatWorkspace.tsx`: raw Agent messages and turn-state cleanup.

Rollback removes the outer deadline/progress layer and restores the existing
per-attempt 60-second behavior. Do not roll back or delete attempt, budget, or
passive reliability evidence, and do not add a post-visible timeout as a shortcut.
