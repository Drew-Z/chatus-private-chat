# Legacy API chat POST evidence handoff

This is a deployment evidence handoff for `legacy.api.chat-post`. It records the
caller and identity boundaries proven by source review and local fake-Provider
tests, plus exact merged-main deployment and census evidence. It does not claim
a rollback rehearsal or completion of either observation window.

## Review identity

- Review head: `48affb8c7f957e8afef168b0c2874810f77397ee`
- Surface manifest: `legacy.api.chat-post`, manifest version `2`, owner `data`
- Caller classes in the code-owned manifest: `browser`, `test`, `worker_api`
- Production deployment SHA: `48affb8c7f957e8afef168b0c2874810f77397ee`

## Caller census map

| Caller | Boundary | Evidence | Classification |
| --- | --- | --- | --- |
| Browser member and guest | `public/app.js:777` sends `POST /api/chat` | `scripts/check-frontend.mjs:361`; browser fetch metadata | `browser` when browser navigation/fetch headers are present |
| Guest API path | `src/worker.ts:2350-2365` and `handleChat` | `tests/worker-api.test.ts:1672` guest admission parity | `worker_api`; guest/member is session policy, not a telemetry caller class |
| Worker/API caller | `src/worker.ts:2350-2365` and `src/worker.ts:6810-6914` | `tests/worker-api.test.ts:4693` exact read/write evidence and control ordering | `worker_api` unless an allowed explicit caller marker is present |
| Test caller | `tests/worker-api.test.ts:4693-4799` | exact read/write rows with a 40-character deployment SHA fixture | `test` |

The route boundary records only caller class, access, occurrence time, and the
server-resolved deployment SHA. It never records request, conversation,
Provider, credential, memory, tool, or response content. An undeclared or
unrecognized caller marker fails closed to the bounded `worker_api` class; it
cannot introduce a new class through a request header.

## Parity handoff

Local fake-Provider/MCP parity covers the following deterministic scenarios:

- file, Skill, streaming, and attempt identity parity (`tests/worker-api.test.ts:1352`)
- builtin tool and continuation attempt parity (`tests/worker-api.test.ts:1453`)
- guest route-admission parity (`tests/worker-api.test.ts:1672`)
- pre-visible fallback telemetry parity (`tests/worker-api.test.ts:1728`)
- visible-stream cancellation cleanup parity (`tests/worker-api.test.ts:1904`)
- legacy read/write control ordering and zero hidden Provider work on denial (`tests/worker-api.test.ts:4693`)

No live model, MCP server, synthetic production probe, or production credential
is used by this evidence.

## Identity handoff to ACL planning

This rollout does not create or rename durable identities. The current source
identity boundaries that the ACL task must migrate without rebinding are:

- Root TeamAgent instance: `member-${SHA256("team-agent:" + label).slice(0, 48)}`
  from `src/worker.ts:11413-11415`.
- Conversation TeamAgent instance:
  `chat-${SHA256("team-agent:" + label + ":conversation:" + chatId).slice(0, 48)}`
  from `src/worker.ts:11418-11420`.
- Root/conversation props carry the authenticated `session.label` and the
  conversation `chatId` at `src/worker.ts:11423-11451`.

The ACL identity task must introduce immutable opaque principal/resource IDs,
retain these names during its first additive migration, reconcile one-to-one
markers, and reject label rename/reuse or client-supplied identity/routing IDs.
This API rollout is therefore a source-identity handoff, not ACL identity
implementation.

## Delivery evidence

- PR #58 final CI: run `31360685183`, head
  `b199fb3f25b1ed8bba2829e2b5cc8c4f01e0317b`; `changes`, `quality`, and local
  fake-Provider Agent acceptance passed. Workspace Playwright was skipped by the
  path classifier, with the complete local Workspace matrix retained separately.
- Squash merge: `a0f8b30a4549dbf832827d6e54de4fbbb48790b3` at
  `2026-08-10T06:10:36Z`.
- Exact-main deployment: run `31361000781`; both stale-main guards, Worker
  deployment, and production verification passed. Worker version is
  `09624a59-5546-4a47-bd71-29c51d9a285f`.
- Retained deployment artifacts: `9052343216` through 2026-09-09 and
  `9052434350` through 2026-11-08.
- Census fix PR #65 merged as
  `48affb8c7f957e8afef168b0c2874810f77397ee`; PR CI run `31562742368`
  passed `changes`, `quality`, and fake-Provider `agent-browser` (the
  path-classified Workspace job was skipped).
- Exact-main deployment run `31565553898` passed all quality, stale-main,
  deploy, and production verification steps. Its production artifact is
  `9129387942`, retained through 2026-11-10.
- Exact-SHA census run `31565995047` passed on the same SHA. Artifact
  `9129468576` (`production-legacy-census-legacy.api.chat-post-48affb8c7f957e8afef168b0c2874810f77397ee`)
  is 240 bytes and retained through 2026-11-10. The validated projection has
  `surfaceId=legacy.api.chat-post`, `days=30`, and `rowCount=0`; no row content
  was printed or retained in this record.
- Census projection PR #63 merged as
  `393f0578e1cb6a3cee3a832b715b3a4fdfed60b9`; exact-main deployment run
  `31560695880` passed all deployment and production verification steps.
- The first 30-day census run `31561044924` targeted that exact SHA but failed
  before artifact upload with HTTP 404 because the bundled surface had no
  initialized coordinator. The failure retained no census rows and starts no
  observation clock. A follow-up makes this cold state a valid empty, read-only
  projection without synchronizing or creating coordinator state.

