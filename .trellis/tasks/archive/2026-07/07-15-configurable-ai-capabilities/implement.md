# Configurable tools, Skills, and MCP - Implementation Plan

## 1. Establish config and storage contracts

- [x] Add Skill, tool, MCP server, route tool-support, user `allowedTools`, conversation `skillIds`, and message `toolEvents` types in `src/worker.ts`.
- [x] Extend server normalization and validation with bounded closed-domain contracts and default-deny tool behavior.
- [x] Extend browser/admin config normalization without changing existing route defaults.
- [x] Add backup version 4 normalization while preserving imports from versions 1-3.
- [x] Add focused tests for missing fields, malformed registries, default deny, Skill ordering/cap, and round-trip cloud/backup storage.
- [x] Checkpoint: run `npm run typecheck` and focused Worker tests.

## 2. Add MCP secret management

- [x] Generalize the AES-GCM primitive by secret namespace while preserving existing route key names, AAD, precedence, and error behavior.
- [x] Add authenticated MCP secret list/write/delete endpoints with revision checks and metadata-only responses.
- [x] Add MCP secret admin state and write-only password controls; clear plaintext across every transition and failure path.
- [x] Add tests proving plaintext/ciphertext exclusion, namespace-bound AAD, rotation, deletion, conflict, managed-over-Worker precedence, and unreadable-record failure.
- [x] Checkpoint: run MCP/route secret tests, frontend structure checks, and `git diff --check`.

## 3. Add administrator capability configuration

- [x] Add one admin navigation section with Skill, tool, and MCP server tabs/segmented views.
- [x] Implement Skill CRUD, enabled state, deterministic order, instruction limits, and tool assignment.
- [x] Implement route `supportsTools` and user/default `allowedTools` editors.
- [x] Implement MCP server CRUD for endpoint, auth type, secret reference, and enabled state.
- [x] Add MCP discovery endpoint using saved secret references only.
- [x] Merge discovered tools so new or schema-changed tools are disabled and unchanged tools preserve policy.
- [x] Preserve config revision conflict handling, dirty editor protection, and advanced JSON editing.
- [x] Add static assertions for IDs, controls, no plaintext config path, and schema-change disable behavior.
- [x] Checkpoint: run `npm run check:frontend`, focused config/discovery tests, and `npm run typecheck`.

## 4. Add the provider-neutral runtime and built-in tool

- [x] Install `@modelcontextprotocol/sdk`, `zod`, and `@cfworker/json-schema` as runtime dependencies.
- [x] Implement tool ID/provider alias mapping and JSON Schema argument validation with the Cloudflare-compatible validator.
- [x] Implement `builtin:text_stats` and normalized size-bounded results.
- [x] Implement OpenAI-compatible non-streaming tool turns and provider-native transient history.
- [x] Implement Anthropic non-streaming tool turns and provider-native transient history.
- [x] Implement four-round/eight-call/15-second/45-second/32-KiB limits and stable sanitized errors.
- [x] Implement pre-response route fallback and route pinning after the first accepted provider response.
- [x] Add adapter tests for text-only completion, one and multiple tool calls, malformed arguments, provider errors, fallback, and loop ceilings.
- [x] Checkpoint: run focused adapter/runtime tests, `npm run typecheck`, and `npx wrangler deploy --dry-run`.

## 5. Add remote Streamable HTTP MCP execution

- [x] Build the official SDK client with explicit subpath imports and `CfWorkerJsonSchemaValidator`.
- [x] Add HTTPS endpoint validation, forbidden destination checks, same-origin bounded fetch, manual redirect rejection, static auth headers, and cancellation.
- [x] Add bounded paginated discovery and reject required tasks or unsupported tool metadata.
- [x] Verify the stored schema fingerprint before invocation and keep one ephemeral client per server per active run.
- [x] Normalize text/structured MCP results; reject unsupported content and oversized envelopes/results.
- [x] Close/terminate clients and clear credentials/results on every completion and failure path.
- [x] Add fake Streamable HTTP fixture tests for no auth, Bearer, X-API-Key, discovery, invocation, schema changes, redirects, unsafe URLs, timeout, malformed protocol, and oversized data.
- [x] Checkpoint: run MCP tests, `npm run typecheck`, and `npx wrangler deploy --dry-run`.

