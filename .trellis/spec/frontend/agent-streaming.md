# Agent Streaming And Fallback

## Runtime Boundary

- `TeamAgent.onChatMessage()` is the owner of `streamText()` and returns `toUIMessageStreamResponse()` so Cloudflare AIChat persistence, reconnect, cancellation, and recovery remain active.
- The Worker preparation boundary validates the member, messages, blocked-prompt policy, route access, image support, quota, Skills, credentials, and route candidates before a model stream starts.
- Provider keys exist only while constructing server-side AI SDK model instances. They must not enter Agent state, UI messages, response metadata, logs, or run traces.
- The browser receives a server-derived Agent client key and `basePath: "agent"`;
  it supplies bounded `chatId` plus the server-projected stable `resourceId`, while
  the gateway resolves the authoritative conversation Agent route.
- The root Agent owns the authoritative long-term memory, conversation tombstones,
  and persisted transcript-cleanup queue. Owner turns may read root memory before
  preparation; shared editor turns must use empty memory and Workspace context.
- Legacy transcript import is idempotent and prefix-safe. A deleted ID or divergent Agent transcript is never overwritten by a rollback-client snapshot.

## Scenario: Per-conversation Client Isolation

### 1. Scope / Trigger

This contract applies whenever the React workspace connects `useAgent()` and `useAgentChat()` through the authenticated `basePath: "agent"` gateway and allows the member to switch between conversations.

### 2. Signatures

```typescript
conversationAgentClientName(resourceOrRootInstance: string, chatId: string): string

useAgent({
  name: conversationAgentClientName(
    conversation.resourceId || session.agent.instance,
    conversation.id,
  ),
  basePath: session.agent.basePath,
  query: { chatId: conversation.id, resourceId: conversation.resourceId },
})
```

### 3. Contracts

- The gateway treats the authenticated session plus exact stable resource/chat
  pair as the server-side routing input and re-resolves ACL authority. The browser
  cannot select a Durable Object instance or role.
- Every mounted conversation receives a stable, collision-free client name from
  the resource ID (or owner compatibility root) plus exact `chatId`. This isolates
  Agents React cache, reconnect state, and local messages across principals.
- `queryDeps` refreshes connection query data but does not make the query part of the AIChat client cache key. It is not a substitute for a conversation-specific client name.
- Switching conversations unmounts the old `ConversationChat` and mounts the new one with a distinct SDK identity. Messages, drafts, errors, tool continuations, and resumable-stream state must remain scoped to that conversation.

### 4. Validation & Error Matrix

- Same member and same `chatId` -> produce the same client name so reconnect and resume remain stable.
- Same member and different `chatId` -> produce different client names even when IDs contain separators or similar prefixes.
- Different resource ID and same `chatId` -> produce different client names.
- Missing or invalid `chatId` -> rejected by the existing gateway/API validation before a conversation transport is mounted.

### 5. Good / Base / Bad Cases

- Good: switch from conversation A to B; B hydrates only B's transcript, and sending in B cannot persist A's messages.
- Base: reconnect the same conversation after a transient disconnect; its stable client identity resumes only that conversation.
- Bad: pass the member root instance directly as every `useAgent.name`; AIChat gives all conversations one cache/`useChat` identity and stale messages can enter the newly selected conversation.

### 6. Tests Required

- Unit-test deterministic client names for same/different members and conversation IDs, including separator-containing IDs.
- Keep a structural frontend assertion that `useAgent.name` uses the conversation-specific helper while `query.chatId` remains present for gateway routing.
- Persist distinct synthetic messages into two conversation Agents owned by one member and assert each export contains only its own transcript.

### 7. Wrong vs Correct

#### Wrong

```typescript
useAgent({
  name: session.agent.instance,
  basePath: session.agent.basePath,
  query: { chatId: conversation.id },
});
```

#### Correct

```typescript
useAgent({
  name: conversationAgentClientName(
    conversation.resourceId || session.agent.instance,
    conversation.id,
  ),
  basePath: session.agent.basePath,
  query: { chatId: conversation.id, resourceId: conversation.resourceId },
});
```

## Scenario: Agent Identity Across Hibernation

### 1. Scope / Trigger

This contract applies whenever a root or conversation `TeamAgent` is created, reconnected, awakened from Durable Object hibernation, or upgraded from a version that did not persist its initialization props.

### 2. Signatures

```typescript
onStart(props?: TeamAgentProps): Promise<void>
ensureIdentity(props: TeamAgentProps): Promise<TeamAgentIdentityResult>
```

```text
chatus:agent-identity:v1 -> {
  version: 1,
  userLabel: string,
  scope: "root" | "conversation",
  chatId: string,
  rootInstance: string
}
```

### 3. Contracts