Deployment proves the shipped identity and route instrumentation are live. It
does not prove which production callers exist or start either 30-day window.

## Gate status

| Gate | Status | Why |
| --- | --- | --- |
| Static caller map and parity contract | Prepared | Source and local fake-runtime evidence above |
| Production exact-SHA caller census | Prepared | Run `31565995047` passed and retained a canonical 30-day artifact with zero rows |
| Routing rollback rehearsal | Open | Requires the deployed control-plane operation and retained rollback evidence |
| 30-day write observation | Open | The API ceiling remains `instrumented` |
| Read disable and 30-day read observation | Open | Depends on shell migration and write observation |
| Destructive cleanup | Forbidden | No route, asset, conversation, or storage data is deleted by this task |

## Scheduled census monitoring

- The production census workflow is scheduled daily at 02:17 UTC and remains
  manually dispatchable. Both entry paths serialize through a non-canceling,
  census-only concurrency group.
- Scheduled runs use exact `legacy.api.chat-post` and 30-day defaults. The strict
  content-free artifact is uploaded before an aggregate anomaly gate checks
  nonzero count, declared caller classes, and exact deployment-SHA agreement.
- Manual runs require exact main/deployment equality. Scheduled runs use full
  history to accept only current main or its deployed Git ancestor and require
  that production SHA to stay unchanged through collection. This prevents a
  later record-only main commit from causing a false stale-release failure.
- A gate failure preserves the artifact and exposes only bounded aggregate
  counts/status. It does not call `/api/chat`, deploy, mutate coordinator state,
  start an observation clock, or close rollback/read-disable/cleanup gates.
- PR [#67](https://github.com/Drew-Z/chatus-private-chat/pull/67) passed all four
  jobs in [run 31617086427](https://github.com/Drew-Z/chatus-private-chat/actions/runs/31617086427):
  path classification, full quality, Workspace Playwright, and isolated
  fake-Provider Agent Playwright. It squash-merged as exact main SHA
  `81ee52c65ff90504f6238aa6063493d677781605`.
- PR [#69](https://github.com/Drew-Z/chatus-private-chat/pull/69) passed all four
  jobs in [run 31619333414](https://github.com/Drew-Z/chatus-private-chat/actions/runs/31619333414)
  and squash-merged as exact main SHA
  `971cc53dbae0e856f55477435a0b289e8ee26111`. It closes the false stale-release
  failure caused by later record-only main commits without weakening ancestry or
  before/after deployment-stability checks.
- The first scheduled collection passed in [run
  31666803093](https://github.com/Drew-Z/chatus-private-chat/actions/runs/31666803093)
  from main SHA `ae2eeca86c3b759e221e7776d79beb33c4cf5892`. Its only retained artifact is
  `9168221653`, named
  `production-legacy-census-legacy.api.chat-post-48affb8c7f957e8afef168b0c2874810f77397ee`,
  with digest `sha256:ce421fbc200ed445c76b9774b6ea92b397092c48967110f59a9a8df6c881bcf9`
  and expiry `2026-11-11T04:22:16Z`.
- The existing strict aggregate evaluator independently validated that artifact
  as `surfaceId=legacy.api.chat-post`, `days=30`, `rowCount=0`, `totalCount=0`,
  `unknownCallerRows=0`, `deploymentMismatchRows=0`, and `status=clear`. No census
  row content was printed or copied into Trellis evidence.

## Local recovery and routing rehearsal

- The isolated restore drill uses the runtime-exported TeamAgent and UserState
  schema versions rather than fixture-owned schema labels. Its capture includes
  one non-empty transitional `chatus_conversations` row and restores it to the
  mapped isolated conversation Agent while the target remains writes-closed.
- The drill also parses the retained `legacy_surface_registry` entry and proves
  the exact `legacy.api.chat-post` atom remains enabled at its captured phase,
  with zero lost items, zero unresolved references, and an unchanged source
  digest. No production data, live Provider, or production restore is used.
- The route rehearsal simulates `write_disabled`, confirms the compatibility
  POST is rejected without another Provider call or net quota charge, invokes
  the real transactional `rollbackLegacySurface` RPC, verifies the projection
  returns to `shadowing`, and proves the same route can serve a later local
  fake-Provider POST. Read-disable is then checked independently.
- Both Worker tests capture the complete pre-test surface atom and restore it in
  `finally`. The control-plane census assertion also clears only its local daily
  rows before asserting an exact count, eliminating execution-order dependence.
- This evidence does not raise the manifest ceiling, disable production writes,
  begin either 30-day observation window, or satisfy the shell-read dependency.
- Static caller mapping, exact-SHA production census, and the completed stable
  principal/resource identity task now satisfy AC1 and AC3. This scheduled run
  remains monitoring evidence only: it does not rehearse rollback, disable
  writes, or start either observation window.
- Draft PR [#78](https://github.com/Drew-Z/chatus-private-chat/pull/78) passed
  path classification and the complete quality gate in [run
  31742332074](https://github.com/Drew-Z/chatus-private-chat/actions/runs/31742332074)
  on head `025822d352a64e5b4f3212efbf3e841612683cae`. Workspace and Agent
  Playwright were path-skipped after the retained local matrices passed 110 and
  3 tests respectively. The PR remains draft and unmerged; no production
  routing, deployment, disable control, or observation window changed.
