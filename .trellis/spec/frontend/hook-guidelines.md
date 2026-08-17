# Hook Guidelines

## Overview

The default client uses React hooks plus the Cloudflare Agents SDK hooks. Legacy pages continue to use browser lifecycle and event listeners wired by page modules.

## Event Patterns

- React effects must declare their owning entity dependencies and clean up listeners, animation frames, and stale async generations.
- Small custom hooks may wrap stable browser lifecycle state, such as online/offline status; do not hide server mutations or ownership changes inside opaque hooks.
- Legacy pages register listeners once at module initialization. Event handlers validate input, update module state, then call focused render/persistence helpers.
- Use `beforeunload` only for real unsaved state. Typed React admin editors register it through the composed workspace boundary.
- Keep service-worker lifecycle behavior in `public/pwa.js` and `public/sw.js`, not in page controllers.

## Data Fetching

- React Agent streaming uses authenticated `useAgent` and `useAgentChat`; ordinary JSON endpoints use the runtime-validating helpers in `client/src/lib/api.ts`.
- The authenticated session projection owns the Agent instance and `basePath`. For the current SDK, `basePath` is `agent` without a leading slash; `chatId` is passed as a query value and never as an authorization decision.
- Legacy pages use their shared page-level request helper for JSON endpoints, credentials, response parsing, and bounded timeouts.
- Non-streaming requests use `fetchWithTimeout`; streaming `/api/chat` remains user-cancellable through its AbortController and does not use a fixed timeout.
- Surface rate-limit type and retry timing to the UI instead of collapsing daily and minute limits into one error.
- Preserve optimistic-concurrency fields such as `expectedRevision` and `expectedUpdatedAt` on writes and deletes.
- Advisory availability reads still expose failures. Keep the last successful projection on refresh failure, mark it stale, and offer a manual read retry; never turn that retry into an active Provider or model probe.

## Naming Conventions

- Name handlers and helpers by action: `saveActiveDraft`, `restoreActiveDraft`, `commitPendingSessionDeletion`.
- Use `on...` only when the function is specifically an event callback; otherwise prefer a domain action name.
- Keep listener wiring close enough to initialization that duplicate registration is easy to spot.

## Common Mistakes

- Starting overlapping async work for the same entity; use in-flight sets/maps where the code already does so for summaries and cloud saves.
- Allowing deleted chats to re-enter a delayed save queue.
- Assuming the active chat is still the source of an async result.
- Fire-and-forgetting a `sendMessage()` promise and clearing the only draft copy before rejection is observed.
- Allowing logout, chat switching, or destructive actions while a resumable Agent run is still active.
- Adding periodic or lifecycle behavior without cleanup, deduplication, or a visibility/focus check.

## Scenario: Conditional Transcript Follow

### 1. Scope / Trigger

- Trigger: changing streaming transcript growth, message-list scrolling, or the end-of-transcript anchor.

### 2. Signatures

```typescript
useTranscriptFollow({ conversationId, followKey, active }): {
  messageListRef;
  endRef;
  trackTranscriptScroll;
}
```

### 3. Contracts

- Coalesce repeated stream updates into at most one `requestAnimationFrame` callback and cancel pending work on unmount.
- Reset follow mode when the conversation changes. Continue following while the viewport is near the bottom.
- Content growth at an unchanged `scrollTop` is not evidence that the user scrolled away. Disable follow only after an explicit upward scroll direction outside the near-bottom threshold; reaching the bottom enables it again.
- Recheck follow state inside the scheduled frame so a user scroll that occurs after scheduling wins.
- Streaming and reduced-motion scrolling use `behavior: "auto"`; smooth behavior is reserved for inactive, non-reduced-motion transitions.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Multiple tokens arrive in one frame | Run only the latest scheduled callback once |
| Content height grows without upward movement | Preserve follow mode |
| User scrolls upward beyond the threshold | Cancel subsequent automatic following |
| User returns near the bottom | Re-enable following |
| Conversation changes | Reset to following and move to the new end anchor |

### 5. Good / Base / Bad Cases

- Good: streaming remains pinned while the reader is at the end, but an upward reader stays exactly where they moved.
- Base: a completed response follows with normal motion preference behavior.
- Bad: infer intent only from the post-growth bottom distance, or schedule one smooth scroll per token.

### 6. Tests Required

- Pure tests cover frame coalescing/cancellation, the bottom threshold, content-growth stability, explicit upward scrolling, and return-to-bottom.
- Synthetic browser coverage verifies follow and manual-scroll preservation without an Agent or model request.
- The local fake-provider Agent suite verifies the same behavior against real streaming transport.

### 7. Wrong vs Correct

#### Wrong

```typescript
useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages]);
```

#### Correct

```typescript
const transcript = useTranscriptFollow({ conversationId, followKey: messages, active: isStreaming });
```

## Scenario: Bounded Non-Streaming Browser Requests

### 1. Scope / Trigger

- Trigger: adding or changing a browser request in `client/src/lib/api.ts` that expects an ordinary finite HTTP response.

### 2. Signatures

```typescript
fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit, timeoutMs?: number): Promise<Response>
```

### 3. Contracts

- The default deadline is `DEFAULT_API_TIMEOUT_MS` (30 seconds).
- The helper composes its internal deadline with `init.signal`; caller cancellation remains caller cancellation.
- Timers and caller-signal listeners are removed on every success or failure path.
- Shared JSON/form boundaries translate only the helper's deadline into `ApiError { code: "request_timeout", status: 0 }`.
- Streaming Agent/chat transports keep their own cancellation and timeout rules and do not use this helper.
- The client never automatically retries a mutating request.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Response settles before the deadline | Return it and clear timer/listener state |
| Internal deadline wins | Abort fetch and expose `request_timeout` at the API boundary |
| Caller signal aborts first | Preserve the caller abort; do not relabel it as timeout |
| Fetch rejects independently | Preserve existing `network_unavailable` normalization |
| Timeout is negative or non-finite | Reject the helper call as invalid configuration |

### 5. Good / Base / Bad Cases

- Good: a stalled logout request aborts and leaves an actionable retry state.
- Base: a normal read completes and has no live timer afterward.
- Bad: apply a fixed deadline to a streaming response or automatically replay a timed-out mutation.

### 6. Tests Required

- Use fake timers and an abort-aware fetch double for success, deadline, caller abort, cleanup, and API-error normalization.
- Keep stream tests separate and assert the finite-request helper is not introduced into the Agent transport.

### 7. Wrong vs Correct

#### Wrong

```typescript
const response = await fetch(path, init); // may wait forever
```

#### Correct

```typescript
const response = await fetchWithTimeout(path, init);
```