- Identity props are derived by the authenticated Worker gateway. The browser still supplies only a bounded `chatId` and cannot select a label, scope, or root instance.
- Identity is stored under the private Durable Object storage key above, never in Agent public state, UI messages, diagnostics, or logs.
- Complete first-start props are normalized and persisted. A hibernation wake with no props restores the stored record before scoped methods run.
- Every server-side `getAgentByName()` helper awaits the returned stub and calls `ensureIdentity(props)` before use. This repairs an already-started upgrade instance whose original props were transient and never persisted.
- A stored, active, or newly supplied identity must match exactly. Conflicting props return a stable error and never replace the original record.
- Expected `onChatMessage()` failures use a UI Message SSE `error` chunk. Returning an `application/json` body is forbidden because AIChat treats non-SSE bodies as assistant plaintext and persists the JSON in the transcript.

### 4. Validation & Error Matrix

- Missing storage and missing startup props -> remain unavailable; a chat turn returns `agent_identity_unavailable`.
- Incomplete root/conversation props -> `agent_identity_unavailable`; do not persist a partial record.
- Stored or active identity differs from supplied props -> `agent_identity_conflict`; preserve the original identity.
- Existing versioned storage is malformed -> `agent_identity_corrupt`; do not silently replace it.
- Structured chat failure -> SSE `errorText` contains the machine-readable error envelope; the React client renders an actionable error banner and restores the rejected draft.

### 5. Good / Base / Bad Cases

- Good: a conversation Agent is evicted, wakes through WebSocket or RPC without props, restores its private identity, and accepts the next scoped operation.
- Base: a normal gateway request initializes the Agent, then `ensureIdentity()` confirms the same identity without changing storage.
- Bad: identity exists only in class fields set by `onStart(props)`; hibernation calls `onStart(undefined)`, the connection still looks healthy, and the first message fails with HTTP `401`.

### 6. Tests Required

- Initialize both root and conversation Agents, evict them with `evictDurableObject()`, reconnect without props, and assert scoped RPCs still succeed.
- Start an Agent without props, call a scope-neutral method, then `ensureIdentity()`; evict and assert the persisted identity survives another no-props wake.
- Supply conflicting scope/identity props and assert `agent_identity_conflict` while the original scoped method still succeeds.
- Unit-test structured Agent error parsing so identity failures become a refresh action and raw JSON is never rendered as assistant text.

### 7. Wrong vs Correct

#### Wrong

```typescript
async onStart(props?: TeamAgentProps) {
  this.userLabel = props?.userLabel || "";
}

return new Response(JSON.stringify({ error, message }), {
  headers: { "Content-Type": "application/json" },
});
```

#### Correct

```typescript
async onStart(props?: TeamAgentProps) {
  await this.initializeIdentity(props); // persist first start or restore wake
}

const agent = await getAgentByName(env.TEAM_AGENT, instance, { props });
const identity = await agent.ensureIdentity(props);
if (!identity.ok) throw new Error(identity.error);
```

## Scenario: Secret-safe Agent Error Envelopes

### 1. Scope / Trigger

This contract applies to expected `TeamAgent.onChatMessage()` preflight failures and provider/tool failures emitted after `streamText()` has started.

### 2. Signatures

```typescript
type AgentErrorEnvelope = {
  error: AgentErrorCode;
  message: string;       // exact canonical message for error
  requestId?: string;    // normalized AIChat turn reference
};

normalizeAgentRequestId(value: unknown): string | undefined
serializeAgentErrorEnvelope(error: string, requestId?: string): string
parseAgentErrorEnvelope(value: string): AgentErrorEnvelope | undefined
projectAgentStreamError(error: unknown): AgentErrorCode
```

### 3. Contracts

- `src/contracts/agent-error.ts` is the single owner of the SSE error envelope, canonical member-facing messages, parser, and provider-error projection used by the Worker and typed client.
- The serialized envelope contains exactly `error`, canonical `message`, and optional `requestId`. It never includes a logical route/provider ID, credential reference, upstream response body, request body, raw exception message, or arbitrary extra field.
- The known-code registry is authoritative. Unknown or syntactically valid but unregistered codes normalize to `agent_error`; `conversation_not_found`, `workspace_context_unavailable`, and `agent_runtime_error` are registered actionable codes.
- `TeamAgent.onChatMessage()` normalizes `OnChatMessageOptions.requestId` as an 8-128 character URL-safe turn reference and falls back to a server UUID. It reuses that value in the SSE envelope, response header, structured failure log, and passive Provider reliability for that turn. It never substitutes the WebSocket handshake ID or persists the turn reference in messages, Agent state, prompts, or tool input.
- Workspace loading, turn preparation rejection/throw, continuation conversion, synchronous stream construction, asynchronous streaming, and root-index persistence failures use one phase-tagged failure boundary. Tool/capacity cleanup and stream-failure accounting remain idempotent.
- The server classifies internal exceptions by bounded structural evidence such as `name`, `code`, `statusCode`/`status`, and a bounded `cause` chain. Raw upstream text may help select a class but is never serialized.
- The client maps the machine-readable `error` code back through the canonical dictionary. It does not render the envelope `message` or a raw non-envelope SDK error directly; unknown or expanded payloads become the generic safe failure message.
- The parser rejects unknown fields, unknown codes, invalid request IDs, and non-canonical messages. For compatibility it may restore an omitted canonical `message`; every server serializer still emits the message.
- `user_api_key_required` must tell the current member to switch models or contact the administrator until a member BYOK editor exists. It must not direct the member to a settings control that is not implemented.
- Offline state remains authoritative over transport detail: a failure observed while `navigator.onLine` is false reports the preserved local draft and waits for network recovery.

