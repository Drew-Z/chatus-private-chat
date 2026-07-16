# Current Runtime Audit

## Scope

Audited on 2026-07-16:

- `src/worker.ts`
- `public/app.js`
- `public/admin.js`
- `public/index.html`
- `public/admin.html`
- `public/styles.css`
- `tests/`
- `scripts/check-frontend.mjs`
- `scripts/smoke-production.mjs`
- `wrangler.jsonc`
- `.github/workflows/deploy.yml`
- `package.json` and `package-lock.json`

## Current Shape

- `src/worker.ts` is approximately 5,540 lines and owns authentication, sessions, configuration, secrets, provider protocols, fallback, quota, chats, memory, tools, MCP, audit, telemetry, Durable Object storage, and asset routing.
- `public/app.js` is approximately 3,357 lines; `public/admin.js` is approximately 2,650 lines; `public/styles.css` is approximately 5,096 lines.
- The browser client is framework-free and uses a custom HTTP/SSE capability protocol.
- `UserState` is the only Durable Object class. It stores quota, login throttles, aggregate metrics, cloud chats, deletion tombstones, active capability runs, and transient tool approval trust.
- Shared configuration, access codes, memory, secrets, feedback, audit, and route-health records use KV.
- Production release is correctly restricted to GitHub Actions. Local production Wrangler deployment is not part of the release path.

## Capability Disposition

| Capability | Disposition | Target owner |
| --- | --- | --- |
| Access-code login, HttpOnly session, CSRF/origin policy | Retain and extract | Edge gateway/auth module |
| Admin session and revisioned configuration | Retain and extract | Administration service |
| Per-user quota and login throttling | Retain; migrate quota into Agent-owned state | Gateway plus `TeamAgent` |
| OpenAI-compatible and Anthropic-compatible routes | Retain behavior; replace protocol orchestration with AI SDK providers | Provider router |
| Route allow-list, fallback, BYOK | Retain | Provider router and assignment repository |
| Cloud chats and resumable work state | Replace custom synchronization with Agent SQLite, import existing records idempotently | `TeamAgent` |
| Long-term memory string | Migrate into structured user-owned records | `TeamAgent` memory repository |
| Skills and built-in tools | Retain; normalize behind an assigned capability registry | Capability registry |
| MCP discovery, schema fingerprints, encrypted secrets, SSRF limits | Retain and extract | MCP/capability service |
| Custom capability SSE and `/api/tool-approvals` | Replace | `AIChatAgent` + `useAgentChat` approval protocol |
| Active route-health completion and six-hour cron | Remove | Passive real-task telemetry |
| `/healthz` | Retain and extend for both Durable Object bindings, with zero model calls | Infrastructure health |
| Static handwritten chat/admin applications | Replace | Typed Vite/React client |
| GitHub Actions release and production smoke | Retain and update for built assets and Agent binding | CI/release |

## Active Probe Conflict

The current implementation violates the confirmed reliability policy in three places:

1. `wrangler.jsonc` registers `17 */6 * * *`.
2. the Worker exports `scheduled()` and calls `runScheduledRouteHealthChecks()`;
3. `POST /api/admin/route-health` sends the prompt `17 x 23` and validates `391`.

The UI also labels these records as automatic inspection results. All of this must become passive readiness and real-task telemetry. Existing tests that assert scheduled or manual completion calls must be replaced with tests proving zero model calls.

## Migration Risks

- Existing cloud chat JSON and `AIChatAgent` UI messages are not the same schema. Import requires a versioned decoder and deterministic fixture coverage.
- Existing conversation-level tool trust is in memory only. The Agent runtime needs durable approval state or an explicit decision to keep approval per active run.
- Current fallback can move to another route before returning an SSE response. The AI SDK provider router must preserve the no-mid-stream-fallback rule.
- Provider and MCP keys currently resolve through several precedence layers. Extraction must preserve encrypted-record failure semantics and must not silently fall back after a managed decrypt failure.
- The service worker and GitHub release fingerprinting assume root-level handwritten assets. Vite output and PWA caching must be changed together.
- The local `main` branch contains four commits not on `origin/main`. History must remain intact and production deployment must not be assumed until GitHub Actions runs for the pushed commit.

## First Implementation Slice

The first slice should establish the durable Agent boundary without deleting legacy data:

1. install the pinned compatible runtime set;
2. add `TEAM_AGENT` and a new SQLite migration;
3. add authenticated Agent path routing and an opaque per-user instance projection;
4. add a minimal `TeamAgent` with model-free health/readiness methods and persistence sanitization;
5. remove the cron and active health endpoint behavior, replacing it with configuration readiness plus passive telemetry records;
6. add deterministic tests for cross-user Agent denial, binding health, passive route state, and zero model calls;
7. keep the existing chat client operational until the typed client migration slice is ready.

The retained legacy chat path is a temporary rollback source, not the target architecture. New product work must land on the Agent boundary.
