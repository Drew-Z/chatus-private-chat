# Public Guest Access and Member Model Gate

## Goal

Open the chat workspace to anonymous visitors while allowing each visitor to use exactly one administrator-selected logical model. Authenticated members retain their assigned model, Skill, tool, memory, and account capabilities.

## Background

- Today every ordinary `/api/*` route after login/logout and the `/agent` transport require an opaque cookie session. The React app renders the workspace only after `/api/session` succeeds.
- The session label partitions Agent instances, conversations, memory, usage, and exports. A shared `guest` label would expose one visitor's state to another and is forbidden.
- Model access is already enforced server-side by logical route IDs through `getRouteAccess()` and provider planning. Browser model hiding is presentation only.
- Member admission is currently administrator-issued access codes. There is no public registration, password store, email verification, OAuth, or account-recovery flow.
- Provider credentials are already resolved only inside the Worker. The credential pasted into chat must be revoked and must never appear in this task, source control, logs, browser state, or diagnostics.

## Requirements

### R1. Isolated guest identity

- An unauthenticated same-origin browser can request a short-lived opaque guest session.
- Every guest receives an unpredictable, browser-specific subject. Guest sessions, conversations, usage, and Agent instances cannot be shared across visitors.
- Session records distinguish `guest` from `member`, carry an expiry, and are rejected after expiry or when public access is disabled.
- Login replaces the guest session with a new member session. Guest history is not migrated in the first release.

### R2. One server-enforced guest model

- Administrators can enable public access and select exactly one existing enabled logical route ID.
- Guest session projection contains only that logical route. BYOK and any fallback outside that logical route are forbidden.
- A forged route ID must be rejected by both `/api/chat` and `/agent`; it must not silently grant or fall back to a member-only route.
- If the selected route is disabled, missing, or has no usable managed credential, guest chat enters a controlled unavailable state without exposing another route.
- The upstream endpoint, model ID, and replacement credential are configured through the existing provider/logical-model administration and managed secret storage, not embedded in public-access configuration.
- After a replacement credential is saved through the write-only administrator flow, an administrator-authorized model-list discovery request may determine the exact upstream model ID. It must not send a chat/completion request or become a periodic liveness probe.

### R3. Restricted guest capability surface

- The first guest release supports plain chat and capability-approved image input only.
- Guest BYOK, Skills, tools, MCP, custom system prompts, long-term memory, export, branching/editing, feedback, and account-data actions are disabled server-side and hidden in the UI.
- A guest sees a compact member-login/access entry point. Authenticated members keep the current workspace behavior.

### R4. Abuse and resource controls

- Guest message quotas are configurable. The approved first-release defaults are a 24-hour session, 20 messages per day, 6 messages per minute, one concurrent turn, and no guest-history migration on login.
- A second abuse bucket is keyed by Cloudflare source identity/IP through server-side Durable Object naming so clearing cookies does not fully reset limits. Raw IP values are never logged or returned.
- Request, context, output, tool, and image limits remain bounded.
- Guest conversation data is short-lived and is deleted or made unreachable through a bounded cleanup mechanism after expiry.
- Public access can be disabled immediately without deleting member configuration.

### R5. Authentication boundary

- Existing member access-code login continues to work without weakening session revocation or member assignment.
- Public self-registration is not part of this task. Membership continues to be created by an administrator, and visitors use the restricted guest session until they receive an access code.
- A future self-registration task must separately choose an identity provider, verification, recovery, abuse protection, and terms/privacy surface before implementation.

### R6. Typed administration and observability

- Public-access configuration uses typed, revision-checked admin APIs and UI. It never accepts or returns a provider key.
- Session projections expose an exact access kind and explicit capability policy; components do not infer guest status from labels or route count.
- Operational metrics may include bounded guest/member counts and failure classes, but never source IP, prompt, response, conversation ID, or credential data.

## Acceptance Criteria

- [ ] Two fresh browsers receive different guest tokens and isolated Agent/conversation/usage state.
- [ ] A guest session projects exactly the configured logical route and rejects a forged member route in both transport paths.
- [ ] Guest BYOK, Skills, tools, MCP, memory, export, branch/edit, feedback, and account-data APIs are unavailable even when called directly.
- [ ] Disabling or breaking the guest route produces a controlled unavailable state and never expands route access.
- [ ] Guest and source-abuse quotas are atomic, retry-aware, and cannot be reset solely by clearing the session cookie.
- [ ] Guest expiry and cleanup are deterministic; member sessions and data remain untouched.
- [ ] Login rotates identity to a member session; member route assignments and current login behavior do not regress.
- [ ] Admin configuration is revision-safe, exact-decoded, and secret-free.
- [ ] Browser acceptance covers guest bootstrap, single-model UI, login transition, desktop, and 390px touch layouts without model calls.
- [ ] Required release gates pass and production deployment remains GitHub Actions-only.

## Out Of Scope

- Guest history migration into a member account.
- Anonymous tools, MCP, Skills, memory, BYOK, or data export.
- Provider credential entry in the public browser.
- Turnstile, external identity providers, or public self-registration.
- Live provider probing or model liveness checks.
