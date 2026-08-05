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
| AC8 | All local gates and Trellis consistency pass. Work commit `7b09f0029d7c49048a4a1d9a47056b4a4725c1c8` and draft PR [#49](https://github.com/Drew-Z/chatus-private-chat/pull/49) are recorded. CI, exact-SHA deployment, production acceptance, and archive evidence remain pending. | Pending |

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
| `npm test` | Passed; 44 files, 648 tests |
| `npm run typecheck` | Passed; Worker, client, and browser TypeScript |
| `npm run test:browser:workspace` | Passed; 84 tests, 46 conditional skips, five viewports |
| `npm run test:browser:agent` | Passed; 3 local fake Provider tests |
| `npx wrangler deploy --dry-run` | Passed; five SQLite Durable Object bindings including v5 ledger |
| `git diff --check` | Passed; no whitespace errors after code, spec, and task evidence updates |
| `python ./.trellis/scripts/task.py validate-all` | Passed; repository consistency OK |

No validation used a live model, live MCP, synthetic production probe, or local
production deployment.