### 4. Validation & Error Matrix

- `ProviderBusyError` -> `provider_busy`.
- `ProviderProtocolError` or `code: "provider_protocol_error"` -> `provider_protocol_error`.
- `TimeoutError`, HTTP `408`/`504`, or a timeout cause -> `upstream_timeout`.
- Non-timeout `AbortError` -> `request_cancelled`.
- HTTP `401`/`403` -> `upstream_authentication_failed`; HTTP `429` -> `upstream_rate_limited`.
- HTTP `400`/`404`/`409`/`422` -> `upstream_request_rejected`; HTTP `5xx` -> `upstream_unavailable`.
- Unknown provider failure -> `upstream_error`; invalid machine code -> `agent_error`.
- Missing canonical `message` -> parser restores it from the code; unknown fields, malformed JSON, invalid request ID, non-canonical message, or invalid code -> reject the envelope and show the generic safe message.

### 5. Good / Base / Bad Cases

- Good: an upstream `429` with a private response body produces `upstream_rate_limited`, and the member sees a retry/switch suggestion without the body or provider identity.
- Base: a preflight `no_routes_available` failure uses the same SSE serializer and produces the administrator-contact action.
- Bad: `onError: (error) => String(error)` exposes an upstream body, or the client falls back to displaying `chat.error.message` as raw JSON.

### 6. Tests Required

- Unit-test every provider class above, nested causes, invalid codes, valid/invalid request IDs, non-canonical messages, message-less envelopes, expanded envelopes, and generic fallback behavior.
- Assert structured client mappings for identity, unavailable routes, BYOK requirement, quota/concurrency, busy, timeout, rate-limit, authentication, protocol, and unavailable failures.
- Assert secret-like provider text and extra `providerId` fields never appear in the rendered fallback message.
- Assert one turn uses the same normalized request reference in SSE, `X-Request-ID`, structured logs, and passive route reliability, and that synchronous failure emits one phase-specific log entry.
- Keep the failed-turn retry branch and offline-first draft recovery behavior covered independently from error wording.

### 7. Wrong vs Correct

#### Wrong

```typescript
onError: (error) => error instanceof Error ? error.message : JSON.stringify(error)
```

#### Correct

```typescript
onError: (error) => serializeAgentErrorEnvelope(projectAgentStreamError(error))
```

## Scenario: Conversation Deletion Cleanup

### 1. Scope / Trigger

This contract applies whenever an Agent or legacy API deletes a conversation, or user deletion purges all Agent-owned data.

### 2. Signatures

```typescript
deleteConversation(chatId: string, expectedUpdatedAt: number): Promise<AgentConversationMutationResult>
listPendingConversationCleanups(limit?: number): Promise<AgentConversationCleanupRecord[]>
clearConversation(): Promise<void>
```

```sql
chatus_conversation_cleanup(
  chat_id TEXT PRIMARY KEY,
  requested_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  last_attempt_at INTEGER NOT NULL
)
```

### 3. Contracts

- The root tombstone and cleanup row are committed before the Worker calls the conversation Agent.
- Pending work is ordered by `last_attempt_at ASC, requested_at ASC` so unattempted records run before failed retries and persistent failures cannot starve newer deletions.
- A successful conversation cleanup deletes AIChat messages, resumable stream data, request context, tool-run persistence, and capability trust before the root cleanup row is removed.
- The AIChat SDK version is pinned because cleanup currently names its persisted SQLite tables directly.

### 4. Validation & Error Matrix

- Missing or stale `expectedUpdatedAt` -> reject before deleting either legacy or Agent state.
- Existing tombstone -> `conversation_deleted`; reconnect and explicit recreation return HTTP `410`.
- Conversation Agent cleanup failure -> keep the cleanup row, increment `attempts`, update `last_attempt_at`, and retry from a later bounded drain.
- Cleanup success -> remove the cleanup row; the tombstone remains authoritative.

### 5. Good / Base / Bad Cases

- Good: three old cleanup attempts fail, then an unattempted fourth record is selected on the next drain.
- Base: deletion clears the transcript immediately and returns without a pending cleanup.
- Bad: always selecting `ORDER BY requested_at` lets three permanently failing records block every later transcript deletion.

### 6. Tests Required

