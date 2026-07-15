# Configurable tools, Skills, and MCP - Technical Design

## 1. Design objective

Add one safe, complete read-only capability path without changing ordinary chat behavior when no capability is active. The implementation must keep administrator configuration practical, preserve route and user permission boundaries, and make remote execution visible to the user.

This remains one implementation task because Skills, tools, MCP, provider turns, consent, persistence, and UI all share the same cross-layer contracts. The work is staged and independently checked, but splitting it into child tasks would leave intermediate builds that cannot be exercised end to end.

## 2. High-level architecture

```text
Admin UI
  -> revisioned AppConfig (Skills, tools, MCP servers, users, routes)
  -> write-only MCP secret API
  -> explicit MCP discovery

Chat UI
  -> chatId + skillIds + normal messages
  -> effective Skill/tool projection from /api/session

/api/chat
  -> no effective tools or route lacks tool support
       -> existing provider streaming path unchanged
  -> effective tools and tool-capable route
       -> UserState.runCapabilityChat()
            -> provider-neutral model/tool loop
            -> built-in executor or official MCP client
            -> in-memory approval wait
            -> Chatus capability SSE stream

/api/tool-approvals
  -> authenticated user
  -> same UserState Durable Object
  -> resolve one pending in-memory approval
```

## 3. Configuration contracts

Extend `AppConfig` without changing existing route/user defaults:

```typescript
type SkillConfig = {
  enabled?: boolean;
  label: string;
  description?: string;
  instructions: string;
  toolIds?: string[];
  order?: number;
};

type ToolConfirmation = "auto" | "first-per-conversation" | "always";

type ToolExecutor =
  | { type: "builtin"; name: "text_stats" }
  | { type: "mcp"; serverId: string; remoteName: string };

type ToolConfig = {
  enabled?: boolean;
  label: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  confirmation?: ToolConfirmation;
  executor: ToolExecutor;
  schemaFingerprint?: string;
};

type McpAuthType = "none" | "bearer" | "x-api-key";

type McpServerConfig = {
  enabled?: boolean;
  label: string;
  endpoint: string;
  authType: McpAuthType;
  secretRef?: string;
};

type AppConfig = {
  routes: Record<string, RouteConfig>;
  users?: Record<string, UserConfig>;
  defaults?: UserConfig;
  skills?: Record<string, SkillConfig>;
  tools?: Record<string, ToolConfig>;
  mcpServers?: Record<string, McpServerConfig>;
};
```

Additional existing fields:

```typescript
type RouteConfig = {
  // existing fields
  supportsTools?: boolean;
};

type UserConfig = {
  // existing fields
  allowedTools?: string[];
};
```

### 3.1 Normalization and limits

- IDs are trimmed, bounded, and unique within their registry.
- Skill order is `order`, then ID as the deterministic tie breaker. Users do not reorder Skills.
- Skill instructions and descriptions receive explicit character limits.
- Each conversation accepts at most three distinct enabled Skill IDs.
- Missing or empty `allowedTools` means no tools. This differs intentionally from legacy `allowedRoutes` behavior.
- A tool is usable only when the tool, its MCP server if any, and the route are enabled and the user explicitly allows the tool.
- Built-in executor names and MCP auth types are closed unions; unknown values are dropped during normalization.
- Remote MCP tools can use `first-per-conversation` or `always`. An attempted remote `auto` policy normalizes to `first-per-conversation`.
- Built-in `text_stats` is the only executor allowed to use `auto` in the MVP.
- Conservative config ceilings prevent unbounded admin payloads: 50 Skills, 200 tools, and 20 MCP servers.

### 3.2 Tool identity and provider names

- Built-in tool ID: `builtin:text_stats`.
- MCP tool ID: `mcp:<serverId>:<remoteName>`.
- Internal IDs are never sent directly as provider function names.
- A deterministic provider-safe alias is generated from a sanitized remote name plus a short SHA-256 digest of the internal ID. The request keeps an alias-to-tool-ID map.
- Provider aliases are limited to the common OpenAI/Anthropic function-name subset and 64 characters.

