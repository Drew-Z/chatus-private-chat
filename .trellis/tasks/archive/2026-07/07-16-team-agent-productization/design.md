# Design: Chatus Team Agent Productization

## Target Architecture

Chatus remains one Cloudflare application and one independently deployed repository, but its internal boundaries become explicit:

1. **Edge gateway**: validates access-code sessions, admin sessions, CSRF/origin rules, request limits, and asset/API routing.
2. **Per-user Agent**: a Cloudflare Agents SDK instance backed by Durable Objects owns conversation execution, resumable streams, task state, approvals, durable user context, and run traces.
3. **Provider router**: resolves the user's logical model, ordered provider offerings, protocol adapter, server-managed or BYOK credential, provider-capacity lease, fallback chain, timeout, and redacted result telemetry.
4. **Capability registry**: resolves assigned Skills, tools, and MCP servers; validates schemas and confirmation policies before the Agent sees them.
5. **Administration service**: owns users/access codes, route definitions, encrypted secret references, assignments, quotas, audit records, and passive reliability views.
6. **Typed web client**: a component-based frontend uses the Agents SDK client transport for streaming and recovery while ordinary administration APIs remain explicit HTTP contracts.

The application should continue to deploy as a Worker with static assets. It does not need separate public services or a shared BIAU database.

The product-level capability model is domain-neutral. The initial curated pack focuses on programming and project collaboration, while future packs can add research, writing, operations, or other trusted-work workflows without changing identity, storage, routing, or security boundaries.

## State Ownership

| Data | Owner | Storage direction |
|---|---|---|
| Session and access-code mapping | Edge/admin boundary | Existing secure cookie and KV-backed records, migrated without exposing raw codes |
| User conversations and task state | Per-user Agent | Agent/Durable Object SQLite |
| Durable user memory | Per-user Agent | Structured Agent SQLite records with user-visible controls |
| Route and capability assignments | Administration service | KV initially, behind typed repository interfaces |
| Provider and MCP secret material | Administration service | Cloudflare Secrets or encrypted KV records; never Agent/client state |
| Provider capacity leases and waiters | Provider Coordinator Durable Object | One deterministic instance per provider ID, with expiring active leases and bounded in-memory waiters |
| Usage and real-task reliability | Per-user Agent plus aggregate admin view | Durable counters/events with redacted aggregation |
| Public assets and PWA metadata | Web client | Versioned static assets |

Existing data should be imported through idempotent migration code. No destructive cleanup occurs until user identity, conversations, quotas, and memory have been verified in the new runtime.

### Agent Instance Facets

The per-user Agent identity has two server-derived facets so the runtime can use the
Cloudflare AIChat persistence model without trusting browser-selected Durable Object
names:

- One opaque root `TeamAgent` instance per teammate owns the conversation index,
  structured long-term memory, migration markers, and deletion bookkeeping.
- One opaque conversation `TeamAgent` instance is derived from the authenticated
  teammate plus `chatId`. It owns the native AIChat message transcript, resumable
  stream, cancellation state, and tool approval continuation for that conversation.
- The browser sends only a bounded `chatId`. The gateway authenticates the request and
  derives both instance names; a client-supplied Agent instance name is never used as
  an authorization decision.
- Legacy `UserState` chats and KV memory remain import sources and rollback records.
  Import is idempotent, creates new Agent transcripts, appends only when the existing
  transcript is an exact prefix, and never deletes the source records during bootstrap.
- Root Agent memory is authoritative for `/api/memory`, `/api/agent/memory`,
  administrator memory controls, legacy prompt construction, and Agent turns. KV
  memory is read only during idempotent bootstrap and retained as rollback evidence.
- Writes from the rollback client synchronize new or prefix-compatible transcripts
  into the Agent boundary. A divergent Agent transcript is never replaced by an old
  snapshot, and a tombstoned conversation ID cannot be recreated by either client.
