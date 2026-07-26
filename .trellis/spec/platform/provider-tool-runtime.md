# Provider Tool Runtime

## 1. Scope / Trigger

Use this contract when changing non-streaming OpenAI-compatible or Anthropic-compatible tool turns, provider tool-call parsing, provider-specific tool history, shared provider headers/authentication, Anthropic message conversion, or upstream error projection.

The module is a protocol adapter. Provider selection, credentials, leases, fallback, reliability telemetry, capability assignment, user approval, tool budgets, MCP execution, and result-size enforcement remain outside it.

## 2. Signatures

- Module: `src/services/provider-tool-runtime.ts`
- History construction: `createProviderToolHistory(route, messages)`
- Provider turn: `callProviderToolTurn({ route, apiKey, history, tools, temperature, defaultMaxTokens, signal, usedUserKey, fetch? })`
- History mutation: `appendProviderTurn(history, providerTurn)` and `appendProviderToolResults(history, results)`
- Shared protocol helpers: `buildHeaders`, `setAuthHeader`, `routeUrl`, `clampNumber`, `formatUpstreamErrorMessage`, and `toAnthropicMessages`
- Attempt error: `ProviderToolError(status, message, terminal)`
- Protocol/policy error: `ProviderToolRuntimeError(code, message)`

The optional `fetch` dependency exists for deterministic adapter tests. Production callers omit it and use the Worker global fetch.

## 3. Contracts

- `ResolvedProviderRoute` is the only executable route shape. Legacy `RouteConfig` must be normalized before a tool turn begins.
- `directEndpoint=true` uses `route.baseUrl` exactly as supplied, including a trailing slash. Other requests trim trailing slashes and append `/chat/completions` or `/v1/messages`.
- Saved headers are copied first. `setAuthHeader` never overwrites an explicitly saved authentication header. The default OpenAI header is `Authorization: Bearer <key>`; the default Anthropic header is `x-api-key: <key>`.
- OpenAI tool requests use `tools[].function.{name,description,parameters}`, `tool_choice="auto"`, `stream=false`, numeric-only temperature clamping to `[0,2]`, and optional route `max_tokens`.
- Anthropic tool requests use `tools[].{name,description,input_schema}`, `stream=false`, numeric-only temperature clamping to `[0,1]`, the route max token value or injected deployment default, and `anthropic-version` only when the saved headers do not provide it.
- OpenAI history appends assistant tool calls followed by one `role="tool"` message per result. Anthropic history appends assistant content blocks followed by one user message containing `tool_result` blocks.
- System messages are joined with a blank line for Anthropic. Text and validated inline data images are converted to Anthropic content blocks; invalid images fail before the provider call.
- Provider tool names are aliases from the normalized assigned-tool list. A response naming any other tool is rejected before local or MCP execution.
- Invalid OpenAI argument JSON is preserved as `arguments=null, argumentsValid=false` so the shared capability loop reports the existing argument validation error instead of executing it.
- HTTP failures become `ProviderToolError`. Status 400/422 and user-key 401/403 follow `isTerminalProviderFailure`; other provider failures remain eligible for pre-output fallback.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Provider history type does not match route protocol | `ProviderToolRuntimeError("provider_protocol_error")` |
| OpenAI response lacks `choices[0].message` | `provider_protocol_error` |
| Anthropic response lacks a content array or contains an unsupported block | `provider_protocol_error` |
| Provider requests an unknown tool alias | `ProviderToolRuntimeError("tool_not_allowed")`; no tool runs |
| OpenAI tool arguments are malformed JSON | Return the call with `argumentsValid=false`; capability validation rejects it |
| Provider returns non-2xx | Redact to a bounded message and throw `ProviderToolError` with exact HTTP status |
| User BYOK returns 401/403 | Mark the attempt terminal; do not fall back to another server credential |
| Server credential returns 401/403 | Keep the attempt non-terminal so another eligible offering may be tried |
| Anthropic inline image is malformed | Fail conversion before fetch |
| Request signal aborts | Pass the same signal to fetch; outer capability runtime owns cancellation mapping and lease cleanup |

## 5. Good / Base / Bad Cases

- Good: one assigned alias is sent to an Anthropic provider, its reviewed `tool_use` is normalized, the approved result is appended as a `tool_result`, and the next provider turn continues on the same history.
- Base: a provider returns ordinary assistant text and no tool calls; the runtime returns a protocol-neutral `ModelTurn` and the capability loop finishes without tool execution.
- Bad: parse provider tool calls inside `worker.ts`, trust the remote tool name without checking the assigned alias map, coerce string temperatures into numbers, or recompute fallback policy inside the adapter.

## 6. Tests Required

- Unit-test both request shapes, endpoint handling, default/custom auth headers, saved Anthropic version, temperature bounds, and max-token selection.
- Unit-test OpenAI tool-call parsing, malformed arguments, unknown aliases, assistant/tool history append, and nested upstream error messages.
- Unit-test Anthropic system/image conversion, mixed text/tool-use parsing, error results, and user/tool-result history append.
- Keep Worker integration tests for multi-round OpenAI and Anthropic capability execution, provider lease release, fallback, approval, and MCP execution.
- Run `npm run check:frontend`, `npm test`, `npm run typecheck`, `npx wrangler deploy --dry-run`, and `git diff --check`.

## 7. Wrong vs Correct

### Wrong

```typescript
const payload = await response.json() as any;
return executeTool(payload.choices[0].message.tool_calls[0].function.name);
```

This bypasses assigned aliases, protocol validation, argument decoding, approval, and the shared execution budget.

### Correct

```typescript
const turn = await callProviderToolTurn({
  route,
  apiKey,
  history,
  tools: assignedTools,
  temperature,
  defaultMaxTokens,
  signal,
  usedUserKey,
});
```

The adapter returns a protocol-neutral `ModelTurn`; the Worker capability loop then validates arguments, requests approval, executes the assigned tool, records telemetry, and owns the provider lease.