### 3.3 Discovery merge behavior

MCP discovery returns normalized tool candidates but does not directly mutate stored config. The admin page merges candidates into its revisioned local config and saves through the existing `/api/admin/config` endpoint.

- New tool: create a disabled `ToolConfig`.
- Same tool and same schema fingerprint: refresh label/description/schema while preserving enabled state and policy.
- Same tool with a changed schema fingerprint: update metadata but force `enabled: false` so an administrator must review it again.
- Missing remote tool: retain the stored entry but mark it unavailable in the admin projection; runtime invocation fails closed until rediscovery or removal.
- `execution.taskSupport === "required"` tools are rejected as unsupported in the MVP.

## 4. Secret management

Add MCP-specific endpoints while preserving all existing route-secret paths and stored records:

```text
GET    /api/admin/mcp-secrets
PUT    /api/admin/mcp-secrets/:secretRef
DELETE /api/admin/mcp-secrets/:secretRef
```

- Reuse `ROUTE_KEYS_MASTER_KEY`; no second deployment secret is required.
- Refactor only the encryption primitive into a namespace-aware helper.
- Existing route records keep `route-secret:` keys and `chatus:route-secret:v1:` AAD unchanged.
- MCP records use `mcp-secret:` keys and `chatus:mcp-secret:v1:` AAD.
- Managed encrypted records take precedence over same-name Worker Secret bindings.
- If a managed MCP record exists but is unreadable, fail instead of silently falling back.
- Browser inputs are write-only password fields and are cleared on save, failure, editor switch, login transition, and refresh.
- Config, read responses, audit records, diagnostics, exports, and errors never contain plaintext, IVs, or ciphertext.

## 5. Effective capability calculation

The server is authoritative. Browser selections never widen access.

1. Merge `defaults` and the current user's config.
2. Normalize requested `skillIds`, keep enabled IDs only, remove duplicates, cap at three, and sort by administrator order.
3. Compose selected Skill instructions in that order.
4. Form the union of tool IDs referenced by those Skills.
5. Intersect with the user's effective `allowedTools`.
6. Keep only enabled and valid tools whose executor is available.
7. If the selected route has `supportsTools !== true`, expose no tool schemas and use ordinary chat behavior.

Skill selection never modifies memory, the permanent user prompt, or account permissions.

### 5.1 System instruction order

`buildMessagesWithSystem` uses this order:

1. Global `SYSTEM_PROMPT`.
2. Permanent user `systemPrompt`.
3. Selected Skill instructions in administrator order, each clearly delimited and identified.
4. Long-term user memory.
5. Rolling conversation summary.
6. Normal conversation messages.

The global and permanent user constraints therefore remain above Skill instructions.

## 6. Public capability projection

Extend `GET /api/session` with a bounded display-only projection:

```typescript
type PublicSkill = {
  id: string;
  label: string;
  description: string;
  toolIds: string[];
};

type PublicTool = {
  id: string;
  label: string;
  description: string;
  source: "builtin" | "mcp";
  confirmation: ToolConfirmation;
};
```

- Return only enabled Skills.
- Return only enabled tools allowed for the current user.
- Do not return schemas, endpoints, remote names, server IDs, secret references, or credentials.
- The browser derives which allowed tools become active for the selected Skills.

## 7. Provider-neutral tool loop

### 7.1 Internal turn contracts

```typescript
type NormalizedToolDefinition = {
  id: string;
  providerName: string;
  label: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

type NormalizedToolCall = {
  providerCallId: string;
  providerName: string;
  toolId: string;
  arguments: unknown;
};

type ModelTurn = {
  text: string;
  toolCalls: NormalizedToolCall[];
  finishReason: string;
  providerTurn: unknown;
};
```

The loop keeps provider-native transient history in memory because OpenAI and Anthropic require different tool-call/result message shapes. These transient turns are never accepted from the browser and never stored in chat history.

