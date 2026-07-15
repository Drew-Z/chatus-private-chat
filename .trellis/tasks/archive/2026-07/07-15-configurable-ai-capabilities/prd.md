# Configurable tools, skills, and MCP

## Goal

Evolve Chatus from a multi-model chat workspace into a safely extensible AI workspace where administrators can configure reusable Skills, expose approved tools to models, and connect remote MCP servers while retaining per-user permissions, privacy, and Cloudflare deployment compatibility.

## Background

- The Worker currently supports `openai-chat` and `anthropic-messages` routes with text/image chat streaming and per-user system prompts (`src/worker.ts:38`, `src/worker.ts:69`).
- The stored browser message model currently recognizes only `user`, `assistant`, and `error` roles (`public/app.js:1020`). There is no persisted tool-call or tool-result representation.
- The current request path forwards normalized conversation context to one selected route and streams provider output back to the browser; it does not send provider `tools`, parse `tool_calls`, execute tools, or continue a model/tool loop.
- Route keys already have an authenticated encrypted server-side management path. MCP credentials must follow the same write-only principle rather than entering ordinary configuration or diagnostics.
- Production runs on Cloudflare Workers. The Worker cannot spawn local MCP `stdio` processes, so an initial MCP implementation can support only remote HTTP transports. Local MCP would require a separately operated gateway.

## Product Principles

- Treat Skills, tools, and MCP servers as separate concepts with explicit relationships.
- Keep the default chat experience simple when no capability is enabled.
- Grant capabilities by least privilege and make consequential tool execution visible to the user.
- Do not expose credentials, raw tool payloads, conversation content, or memory in logs, diagnostics, or admin reports. User-initiated conversation exports may contain normal conversation content and the persisted redacted tool timeline, but never secrets or raw tool arguments/results.
- Preserve route-level model, fallback, health, permission, and metric boundaries.

## MVP Scope

- Deliver one complete read-only vertical slice rather than a Skills-only prototype.
- Include administrator-configured Skills, multi-Skill selection per conversation, a provider-neutral tool loop for OpenAI-compatible and Anthropic routes, one built-in side-effect-free test tool, and one remote Streamable HTTP MCP connection path.
- The first release does not execute mutating tools. Its purpose is to validate the end-to-end capability, permission, message, provider, and remote transport contracts before consequential actions are introduced.

## Requirements

### R1. Skill registry

- Administrators can define reusable Skills with a name, description, instruction content, enabled state, and optional allowed-tool references.
- The persisted conversation contract uses an ordered `skillIds` collection rather than a singular Skill field so the design does not require a migration when Skill composition is introduced.
- Users can select up to three enabled Skills per conversation. Instructions are composed in administrator-defined registry order; the MVP does not add user drag ordering.
- The MVP does not add `defaultSkill`, `requiredSkill`, or user-level `allowedSkills` policy fields.
- Global system constraints and the user's permanent system prompt remain higher priority than selected Skill instructions.
- Selected Skill tool references are combined, then intersected with the user's effective tool permissions at request time. Skill selection never widens permissions.
- Selecting a Skill affects subsequent requests without silently changing stored user memory or the user's permanent system prompt.

### R2. Unified tool calling

- Chatus exposes a provider-neutral tool definition and execution contract, then adapts it to OpenAI-compatible and Anthropic request/response formats.
- A bounded model/tool loop validates arguments, executes an approved tool, returns the result to the same model route, and stops on completion, cancellation, timeout, or configured limits.
- A tool-capable request may use the existing route fallback plan only before any provider output or tool call has been accepted. Candidate fallback routes must support the same required capability set.
- After the first tool call is accepted, the loop is pinned to that route. A later provider failure stops the loop with a retryable error rather than crossing routes or risking duplicate tool execution.
- Routes declare whether tool use is supported and default to unsupported for backward compatibility; unsupported routes continue normal chat without receiving tool schemas.
- The MVP includes one built-in deterministic read-only tool so provider adaptation and tool-loop behavior can be tested without relying on an external service.

### R3. Tool registry and permissions

- Administrators can enable approved tools and assign them to Skills and users.
- Tools declare a stable ID, JSON input schema, risk level, confirmation policy, and executor type. The MVP applies fixed global runtime ceilings rather than per-tool administrator tuning.
- Newly configured or newly discovered tools are disabled and denied by default. They become usable only after an administrator explicitly enables them and adds them to the default or a specific user's effective `allowedTools` policy.
- If rediscovery changes a remote tool's schema, that tool is disabled again until an administrator reviews and explicitly re-enables it.
- Users see which tools are enabled and can review tool-call activity in the conversation.
- Explicit per-user capability restrictions are never widened by adding a Skill, tool, or MCP server.

