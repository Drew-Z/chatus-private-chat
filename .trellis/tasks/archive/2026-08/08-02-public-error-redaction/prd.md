# Public Error Redaction And Turn Correlation

## Goal

Make every model, Agent, Capability, MCP, and model-discovery failure actionable without exposing upstream response bodies, raw exception messages, credentials, member labels, prompts, files, memories, or conversation content. Repeated failures must carry a safe per-turn reference that operators can correlate with redacted logs and passive real-task telemetry.

## Background

- `src/contracts/agent-error.ts:9-46` already owns canonical Agent messages and Provider classification, but syntactically valid unknown codes remain public and fall back to the generic message.
- `src/agent/team-agent.ts:2055-2072` collapses conversation, memory, and workspace-file preparation failures into codes that are not registered, while `prepareTeamAgentTurn()` rejection and synchronous `streamText()` exceptions can bypass the stream classifier at `2073-2089` and `2140-2177`.
- `/api/chat`, Capability SSE, MCP discovery, and administrator model discovery can expose bounded Provider response text or arbitrary `Error.message` through `src/worker.ts:5789-5909`, `7733-7741`, `7869-8036`, `8220-8228`, and `5114-5147`.
- MCP OAuth audit targets persist `session.label` at `src/worker.ts:9451`, `9481`, and `9495-9497`.
- The Worker HTTP boundary creates `X-Request-ID`, but one WebSocket can contain many turns. AIChat already supplies the correct per-turn `OnChatMessageOptions.requestId`; it is currently unused by `TeamAgent.onChatMessage()`.

## Requirements

- R1. Maintain one allow-listed registry of public error codes and canonical Chinese messages. Invalid or unregistered internal codes must serialize as `agent_error`; raw internal code names must not cross a browser boundary.
- R2. Register actionable public messages for `conversation_not_found`, `workspace_context_unavailable`, and `agent_runtime_error`. Preserve more specific Provider classes such as busy, timeout, rate limit, authentication, request rejection, protocol, and unavailable.
- R3. Every `TeamAgent.onChatMessage()` failure path, including workspace preparation, rejected/thrown turn preparation, synchronous stream construction, asynchronous streaming, tools, and continuation context, must return a valid UI Message SSE error envelope. Cleanup and failure accounting must run exactly once.
- R4. Use the AIChat SDK turn request ID as the correlation source. Accept only a bounded URL-safe value and replace invalid input with a server UUID. Do not use the WebSocket handshake ID, persist correlation context in messages/state/body, or add private data to model/tool input.
- R5. The Agent envelope remains exact and secret-free, with approved keys `error`, canonical `message`, and optional `requestId`. The parser must reject unknown fields, invalid IDs, unknown codes, and non-canonical messages. React may show/copy the request ID but must render only the canonical local message.
- R6. `/api/chat`, Capability SSE, MCP discovery/execution, and administrator model discovery must project failures to stable public codes/messages. Provider body text, arbitrary exception text, MCP endpoint/server identifiers in member-facing messages, and model-discovery endpoint details must not appear in failure responses.
- R7. MCP OAuth audit records must not persist the member label. Audit data stays bounded to the operation, MCP server ID, and non-sensitive counts/status.
- R8. Structured failure logs and passive route reliability may record only normalized request ID, phase, public code, retryability, route/provider IDs, status class, latency, and fallback. They must never record raw error messages, cause bodies, labels, prompts, responses, tool arguments/results, credentials, files, or memories.
- R9. Correlation extends the existing latest passive route-reliability record with an optional request ID; it must not create per-request KV keys or active probes. Existing version-2 records remain readable.
- R10. All verification uses local fake Provider/MCP fixtures. No live model, synthetic production probe, production data mutation, or local production deployment is allowed.

## Acceptance Criteria

- [x] AC1. Unknown/invalid codes and non-canonical or expanded envelopes fail closed; known envelopes with a valid optional request ID decode and display the local canonical message without raw input.
- [x] AC2. Conversation missing, workspace context failure, turn-preparation rejection/throw, synchronous stream failure, and asynchronous Provider failure all produce valid secret-free SSE envelopes with actionable public codes and one normalized turn request ID.
- [x] AC3. Provider HTTP/SSE failures keep distinct busy/timeout/429/auth/4xx/5xx/protocol classes, release resources once, and never expose Provider body, endpoint, API key, member label, or exception text.
- [x] AC4. `/api/chat`, Capability, MCP discovery/execution, and administrator model discovery return canonical public failures only; negative tests include secret-like markers and assert their absence from JSON/SSE/UI.
- [x] AC5. MCP OAuth audit events contain no member label; existing operational meaning and bounded MCP server/count context remain available.
- [x] AC6. The same normalized request ID appears in the Agent error envelope, structured failure evidence, and latest passive route telemetry where a Provider attempt exists. WebSocket upgrade responses remain untouched.
- [x] AC7. React shows an accessible failed-turn banner with the canonical message and a copyable request reference when present; retry still creates one resend branch and does not expose private diagnostics.
- [x] AC8. Local fake Provider/MCP regression coverage includes preparation/runtime throw, 401, 429, 5xx, network/protocol failure, post-output failure, and MCP failure without any external request.
- [x] AC9. Frontend checks, full Vitest, typecheck, Wrangler dry-run, affected Playwright suites, `git diff --check`, and Trellis consistency all pass before the work commit and PR.
- [x] AC10. Work commit, PR CI artifacts, main exact SHA, GitHub Actions deployment, and production/user acceptance are recorded before archive.

## Out Of Scope

- Active Provider/MCP health probes, live model calls, or local production deployment.
- Persisting a high-cardinality per-request failure ring or conversation-level trace.
- Showing raw Provider/MCP errors to administrators as a debugging escape hatch.
- Changing quota, fallback ordering, model selection, tool confirmation policy, or retry branching semantics.
- Production deployment or production configuration mutation outside GitHub Actions and authenticated user acceptance.
