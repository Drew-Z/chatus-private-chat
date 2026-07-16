# Design: Chatus Team Agent Productization

## Target Architecture

Chatus remains one Cloudflare application and one independently deployed repository, but its internal boundaries become explicit:

1. **Edge gateway**: validates access-code sessions, admin sessions, CSRF/origin rules, request limits, and asset/API routing.
2. **Per-user Agent**: a Cloudflare Agents SDK instance backed by Durable Objects owns conversation execution, resumable streams, task state, approvals, durable user context, and run traces.
3. **Provider router**: resolves the user's allowed route, protocol adapter, server-managed or BYOK credential, fallback chain, timeout, and redacted result telemetry.
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
| Usage and real-task reliability | Per-user Agent plus aggregate admin view | Durable counters/events with redacted aggregation |
| Public assets and PWA metadata | Web client | Versioned static assets |

Existing data should be imported through idempotent migration code. No destructive cleanup occurs until user identity, conversations, quotas, and memory have been verified in the new runtime.

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

## Frontend Direction

Replace the large handwritten `public/app.js`, `public/admin.js`, and shared CSS surface with a typed Vite/React client that still builds into Worker assets. Use stable routes for sign-in, chats, memory, capabilities/settings, and administration. Reuse the current product's proven behavior rather than preserving its file layout.

The main workspace should prioritize the conversation and current task. Route, Skill, and tool details belong in compact inspectable controls and run traces, not permanent explanatory walls. Mobile behavior must preserve normal vertical scrolling, avoid overlapping navigation, and make tool approval usable without horizontal page scrolling.

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
