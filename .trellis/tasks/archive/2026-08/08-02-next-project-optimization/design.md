# Design: Member Logout Fail-Closed Recovery

## Boundary

This task aligns ordinary member logout with the existing admin fail-closed contract. The Worker response schema does not change. The implementation tightens the React decoder and introduces explicit member-workspace pending/error/retry state. There is no storage migration, cookie-format change, or new endpoint.

## Client API Contract

`client/src/lib/api.ts` will implement member logout through the same `requestJson()` boundary used by admin logout:

```typescript
async function logout(): Promise<void>
```

The request is `POST /api/logout` with included credentials. A successful response is exactly:

```json
{ "ok": true }
```

The decoder rejects unknown keys, false/missing `ok`, arrays, null, empty bodies, and non-JSON bodies with `ApiError("invalid_logout_response", ..., 502)`. `requestJson()` remains responsible for network and non-2xx errors so the component receives one typed failure channel.

## Workspace State Machine

`ChatWorkspace` owns a closed logout state:

```text
idle -> pending -> success (workspace unmounts)
                 -> error -> pending (retry)
```

- `pending` joins the existing account-operation busy boundary, so repeated logout and conflicting account/MCP/conversation operations cannot start.
- `WorkspaceHeader` receives an explicit `logoutPending` projection. The logout button remains icon-only, disabled while pending, and changes its accessible label/title to `正在退出登录`.
- `error` renders a dedicated `role=alert` row with the normalized error message and a `重试退出` button. It does not reuse the conversation-refresh button because that action would not retry revocation.
- Existing generic `workspaceError` remains independently owned by conversation refresh/mutation failures.

## Draft And Session Ordering

The current ordering is reversed:

```text
before: clear member drafts -> request logout -> refresh session
after:  request logout -> exact success -> refresh session -> clear member drafts
```

`onLogout()` in `App` continues to call the exact API first, then switches to loading and refreshes the session. `ChatWorkspace` calls `clearUserDrafts(session.user)` only after `onLogout()` resolves. The closure may finish after the workspace begins unmounting, but the draft cleanup remains bound to the captured member identity. If the API rejects, `App` never changes state and cleanup is not called.

Successful logout may resolve to a public guest session or the login surface depending on deployment configuration. The contract is loss of the old member session, not one hard-coded post-logout surface.

## Worker Contract And Failure Injection

`handleLogout()` already performs the authoritative order:

```text
read cookie/session -> delete session KV -> guest cleanup if applicable -> exact response + clearing cookie
```

No Worker production behavior should change. A new integration test will proxy `CHAT_STORE.delete()` to reject only the target member session key. The test proves:

1. The first request returns `500` with no clearing cookie.
2. The original session KV record and `/api/session` remain valid.
3. Retrying against the real store returns exact `{ ok: true }`, emits `Max-Age=0`, removes the session, and makes the old cookie unauthorized.

This test complements, rather than replaces, the existing admin failure test.

## Browser Evidence

### Workspace fixture

Add a deterministic member-logout presentation fixture using real presentational components only. It exercises idle, pending, error, and retry controls without mounting Agent hooks or calling `/api`. Desktop and touch-390 assertions cover accessible labels, alert/action visibility, containment, and no horizontal overflow.

### Local Agent acceptance

Add a separate real App/Worker scenario to `tests/browser/agent-e2e/`:

1. Log in with the runtime-only member access code.
2. Fill a draft and capture the member user identifier/provider counters.
3. Intercept the first `/api/logout` as a synthetic `500` without forwarding it.
4. Assert the member workspace and draft stay mounted and the retry alert is visible.
5. Let the retry reach the local Worker; assert the member session is left, member draft keys are gone, and Provider counters did not change.

The interception contains no credentials or user content in logs/artifacts.

## Compatibility

- Admin logout remains unchanged.
- Guest login and automatic guest creation remain unchanged.
- `revokeAllSessions()` and `deleteUserData()` already perform their authoritative server mutation before calling `onLogout()`; they retain their current ordering and cleanup behavior.
- No API schema, storage record, Durable Object migration, R2 object, Queue message, OAuth token, or Provider telemetry changes.

## Accessibility And Layout

- Pending state is exposed through the button label/title and disabled state, not color alone.
- The failure row uses `role=alert`; retry is a text command because it is not a familiar standalone icon action.
- Retry remains keyboard reachable and the existing workspace layout owns containment at all supported widths.
- No focus is forcibly moved on failure; the disabled logout button remains in place and the retry action enters the normal tab order.

## Rollback

The change is client-side state/decoder hardening plus tests. Reverting the work commit restores the previous UI without data migration. The Worker remains fail-closed throughout rollback. No production resource cleanup is required.
