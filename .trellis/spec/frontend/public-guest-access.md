# Public Guest Access

## Scenario: Restricted Anonymous Chat Session

### 1. Scope / Trigger

- Trigger: changing anonymous access, session projection, route access, Agent preparation, guest quotas, guest cleanup, or the React workspace behavior for unauthenticated visitors.
- The contract spans `POST /api/guest-session`, `GET /api/session`, `/api/chat`, `/agent`, conversation metadata APIs, `client/src/lib/api.ts`, and the workspace shell.

### 2. Signatures

```text
POST /api/guest-session
  -> SessionProjection with access: "guest"

GET /api/session
  -> SessionProjection | 401

POST /api/chat
POST /agent?chatId=:chatId
```

```typescript
type GuestSession = {
  id: string;
  label: `guest-${string}`;
  kind: "guest";
  createdAt: number;
  lastSeen: number;
  expiresAt: number;
  sourceKey: `guest-source:${string}`;
};

type PublicAccessConfig = {
  enabled: boolean;
  routeId: string;
  sessionTtlSeconds: number;
  dailyMessageLimit: number;
  minuteMessageLimit: number;
  sourceDailyMessageLimit: number;
  sourceMinuteMessageLimit: number;
};
```

KV cleanup records use `guest-cleanup:<13-digit-expiresAt>:<encoded-label>` and store only `{ label, expiresAt }`.

Root guest cleanup ownership is persisted as `chatus:guest-cleanup-ticket:v1`:

```typescript
type AgentGuestCleanupTicket = {
  version: 1;
  markerKey: string;
  expiresAt: number;
  attempts: number;
  nextAttemptAt: number;
  terminalAt: number;
  lastError: "guest_cleanup_failed" | "guest_account_cleanup_failed" | "workspace_account_purge_failed" | "workspace_r2_delete_failed";
};
```

The Root `TeamAgent` schedules `runCleanupSchedule` at the earliest due cleanup record. Retry delay is `min(5s * 2 ** (attempts - 1), 5m)` and automatic work stops after 8 attempts while retaining a terminal ticket for aggregate inspection.

### 3. Contracts

- Guest sessions are real server sessions. Never special-case anonymous users by sharing a fixed label or bypassing `getSession()`.
- A guest projection has at most one route. It is either unavailable with `routes: []` and `defaultRoute: ""`, or it exposes exactly `publicAccess.routeId`.
- Guest route access requires a usable managed route secret. Worker Secret fallback, legacy plaintext keys, BYOK, Skills, tools, MCP, custom user prompts, long-term memory, exports, feedback, branch actions, and account-data actions are denied server-side.
- `/api/chat` and `prepareTeamAgentTurn()` must both reject a guest-selected route other than `publicAccess.routeId` with `route_not_allowed` before provider planning.
- Guest-provided `sessionSummary`, `skillIds`, `userApiKey`, and any user custom system prompt must not create provider system messages.
- Guest quotas consume both a per-session bucket and a `sourceKey` bucket. If source admission fails after personal admission, refund the personal bucket. One guest turn lease is allowed per guest label.
- Guest cleanup is not a model liveness probe and must not use cron health checks. Store the cleanup index beside the session without a KV TTL; ordinary API/Agent requests may drain a bounded batch with `ctx.waitUntil()` only after cross-origin mutation checks have passed, while the Root alarm owns eventual convergence.
- Guest cleanup marker ownership is transferred to the Root ticket before attempting deletion. UserState, Root/conversation Agents, Workspace objects/metadata, and sessions must succeed before the marker is deleted; `completeGuestCleanup()` is the final Root-side operation. A failed dependency keeps the marker and ticket, including when the session TTL has already elapsed.
- Cleanup failures persist only stable allowlisted codes (`guest_cleanup_failed`, `guest_account_cleanup_failed`, or the relevant workspace/account code). Raw exception messages, labels, object keys, prompts, and provider payloads never enter the ticket, aggregate summary, or logs.
- The React decoder rejects guest projections that include multiple routes, member capabilities, Skills/tools, BYOK, user system prompt state, or image capability that does not match the exposed route.
- The guest workspace renders a fixed route label and member-login action. It hides member-only controls from the UI, while the server remains the authority.

