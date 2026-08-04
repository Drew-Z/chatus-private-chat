# Implementation Plan: Automatic Skill 配额与 Provider 路由治理

## Ordered Checklist

- [x] Run `trellis-before-dev`; load frontend/index, quality, capability, agent-streaming, platform/index, provider-plan and provider-stream contracts.
- [x] Add failing TeamAgent tests for exhausted automatic quota, one-unit accounting, automatic continuation, pre-abort, selector parent cancellation, and zero main Provider work after cancellation.
- [x] Refactor `prepareTeamAgentTurn()` to reuse one `admitOnce()` result and move automatic admission before selector Provider work without changing manual/no-candidate timing.
- [x] Distinguish selector deadline fallback from parent cancellation and preserve idempotent lease/tool/admission release.
- [x] Add a discriminated reliability-write contract with required `usedUserKey` for shared chat samples; update every legacy stream, Agent, completion, and capability call site.
- [x] Add parameterized BYOK isolation tests covering success, auth, rate limit, server, timeout, protocol, and network outcomes for both logical-route and exact route/provider keys; retain selector telemetry coverage.
- [x] Extract pure bounded aggregate reducers and key/normalization helpers that can be used by the Worker service and ProviderCoordinator without circular runtime ownership.
- [x] Add ProviderCoordinator chat/selector aggregate RPCs backed by DO storage with strict one-time KV seed and write-through KV projection.
- [x] Add deterministic concurrent-write and DO-eviction tests proving no sample loss, bounded invariants, legacy seed compatibility, and passive mirror-failure behavior.
- [x] Add the shared 60-second first-visible deadline mechanism with parent-signal forwarding and late-result cleanup.
- [x] Apply the deadline to AI SDK Agent fallback and legacy SSE preflight; add fake-timer/non-cooperative Provider tests for timeout fallback, cancellation, post-visible long streams, release, and telemetry.
- [x] Run focused Vitest suites until green, then load and execute `trellis-check` for the full affected frontend/platform scope.
- [x] Run the full project gate and both browser suites using only local fake Provider fixtures.
- [x] Run `trellis-update-spec`; update Automatic Skill quota ownership, full BYOK isolation, atomic aggregate authority, first-visible deadline, and explicit member concurrency decision.
- [ ] Prepare task-scoped work/spec commits, PR, CI, merge, GitHub Actions deployment and exact-SHA production acceptance; record artifacts before archive.

## Focused Validation

```powershell
npx vitest run tests/quota-admission.test.ts tests/team-agent-turn.test.ts
npx vitest run tests/route-reliability.test.ts tests/provider-coordinator.test.ts
npx vitest run tests/fallback-language-model.test.ts tests/provider-stream-runtime.test.ts tests/worker-api.test.ts
```

## Full Validation

```powershell
npm run check:frontend
npm test
npm run test:browser:workspace
npm run test:browser:agent
npm run typecheck
npx wrangler deploy --dry-run
git diff --check
python ./.trellis/scripts/task.py validate-all
```

## Risky Files

- `src/worker.ts`
- `src/services/quota-admission.ts`
- `src/services/route-reliability.ts`
- `src/provider-coordinator.ts`
- `src/services/fallback-language-model.ts`
- `src/services/provider-stream-runtime.ts`
- `tests/team-agent-turn.test.ts`
- `tests/route-reliability.test.ts`
- `tests/provider-coordinator.test.ts`
- `tests/fallback-language-model.test.ts`
- `tests/provider-stream-runtime.test.ts`
- `tests/worker-api.test.ts`

## Review Gates

- Planning review must confirm the one-charge admission semantics, full BYOK isolation, DO/KV authority split, 60-second boundary, and decision not to add member concurrency in this task.
- Implementation cannot start until `task.py start` flips this child to `in_progress`.
- The final `trellis-check` pass must cover every affected frontend/platform package and all call sites, not only new tests.
- Production deployment and acceptance must run only from GitHub Actions at the exact merged `main` SHA.

## Rollback Points

- Admission/cancellation, BYOK typing, aggregate authority, and first-visible deadline should land as separable commits where practical.
- If the DO projection migration is unsafe, retain the BYOK/admission fixes and keep aggregate code behind the old KV read path until concurrency tests pass; do not ship a mixed authority.
- If the first-visible boundary causes post-commit cancellation, roll back that slice; never keep a timer alive after Provider commitment.