- Conversation deletion writes the root tombstone and a persistent transcript-cleanup
  record before cleanup is attempted. Later Agent entry/list requests retry bounded
  pending cleanup work until the conversation Agent transcript and tool trust are clear.

## Agent Execution Flow

1. The gateway authenticates the teammate and resolves a stable internal user ID.
2. The request is routed to that user's Agent instance.
3. The Agent loads compact conversation context, structured durable memory, and assigned capability metadata.
4. The capability registry exposes only allowed Skills and tools.
5. The provider router executes the selected model route and applies fallback only for classified retryable failures.
6. Tool calls pass schema validation, policy checks, limits, and any required user approval before execution.
7. The Agent streams the response and run events, persists the completed turn, and records redacted real-task telemetry.
8. Any proposed durable memory change is shown under the configured confirmation policy.

The Agent is responsible for deciding whether retrieval, a Skill, a tool, or ordinary reasoning is appropriate. The UI does not require the user to preselect an intent category.

## Logical Model And Provider Pool

The public model catalog and the physical provider inventory are separate domains:

- `RouteConfig` remains the stable logical model and permission identifier during migration. It owns the teammate-facing label, fallback logical models, capability flags, and an ordered list of provider offerings.
- `ProviderConfig` owns one real endpoint/account instance: protocol, Base URL, encrypted `apiKeyRef`, headers, BYOK policy, concurrency policy, and default priority.
- A provider offering links one logical route to one provider and one upstream model ID. It may override priority and capability flags without copying credentials.
- Legacy routes that still contain `type`, `baseUrl`, `model`, and `apiKeyRef` are normalized into an implicit single offering so existing deployments remain usable.

Candidate order follows the useful parts of CLIProxyAPI's scheduler: discard disabled/unavailable candidates, choose the highest administrator priority, and use passive model/provider quality as a tie-breaker. Chatus does not copy CLIProxyAPI's local credential files or treat failure cooldown as an active-request lock.

Fallback plans retain each exact logical-route/provider pair, so a provider may be tried again for a different upstream model after a pre-output model-specific failure. Capacity acquisition still submits at most one waiter per provider in a single selection round; a later same-provider candidate can acquire only after the earlier attempt releases its lease.

Each limited provider maps to one deterministic `ProviderCoordinator` Durable Object. `exclusive` means capacity one; `bounded` uses `maxConcurrent`; `unlimited` bypasses the coordinator. Acquisition is atomic for the provider ID, not for a route or model, so using any offered model closes every other new exit through that provider until release.

The router first attempts ordered candidates without waiting. Occupied candidates are skipped while any lower-ranked candidate is immediately available. Only when all eligible candidates are occupied does the router register bounded waits, selecting the first lease granted within a shared 10-second deadline and cancelling any losing waits. Lease tokens have a TTL, are released in `finally`/stream cancellation paths, and are pruned by the coordinator alarm after failures.

Fallback still cannot cross a visible-output boundary. A busy provider is a pre-output retryable condition; a successful stream keeps its provider lease until finish, failure, or cancellation.

Passive reliability is keyed by logical route plus provider ID. Administrator priority is authoritative; recent success, timeout, server failure, and latency only order candidates at the same priority and never create active probes.

### Provider Pool Administration Surface

The provider router is already the runtime source of truth, but its management surface must converge into the typed product:

- A **Providers** view owns provider identity, protocol, Base URL, write-only credential reference/readiness, concurrency policy, capacity, queue timeout, and default priority.
- A **Logical Models** view owns the teammate-facing route label, enabled/capability flags, fallback logical models, and an ordered offering table. Each offering selects one provider plus the exact upstream model ID and optional overrides.
- A **Reliability** projection joins each logical-model/provider pair with configuration readiness and passive real-task evidence: recent outcome, total latency, time to first visible output when known, fallback use, and whether the response arrived progressively or as one visible chunk.
- Provider model discovery is an explicit read operation against the selected saved provider. Importing selections mutates only offerings through the revisioned config boundary; it never reads a credential into browser state or grants routes to members.
- The typed admin becomes the primary workflow. `/admin.html` remains a rollback surface until provider, logical-model, secret, discovery, and passive-health acceptance pass, then its corresponding route editor can be retired separately.

