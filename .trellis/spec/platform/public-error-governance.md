# Public Error Projection And Turn Correlation

## 1. Scope / Trigger

Use this contract when changing Agent/Provider/Capability/MCP/model-discovery failures, browser error payloads, Agent failure logs, MCP OAuth audit targets, or passive route-reliability correlation. Internal errors may retain bounded classification evidence, but every browser, log, audit, and telemetry boundary is an explicit allow-list.

## 2. Signatures

```typescript
type AgentErrorEnvelope = {
  error: AgentErrorCode;
  message: string;
  requestId?: string;
};

normalizeAgentRequestId(value: unknown): string | undefined
createAgentErrorEnvelope(error: string, requestId?: string): AgentErrorEnvelope
projectAgentStreamError(error: unknown): AgentErrorCode

type RouteReliabilityWrite = {
  requestId?: string;
  routeId: string;
  providerId?: string;
  // bounded outcome/status/latency fields only
};

ProviderCoordinator.recordReliabilitySample({
  operation: "chat",
  sample: { requestId?: string, /* bounded reliability fields */ },
});
```

Affected public surfaces are Agent UI Message SSE, legacy `/api/chat`, Capability SSE, MCP discovery/execution, administrator model discovery, instance-maintenance admission, and the React/admin reliability projections.

Content-free Provider attempt diagnostics are available only at authenticated
`GET /api/admin/provider-attempts?providerId=<configured-id>&limit=<1..100>`.

## 3. Contracts

- `src/contracts/agent-error.ts` owns the finite code registry, canonical Chinese messages, exact Agent envelope parser/serializer, request-reference normalization, and Provider classification. Unknown internal codes fail closed to `agent_error`.
- `instance_maintenance` is the only public maintenance-admission code. HTTP and Agent entry return the canonical message with `503` and optional numeric maintenance revision only; they omit operation/archive IDs, capture phase, inventory, fence IDs, store identities, and internal errors. Queue delivery retries without serializing coordinator state.
- Agent `requestId` comes from the AIChat SDK turn, not the HTTP/WebSocket handshake. Accept only URL-safe values of 8-128 characters; invalid input becomes a server UUID. Reuse one normalized value in the error envelope, `X-Request-ID`, structured failure evidence, and latest passive Provider reliability.
- The Agent envelope contains only `error`, canonical `message`, and optional `requestId`. The client maps the code through the local registry and never trusts serialized message text.
- `/api/chat`, Capability, MCP, and model-discovery boundaries preserve actionable busy/timeout/429/authentication/4xx/5xx/protocol/unavailable classes, then replace raw internal text with the canonical public message. Provider bodies, endpoints on failure, arbitrary exceptions, MCP server identifiers in member-facing messages, and tool results never cross the boundary.
- Budget boundaries preserve only `provider_budget_exceeded`,
  `provider_budget_policy_unknown`, or `provider_budget_unavailable`. They never
  expose amounts, balances, policy/reservation IDs, Provider IDs, price
  evidence, or ledger exception text. The same projection applies to Agent UI
  Message SSE, legacy JSON, Capability SSE, memory/summary, and model discovery.
- Structured Agent failure logs contain only `level`, `event`, normalized `requestId`, phase, public error code, and optional logical route ID. Do not log the raw error/cause, member label, prompt, response, file/memory content, tool input/result, credential, endpoint, or Provider ID.
- Passive correlation extends only the existing latest version-2 route/provider record with an optional normalized request ID. It creates no per-request key, active probe, or conversation trace and does not affect ordering/scoring.
- Exact provider correlation follows the existing chat reliability write through `ProviderReliabilitySample`, the provider-scoped `ProviderCoordinator` reducer, and its KV projection. Do not restore a direct KV read-modify-write path. Automatic Skill selector telemetry remains isolated and does not inherit the answer turn request ID.
- MCP OAuth audit targets omit the member label. They may retain the bounded server ID, operation, and discovery counts/status required for administration.
- Provider attempt and finance diagnostics omit prompt/completion/tool data,
  credentials, raw Provider metadata, raw invoice data, idempotency keys, and
  complete operation fences. They may expose opaque turn/run/attempt IDs, exact
  configured route dimensions, bounded terminal/usage/cost/reconciliation
  classes, timing, credential class, and operation kind. Account deletion
  retains this instance-level evidence; user export excludes it and never
  includes raw invoice material.
