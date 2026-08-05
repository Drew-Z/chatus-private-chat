# Provider attempt shadow ledger evidence

## Acceptance evidence

| AC | Current evidence | Status |
| --- | --- | --- |
| AC1 | `provider-attempt-ledger.test.ts`, `fallback-language-model.test.ts`, `team-agent-turn.test.ts`, and `worker-api.test.ts` cover main answer, offering fallback, timeout/cancel, Automatic Skill, Agent/legacy tool continuation, memory suggestion, conversation summary, and model discovery with local fake Providers. | Passed |
| AC2 | `provider-attempt.ts`, `provider-attempt-runtime.ts`, and `ProviderAttemptLedger` enforce server UUID identities, exact decoders, provider shards, and operation-fence/run/fallback idempotency. TeamAgent schema v7 persists continuation turn identity. | Passed |
| AC3 | Fallback fixtures assert failed/successful attempts share one turn/run, while TeamAgent Automatic Skill plus answer and continuation fixtures preserve one admitted message quota. | Passed |
| AC4 | Ledger replay tests prove identical start/terminal calls append no duplicate event and attribution/terminal conflicts preserve the first evidence. | Passed |
| AC5 | Worker fixtures submit forged `turnId`, `runId`, `attemptId`, Provider, offering, and model fields and prove the ledger uses only server-selected values. | Passed |
| AC6 | Exact input decoders reject content fields; SQL column, diagnostics, account deletion, user export, log, and secret-marker fixtures exclude prompt, completion, tool payload, credentials, raw Provider metadata, and invoice data. | Passed |
| AC7 | Capture registers `provider-attempt-ledger-v1` as `authoritative/restore`; restore requires `PROVIDER_ATTEMPT_LEDGER/ProviderAttemptLedger/v5`; deletion retains instance evidence and user export excludes it. | Passed |
| AC8 | Original delivery used work commit `7b09f0029d7c49048a4a1d9a47056b4a4725c1c8`, evidence commit `cb7cf4797de94565086f9e8cac004182e5939a71`, merged PR [#49](https://github.com/Drew-Z/chatus-private-chat/pull/49), CI `31037448595`, merge SHA `7c84d359b55cb00c26e22389dbff20b57c30ec08`, and deployment `31037988186`. Acceptance `31038341007` exposed the restart regression below. Follow-up work commit `c7469679a47b5f6b70be40476f93dd8f98ebd2dd` shipped through merged PR [#50](https://github.com/Drew-Z/chatus-private-chat/pull/50): CI `31040907503`, merge/deploy SHA `c5afa65605887b07eb2cbd05bc3d948e4ff44de2`, deployment `31041362560`, and production acceptance `31041764253` all passed with retained exact-SHA artifacts. | Passed |

## Risk evidence

- `FIN-01`: every implemented Provider boundary starts an immutable server-owned
  attempt before Provider I/O. Retry/fallback attempts have distinct attempt IDs,
  auxiliary/tool executions have distinct run IDs, and one admitted lifecycle
  retains one turn ID.
- `FIN-05`: the v1 schema and diagnostics are content-free and purpose-bounded;
  account deletion retains instance evidence, user export excludes it, and the
  current retention policy is explicitly `no_automatic_expiry`.
- Usage normalization, token evidence, pricing, cost, budget reservation,
  invoice reconciliation, and finance feedback receipts remain unsupported and
  belong to later roadmap children. Attempt presence or status must not be
  interpreted as usage, money, or billing truth.

## Accepted residual behavior

- Required start failure blocks Provider execution after one bounded retry.
- Repeated terminal RPC failure is surfaced after lease/admission cleanup but
  can leave a durable `started` projection because no deferred-terminal
  reconciler exists yet. `started` means incomplete evidence, never success or
  zero usage.
- Append-only event behavior is enforced at the private Durable Object RPC and
  application boundary, not by SQLite update/delete triggers; adding triggers
  requires capture/restore compatibility proof.
- Exact `PROVIDER_ATTEMPT_LEDGER_MODE=disabled` is the rollback mode. Evidence is
  intentionally incomplete while disabled and no completeness claim may cover
  that interval.

## Local validation

| Command | Result |
| --- | --- |
| `npm run check:frontend` | Passed; Vite build and frontend structure checks |
| `npx vitest run tests/instance-capture.test.ts` | Passed; 26 schema-registration, capture, and maintenance regression tests |
| `npm test` | Passed; 44 files, 651 tests |
| `npm run typecheck` | Passed; Worker, client, and browser TypeScript |
| `npm run test:browser:workspace` | Passed; 84 tests, 46 conditional skips, five viewports |
| `npm run test:browser:agent` | Passed; 3 local fake Provider tests |
| `npx wrangler deploy --dry-run` | Passed; five SQLite Durable Object bindings including v5 ledger |
| `git diff --check` | Passed; no whitespace errors after code, spec, and task evidence updates |
| `python ./.trellis/scripts/task.py validate-all` | Passed; repository consistency OK |

No validation used a live model, live MCP, synthetic production probe, or local
production deployment.

## Production acceptance regression

### Observed evidence

- PR #49 merged as `7c84d359b55cb00c26e22389dbff20b57c30ec08` after CI run `31037448595` passed.
- Deployment run `31037988186` passed its exact-SHA smoke and retained the deployment manifest.
- Exact-SHA production acceptance run `31038341007` later received `/healthz` 503 for all 12 attempts. Temporary-member acceptance correctly skipped because release health failed, and the failure manifest was retained for 90 days.

### Root cause and prevention

- Category: cross-layer migration contract plus regression-test gap. `TeamAgent` applied SQLite schema v7 during startup, then re-registered an existing `health:probe` object previously stored as `team-agent-v6`. `InstanceCoordinator.registerObject()` treated every schema change as `instance_object_conflict`, so a restarted isolate became permanently unavailable.
- The deployment smoke hit the still-running v6 isolate and therefore could not prove the post-eviction startup path. The old registry test also encoded v6-to-v7 as an expected conflict, hiding the missing migration contract.
- The follow-up permits only same-family, strictly increasing numeric schema upgrades for an otherwise identical object registration; persists the upgraded record; invalidates the object-registry baseline; and returns `instance_maintenance_busy` without mutation during requested/active maintenance.
- Regression tests now cover forward upgrade persistence, baseline digest invalidation, exact-schema idempotency, downgrade/family/malformed/policy rejection, requested and active maintenance freeze, and preservation of the stored registration on every rejected path.

### Follow-up delivery evidence

- PR [#50](https://github.com/Drew-Z/chatus-private-chat/pull/50) merged as `c5afa65605887b07eb2cbd05bc3d948e4ff44de2` after CI run `31040907503` passed `quality` and local fake-Provider Agent acceptance. The Workspace job was path-classifier skipped; the required local Workspace suite passed 84 tests with 46 conditional skips.
- CI retained `pr-path-classification-*`, `pr-quality-*`, `pr-coverage-*`, and `agent-playwright-*` artifacts through 2026-08-19.
- Main deployment run `31041362560` targeted the exact merge SHA, passed both remote-main guards, full quality gates, Wrangler deploy, and `Verify production`. It retained `production-deployment-c5afa65605887b07eb2cbd05bc3d948e4ff44de2` through 2026-11-03.
- Production acceptance run `31041764253` targeted the same exact SHA. Release health and temporary-member acceptance both passed, cleanup completed, and `production-acceptance-c5afa65605887b07eb2cbd05bc3d948e4ff44de2` is retained through 2026-11-03.