### 7.2 Loop algorithm

1. Resolve the route plan and effective tools.
2. Before accepting any provider response, allow existing route fallback only to routes that support the same tool capability.
3. Call the selected provider with `stream: false` and normalized tool definitions.
4. Once one valid provider response is accepted, pin the run to that route.
5. If there are no tool calls, emit the final assistant text and finish.
6. For each tool call in provider order:
   - resolve the alias to an allowed internal tool ID;
   - validate arguments against the stored JSON Schema;
   - enforce call count, timing, consent, and cancellation;
   - execute the built-in or MCP executor;
   - normalize and size-bound the result;
   - append the provider-native tool result to transient history.
7. Request the next model turn.
8. Stop at four model/tool rounds, eight total calls, cancellation, denial, timeout, provider failure, or total tool budget exhaustion.

Multiple calls in one model turn execute sequentially in the MVP. This avoids parallel confirmation races, simplifies cancellation, and keeps event ordering deterministic.

### 7.3 Provider adapters

OpenAI-compatible adapter:

- Send Chat Completions function tools without depending on `strict` support.
- Parse `choices[0].message.content` and `tool_calls`.
- Append the complete assistant message and one `role: "tool"` result per call.

Anthropic adapter:

- Send native `tools` with `input_schema`.
- Parse text and `tool_use` content blocks.
- Append the assistant content blocks and a following user message containing `tool_result` blocks.

Both adapters validate all upstream response fields from `unknown` and return stable Chatus error codes for malformed responses.

### 7.4 Streaming trade-off

Ordinary chat continues to proxy provider token streams exactly as today. The tool-enabled path uses non-streaming provider turns so it can safely decide whether a turn is final or requests tools. The browser still receives an immediate Chatus SSE lifecycle stream; the final assistant text may arrive as one bounded event rather than provider token deltas in the MVP.

## 8. Built-in tool

Add one deterministic side-effect-free executor:

```text
ID: builtin:text_stats
Input: { text: string }
Output: { characters, codePoints, words, lines }
```

- No network, storage, secret, or user-account access.
- Server-side JSON Schema validation is mandatory.
- The result is deterministic for the same UTF-8 input.
- It may run automatically only when enabled, referenced by a selected Skill, and allowed for the user.

## 9. Remote MCP client

Use `@modelcontextprotocol/sdk` `Client`, `StreamableHTTPClientTransport`, and `CfWorkerJsonSchemaValidator`.

### 9.1 Connection policy

- HTTPS only.
- No URL userinfo or fragments.
- Reject localhost and literal private, loopback, link-local, multicast, unspecified, and reserved IPv4/IPv6 destinations.
- Restrict the custom fetch wrapper to the configured endpoint origin.
- Set `redirect: "manual"`; any redirect is an error in the MVP.
- Add `Authorization: Bearer <secret>` or `X-API-Key: <secret>` only when configured.
- Use a 15-second per-call abort signal and zero automatic reconnection retries.
- Bound each MCP protocol envelope to 256 KiB before SDK parsing.
- Close the SDK client and best-effort terminate a remote session after discovery or the active run.

Cloudflare's platform network restrictions remain defense in depth for DNS-resolved private destinations. The explicit URL checks are not treated as a complete custom DNS security layer.

### 9.2 Discovery

`POST /api/admin/mcp-discovery` accepts a normalized server draft containing endpoint, auth type, secret reference, and server ID. It never accepts plaintext credentials.

- Connect and initialize.
- Page through `tools/list` with bounded pages and total tools.
- Validate names, input schemas, annotations, and task support.
- Generate internal IDs and schema fingerprints.
- Return metadata only.
- Record a non-sensitive audit event containing the server ID and counts, not endpoint, schemas, or credentials.

### 9.3 Invocation

On first use of one MCP server during a capability run:

- connect and list configured tools;
- verify the target tool still exists and its schema fingerprint matches stored config;
- cache the verified client and tool list only for the active run;
- call the exact remote name;
- accept text and structured JSON results;
- reject unsupported binary, audio, embedded-resource, elicitation, sampling, and task-required behavior;
- serialize the normalized result to at most 32 KiB.

## 10. Consent and Durable Object coordination

### 10.1 Active run state

`UserState` gains bounded in-memory maps only:

```typescript
type ActiveCapabilityRun = {
  runId: string;
  chatId: string;
  controller: AbortController;
  pendingApproval?: PendingApproval;
};

type ConversationTrust = {
  toolIds: Set<string>;
  lastSeenAt: number;
};
```

- Raw arguments and results live only inside the active run closure.
- Active runs are removed on completion, cancellation, timeout, or stream close.
- Conversation trust is memory-only, bounded by chat count and idle time, and may be lost on object eviction. Losing trust causes another prompt, which fails safe.
- A different `chatId` starts without trust.

### 10.2 Confirmation policy

- Built-in local read tool with `auto`: execute immediately.
- Remote `first-per-conversation`: ask unless the same tool is trusted for the current `chatId`.
- Remote `always`: ask for every call and ignore temporary trust.
- User decisions: `once`, `conversation`, or `deny`.
- Approval waits at most 120 seconds. This waiting time is separate from the 45-second cumulative tool execution budget.
- Denial returns a structured tool error to the model and a visible denied event to the user; it does not execute the tool.

### 10.3 Approval endpoint

```text
POST /api/tool-approvals
{ runId, callId, decision: "once" | "conversation" | "deny" }
```

The outer Worker authenticates the normal user session and calls the same user's `UserState.resolveToolApproval`. Random IDs, one-shot resolution, pending-call matching, and cleanup prevent replay.

## 11. Capability stream protocol

Tool-enabled responses set:

```text
Content-Type: text/event-stream; charset=utf-8
X-Chatus-Stream: capability-v1
X-Chatus-Route: <routeId>
```

Each `data:` frame contains one bounded JSON event:

```typescript
type CapabilityStreamEvent =
  | { type: "run"; runId: string; routeId: string; fallback: boolean }
  | { type: "tool"; event: ToolEventSummary }
  | { type: "confirmation_required"; runId: string; callId: string; event: ToolEventSummary }
  | { type: "assistant_delta"; text: string }
  | { type: "finish"; finishReason: string }
  | { type: "error"; code: string; message: string; retryable: boolean }
  | { type: "done" };
```

The existing provider stream parser remains unchanged for responses without the capability header.

## 12. Conversation and backup storage

Keep message roles unchanged. Tool activity belongs to the assistant message that owns the run:

```typescript
type ToolEventSummary = {
  id: string;
  toolId: string;
  label: string;
  source: "builtin" | "mcp";
  status: "pending" | "approved" | "running" | "completed" | "failed" | "denied";
  argumentSummary?: string;
  resultPreview?: string;
  confirmation?: "once" | "conversation";
  errorCode?: string;
  createdAt: number;
  updatedAt: number;
  truncated?: boolean;
};
```

- Add `toolEvents?: ToolEventSummary[]` to assistant messages.
- Add `skillIds: string[]` to conversations.
- Browser, cloud, branch, merge, and import normalizers validate and bound both fields.
- Argument/result summaries are redacted and capped; result previews are at most 2,000 characters.
- Pending/running events loaded after an interruption normalize to failed with `interrupted`.
- Raw arguments, raw MCP payloads, provider-native tool messages, remote endpoints, schemas, and credentials are never persisted.
- Increment backup format to version 4. Versions 1-3 continue to import with empty `skillIds` and no tool events. Future versions remain rejected.
- Markdown conversation export may include the redacted visible tool timeline, never raw payloads.
- Regenerate/resend/edit branches copy persisted summaries but rerun tools under current policy; they never replay raw results.

## 13. User interface design

### 13.1 Chat capability selector