- React shows/copies only a validated request reference. The chat banner renders the local canonical message; the admin reliability table may compact the display but copies the exact value.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Unknown/unregistered code | Normalize server output to `agent_error`; strict client input rejects it |
| Envelope has extra keys, invalid request ID, or non-canonical message | Reject and show generic local failure |
| Provider busy / timeout / 429 / 401-403 / 400-422 / 5xx | `provider_busy` / `upstream_timeout` / `upstream_rate_limited` / `upstream_authentication_failed` / `upstream_request_rejected` / `upstream_unavailable` |
| Provider JSON/SSE shape is invalid | `provider_protocol_error`; no body or endpoint in the response |
| Hard budget lacks available balance | `provider_budget_exceeded`, HTTP 429, canonical message only, zero Provider calls |
| Hard budget has no verifiable immutable price | `provider_budget_policy_unknown`, HTTP 503, canonical message only, zero Provider calls |
| Required budget/attempt ledger is unavailable before I/O | `provider_budget_unavailable`, HTTP 503, canonical message only, zero Provider calls |
| Workspace/preparation/runtime failure | `workspace_context_unavailable` / expected preparation code / `agent_runtime_error` with UI Message SSE |
| Maintenance is requested/active or coordinator state cannot be inspected safely | `503 instance_maintenance`; optional revision only, no internal capture/fence fields |
| MCP runtime/discovery error | Canonical registered MCP/tool code; no raw result, endpoint, or server ID in member text |
| Stored reliability request ID is malformed | Reject the complete stored/client route record |
| Chat sample reaches `ProviderCoordinator` | Preserve its normalized request ID in the authoritative DO aggregate and KV projection; omit it from selector telemetry |
| Clipboard API rejects | Keep the original error/reference visible and omit success feedback |
| Provider-attempt diagnostics request an unknown shard or out-of-range limit | Reject without creating/opening arbitrary operator-selected evidence |

## 5. Good / Base / Bad Cases

- Good: a Provider returns `429` with a secret-like body; the member receives `upstream_rate_limited`, the same safe turn reference appears in Agent evidence/reliability, and the body appears nowhere public.
- Good: hard admission denies before I/O; every public transport emits the same
  registered budget code/message and omits the Provider, policy, amount, and
  private ledger failure.
- Base: an older Agent envelope or version-2 reliability record has no request ID and remains readable.
- Bad: `jsonResponse({ message: error.message, endpoint })`, `onError: String`, or an audit target containing `${session.label}:${serverId}` leaks private context.

## 6. Tests Required

- Unit-test the complete registry, unknown codes, exact envelope keys/messages, valid/invalid request IDs, and every Provider classification.
- Exercise maintenance across HTTP mutation, Agent entry, OAuth status/callback, Queue delivery, health, reads, and logout. Assert mutation/Agent payloads contain only the canonical code/message plus optional revision and that health creates no probe Agent/UserState identity.
- Exercise preparation throw, synchronous stream throw, asynchronous pre/post-output failures, and workspace-context failure through local fake Provider fixtures; assert valid UI Message SSE, cleanup/accounting once, and matching envelope/header/log/reliability references.
- Put secret-like markers in Provider bodies, exceptions, MCP results/endpoints/server IDs, member labels, files, and memory fixtures; assert absence from JSON/SSE/log/audit/UI outputs.
- Cover `/api/chat`, Capability SSE, MCP discovery/execution, and model discovery for 401, 429, 5xx, network, invalid JSON/protocol, and post-output failures without live Provider/MCP requests.
- Cover all three budget codes through legacy chat, Agent/Automatic Skill,
  memory/summary, initial/continuation capability turns, and model discovery;
  assert exact 429/503 mapping, zero fake Provider calls, and secret-marker
  absence.
- Cover chat/admin reference display, full-value copy, clipboard failure, accessibility, and desktop/390px containment.
- Exercise one chat reliability sample through `ProviderCoordinator`, eviction/readback, and the KV projection; assert the exact normalized request ID survives while selector telemetry remains unchanged.

## 7. Wrong vs Correct

### Wrong

```typescript
return jsonResponse({ error: "provider_failed", message: error.message, endpoint }, 502);
```

### Correct

```typescript
const code = projectAgentStreamError(error);
return jsonResponse({ error: code, message: agentErrorMessage(code) }, 502);
```

The classification stays actionable while raw upstream material remains inside the runtime boundary.