- Seed a non-empty conversation transcript, delete it, drain cleanup, and assert both zero messages and an empty cleanup queue.
- Queue at least four deletions, mark the first batch failed, and assert the next batch begins with an unattempted record.
- Assert stale reconnect, explicit recreation, and legacy PUT cannot revive a tombstoned ID.

### 7. Wrong vs Correct

#### Wrong

```typescript
await this.persistMessages([]);
```

`persistMessages` reconciles with the current transcript and does not express destructive deletion.

#### Correct

```typescript
this.resetTurnState();
this.sql`DELETE FROM cf_ai_chat_agent_messages`;
this.sql`DELETE FROM cf_ai_chat_stream_chunks`;
this.messages = [];
```

## Capability Registry Boundary

- Capability contracts live under `src/contracts/capability.ts`; Worker, Agent, services, and tests import these types instead of defining local variants.
- `src/services/capability-registry.ts` is the single owner of member `allowedTools`, selected Skill `toolIds`, enabled state, executor/MCP availability, public capability projection, normalized approval policy, and deterministic provider tool names.
- Transitional legacy capability execution and the Agent runtime must consume the same registry service until the old protocol is removed. Do not duplicate filtering or approval defaults inside either handler.
- Provider-facing tool names are derived from the configured executor name plus a fingerprint of the internal tool ID. Internal IDs and raw schemas remain server-side.

## Scenario: Agent Capability Tool Execution

### 1. Scope / Trigger

This contract applies when an assigned Skill references a built-in or reviewed MCP tool and the turn is executed through `TeamAgent.onChatMessage()`.

### 2. Signatures

```typescript
createAgentToolSet({
  definitions,
  conversationId,
  runTool,
  approvals,
}): ToolSet

runTool(
  definition: NormalizedToolDefinition,
  input: unknown,
  signal?: AbortSignal,
): Promise<CapabilityToolExecutionResult>
```

### 3. Contracts

- Only definitions returned by `capability-registry` may become AI SDK tools.
- `auto` tools execute immediately; `first-per-conversation` tools require approval until a successful execution is recorded for the same `(conversationId, toolId)`; `always` tools require approval every time.
- Agent continuation requests use `convertToModelMessages(this.messages, { tools })` so tool calls and approval responses survive the second model call.
- Continuations do not consume another message quota unit. A new user turn does.
- Tool execution is bounded by 4 model steps, 8 calls, 15 seconds per call, 45 seconds of cumulative execution time, and 32 KiB of serialized result data.
- Shared editor/viewer access never constructs this tool set. Every ACL revision
  clears conversation trust, and deny/revoke paths must produce zero remote calls.

### 4. Validation & Error Matrix

- Unassigned or changed definition -> `tool_not_found`.
- Invalid input schema arguments -> `tool_arguments_invalid`.
- Call count or cumulative budget exceeded -> `tool_call_limit_exceeded` / `tool_budget_exceeded`.
- Closed runtime or cancelled signal -> non-secret tool execution error; no fallback is attempted for the tool itself.
- Approval denial -> AI SDK emits `output-denied`; the tool is not executed and is not trusted.

### 5. Good / Base / Bad Cases

- Good: first MCP call produces an approval request, approval continuation restores the tool call, executes it, and records trust only after success.
- Base: a built-in `auto` tool executes inside the same `streamText` run and its bounded result is sent to the model.
- Bad: the Agent converts its UI history through the legacy text-only adapter during continuation and silently drops the tool approval response.

### 6. Tests Required

- Assert AI SDK tool-call SSE performs a local built-in tool and sends a second provider request with the result.
- Assert approval-required tools transition from required to trusted only after execution.
- Assert `convertToModelMessages` preserves tool-call, approval-request, and approval-response parts.
- Assert continuation preparation does not increment daily/minute quota.
- Assert shared editor/viewer turns construct no tool definitions or memory tool,
  ACL revision invalidation clears trust, and deny/revoke produces zero fake-MCP calls.
- Assert no test contacts a real model or MCP server.

### 7. Wrong vs Correct

#### Wrong

```typescript
messages: toLegacyMessages(this.messages)
```

#### Correct

```typescript
messages: await convertToModelMessages(this.messages, { tools })
```

## Fallback Contract

