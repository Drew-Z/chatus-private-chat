# Agent Streaming And Fallback

## Runtime Boundary

- `TeamAgent.onChatMessage()` is the owner of `streamText()` and returns `toUIMessageStreamResponse()` so Cloudflare AIChat persistence, reconnect, cancellation, and recovery remain active.
- The Worker preparation boundary validates the member, messages, blocked-prompt policy, route access, image support, quota, Skills, credentials, and route candidates before a model stream starts.
- Provider keys exist only while constructing server-side AI SDK model instances. They must not enter Agent state, UI messages, response metadata, logs, or run traces.
- The browser receives a server-derived root Agent instance and `basePath: "agent"`; it supplies only a bounded `chatId`, while the gateway derives the conversation Agent instance.
- The root Agent owns the authoritative long-term memory, conversation tombstones, and persisted transcript-cleanup queue. Conversation Agents read root memory before turn preparation.
- Legacy transcript import is idempotent and prefix-safe. A deleted ID or divergent Agent transcript is never overwritten by a rollback-client snapshot.

## Scenario: Per-conversation Client Isolation

### 1. Scope / Trigger

This contract applies whenever the React workspace connects `useAgent()` and `useAgentChat()` through the authenticated `basePath: "agent"` gateway and allows the member to switch between conversations.

### 2. Signatures

```typescript
conversationAgentClientName(rootInstance: string, chatId: string): string

useAgent({
  name: conversationAgentClientName(session.agent.instance, conversation.id),
  basePath: session.agent.basePath,
  query: { chatId: conversation.id },
})
```

### 3. Contracts

- The gateway still treats the authenticated session plus bounded `chatId` query as the only server-side routing authority; the browser cannot select the Durable Object instance.
- Every mounted conversation must also receive a stable, collision-free client name derived from the authenticated root instance and exact `chatId`. This name isolates the Agents React `agent.path`, AIChat initial-message cache, `useChat` ID, reconnect state, and local message list.
- `queryDeps` refreshes connection query data but does not make the query part of the AIChat client cache key. It is not a substitute for a conversation-specific client name.
- Switching conversations unmounts the old `ConversationChat` and mounts the new one with a distinct SDK identity. Messages, drafts, errors, tool continuations, and resumable-stream state must remain scoped to that conversation.

### 4. Validation & Error Matrix

- Same member and same `chatId` -> produce the same client name so reconnect and resume remain stable.
- Same member and different `chatId` -> produce different client names even when IDs contain separators or similar prefixes.
- Different member root instance and same `chatId` -> produce different client names.
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
  name: conversationAgentClientName(session.agent.instance, conversation.id),
  basePath: session.agent.basePath,
  query: { chatId: conversation.id },
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
- A provider offering or logical route may fall back only before user-visible output begins. Provider metadata, response metadata, empty text starts, and raw chunks may be buffered and discarded.
- Text/reasoning deltas, sources/files, tool input/calls/results, or approval events commit the selected offering. Errors after commitment are surfaced and recorded; another provider or logical route must not continue the same answer.
- User cancellation never triggers fallback.
- HTTP `400`/`422` and BYOK `401`/`403` are terminal. Retryable upstream, timeout, protocol-before-output, and network failures may advance to an allowed configured fallback.
- Preserve candidates by exact `(logicalRouteId, providerId)` pair. The same provider may appear again for a different logical fallback model because a failure can be model-specific; do not globally deduplicate the fallback plan by provider ID.

## Provider Capacity Contract

