# Design: Public Error Redaction And Turn Correlation

## Boundary

This task fixes public error projection and turn-level correlation across the Worker, TeamAgent Durable Object, Provider/Capability/MCP runtimes, passive reliability, and React error banner. Internal runtime errors may keep bounded diagnostic structure in memory, but every browser, audit, log, and telemetry boundary applies an explicit allow-list.

## Public Error Contract

`src/contracts/agent-error.ts` remains the compatibility owner for canonical public messages and Provider classification. Its known-code registry becomes authoritative: normalization preserves only registered codes and maps every invalid or unknown code to `agent_error`.

The Agent SSE envelope becomes:

```typescript
type AgentErrorEnvelope = {
  error: KnownPublicErrorCode;
  message: string;       // exact canonical message for error
  requestId?: string;    // bounded URL-safe turn reference
};
```

Parsing remains exact. It permits only the three approved keys, validates `requestId`, and rejects any message that is not the canonical message for the supplied code. The client never renders the serialized message directly; it maps `error` through the same registry.

Non-Agent JSON/SSE endpoints reuse the same Provider projection and canonical message lookup. Capability/MCP codes receive finite public mappings; arbitrary `CapabilityError.message`, `McpRuntimeError.message`, `ProviderToolError.message`, and Provider response text remain internal and never become response text.

## Agent Turn Lifecycle

`TeamAgent.onChatMessage()` derives a normalized turn ID from `options.requestId`, falling back to `crypto.randomUUID()` for malformed input. It uses that ID for every early `chatErrorResponse`, the successful stream response header, the asynchronous `onError` envelope, redacted failure logging, and passive telemetry callbacks.

The lifecycle is divided into stable internal phases:

```text
identity -> attachments -> workspace_context -> prepare -> continuation
         -> stream_create -> provider_stream/tool -> persistence/runtime
```

Expected business rejections keep their public code. Thrown preparation/runtime exceptions become `agent_runtime_error`; workspace loading failures become `workspace_context_unavailable`; missing conversations become `conversation_not_found`. Provider-shaped exceptions continue through `projectAgentStreamError()`.

Preparation and synchronous `streamText()` creation are wrapped locally. They release tools/turn capacity and record failure once before returning UI Message SSE, rather than rethrowing to the framework. Asynchronous stream errors use one closure to classify, record, log, and serialize the same code.

## Correlation

Two IDs remain intentionally separate:

- Worker `X-Request-ID` identifies an HTTP request or WebSocket handshake.
- Agent `requestId` identifies one AIChat turn or continuation.

One WebSocket carries multiple turns, so the handshake UUID is never cached as a turn ID. AIChat response frames already use the SDK turn ID; the error envelope carries the normalized public reference because WebSocket response headers are not forwarded by the SDK.

Correlation values are not stored in Agent public state, message metadata, request body, prompt, tool payload, or a new KV namespace. The existing latest route-reliability record may retain the normalized ID as an optional field. Version-2 records without it remain valid.

## Other Public Surfaces

- Legacy `/api/chat`: keep response status and existing route semantics, but replace Provider body/exception messages with the projected public code and canonical message.
- Capability SSE: serialize public code, canonical message, and retryability; do not forward the internal error message.
- MCP: retain runtime codes internally, remove `serverId` from member-facing messages, and project discovery/execution errors at the Worker boundary.
- Model discovery: success may continue to return the configured endpoint because the authenticated administrator already owns that configuration. Failure responses omit endpoint and Provider body and use canonical public messages.
- MCP OAuth audit: remove `session.label`; retain operation, server ID, and bounded counts/status only.

## React Presentation

The client derives `{ message, requestId? }` from a valid envelope. The existing failed-turn banner keeps retry and reconnect behavior. When a request reference exists, it shows a compact value and a Lucide copy action with an accessible label; copy failures do not replace the primary task error.

## Observability And Privacy

Structured logs contain only `event`, normalized request ID, phase, public code, retryability, and optional route/provider/status class. Passive telemetry remains real-task-only and stores no raw error object. No log, audit, response, or artifact contains member labels, credentials, prompts, responses, tool data, file contents, or memory.

## Compatibility And Rollback

- Existing Agent envelopes without `requestId` remain valid.
- Existing route-reliability v2 records remain readable; the optional request ID does not change ordering or quality scoring.
- Provider fallback, quota, capacity, cancellation, and resend branching are unchanged.
- Reverting the work commit restores the old error projection without mutating user data or configuration.
- The error-governance PR is stacked on the legacy-admin PR until that base merges; it is then retargeted to `main` before merge.