- AI SDK provider retries are disabled with `maxRetries: 0`; Chatus owns retries across offerings and fallback logical routes plus their telemetry.
- Automatic Skill selection is a pre-turn non-streaming auxiliary call. It may fall back between offerings of the selected logical route, but it must never enter the main answer's logical-route fallback chain.
- The selector's hard five-second boundary starts before plan preparation and returns the validated snapshot/admin fallback even when plan, lease, Provider, telemetry, or release work ignores abort. If an attempt has started, the boundary appends `timed_out/upstream_timeout` directly; a late completion cannot update the conversation snapshot. The selector rechecks abort after delayed plan and ledger-start dependencies.
- TeamAgent schema v7 stores the current server-issued Provider `turnId`. A new admitted message replaces it; an approval/tool continuation reuses it after hibernation. Automatic Skill, main answer, and every continuation have distinct run IDs, while fallback attempts inside one run share that run.
- A provider offering or logical route may fall back only before user-visible output begins. Provider metadata, response metadata, empty text starts, and raw chunks may be buffered and discarded.
- Text/reasoning deltas, sources/files, tool input/calls/results, or approval events commit the selected offering. Errors after commitment are surfaced and recorded; another provider or logical route must not continue the same answer.
- User cancellation never triggers fallback.
- HTTP `400`/`422` and BYOK `401`/`403` are terminal. Retryable upstream, timeout, protocol-before-output, and network failures may advance to an allowed configured fallback.
- Preserve candidates by exact `(logicalRouteId, providerId)` pair. The same provider may appear again for a different logical fallback model because a failure can be model-specific; do not globally deduplicate the fallback plan by provider ID.

## Scenario: Ephemeral Provider turn progress

### 1. Scope / Trigger

Use this contract when changing the custom pre-visible Provider progress frame,
its TeamAgent WebSocket broadcast, the typed browser decoder, or the waiting row
shown before the first visible AI SDK output.

### 2. Signatures

```typescript
type ProviderTurnProgressV1 = {
  type: "chatus_provider_turn_progress";
  version: 1;
  requestId: string;
  sequence: number;
  phase: "planning" | "waiting_capacity" | "attempting" | "fallback";
  attempt: number;
  candidateCount: number;
  startedAt: number;
  deadlineAt: number;
};

decodeProviderTurnProgressV1(value: unknown): ProviderTurnProgressV1 | undefined
decodeProviderTurnProgressMessage(data: unknown): ProviderTurnProgressV1 | undefined
selectNewestProviderTurnProgress(current, next, localTurnStartedAt): ProviderTurnProgressV1 | null
providerTurnProgressText(progress, now): string
```

### 3. Contracts

- `src/contracts/provider-turn-progress.ts` is the single owner of the versioned
  frame, phase registry, exact decoder, 90-second duration constant, and bounded
  candidate-count limit.
- The decoder accepts exactly the nine declared keys. Request IDs use the shared
  Agent request normalizer; sequence is a positive safe integer; counts and
  timestamps are non-negative safe integers; `deadlineAt - startedAt` must equal
  90 seconds.
- `planning` requires attempt/count `0/0`; `waiting_capacity` requires attempt
  zero and at least one candidate; `attempting` uses `1..candidateCount`; and
  `fallback` uses `2..candidateCount`.
- TeamAgent broadcasts `JSON.stringify(frame)` through the existing conversation
  Agent connection. Broadcast failure is swallowed. The frame is not a UIMessage
  part or stream chunk and must not enter Agent SQLite, transcript export,
  localStorage, prompts, logs, or Provider attempt evidence.
- The frame contains no Provider ID, logical route, model, endpoint, credential,
  error, prompt, completion, tool payload, member label, or conversation content.
- React observes raw Agent messages in addition to `useAgentChat()`. While the
  local turn waits for first output it keeps only the newest server timestamp and
  sequence, rejects frames older than the current local send boundary, and never
  lets a stale sequence replace current progress.
- Progress clears when first visible output arrives, the turn becomes idle or
  failed, the member cancels, the connection is not ready, the conversation
  unmounts, or the Agent changes. Missing/reconnect-lost frames fall back to the
  existing generic preparation/waiting text.
- Remaining seconds are presentation-only and clamp to `0..90` so browser/server
  clock skew cannot produce a negative or expanded deadline. The text is neutral
  and may show only attempt ordinal/count plus the bounded time.
- The waiting row remains a polite live status, wraps within the chat column, and
  preserves desktop and touch-width containment.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Non-string Agent message or malformed JSON | Ignore without changing chat state |
| Unknown key/type/version/phase or malformed request ID/count/timestamp | Reject the whole frame |
| Planning/capacity/attempt/fallback ordinal contradicts its phase | Reject the whole frame |
| Same request ID with stale sequence or timestamp | Keep current progress |
| Different request ID with an older server start | Keep current progress |
| Frame predates the active local send boundary | Ignore it |
| Progress frame is missed during reconnect | Show generic waiting state; AIChat recovery continues |
| Browser clock is before/after the server clock | Render a remaining value clamped to `0..90` |
| Broadcast callback throws | Provider routing and result remain unchanged |
| First output, error, cancellation, disconnect, or unmount | Clear progress and stop its one-second display timer |

### 5. Good / Base / Bad Cases

- Good: the member sees planning, `1/3`, then backup `2/3`; first output removes
  the row and no frame appears in localStorage or the transcript.
- Base: no custom frame arrives, so the existing generic “preparing/waiting for
  first output” state remains accurate.
- Bad: encode Provider/model names or raw exceptions in the frame, persist it as
  a UIMessage, or accept unknown fields for forward compatibility.
