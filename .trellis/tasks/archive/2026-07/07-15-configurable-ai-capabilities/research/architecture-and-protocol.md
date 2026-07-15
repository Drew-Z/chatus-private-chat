# Configurable AI capabilities research

## Purpose

Record the codebase and protocol evidence used to design the first configurable Skills, tool-calling, and remote MCP vertical slice for Chatus.

## Current Chatus boundaries

- `src/worker.ts:38` defines only `openai-chat` and `anthropic-messages` providers.
- `src/worker.ts:2070` handles chat by normalizing browser messages, resolving one route plan, and proxying the first successful provider stream.
- `src/worker.ts:2880` normalizes Anthropic text streaming into the OpenAI-compatible SSE shape consumed by the browser.
- `public/app.js:680` sends one `/api/chat` request and parses text/finish chunks. There is no application event protocol for tool lifecycle or confirmation.
- `src/worker.ts:2326` owns config normalization. The current config has routes, defaults, and users only.
- `src/worker.ts:2403` computes effective route access by merging defaults and the selected user. Missing `allowedRoutes` currently means all routes.
- `src/worker.ts:1789` and `public/app.js:1000` store conversations with user/assistant messages. Tool calls and results have no persisted representation.
- `public/app.js:2595` exports backup format version 3 and includes normalized conversation messages.
- `src/worker.ts:208` already provides one per-user `UserState` Durable Object for quota, metrics, and cloud chat coordination.
- `src/worker.ts:985` and `.trellis/spec/frontend/type-safety.md` provide an authenticated, revision-aware, AES-GCM encrypted, write-only route-secret pattern.

## Provider tool-calling contracts

### OpenAI-compatible Chat Completions

Official function-calling guidance confirms the Chat Completions loop used by compatible providers:

1. Send JSON Schema function definitions in `tools`.
2. Read assistant `tool_calls` with an ID, function name, and JSON-encoded arguments.
3. Append the assistant tool-call message.
4. Append one `role: "tool"` result per call using `tool_call_id`.
5. Request the next model turn.

Chatus should validate arguments itself and should not depend on provider strict-mode support because compatible relays vary.

Source: https://platform.openai.com/docs/guides/function-calling

### Anthropic Messages

Anthropic uses native content blocks:

- Request tools use `name`, `description`, and `input_schema`.
- Assistant responses contain `tool_use` blocks with an ID, name, and already-parsed input object.
- Results return in a following user message as `tool_result` blocks referencing `tool_use_id`.
- Text and tool blocks can coexist in one assistant turn.

The provider adapter therefore must preserve provider-native transient turns during one request while exposing one provider-neutral internal tool-call shape.

Source: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use

## MCP transport and authorization

- MCP Streamable HTTP is the current remote transport. It sends JSON-RPC over HTTP POST and may return either JSON or SSE.
- HTTP authorization is optional at the MCP protocol level. Full standardized authorization is OAuth 2.1 based and includes protected-resource metadata, authorization-server discovery, PKCE, scopes, and token lifecycle management.
- The approved MVP intentionally supports no auth, static Bearer auth, and static `X-API-Key` auth only. Full OAuth is deferred.
- MCP tools expose names, descriptions, JSON input schemas, optional output schemas, annotations, and task-support metadata.
- The first Chatus release should reject task-required tools, sampling, elicitation, resources, prompts, and other capabilities outside the read-only tool slice.

Sources:

- https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- https://modelcontextprotocol.io/specification/2025-11-25/server/tools

## MCP security evidence

Official MCP security guidance calls out SSRF, redirects, private/reserved destinations, DNS rebinding, token leakage, session hijacking, and over-broad scopes.

Applicable MVP controls:

- Require HTTPS endpoints.
- Reject URL userinfo, fragments, localhost names, and literal private, loopback, link-local, multicast, or reserved IP destinations.
- Use `redirect: "manual"` and reject all redirects in the MVP.
- Restrict the MCP SDK fetch wrapper to the configured endpoint origin.
- Bound protocol responses before parsing and bound normalized tool results separately.
- Send static credentials only in headers, on every MCP request, and never in URLs, errors, config reads, audit targets, or exports.
- Treat a changed discovered schema as a new approval event: disable the affected tool until an administrator reviews and re-enables it.

Source: https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices

## Official TypeScript SDK assessment

`npm view @modelcontextprotocol/sdk version` returned `1.29.0` on 2026-07-15.

Relevant package facts:

- `StreamableHTTPClientTransport` accepts a custom `fetch`, `requestInit`, reconnection limits, and session ID.
- `Client` provides `connect`, `listTools`, and `callTool` and validates protocol messages.
- `CfWorkerJsonSchemaValidator` is a dedicated Cloudflare Worker-compatible validator that avoids code generation.
- Required packages for this path are `@modelcontextprotocol/sdk`, `zod`, and optional peer `@cfworker/json-schema` when using the Worker validator.
- The package is large in full, so Chatus must use explicit subpath imports and verify the Worker bundle with `wrangler deploy --dry-run`.

Planned imports:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
```

The SDK owns MCP JSON-RPC, initialization, transport parsing, capability checks, tool listing, and call-result validation. Chatus still owns endpoint policy, credentials, permissions, consent, timeouts, size limits, and conversion into model-facing tool results.

## Durable Object coordination evidence

Cloudflare Workers RPC supports `Request`, `Response`, and byte-oriented `ReadableStream` values with streaming flow control. A Durable Object RPC method can therefore return the capability chat response stream to the outer Worker.

The existing per-user `UserState` object is the correct coordination atom for:

- active capability runs,
- pending confirmation resolvers,
- conversation-scoped temporary trust,
- cancellation and cleanup.

Raw arguments and results remain only in active object memory and the open response stream. They are not critical durable state: object eviction or stream interruption safely fails the run and requires a retry. No raw payload is written to SQLite, KV, cloud chat storage, or local storage.

Sources:

- https://developers.cloudflare.com/durable-objects/best-practices/create-durable-object-stubs-and-send-requests/
- https://developers.cloudflare.com/workers/runtime-apis/rpc/

## Design conclusions

1. Preserve the current direct provider streaming path when no effective tool is active.
2. Use a separate capability stream protocol only for tool-enabled requests.
3. Run tool-enabled requests inside `UserState` so a second authenticated approval request can resolve an in-memory pending call.
4. Use non-streaming provider requests inside the bounded tool loop. Send lifecycle events immediately and emit the final assistant text through the Chatus capability stream when the provider returns it.
5. Keep provider-native transient messages inside the active run; persist only normal user/assistant messages plus redacted tool-event summaries.
6. Use the official MCP SDK with the Cloudflare validator and a Chatus-owned bounded fetch wrapper.
7. Keep one Trellis task. The deliverables share config, permission, message, confirmation, and compatibility contracts, so child tasks would create unusable intermediate states. Implementation will still use independently checked stages.

## Commands used

```text
npm view @modelcontextprotocol/sdk version dist-tags engines dependencies --json
npm view @modelcontextprotocol/sdk peerDependencies peerDependenciesMeta --json
npm pack @modelcontextprotocol/sdk@1.29.0 --pack-destination %TEMP% --json
smart-search fetch <official OpenAI, Anthropic, MCP, and Cloudflare URLs> --format markdown
```
