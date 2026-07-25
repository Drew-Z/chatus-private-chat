# PRD: Chatus Team Agent Productization

## Goal

Turn Chatus from a capable but monolithic private chat Worker into a maintainable, invitation-only general private work Agent for trusted teammates, with programming and project collaboration as its first bundled capability pack. The final product must use a formal Cloudflare-native Agent runtime, preserve administrator-controlled model routing and tools, provide durable per-user work context, and remain operational without arbitrary model liveness prompts.

## Confirmed Facts

- Chatus is an independent Cloudflare Worker product deployed through GitHub Actions only.
- Access-code login, HttpOnly sessions, per-user quotas, route allow-lists, fallback routing, optional BYOK, cloud chats, long-term memory, feedback, and administration already exist.
- Per-user strongly consistent state is stored in the `UserState` Durable Object; shared configuration, access data, memories, route metadata, and administration records use KV.
- The runtime already supports OpenAI-compatible and Anthropic-compatible providers, bounded tool loops, JSON Schema validation, explicit tool confirmation, Skills, built-in tools, remote MCP discovery, encrypted managed secrets, timeout controls, and audit records.
- The current implementation concentrates most backend responsibilities in `src/worker.ts` and most client/admin behavior in large static files under `public/`, which makes further product evolution and isolated verification difficult.
- `src/worker.ts` currently schedules route-health calls, `/api/admin/route-health` can send active model requests, and `wrangler.jsonc` registers a six-hour cron. This conflicts with the policy that model channels must not receive arbitrary liveness prompts.
- The local `main` branch is ahead of `origin/main`. Existing commits must not be rewritten, force-pushed, or assumed to be deployed.

## Requirements

### R1. Private Team Product Boundary

- Chatus is a separately branded teammate Agent, not a BIAU Operator subpage and not a public anonymous chatbot.
- Its product scope is a general private work Agent. Programming and project collaboration ship as the first bundled capability pack rather than constraining the entire runtime to coding use cases.
- Admission remains invitation/access-code based; public self-registration is not added.
- Each teammate receives an isolated identity, conversations, memory, limits, permitted model routes, Skills, tools, and MCP capabilities.
- Chatus must not share BIAU cookies, databases, private memories, model credentials, or administrator credentials.

### R2. Formal Cloudflare Agent Runtime

- Replace the hand-assembled chat orchestration boundary with the current Cloudflare Agents SDK and an explicit per-user Agent instance backed by Durable Objects.
- The Agent runtime owns conversation state, durable work context, resumable execution, tool approval state, and model/tool traces.
- Existing provider adapters, fallback rules, quota enforcement, tool schemas, MCP restrictions, and security controls are preserved as explicit services around the Agent rather than remaining entangled in one request handler.
- Implementation must verify current Agents SDK APIs against official Cloudflare documentation before code is written.

### R3. Administrator-controlled Capability Assignment

- Administrators can assign each teammate a default route, allowed routes, fallback policy, limits, enabled Skills, allowed tools, and allowed MCP servers.
- A teammate can see the capabilities available to them but cannot discover other users, secret values, disabled routes, or administrator-only diagnostics.
- BYOK remains optional and can be disabled globally, per user, or per route.
- Configuration changes remain revision-checked and auditable.

### R4. Passive Route Reliability

- Scheduled and automatic minimal-completion model probes are disabled by default and removed from the normal production reliability path.
- Route status is derived from configuration readiness, infrastructure health, and redacted telemetry from real user tasks: recent success, timeout, provider HTTP class, fallback use, and last real-task timestamp.
- A model call may be used for validation only when a user explicitly approves a real, useful task. There is no hidden ping, doctor, or synthetic prompt.
- Infrastructure `/healthz` remains model-free and checks only Worker bindings, durable state availability, and non-secret configuration readiness.

### R4A. Logical Model And Provider Pool Routing