No external LiteLLM/CLIProxyAPI deployment is required. Chatus keeps its current Cloudflare-native coordinator because provider-wide exclusive leases, per-member policy, encrypted KV credentials, and passive telemetry already live inside this product boundary. An external OpenAI-compatible gateway remains a valid provider endpoint, not the owner of Chatus permissions or user-visible logical models.

### Durable Conversation Branching

Message editing and regeneration reuse the legacy product rule: preserve the source transcript and create a linked conversation branch.

- Add one narrow authenticated branch operation owned by the Agent conversation boundary. Its input identifies the source conversation, source message, action (`branch`, `edit`, `resend`, `regenerate`, or `continue`), the source conversation version, and edited text only when required.
- The server resolves the authenticated source Agent, validates that the message and action are compatible, copies a bounded sanitized transcript prefix, and creates a destination conversation with `parentChatId` before generation begins.
- The destination conversation inherits the source logical route and selected Skills after re-validating current member access. Revoked routes/Skills are repaired to the current allowed defaults rather than copied blindly.
- The original transcript is never overwritten. A partially created destination is tombstoned/cleaned through the existing conversation cleanup path, and a client request ID makes retries idempotent.
- The response returns the new conversation projection and enough transient state for the client to activate it. It never returns provider metadata, credentials, raw tool payloads, or another user's transcript.
- Simple copy and feedback remain in-place actions. Retry after a rejected pre-stream request may reuse the current draft; retry/regenerate after an assistant attempt creates a branch so the original outcome remains inspectable.

### Stream Experience Contract

The provider stream and the user-visible state are related but not identical:

1. `submitted`: the request is accepted and the Agent is preparing policy, context, candidate order, or provider capacity.
2. `waiting-first-output`: a provider attempt is active but no user-visible delta has committed the route. The UI shows a neutral thinking row, elapsed time after a short threshold, and Stop.
3. `streaming`: the first visible text/reasoning/tool/source part commits the selected offering and renders progressively.
4. `tool-running` / `approval-required`: tool parts own their existing bounded status and approval controls.
5. `recovering`: the client reconnects to the resumable stream without duplicating the user turn.
6. `completed`, `stopped`, or `failed`: the composer and message actions return to their stable availability matrix.

The client can derive the basic phases from `useAgentChat` status plus whether the last assistant message has visible parts. Server-side passive telemetry records first-visible and completion timing for the exact route/provider pair. A provider that emits one visible delta near completion is classified as single-chunk/buffered evidence for administrators; the client does not animate the completed text to imitate streaming.

## Frontend Direction

Replace the large handwritten `public/app.js`, `public/admin.js`, and shared CSS surface with a typed Vite/React client that still builds into Worker assets. Use stable routes for sign-in, chats, memory, capabilities/settings, and administration. Reuse the current product's proven behavior rather than preserving its file layout.

The React teammate client is the default root shell; `/legacy/` remains an independent
rollback shell and `DEFAULT_CLIENT=legacy` remains the emergency root switch. Service
worker navigation caches stay isolated for root, React, legacy, and admin shells. Network
`404` and `5xx` navigation responses may use the matching cached shell, while authorization
and rate-limit responses remain visible and an absent cache preserves the original error.

The main workspace should prioritize the conversation and current task. Route, Skill, and tool details belong in compact inspectable controls and run traces, not permanent explanatory walls. Mobile behavior must preserve normal vertical scrolling, avoid overlapping navigation, and make tool approval usable without horizontal page scrolling.

