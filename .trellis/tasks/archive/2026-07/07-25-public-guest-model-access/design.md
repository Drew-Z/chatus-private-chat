# Public Guest Access and Member Model Gate - Design

## Architecture

Use a real restricted server session, not an authentication bypass:

```text
Browser without cookie
  -> POST /api/guest-session
  -> opaque HttpOnly guest cookie + exact SessionProjection
  -> authenticated Worker/Agent boundary
  -> guest policy resolves exactly one logical route
  -> existing provider pool resolves only candidates inside that route
```

Member login remains a separate identity transition:

```text
guest cookie -> POST /api/login -> revoke guest token -> new member cookie -> member projection
```

## Contracts

### Session storage

```typescript
type Session = {
  id: string;
  label: string;
  kind: "guest" | "member";
  createdAt: number;
  lastSeen: number;
  expiresAt: number;
};
```

Development/test session records without `kind` are invalidated and deleted, forcing a fresh login. Guest labels use a reserved, unpredictable internal prefix and are never accepted from client input.

### Public-access configuration

```typescript
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

This configuration contains only a logical route ID and bounded policy values. Provider endpoint/model/credential data continues to live in provider-pool configuration and managed route secrets.

### Session projection

```typescript
type SessionProjection = {
  access: "guest" | "member";
  capabilities: {
    imageInput: boolean;
    memory: boolean;
    messageActions: boolean;
    feedback: boolean;
    accountData: boolean;
  };
  // Existing exact-decoded fields remain.
};
```

The server returns explicit policy. UI components never infer authorization from a `guest-*` label.

## Server Flow

1. `POST /api/guest-session` enforces same-origin mutation rules and validates public-access configuration.
2. Reuse a valid guest cookie or generate a high-entropy token and subject. Store the bounded session with TTL.
3. `getSession()` validates kind, expiry, global guest enablement, and member enablement.
4. `getRouteAccess()` receives the session actor. Guest access is synthesized from the single configured logical route with BYOK, Skills, tools, MCP, and system prompt disabled.
5. `/api/session`, `/api/chat`, and `/agent` consume the same actor policy. A guest-selected route other than `routeId` returns `403 route_not_allowed`.
6. Quota consumption reserves both the per-guest bucket and the source-abuse bucket before provider execution. Failed pre-output work follows the existing quota/refund policy consistently.
7. Guest Agent data uses the unique subject. Expiry schedules bounded transcript cleanup and makes stale reconnects fail closed.

## Client Flow

1. `fetchSession()` returns `null` for 401.
2. The chat app attempts one `createGuestSession()` call, then renders the normal workspace with a guest projection.
3. A single guest route is rendered as a fixed model label rather than a selector.
4. Explicit capability flags hide member-only controls. Member login/access is available from the workspace header; there is no public registration UI.
5. Successful login replaces the cookie, clears guest-scoped local drafts, fetches a member projection, and remounts the Agent client identity.
6. Logout returns to a fresh guest session when public access is enabled.

## Validation And Error Matrix

| Condition | Result |
| --- | --- |
| Public access disabled | Guest bootstrap `404` or exact disabled response; login remains available |
| Invalid/missing guest route | Guest session may render unavailable state; no fallback expansion |
| Forged guest route | `403 route_not_allowed` before provider planning |
| Expired guest token | Delete token, return 401, allow a fresh bootstrap |
| Guest calls member-only API | `403 capability_not_allowed` |
| Source quota exceeded | `429` with bounded retry timing, no source identity |
| Login succeeds | New member token; old guest token revoked |
| Login fails | Guest session remains usable within guest policy |

## Security And Privacy

- Never reuse one guest label.
- Never expose provider IDs, upstream model IDs, base URLs, credentials, source IPs, or Durable Object names to guests.
- Keep cross-origin mutation rejection ahead of body parsing and storage writes.
- Do not persist raw source IP. Use the platform's Durable Object name derivation for an opaque source bucket.
- Do not add model health probes. Availability remains passive real-request evidence.
- Public rollout should be staged behind `publicAccess.enabled`; Turnstile/WAF can be added later if passive abuse data warrants it.

## Compatibility And Rollback

- Existing development/test sessions without the new actor kind are invalidated. Member access/configuration remains intact, so users can log in again.
- Disabling public access is the rollback switch and must not alter member access codes or provider configuration.
- The provider selected for guests remains an ordinary logical route; changing the guest route requires only revisioned admin configuration.
- No production deployment occurs locally.

## Model Discovery Decision

The exact upstream model ID will be determined through the existing saved-provider model discovery after the exposed credential is revoked and its replacement is stored through the write-only administrator flow. This is a one-time administrator action, not a model completion, health check, or periodic probe. The discovered model is then attached to an ordinary provider offering and logical route before that route is selected for guests.

## Authentication Decision

Public self-registration is explicitly deferred. The MVP keeps administrator-issued access codes, ships restricted guest access, and leaves verified self-registration for a separate child task with its own identity and recovery design.