- Teammates select a logical model name rather than a physical upstream route. One logical model may be backed by multiple provider instances, and one provider instance may offer multiple logical models.
- A provider instance owns its protocol, endpoint, encrypted credential reference, concurrency policy, and administrator priority. Model offerings reference a provider instance plus the upstream model ID instead of duplicating provider credentials.
- Candidate offerings are ordered first by administrator priority and then by passive real-task quality for that exact logical-model/provider pair. No synthetic model probe is introduced.
- An `exclusive` provider instance permits one active upstream model request across all of its models and all teammates. While occupied, it accepts no new request for either the same model or another model; the active request is never interrupted.
- A bounded provider instance permits the configured number of active requests. An unlimited provider instance does not acquire a concurrency lease.
- A request skips an occupied provider when another candidate for the selected logical model is immediately available. When every eligible candidate is occupied, it waits up to 10 seconds for the first available candidate, then returns a stable busy response.
- Provider leases are released on success, upstream failure, stream cancellation, and client disconnect. Expiring leases recover capacity after Worker or upstream failures without requiring an administrator action.
- Existing one-route-per-upstream configuration remains readable and is projected as a single-provider logical model during migration.

### R4B. Provider Pool Product Surface

- The implemented logical-model/provider runtime must be visible as one coherent administrator workflow rather than a typed member screen plus a separate legacy route editor.
- Administrators manage a provider inventory, logical model catalog, and offering mappings as distinct concepts. One provider can serve many models, and one logical model can use many ordered providers without duplicating credentials.
- The provider surface shows protocol, endpoint identity, write-only credential readiness, capacity policy, administrator priority, offered upstream model IDs, and passive real-task quality. It never returns plaintext credentials or sends synthetic model probes.
- Model discovery remains provider-scoped. Adding discovered models creates or merges credential-free offerings and never expands member permissions implicitly.
- Members continue to select logical models only. Physical providers, secret references, internal failure payloads, and other members' assignments remain administrator-only.
- Recent real-task diagnostics distinguish waiting for provider capacity, time to first visible output, upstream authentication/rate-limit/server failures, protocol incompatibility, and buffered or single-chunk responses without recording prompts or completions.

### R5. Safe Skills, Tools, And MCP

- The Agent selects relevant Skills and tools from the user's assigned allow-list; users do not need to manually classify every request.
- Tool execution keeps bounded rounds, bounded calls, schema validation, timeout/size limits, SSRF protections, redaction, and explicit confirmation for consequential actions.
- Remote MCP servers are disabled until an administrator discovers and reviews their tool schemas.
- Tool results and errors are visible in a concise run trace without exposing secrets or raw private payloads to other users.

### R6. Durable Work Context And Privacy

- Long-term memory is user-owned, inspectable, editable, and deletable.
- The product distinguishes conversation history, durable preferences/facts, task artifacts, and administrator configuration instead of storing them as one undifferentiated memory string.
- Memory writes are proposed by the Agent and require an explicit policy or user confirmation; private conversation content is never copied into public BIAU knowledge.
- Data export, session revocation, and user deletion have documented behavior.

### R7. Product-grade Web Experience

- Replace the oversized static client/admin scripts with a typed, component-based web client that supports Agent streaming, reconnect/resume behavior, tool approvals, run traces, route/fallback visibility, memory controls, chat history, and mobile/PWA use.
- First-use states explain only the next required action and do not expose a wall of configuration text.
- Provider failures are translated into actionable, non-secret diagnostics such as timeout, upstream status class, route unavailable, fallback used, or configuration missing.
- Accessibility, responsive layout, loading, empty, degraded, offline, and permission-denied states are covered.
- A submitted turn has explicit queued/waiting-first-output, streaming, tool-running, recovering, stopped, and failed states. After a short threshold the UI shows elapsed waiting time and keeps the stop action available.
- Genuine upstream deltas render progressively. When an upstream buffers and returns one complete response, the client does not fake token streaming; it keeps a clear waiting state and the administrator diagnostics identify the buffered behavior.
- User-message actions include copy, edit in a branch, resend in a branch, and create branch. Assistant-message actions include copy, regenerate in a branch, feedback, create branch, and continue when output was truncated. Failed turns expose a focused retry action.
- Editing, resending, and regenerating preserve the original conversation. Branch creation is durable, server-authorized, quota-aware, and linked to its parent conversation.
- Message actions remain discoverable on touch layouts, keyboard accessible on desktop, disabled while their owning run is active, and never depend on hover as the only way to find them.
- The workspace uses a restrained responsive hierarchy: a scannable conversation rail, centered readable transcript, compact route/status header, sticky composer, and stable message/action dimensions across desktop and mobile.