The transcript uses a centered readable column with unframed assistant content and a compact user bubble. Message actions sit immediately below their owning message, stay visible for the latest message and all touch layouts, and use icon buttons with tooltips/accessible labels. User actions are copy/edit/resend/branch; assistant actions are copy/regenerate/feedback/branch and conditional continue. Less-frequent actions may move into an overflow menu only after keyboard and touch access are verified.

The composer remains sticky and stable while status text changes. Waiting, streaming, recovering, offline, and error rows have reserved dimensions so they do not resize the composer or move the transcript. Desktop keeps a dense conversation rail; mobile uses the existing focus-managed drawer and full-width transcript without horizontal scrolling.

The typed administration migration keeps member route, Skill, and tool assignments in one atomic revisioned draft. Route definitions and provider credentials remain in the full legacy administration surface for now. Member route editing distinguishes inherited access, all-route intent (`allowedRoutes: []`), and explicit route lists; keeps an enabled allowed default route; and rebases those intentions onto the latest configuration after a revision conflict without overwriting unrelated member fields.

Member login access uses a separate revision from capability configuration. The typed surface creates, rotates, and revokes one member through narrow server-generated credential operations; only create/rotate returns the code, while list/revoke projections remain exact and secret-free. Rotate/revoke invalidate sessions for that label, but revocation never deletes configuration or user-owned data. A separate revision-checked member-config operation removes all matching `config.users` overrides and restores defaults without touching access, sessions, or user data. Session management reports cleanup completeness independently. The typed lifecycle keeps a last-entry lockout guard. In legacy mode this also prevents an empty KV override from falling back to the deployment Secret; managed production deliberately ignores that Secret and exposes a `managed` empty source while the first member is being created. Cloudflare Assets serves the typed admin shell through the `/react-chat/` directory entry so `/react-chat/admin` is preserved rather than canonicalized to the chat URL.

## Route Reliability Without Model Probes

- Remove the production cron that invokes route health completions.
- Keep `/healthz` limited to binding reachability and configuration shape.
- Build route readiness from enabled/configured state and secret-reference presence without revealing values.
- Record real-task outcomes using a bounded taxonomy: success, timeout, upstream authentication class, upstream rate-limit class, upstream server class, protocol error, fallback success, and fallback exhaustion.
- Display `unknown` when no real task has used a route recently. Unknown is not treated as unhealthy.
- Manual route validation requires an explicitly approved useful task and uses the same normal Agent path, not a hidden diagnostic endpoint.

## Security Boundary

- Preserve HttpOnly sessions, origin/CSRF checks, timing-safe secret comparison, per-user rate limits, and response security headers.
- Provider and MCP credentials never enter Agent state, logs, run traces, browser storage, exported chats, or memory.
- MCP remains HTTPS-only with destination validation, bounded redirects, response limits, schema fingerprint checks, and confirmation policies.
- Agent callable methods expose narrow typed operations and re-check identity/capability authorization server-side.
- Administration endpoints and Agent endpoints remain separate; being a valid teammate does not grant administration access.

## BIAU Boundary

Chatus can later consume a public-safe BIAU MCP endpoint for published project, status, and content facts. The integration is read-only, separately authenticated, optional, and subject to Chatus capability assignment. It cannot access BIAU Operator sessions, owner memories, Studio write/publish APIs, Git operations, or cloud administration.

## Migration And Rollback

1. Add the modular runtime and Agent binding alongside deterministic migration tests.
2. Import one non-production fixture user and verify conversations, quotas, memory, routes, and capabilities.
3. Migrate existing user records idempotently while retaining the prior data for rollback.
4. Switch the new typed client to the Agent transport after API and reconnect tests pass.
5. Remove scheduled active probes and enable passive telemetry before production activation.
6. Deploy only through GitHub Actions and retain the previous Worker version for rollback.
7. Remove old static/runtime code only after production acceptance and data verification.

Because the project is not yet generally released, compatibility is subordinate to correctness and maintainability. Data preservation and rollback remain mandatory even when old UI/API compatibility is dropped.
