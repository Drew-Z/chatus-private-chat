# Legacy API chat POST evidence handoff

This is a pre-merge evidence handoff for `legacy.api.chat-post`. It records
the caller and identity boundaries that are proven by source review and local
fake-Provider tests. It does not claim a production census, a rollback
rehearsal, or completion of either observation window.

## Review identity

- Review head: `9dd30b6bfcf5e96b7f78e56d475f2f77cb9bdd4f`
- Surface manifest: `legacy.api.chat-post`, manifest version `2`, owner `data`
- Caller classes in the code-owned manifest: `browser`, `test`, `worker_api`
- Production deployment SHA: not assigned on this pre-merge branch

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

## Gate status

| Gate | Status | Why |
| --- | --- | --- |
| Static caller map and parity contract | Prepared | Source and local fake-runtime evidence above |
| Production exact-SHA caller census | Open | Requires the merged-main deployment and observation evidence |
| Routing rollback rehearsal | Open | Requires the deployed control-plane operation and retained rollback evidence |
| 30-day write observation | Open | The API ceiling remains `instrumented` |
| Read disable and 30-day read observation | Open | Depends on shell migration and write observation |
| Destructive cleanup | Forbidden | No route, asset, conversation, or storage data is deleted by this task |