- Bad: let an old request's late frame replace the active request or leave a
  countdown interval running after the turn settles.

### 6. Tests Required

- Unit-test exact decoding, every phase/count invariant, request-ID validation,
  unknown-key rejection, altered deadline duration, malformed JSON, stale
  sequence/timestamp handling, and clamped presentation text.
- TeamAgent tests assert the frame reuses the same normalized request reference
  as passive reliability and broadcast callback failure cannot alter success.
- Workspace Playwright tests cover generic and evidence-backed waiting text,
  clearing on first output, desktop and touch-enabled 390px containment, and no
  Provider/model/endpoint leakage.
- Local fake-Provider Agent Playwright acceptance must observe a real raw
  broadcast, render the expected ordinal/time, clear it after first output, and
  assert no localStorage value contains the protocol type.
- All tests use local fake Provider/Agent inputs. Never contact a live model or
  add a synthetic production probe for progress.

### 7. Wrong vs Correct

#### Wrong

```typescript
setStatus(JSON.parse(event.data).message);
localStorage.setItem("provider-progress", event.data);
```

This trusts unversioned Provider-controlled text and persists an ephemeral
transport frame in browser state.

#### Correct

```typescript
const next = decodeProviderTurnProgressMessage(event.data);
if (!next) return;
setProviderProgress((current) =>
  selectNewestProviderTurnProgress(current, next, localTurnStartedAtRef.current));
```

The exact shared decoder and monotonic selector keep progress secret-free,
request-scoped, and ephemeral without changing AIChat persistence.

## Scenario: Turn Admission, Provider Capacity, And Reliability Authority

### 1. Scope / Trigger

Use this contract when changing Agent admission, Automatic Skill selection, Provider capacity, passive route quality, first-visible stream telemetry, or the `ProviderCoordinator` storage boundary.

### 2. Signatures

```typescript
admitOnce(): Promise<TurnAdmission>
ProviderCoordinator.recordReliabilitySample({ operation: "chat" | "skill_selection", sample })
createProviderFirstVisibleDeadline(parentSignal?): { signal, commit, dispose }
```

```text
ProviderCoordinator instance = providerId
reliability:chat:<encoded routeId>                 # authoritative DO record
reliability:skill_selection:<encoded routeId>      # authoritative DO record
route-provider-reliability:<routeId>:<providerId>  # KV projection and migration seed
route-provider-skill-selection:<routeId>:<providerId> # KV projection and migration seed
```

### 3. Contracts

- Capacity is provider-scoped across every offered model and every teammate. `exclusive` has capacity one, `bounded` uses `maxConcurrent`, and `unlimited` bypasses lease acquisition.
- Member turn concurrency intentionally remains unlimited. Daily/minute message buckets own member fairness, the existing guest lease prevents duplicate guest turns, and Provider leases own upstream capacity. Do not add a member lease, configuration field, or silent limit without measured saturation and an explicit product limit.
- Try ordered candidates without waiting first. The all-busy wait uses one shared deadline of at most 10 seconds; during one selection round enqueue at most one waiter per Provider, and repeated acquisition for the same request ID reuses the original waiter.
- Hold a streaming lease until success, upstream failure, cancellation, or client disconnect. On restart, normalize leases and schedule the earliest surviving expiry.
- Quota is consumed once per admitted user message, not per selector, fallback attempt, or continuation. An eligible Automatic turn calls `admitOnce()` before selector Provider work and reuses that admission for the main answer. A pre-aborted turn consumes nothing; parent cancellation during selection releases capacity and prevents main-model preparation.
- Provider attempt evidence is separate from `ProviderCoordinator` reliability. The provider-sharded `ProviderAttemptLedger` records every exact server-selected call, while reliability remains a bounded rebuildable aggregate used only for passive quality. Ledger start is required before Provider I/O and does not change the one-message quota rule.
- Every shared chat reliability call explicitly supplies `usedUserKey`. Any BYOK success or failure class is excluded from both `route-reliability:` and exact route/provider quality. Selector attempts remain allowed only in the separate redacted `skill_selection` telemetry keyspace.
- `ProviderCoordinator`, addressed by `providerId`, is the single writer for bounded chat and selector aggregates. Durable Object storage is authoritative; existing KV records seed only the first missing DO record and remain read-compatible projections for the route planner and admin API. A KV mirror failure never rolls back the DO aggregate or changes chat behavior.
- Provider aggregate records retain at most 1,000 samples and satisfy `progressiveSamples <= streamSamples <= successes <= attempts`. Administrator priority remains authoritative; recent passive quality breaks equal-priority ties only, and active probes are forbidden.
- A shared 60-second boundary starts immediately before each streaming Provider request and covers construction plus pre-visible reads. Text/reasoning/tool/source/file/approval parts commit Agent fallback; legacy SSE commits on non-empty text. Commitment clears the deadline timer but preserves parent cancellation and never ends an otherwise valid long stream.
- After commitment, downstream cancellation is authoritative over any internal `reader.read()` prefetch already in flight. A cancel request cancels the upstream reader and settles cancellation exactly once; a resulting EOF/rejection must not be reclassified as a missing-finish protocol failure, record failure telemetry, or start fallback.
- There is no post-visible idle/no-byte deadline. A Provider that emits one visible part and then stalls can retain request, admission, and Provider lease resources until client/request cancellation. Changing this requires an explicit partial-response UX, stream-error projection, and coordinated cleanup contract.
- `firstVisibleLatencyMs` still measures only the first non-empty text/reasoning delta. Telemetry forwards stream parts unchanged and never records prompts, completions, tool payloads, raw chunks, Provider bodies, credentials, or member identifiers.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Automatic quota exhausted | Stable quota error and zero selector/main Provider requests |
| Parent cancelled before admission | `request_cancelled`, no charge, no Provider request |
| Parent cancelled during selector | Abort selector, release lease, no fallback or main model |
| BYOK success, auth, rate-limit, server, timeout, protocol, or network sample | No shared logical or exact quality mutation |
| Concurrent samples for one Provider/route | Preserve every input in the bounded DO aggregate and KV projection |
| DO record exists but KV projection differs | Continue from DO authority and repair the projection on the next sample |
| KV projection write fails | Keep the authoritative DO sample; log only bounded IDs and continue chat |
| No visible output for 60 seconds | Abort upstream and allow only existing pre-output fallback |
| Parent cancellation before visible output | Abort without fallback |
| Visible output then stream exceeds 60 seconds | Continue; the first-visible timer is cleared |
| Downstream cancel races a committed reader prefetch | Cancel/settle once; no protocol failure, failure telemetry, or fallback |
| Visible output then permanent idle | Continue until downstream/request cancellation; retain as an explicit capacity risk |

