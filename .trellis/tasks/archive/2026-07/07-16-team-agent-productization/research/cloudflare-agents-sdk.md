# Cloudflare Agents SDK Research

## Sources

- Cloudflare Agents repository documentation: <https://github.com/cloudflare/agents/tree/main/docs/agents>
- Getting started: <https://github.com/cloudflare/agents/blob/main/docs/agents/getting-started.md>
- Agent class and routing: <https://github.com/cloudflare/agents/blob/main/docs/agents/agent-class.md>
- Client SDK: <https://github.com/cloudflare/agents/blob/main/docs/agents/client-sdk.md>
- Chat Agents: <https://github.com/cloudflare/agents/blob/main/docs/agents/chat-agents.md>
- Local fetched evidence: `C:\tmp\smart-search-evidence\chatus-agentic-20260716`

The source material was fetched from the official Cloudflare repository on 2026-07-16. Package versions were checked directly against the npm registry on the same date.

## Pinned Runtime Decision

| Package | Version decision | Reason |
| --- | --- | --- |
| `agents` | `0.17.4` | Current official Cloudflare Agent runtime. |
| `@cloudflare/ai-chat` | `0.9.3` | Supplies `AIChatAgent` and the supported React chat transport. |
| `ai` | `6.0.228` | `@cloudflare/ai-chat@0.9.3` declares `ai ^6.0.0`; AI SDK 7 is not compatible with that peer range. |
| `@ai-sdk/react` | `3.0.230` | Compatible with the `^3.0.204` peer range declared by the Cloudflare packages. |
| `@ai-sdk/openai` | `3.0.85` | AI SDK 6 generation, supports OpenAI-compatible providers through a configurable provider instance. |
| `@ai-sdk/anthropic` | `3.0.97` | AI SDK 6 generation, supports Anthropic-compatible providers through a configurable provider instance. |
| `react` / `react-dom` | `19.2.7` | Satisfies the Agents SDK React peer requirement and is the typed client runtime. |
| `vite` | `8.1.4` | Falls inside the Agents SDK supported Vite range (`>=6 <9`). |

Do not use unbounded `latest` ranges for this migration. The Cloudflare chat package currently trails the AI SDK major line, so package compatibility must be treated as one pinned runtime set.

## API Decisions

### Durable Agent

- Implement `TeamAgent extends AIChatAgent<Env>`.
- Add a dedicated Durable Object binding for `TEAM_AGENT`.
- Add a new Wrangler migration with `new_sqlite_classes: ["TeamAgent"]`; `AIChatAgent` requires SQLite for messages and resumable stream chunks.
- Keep the existing `UserState` class and migration during data migration. It remains a rollback source until Agent-owned records are verified.

### Routing And Identity

- Route the supported `/agents/team-agent/{instance}` path through `routeAgentRequest` only after the existing HttpOnly session has been authenticated.
- Derive an opaque Agent instance name from the authenticated internal user label. Never accept an arbitrary instance name supplied by a teammate.
- Return the opaque instance name in the authenticated session projection so the typed client can connect with `useAgent`.
- Reject cross-user Agent paths at the Worker gateway before they reach the Durable Object.

### Chat And Recovery

- Use `AIChatAgent.onChatMessage()` as the primary conversation execution boundary.
- Use `useAgent` plus `useAgentChat` in the typed client.
- Preserve resumable streaming and automatic message persistence instead of rebuilding a private WebSocket protocol.
- Use `sanitizeMessageForPersistence()` to remove provider metadata, secret-bearing tool payloads, and oversized domain data before SQLite persistence.
- Keep model context pruning separate from storage limits.

### Tools And Approval

- Convert only administrator-assigned tool schemas into AI SDK tools.
- Preserve server-side schema validation, bounded steps, call/time/size limits, SSRF checks, and redacted results.
- Use AI SDK/AIChatAgent human-in-the-loop approval messages for consequential tools.
- MCP discovery remains an administrator action. A discovered or changed schema is disabled until reviewed.

### Provider Routing

- Provider selection, credentials, fallback classification, quota, and telemetry remain application services. They are not copied into browser or Agent state.
- Use AI SDK-compatible OpenAI and Anthropic provider instances with per-route `baseURL`, headers, and credentials.
- Retry/fallback is allowed only before user-visible output has started and only for classified retryable failures.
- Record real-task outcomes after the normal Agent execution path. Do not add health prompts, doctor prompts, or synthetic completion endpoints.

## Explicit Non-decisions

- Do not use `ToolLoopAgent` as the top-level chat runtime. Official guidance positions it for subagents; `onChatMessage` needs direct access to Agent messages, environment, request metadata, and product policy.
- Do not expose Cloudflare's raw Agent instance naming as an authorization mechanism. The gateway session remains authoritative.
- Do not use the Agents SDK scheduler for provider liveness checks.
- Do not migrate Chatus into BIAU infrastructure or share BIAU identity, storage, secrets, or owner tools.