- Add one compact capability icon button beside the attachment control.
- Open an anchored popover/dialog containing enabled Skills as native checkbox rows.
- Enforce at most three selections and preserve administrator order.
- Show selected Skills in the composer metadata as compact removable labels; do not add a large explanatory panel.
- Store selection on the active conversation and restore it when switching conversations or branches.
- Show the effective allowed tool names in the same surface as secondary read-only metadata.

### 13.2 Tool timeline

- Render tool events as compact unframed rows within the assistant message flow, not nested cards.
- Use the existing Lucide sprite for pending, running, success, failure, and remote-tool indicators.
- Show label, status, time, redacted argument summary, and bounded result preview.
- Confirmation rows expose `仅本次`, `本会话允许`, and deny controls with visible focus states.
- Disable stale confirmation controls immediately after a decision.
- Keep controls fully visible on touch layouts and keyboard reachable.

### 13.3 Admin capability page

Add one `AI capabilities` navigation section rather than separate top-level pages for every concept. Use a compact segmented control or tabs for:

- Skills: registry picker, enabled state, label, description, instructions, order, and tool checkboxes.
- Tools: built-in and discovered tools, enabled state, source, schema-change status, and confirmation policy.
- MCP servers: server picker, label, endpoint, auth type, secret reference/write-only password, enabled state, discovery action, and discovered-tool merge.

The existing user editor receives one `allowedTools` checkbox group below routes. Defaults and concrete users share the same editor behavior.

## 14. Errors, limits, and audit

Stable error codes include:

```text
route_does_not_support_tools
tool_not_allowed
tool_not_found
tool_arguments_invalid
tool_confirmation_timeout
tool_denied
tool_call_limit
tool_round_limit
tool_time_budget_exceeded
tool_result_too_large
tool_execution_failed
mcp_endpoint_invalid
mcp_auth_unavailable
mcp_redirect_rejected
mcp_protocol_error
mcp_tool_changed
mcp_tool_unsupported
```

Audit and metrics may record server/tool IDs, lifecycle kind, duration bucket, outcome, and counts. They must not include prompts, arguments, results, endpoints, credentials, conversation text, memory, or schemas.

## 15. Compatibility and migration

- Existing stored config without capability fields normalizes to empty registries and no allowed tools.
- Existing routes default `supportsTools` to false so no model receives tool schemas accidentally.
- Existing chats and backups remain readable.
- Existing non-tool `/api/chat` request and stream behavior remains the default.
- No new Durable Object class or storage migration is required; `UserState` receives only methods and ephemeral maps.
- `ROUTE_KEYS_MASTER_KEY` remains the only encryption master key.
- Production deployment remains GitHub Actions only.

## 16. Rollout and rollback

Rollout is configuration-gated:

1. Deploy code with empty capability registries and `supportsTools: false` defaults.
2. Configure and test the built-in tool on one route/user.
3. Configure a fake or trusted MCP server, discover tools, explicitly enable one, and allow it for one user.
4. Expand only after provider and consent telemetry is healthy.

Rollback requires disabling Skills, tools, MCP servers, or route `supportsTools`; ordinary chat remains available. Removing the new config fields is not required for rollback because old runtime behavior ignores empty/disabled capabilities.

## 17. Verification strategy

- Pure config, schema, redaction, alias, URL, and event normalization tests.
- Worker integration tests for admin config, encrypted MCP secrets, discovery, permission intersections, provider adapters, limits, fallback pinning, and sanitized errors.
- Concurrent API test that reads a confirmation event, submits approval, and observes the same stream continue.
- UserState tests for one-shot approval resolution, conversation trust, timeout cleanup, and cancellation.
- Frontend structural assertions for all new IDs, backup version 4, selection cap, no plaintext secret path, capability stream parser, tool timeline controls, and touch accessibility.
- Browser fixtures at 1440x960 and 390x844 for Skill selection, pending confirmation, completed/failed tool events, admin capability editors, dark mode, keyboard focus, and no overlap/overflow.
- Full project quality gate plus `wrangler deploy --dry-run` to verify MCP SDK bundle compatibility and size.