### 5. Good/Base/Bad Cases

- Good: one Automatic user message is admitted before selector I/O, uses one of several Provider offerings, streams an answer, and consumes exactly one quota unit.
- Good: two concurrent chat samples reach one ProviderCoordinator, both survive eviction, and a stale KV projection cannot replace the DO aggregate.
- Base: a valid legacy KV aggregate seeds an empty DO record once, after which all mutations use DO state while readers keep the same KV key.
- Good: a member cancels immediately after visible output while the adapter is prefetching; cancellation wins and no false Provider failure is recorded.
- Bad: read-modify-write aggregate counters directly in KV, let any BYOK outcome influence shared ordering, leave a first-visible timer active after commitment, or silently reject parallel member conversations.
- Bad: interpret EOF caused by `reader.cancel()` as “stream ended without finish” and penalize the Provider after the member already cancelled.

### 6. Tests Required

- Unit-test pre-output fallback, post-output route locking, terminal failure classes, parent cancellation, the 60-second first-visible boundary, and telemetry callback isolation with fake Providers only.
- Regression-test committed-stream cancellation while an internal read is pending. Assert upstream cancel and cancellation settlement are each idempotent, visible output remains delivered, failure telemetry stays zero, and fallback is never attempted.
- Team Agent tests prove exhausted Automatic quota creates zero selector/main calls, one admission covers selector plus answer, continuations are free, pre-admission cancellation is free, and selector cancellation releases the lease with zero main calls.
- Team Agent tests also prove Automatic Skill timeout records a terminal timed-out attempt, fallback attempts share a run, continuations create a new run under the persisted turn, and required ledger-start failure creates zero Provider requests.
- Parameterize every BYOK success/failure class and assert both shared logical and exact route/provider records remain byte-for-byte unchanged while selector telemetry still records a redacted attempt.
- Concurrently write two chat and two selector samples to one Provider/route, evict the Durable Object, and assert exact attempts, successes, fallback, latency/shape invariants, and DO authority over a changed KV projection.
- Seed malformed and valid legacy aggregates separately; invalid data fails closed, valid v2 chat/v1 selector data seeds once, and telemetry or mirror failure cannot fail chat.
- Integration-test `prepareTeamAgentTurn -> streamText -> UIMessageStream`; gate progressive fake output rather than reading only the final concatenated body. No test may contact a live model or MCP server.
- Keep `chatRecovery` configured as a class field, never inside `onStart()`.

### 7. Wrong vs Correct

#### Wrong

```typescript
await runAutomaticSkillSelector(input);
const admission = await admitTurn();
const previous = await kv.get(key);
await kv.put(key, JSON.stringify(reduce(previous, sample)));
```

#### Correct

```typescript
const admission = await admitOnce();
if (!admission.ok) return rejectAdmission(admission);
await runAutomaticSkillSelector(input);
await env.PROVIDER_COORDINATOR.getByName(providerId)
  .recordReliabilitySample({ operation: "chat", sample });
```

Admission precedes auxiliary Provider work and is reused by the answer; one provider-scoped Durable Object serializes every aggregate mutation while KV remains a compatibility projection.