### 4. Validation & Error Matrix

- Public access disabled -> `POST /api/guest-session` returns `404 public_access_disabled`; member login remains available.
- Missing or unusable guest route -> guest projection may be created with no routes; no fallback route is exposed.
- Forged guest route in `/api/chat` or `/agent` -> `403 route_not_allowed`; no provider fetch.
- Guest member-only API call -> `403 capability_not_allowed`.
- Expired guest session -> delete the session, clean guest data, and reject with `401`.
- KV session expires before cleanup -> bounded cleanup drain uses the cleanup index to purge the guest label.
- TeamAgent/UserState/Workspace dependency unavailable -> return the request's normal auth/cleanup result, retain the marker and due ticket, and retry from the Root alarm; never delete the marker on `Promise.allSettled()` completion alone.
- Automatic cleanup attempts reach 8 -> set `terminalAt`, stop scheduling that ticket, and retain only aggregate terminal evidence for inspection.
- Guest concurrent turn -> `429 concurrent_turn` and any consumed guest/source quota is refunded.
- Malformed guest projection in the browser -> `invalid_session_response` instead of rendering a widened model/member surface.

### 5. Good / Base / Bad Cases

- Good: two browsers with no cookie call `POST /api/guest-session`, receive different guest labels and Agent instances, and both can use only the same public logical route.
- Base: the selected public route is temporarily unavailable, so the guest UI shows no route and the composer is disabled without revealing a member model.
- Bad: a guest body includes `sessionSummary` and the Worker turns it into a system message for the provider.
- Bad: the browser accepts a guest projection with two routes and shows the first route while sending through a different default route.
- Bad: relying only on KV session TTL makes the guest label unreachable after expiry, leaving Agent/UserState data behind.
- Bad: delete the KV marker before `releaseWorkspaceAccountPurge()` and `completeGuestCleanup()` both succeed, or persist the raw caught exception as `lastError`.

### 6. Tests Required

- Worker tests cover isolated guest sessions, managed-secret-only public route exposure, forged route rejection for `/api/chat`, denied member APIs, guest->member rotation, quota/source buckets, one-turn concurrency, and cleanup after both explicit expiry and missing session TTL.
- Cleanup tests inject each owned backend failure, assert the marker remains, advance a local fake alarm past `nextAttemptAt`, and assert recovery deletes the marker last. They also assert backoff/cap/terminal retention, legacy marker adoption, bounded batches, and aggregate-only inspection fields.
- Agent turn tests cover forged route rejection and prove guest `sessionSummary`, stale Skill IDs, and BYOK strings do not reach prepared provider messages.
- Client decoder tests accept valid guest/unavailable projections and reject widened guest projections.
- Browser workspace tests cover fixed guest model display, member-login entry, hidden memory/route controls, and no horizontal overflow at the workspace viewport matrix.
- No test may contact a real provider, run a liveness probe, log a credential, or include prompt/conversation content from a real user.

### 7. Wrong vs Correct

#### Wrong

```typescript
const sessionSummary = String(body.sessionSummary || "");
const messages = await buildMessagesWithSystem(env, session, normalized, sessionSummary, access.user, selectedSkills);
```

This lets an anonymous visitor inject custom system context.

#### Correct

```typescript
const messages = await buildMessagesWithSystem(env, session, normalized, sessionSummary, access.user, selectedSkills);

// Inside the shared builder:
if (session.kind === "member" && sessionSummary.trim()) {
  systemMessages.push({ role: "system", content: formatSummary(sessionSummary) });
}
```

The shared system-message boundary enforces the guest/member split for both `/api/chat` and Agent turns.

### Cleanup Ordering

```typescript
await purgeGuestOwnedData();
await root.releaseWorkspaceAccountPurge(operationId, generation, true);
await env.CHAT_STORE.delete(markerKey);
await root.completeGuestCleanup(markerKey);
```

The marker is durable ownership, not a best-effort notification. Any failure before the final two operations records a stable retry code and leaves the marker available to the Root alarm.