## 6. Add Durable Object confirmation coordination

- [x] Add bounded in-memory active-run and conversation-trust maps to `UserState`.
- [x] Add `runCapabilityChat` returning a streaming `Response` over Workers RPC.
- [x] Add application SSE events for run, tool lifecycle, confirmation, assistant text, finish, error, and done.
- [x] Add the authenticated `/api/tool-approvals` endpoint and one-shot pending approval resolution.
- [x] Implement once/conversation/deny choices, admin `always`, 120-second approval timeout, stream cancellation, and cleanup.
- [x] Keep raw arguments/results only in active closures; assert they never enter SQL, KV, audit, response metadata, or stored chat summaries.
- [x] Add concurrent tests that approve/deny a pending call while the original response stream remains open.
- [x] Add UserState tests for trust isolation by chat ID, timeout, replay rejection, cleanup, and object-safe failure behavior.
- [x] Checkpoint: run UserState and capability API tests plus `npm run typecheck`.

## 7. Add the chat capability experience

- [x] Extend `/api/session` and browser boot state with bounded public Skills/tools.
- [x] Add a compact Skill selector with native checkboxes, three-Skill cap, administrator order, and per-conversation persistence.
- [x] Add `chatId` and normalized `skillIds` to chat requests.
- [x] Branch stream parsing by `X-Chatus-Stream` while preserving the existing provider stream parser.
- [x] Render compact tool lifecycle rows inside assistant messages with accessible Lucide controls.
- [x] Wire once/conversation/deny confirmation actions and disable stale controls immediately.
- [x] Persist only redacted summaries; normalize interrupted pending/running events to failed.
- [x] Preserve branch, edit, resend, regenerate, export, import, cloud sync, offline view, and route metadata behavior.
- [x] Update service-worker assets only if a new public module is introduced.
- [x] Add structural assertions for selection, event parsing, confirmation, persistence, backup version 4, and touch-visible controls.
- [x] Checkpoint: run `npm run check:frontend`, focused Worker tests, and `npm run typecheck`.

## 8. Full verification

- [x] Exercise built-in tool success on one OpenAI-compatible fixture.
- [x] Exercise built-in tool success on one Anthropic fixture.
- [x] Exercise remote MCP discovery, first-call confirmation, conversation trust, always-ask policy, denial, timeout, disable/revoke, and schema-change failure.
- [x] Verify a non-tool conversation still uses the existing streaming path byte-for-byte at the browser contract boundary.
- [x] Verify default-deny permissions for new/discovered tools and Skill/user intersection.
- [x] Verify raw credentials, arguments, results, endpoints, schemas, prompts, conversation text, and memory stay out of diagnostics/audit/admin reports.
- [x] Run browser fixtures at 1440x960 and 390x844 in light and dark modes for chat and admin capability states.
- [x] Inspect screenshots and computed bounds for clipping, overflow, overlapping controls, readable previews, focus states, and touch usability.
- [x] Run `npm run check:frontend`.
- [x] Run `npm test`.
- [x] Run `npm run typecheck`.
- [x] Run `npx wrangler deploy --dry-run`.
- [x] Run `git diff --check`.

## Risk and rollback points

- MCP SDK bundle/runtime incompatibility: stop after the first dry-run checkpoint; do not compensate by enabling broad Node compatibility without reviewing the bundle and imports.
- Route regression: keep the legacy no-tool path structurally separate and covered by existing stream tests.
- Approval stream interruption: fail the active run, clear in-memory state, and require user retry; never persist raw continuation state.
- Secret regression: preserve route-secret keys/AAD and run the full existing route-secret suite after the namespace refactor.
- Provider-format drift: keep all `unknown` parsing in the two adapter boundaries and reject malformed turns rather than coercing them.
- MCP schema drift: disable changed tools on discovery and fail runtime fingerprint mismatches closed.
- Storage growth: enforce event/preview/count limits before cloud serialization and backup export.
- UI density regression: keep the capability selector and tool rows compact; verify mobile and touch layouts before expanding styling.
- If a checkpoint fails, revert the current stage only. Empty/disabled capability config keeps ordinary chat operational throughout implementation.