- Capacity is provider-scoped across every offered model and every teammate. `exclusive` has capacity one, `bounded` uses `maxConcurrent`, and `unlimited` bypasses lease acquisition.
- Try ordered candidates without waiting first. Skip an occupied provider while another eligible candidate is immediately available; wait only when every eligible candidate is occupied.
- The all-busy wait uses one shared deadline of at most 10 seconds. The first granted lease wins and losing waits are cancelled; timeout returns the stable busy response.
- During one availability-selection round, enqueue at most one waiter per provider even when later logical fallbacks reuse that provider. After a failed attempt releases its lease, a later model on the same provider may enter a new selection round.
- A repeated acquisition for the same request ID while queued shares the original waiter promise; it must never create a second lease.
- Hold a streaming lease until success, upstream failure, cancellation, or client disconnect. Lease TTL and coordinator alarms recover abandoned capacity without interrupting an active request.
- On Durable Object restart, discard malformed and expired lease records, keep at most one lease per token and request ID, retain the longest valid duplicate, rewrite normalized storage, and schedule the alarm for the earliest surviving expiry.

## Reliability And Quota

- Quota is consumed once during turn preparation, not once per fallback attempt.
- Every real offering attempt records redacted passive reliability keyed by the exact `(logicalRouteId, providerId)` pair. BYOK authentication failures do not overwrite shared provider quality.
- Administrator priority is authoritative. Passive real-task success rate and latency order only offerings at the same priority; no active probe may influence this ordering.
- A successful logical-route fallback records the selected route as `fallback: true`; exhausted or post-output failures also record the overall request failure.
- Telemetry callbacks are best effort and must never alter stream success or failure.

### First-visible Latency And Stream Shape

- Observe provider delivery at the `LanguageModelV3` committed-stream boundary before UI-message transformation. Forward every provider part unchanged; telemetry must not split, merge, delay, or fabricate deltas.
- First-visible latency is the bounded elapsed time from provider-attempt start to the first non-empty `text-delta` or `reasoning-delta`. Metadata-only, source, file, tool, and approval events still commit fallback selection but do not become text-stream samples.
- A successfully finished text stream with one visible text/reasoning delta is `single_chunk`; two or more are `progressive`. Cancellation and any failure, including a post-output failure, never increment successful stream-shape samples.
- Per `(logicalRouteId, providerId)` version-2 records retain at most 1,000 bounded samples plus average/latest first-visible latency, latest shape, and progressive sample count. Stored and projected aggregates must satisfy `progressiveSamples <= streamSamples <= successes <= attempts`; when the bounded success history shrinks after a failure, stream counters shrink proportionally so the writer cannot create a record that its own reader rejects. Version-1 development records are invalidated and deleted on read rather than migrated.
- The admin API and exact client decoder expose counts, timing, and the two shape literals only. They must never expose prompts, completions, tool payloads, raw chunks, provider response metadata, or credentials.
- A single-chunk result means the upstream exposed one visible delta; the client must keep the truthful waiting state and render that delta normally instead of simulating token streaming.

## Required Tests

- Unit-test pre-output fallback, post-output route locking, terminal failure classes, cancellation, and telemetry callback isolation.
- Assert a retryable failure may advance to a different logical model on the same provider, while one lease-selection round still creates at most one candidate per provider.
- Test lease/error lifecycle directly in the Worker isolate. Do not pass an intentionally errored response body across the workerd RPC boundary merely to assert rejection; workerd reports that expected stream failure as an uncaught isolate warning even when the host assertion catches it.
- Integration-test `prepareTeamAgentTurn -> streamText -> UIMessageStream` with local fake provider responses; no test may contact a model channel.
- For progressive acceptance, gate the fake provider stream: release one visible delta, assert the downstream UI-message reader consumes it, then release the later delta and finish. Reading only the final concatenated body does not prove incremental delivery.
- Seed an impossible aggregate with `streamSamples > successes` and assert both the storage normalizer and exact client decoder reject it; at the 1,000-sample cap, add a failure and assert stream counters remain within the reduced success count.
- Seed malformed, expired, and duplicate persisted leases, evict the coordinator, and assert normalized capacity, storage, idempotent request recovery, and the earliest alarm.
- Pass the Agent request abort signal through to `streamText`.
- Keep `chatRecovery` configured as a class field, never inside `onStart()`.

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
