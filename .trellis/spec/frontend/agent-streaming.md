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
