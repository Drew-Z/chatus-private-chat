# Provider turn deadline and fallback progress implementation plan

## Planning and activation

- [x] Create this independent P1 child under `post-hardening-roadmap` after the
      legacy control-plane child is fully delivered and archived.
- [x] Confirm the repeated long wait is sequential 60-second candidate deadlines,
      not a browser cache, old admin surface, or synthetic health-check issue.
- [x] Preserve pre-visible-only fallback, post-visible long streams, parent
      cancellation, budget/ledger blocking, one-message quota, and fake-only test
      constraints in `prd.md` and `design.md`.
- [x] Review all three planning artifacts with the user and run `task.py start`
      only after approval.

## Shared deadline and runtime

- [x] Add strict run-deadline/progress contracts and code-owned 90-second constant.
- [x] Extend the deadline helper for an absolute/remaining budget while preserving
      parent cancellation and idempotent commit/dispose behavior.
- [x] Race the initial Team Agent candidate preparation against the transferred
      run deadline and reject late planning without Provider I/O.
- [x] Apply one outer deadline across capacity acquisition, every candidate
      attempt, pre-visible reads, required settlement, and fallback in both
      `doStream()` and `doGenerate()`.
- [x] Recheck deadline/cancellation before lease acquisition, attempt start, and
      fallback; cancel/release/settle exactly once under every race.

## Progress, errors, and passive evidence

- [x] Emit exact secret-free monotonic progress frames from the conversation
      Agent for planning, capacity, primary attempt, and fallback.
- [x] Add a strict client decoder and ephemeral request-scoped progress state;
      ignore malformed/stale/foreign messages and never persist it.
- [x] Replace the unbounded first-output counter with generic-or-evidenced bounded
      progress and remaining time, preserving screen-reader status and terminal
      cleanup on desktop and touch layouts.
- [x] Preserve canonical `upstream_timeout` projection and assert the same request
      reference reaches progress, Agent error, failure log, and passive reliability.
- [x] Keep BYOK excluded and telemetry/broadcast failures isolated from routing.

## Verification and delivery

- [x] Add fake-timer unit coverage for three stalled candidates, fast fallback,
      plan/lease/read late completion, remaining-budget truncation, cancellation,
      committed long streams, generate, and no post-deadline Provider call.
- [x] Extend attempt/budget/quota/reliability/Agent tests for identity, settlement,
      request correlation, BYOK exclusion, and telemetry failure.
- [x] Extend client/component tests plus Workspace Playwright at desktop and 390px;
      run the complete local fake-Provider Agent acceptance suite.
- [x] Run `trellis-check`, update Provider runtime and frontend specs, then run:
      `npm run check:frontend`, `npm test`,
      `npm run test:browser:workspace`, `npm run test:browser:agent`,
      `npm run typecheck`, `npx wrangler deploy --dry-run`,
      `git diff --check`, and `python ./.trellis/scripts/task.py validate-all`.
- [x] Commit on `codex/provider-turn-deadline-fallback-progress`, push a PR, retain
      exact-head CI/artifacts, merge, verify exact-main GitHub Actions deployment
      and production smoke, record all AC/delivery evidence, and archive.

## Validation Evidence

- Focused Vitest: `npx vitest run tests/fallback-language-model.test.ts tests/provider-lease.test.ts tests/provider-turn-progress.test.ts tests/provider-turn-progress-client.test.ts tests/team-agent-turn.test.ts` passed 5 files / 48 tests.
- Full Vitest: `npm test` passed 48 files / 728 tests in 144.29 seconds. The expected negative budget-policy diagnostics and third-party sourcemap warnings did not change the zero exit status.
- Workspace browser: `npm run test:browser:workspace` passed 90 tests with 55 intentional skips across the full 145-case matrix, including desktop and touch-enabled 390px progress acceptance.
- Local fake-Provider Agent browser: `npm run test:browser:agent` passed 3/3 and proved raw progress broadcast, first-output cleanup, secret-free rendering, and no localStorage persistence.
- `npm run check:frontend` and `npm run typecheck` passed.
- Wrangler 4.110.0 `npx wrangler deploy --dry-run` passed local packaging for 19 assets and all Worker/DO/KV/Queue/R2 bindings; no upload or production deployment occurred.
- `git diff --check` and `python ./.trellis/scripts/task.py validate-all` passed after the code-spec update.
- Every test used local deterministic fake Provider/Agent inputs. No live model, MCP/OAuth request, synthetic production probe, or local production deployment was used.

## Delivery Evidence

- Work commit: `39ae56906e557ddf9b5634f40e9e146f488ed6ac`, the squash commit reachable from `main` for PR [#54](https://github.com/Drew-Z/chatus-private-chat/pull/54).
- PR exact-head CI: head `6a8214586a35a2a92f1de527274a067c910364ce`; `changes`, `quality`, `workspace-browser`, and `agent-browser` passed in [run 31302263886](https://github.com/Drew-Z/chatus-private-chat/actions/runs/31302263886). Path classification, quality manifest, coverage summary, Workspace Playwright, and local fake-Provider Agent Playwright artifacts were retained.
- Exact-main deployment: SHA `39ae56906e557ddf9b5634f40e9e146f488ed6ac` passed both stale-main guards, full quality gates, Worker deployment, production revision verification, and deployment-manifest retention in [run 31302578436](https://github.com/Drew-Z/chatus-private-chat/actions/runs/31302578436). Artifacts `production-deployment-39ae56906e557ddf9b5634f40e9e146f488ed6ac` and `deployment-paths-39ae56906e557ddf9b5634f40e9e146f488ed6ac` were retained.
- Production acceptance: the same main SHA passed deployed-revision verification, temporary-member acceptance, cleanup, and 90-day manifest retention in [run 31302800180](https://github.com/Drew-Z/chatus-private-chat/actions/runs/31302800180). Artifact `production-acceptance-39ae56906e557ddf9b5634f40e9e146f488ed6ac` was retained.
- Delivery used only GitHub Actions for production deployment and acceptance. No local production deployment, live Provider/MCP test, or synthetic probe was used.

## Risky files and rollback point

- `src/services/provider-first-visible-deadline.ts`: shared abort semantics.
- `src/services/fallback-language-model.ts`: attempt/fallback/lease settlement.
- `src/worker.ts`: plan preparation, request correlation, reliability callbacks.
- `src/agent/team-agent.ts`: ephemeral conversation broadcast lifecycle.
- `client/src/components/ChatWorkspace.tsx`: raw Agent messages and turn-state cleanup.

Rollback removes the outer deadline/progress layer and restores the existing
per-attempt 60-second behavior. Do not roll back or delete attempt, budget, or
passive reliability evidence, and do not add a post-visible timeout as a shortcut.