For a committed cancellation race:

#### Wrong

```typescript
const next = await reader.read();
if (next.done) await settleFailure(providerProtocolError("missing finish"));
```

#### Correct

```typescript
const next = await reader.read();
if (next.done && cancellationRequested) return settleCancelled();
if (next.done) return settleFailure(providerProtocolError("missing finish"));
```

Check cancellation intent again after the pending read settles; cancellation is a consumer lifecycle event, not Provider reliability evidence.

## Scenario: Durable Message Branches And Safe Truncation Metadata

### 1. Scope / Trigger

This contract applies when a member edits, resends, regenerates, continues, or explicitly branches a message, or when a legacy transcript is imported into an AIChat conversation.

### 2. Signatures

```text
POST /api/agent/conversations/:chatId/branches
{
  requestId: string,
  action: "branch" | "edit" | "resend" | "regenerate" | "continue",
  sourceMessageId: string,
  expectedUpdatedAt: number,
  editedText?: string
}
```

```typescript
TeamAgent.copyConversationBranchTo(input): Promise<AgentConversationBranchCopyResult>
TeamAgent.startConversationBranch(input): Promise<AgentConversationBranchStartResult>
```

### 3. Contracts

- The Worker authenticates the source conversation, checks the source version and action/role compatibility, then copies a bounded sanitized prefix into a new conversation with `parentChatId`.
- `requestId` is idempotent for the same request fingerprint. A different payload using an existing request ID returns `branch_request_conflict`; the source transcript is never overwritten.
- The destination re-validates the current route and Skill assignment. Revoked settings are repaired to the member's allowed default rather than copied blindly.
- `branch` completes without a model call. `edit`, `resend`, `regenerate`, and `continue` launch a new branch turn and cannot fall back after visible output.
- The Worker generates action-specific branch titles, strips any existing generated suffix from the source title, and keeps the result bounded. The first-release suffixes are `分支`, `编辑分支`, `重发分支`, `重生成分支`, and `续写分支`.
- The React workspace header shows a compact parent-origin hint when `parentChatId` is present. If the parent conversation is loaded, the hint is an accessible return action; if it is missing or deleted, the hint is static and must not fetch or resurrect the parent. The conversation sidebar remains a flat list in this release.
- Agent message persistence has an explicit metadata allow-list: only `{ finishReason: "length" }` may be stored. Provider metadata, credentials, trace objects, and all other finish reasons are removed before SQLite persistence.
- Legacy assistant `finishReason: "max_tokens"` is normalized to the same safe `finishReason: "length"` marker so a refreshed client can offer Continue without retaining upstream metadata.

### 4. Validation & Error Matrix

- Missing/invalid request ID, message ID, action, or version -> `400 invalid_branch_request`.
- Stale source version -> `409 conversation_conflict` with the current secret-free conversation projection.
- Existing request ID with a different fingerprint -> `409 branch_request_conflict`.
- Source message role does not support the action -> `409 branch_action_not_allowed`.
- Source conversation is deleted -> `410 conversation_deleted`; tombstones remain authoritative.
- A busy source or divergent destination -> `409 conversation_busy` / `409 branch_copy_conflict`; do not partially replace either transcript.

### 5. Good / Base / Bad Cases

- Good: retrying the same branch request returns the original destination, and the source still contains its complete transcript.
- Base: a legacy truncated assistant message reloads with one safe `finishReason` marker and exposes Continue only when a route is available.
- Bad: copying the entire UI message metadata object stores provider IDs or a credential reference, or a client-only `setMessages` edit silently destroys the source history.

### 6. Tests Required

- Assert branch/edit/resend/regenerate/continue preserve the source, set `parentChatId`, revalidate settings, and are idempotent by request fingerprint.
- Assert action-specific branch titles are bounded, strip existing generated suffixes, and remain stable across idempotent retries.
- Assert parent-origin header states for parent-present and parent-missing conversations on desktop and touch layouts without horizontal overflow.
- Assert stale versions, deleted tombstones, incompatible roles, busy sources, and divergent destinations return stable errors without cleanup leaks.
- Inspect persisted `cf_ai_chat_agent_messages` rows and assert only `{ finishReason: "length" }` survives; assert legacy `max_tokens` maps to that marker and no other metadata or secret-like field survives.
- Run browser acceptance at desktop and 390px widths with visible action bars and a conditional Continue control; use local fake/placeholder providers only.

### 7. Wrong vs Correct

#### Wrong

```typescript
await destination.importLegacyMessages(source.messages);
// source messages and arbitrary UI metadata are copied without a request fence
```

#### Correct

```typescript
const operation = await root.reserveConversationBranch({
  requestId,
  fingerprint,
  sourceId,
  sourceMessageId,
  expectedUpdatedAt,
  action,
  // bounded prefix and sanitized metadata are copied by the Agent
});
```