### R8. Optional Read-only BIAU Integration

- A later integration may attach a narrow read-only BIAU MCP server for public project, status, and published-content lookup.
- Chatus must not receive BIAU Operator write tools, Studio publish permissions, repository credentials, or owner memory.
- BIAU integration is optional and cannot block standalone Chatus operation.

### R9. Operations And Open-source Readiness

- Production deployment remains GitHub-Actions-only; local production `wrangler deploy` is prohibited.
- Configuration and deployment documentation must support a clean third-party installation using placeholders and generated secrets without exposing the maintainer's production values.
- Deterministic tests cover authentication, state isolation, routing/fallback, quota, memory, tool approval, MCP restrictions, passive telemetry, migration, and frontend contracts without live model calls.

## Acceptance Criteria

- [ ] Chatus runs on a formal Cloudflare Agents SDK boundary with one isolated durable Agent identity per teammate.
- [ ] Invitation-only authentication and administrator capability assignment work without public registration.
- [ ] Existing route adapters, fallback, BYOK, quota, memory, Skills, tools, MCP, and audit capabilities survive the migration under explicit module boundaries.
- [ ] Automatic and scheduled model liveness prompts are absent; `/healthz` and normal diagnostics make zero model calls.
- [ ] Real-task telemetry provides redacted route reliability and fallback evidence.
- [x] A logical model can use multiple ordered provider offerings, and one provider credential can be reused by multiple models without redeployment.
- [x] Exclusive and bounded provider capacity is enforced atomically across teammates and across every model offered by the provider; all-busy requests wait no longer than 10 seconds.
- [x] Lease release, cancellation, expiry recovery, pre-output fallback, legacy route compatibility, and provider/model configuration validation have deterministic tests without live model calls.
- [x] Typed administration exposes provider inventory, logical models, offerings, capacity, credential readiness, model discovery, and passive health without revealing secret material.
- [ ] The web client supports streaming/recovery, history, memory, tool approvals, run traces, mobile/PWA states, and actionable errors.
- [ ] Slow turns show a truthful waiting/first-output/streaming state; local fake-provider tests cover delayed SSE, single-chunk output, provider-busy timeout, cancellation, and recovery without live model calls.
- [ ] Copy, edit, resend, regenerate, feedback, branch, continue, and failed-turn retry actions follow role/state availability rules and preserve the source conversation.
- [ ] Desktop and 390px touch acceptance confirms readable transcript width, stable composer/actions, visible touch controls, keyboard focus, no horizontal overflow, and no overlapping UI.
- [ ] User data and credentials remain isolated from BIAU Operator and from other Chatus users.
- [ ] README, operations docs, environment examples, and CI describe a clean installation and GitHub-Actions-only release flow.
- [ ] `npm run check:frontend`, `npm test`, `npm run typecheck`, `npx wrangler deploy --dry-run`, and `git diff --check` pass with no live model calls.

## Out Of Scope

- Public anonymous registration or an open consumer chat service.
- Sharing BIAU Operator authentication, databases, private memory, credentials, or write-capable tools.
- Modifying the concurrently developed `D:\workspace4Cursor\learn\duoduo` repository.
- Local production deployment or force-pushing the four existing local commits.
- Active provider probes disguised as diagnostics or test prompts.
- Fake typewriter animation that presents a buffered upstream response as real provider streaming.
- Copying a competitor's visual system or adding every available chat action before its data and branch semantics are defined.
