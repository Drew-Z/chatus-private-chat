# Agent Streaming And Fallback

## Runtime Boundary

- `TeamAgent.onChatMessage()` is the owner of `streamText()` and returns `toUIMessageStreamResponse()` so Cloudflare AIChat persistence, reconnect, cancellation, and recovery remain active.
- The Worker preparation boundary validates the member, messages, blocked-prompt policy, route access, image support, quota, Skills, credentials, and route candidates before a model stream starts.
- Provider keys exist only while constructing server-side AI SDK model instances. They must not enter Agent state, UI messages, response metadata, logs, or run traces.

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

- AI SDK provider retries are disabled with `maxRetries: 0`; Chatus owns cross-route retry and telemetry.
- A route may fall back only before user-visible output begins. Provider metadata, response metadata, empty text starts, and raw chunks may be buffered and discarded.
- Text/reasoning deltas, sources/files, tool input/calls/results, or approval events commit the route. Errors after commitment are surfaced and recorded; another route must not continue the same answer.
- User cancellation never triggers fallback.
- HTTP `400`/`422` and BYOK `401`/`403` are terminal. Retryable upstream, timeout, protocol-before-output, and network failures may advance to an allowed configured fallback.

## Reliability And Quota

- Quota is consumed once during turn preparation, not once per fallback attempt.
- Every real route attempt records redacted passive reliability. BYOK authentication failures do not overwrite shared route reliability.
- A successful fallback records the selected route as `fallback: true`; exhausted or post-output failures also record the overall request failure.
- Telemetry callbacks are best effort and must never alter stream success or failure.

## Required Tests

- Unit-test pre-output fallback, post-output route locking, terminal failure classes, cancellation, and telemetry callback isolation.
- Integration-test `prepareTeamAgentTurn -> streamText -> UIMessageStream` with local fake provider responses; no test may contact a model channel.
- Pass the Agent request abort signal through to `streamText`.
- Keep `chatRecovery` configured as a class field, never inside `onStart()`.