### R4. Remote MCP configuration

- Administrators can configure remote MCP servers over supported HTTP transport, including endpoint, enabled state, authentication reference, and tool allow list.
- The MVP supports unauthenticated servers plus administrator-managed static `Authorization: Bearer` and `X-API-Key` credentials. These credentials reuse the existing encrypted, write-only secret-management contract.
- OAuth authorization-code flows, PKCE, authorization-server discovery, scope upgrades, token refresh, and dynamic client registration are deferred beyond the MVP.
- MCP discovery and invocation run server-side with bounded timeouts, response limits, redirect rules, and network destination validation.
- MCP credentials remain write-only and encrypted; they are not returned in normal configuration payloads.
- The MVP supports remote Streamable HTTP only and must reject local `stdio` or other unsupported transports.

### R5. Safety and consent

- Built-in deterministic read-only tools that make no external request may run automatically when enabled.
- A remote MCP tool requires confirmation on its first invocation in each conversation. The user can allow only that invocation or trust the same tool for the rest of the current conversation.
- Conversation-scoped trust expires when a new conversation starts and is not synced as a permanent account permission.
- Administrators can tighten a tool to always require confirmation. The MVP cannot configure a remote MCP tool for completely silent execution.
- Future mutating, external, or otherwise consequential calls require clear user confirmation before execution even if a related read-only tool was trusted.
- Tool and MCP execution records include non-sensitive operational metadata for auditability without storing raw secrets or unrestricted private payloads.
- Conversation storage, cloud sync, and backups retain only the tool ID, lifecycle status, timestamps, confirmation choice, and redacted size-bounded argument/result summaries needed to render the user-visible timeline.
- Full tool arguments and raw tool results exist only for the active execution loop and are not written to browser storage, cloud chat storage, backups, diagnostics, or admin reports.
- Regeneration reruns the tool under the current permission and confirmation policy rather than replaying a retained raw result.
- The runtime enforces fixed MVP ceilings of four tool rounds, eight total tool calls, fifteen seconds per call, and forty-five seconds of cumulative tool execution time.
- Each raw tool result is limited to 32 KiB. Persisted redacted result previews are limited to 2,000 characters.
- Reaching any ceiling stops the loop with a specific sanitized limit error visible to the model and user. The MVP does not expose administrator tuning controls for these ceilings.

### R6. Compatibility

- Existing chats, routes, BYOK, memory, branching, backups, offline behavior, rate limits, and provider fallbacks remain usable when capabilities are disabled.
- Tool-capable message storage and backups remain versioned, import existing versions without capability data, and reject unsupported future formats safely.
- Production deployment continues through GitHub Actions; no local production deployment path is added.

## Acceptance Criteria

- [x] AC1: Administrators can create, edit, enable, disable, and assign Skills without editing raw configuration JSON.
- [x] AC2: A supported OpenAI-compatible route can complete a bounded tool-call round trip using an approved test tool.
- [x] AC3: A supported Anthropic route can complete the same provider-neutral tool flow through its native message format.
- [x] AC4: Tool arguments are schema-validated, execution is cancellable and bounded, and failures are surfaced without leaking credentials or private payloads.
- [x] AC5: Users can select up to three Skills and see active Skill/tool context plus a readable timeline of pending, approved, running, completed, denied, and failed tool calls.
- [x] AC6: Explicit user capability allow lists remain unchanged when new tools, Skills, or MCP servers are added, and new or schema-changed tools remain disabled until reviewed.
- [x] AC7: Administrators can connect a fake remote Streamable HTTP MCP fixture using no auth, static Bearer, or static `X-API-Key`, discover tools, invoke one, and revoke or disable it without exposing plaintext credentials.
- [x] AC8: MCP requests reject unsupported transports and unsafe network destinations, redirects, oversized responses, and invalid tool schemas.
- [x] AC9: Existing non-tool chat behavior, provider streaming, storage, branches, sync, and backup imports remain backward compatible when all capabilities are disabled.
- [x] AC10: Focused tests cover provider adaptation, tool-loop limits, permission checks, confirmation policy, MCP transport safety, storage migration, and frontend structural contracts.
- [x] AC11: All project quality gates and desktop/mobile browser fixtures pass before shipping.

## Out Of Scope

- Local `stdio` MCP execution inside Cloudflare Workers.
- Arbitrary administrator-authored JavaScript or shell execution.
- An unrestricted public marketplace or automatic third-party Skill installation.
- Autonomous background agents, scheduled jobs, or unattended tool execution.
- Mutating tools or external side effects in the first release.
- Browser-side storage of MCP or tool credentials.
- MCP OAuth login, PKCE, authorization-server discovery, dynamic client registration, scope upgrades, or token refresh.
