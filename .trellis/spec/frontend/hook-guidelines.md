# Hook Guidelines

## Overview

The default client uses React hooks plus the Cloudflare Agents SDK hooks. Legacy pages continue to use browser lifecycle and event listeners wired by page modules.

## Event Patterns

- React effects must declare their owning entity dependencies and clean up listeners, animation frames, and stale async generations.
- Small custom hooks may wrap stable browser lifecycle state, such as online/offline status; do not hide server mutations or ownership changes inside opaque hooks.
- Legacy pages register listeners once at module initialization. Event handlers validate input, update module state, then call focused render/persistence helpers.
- Use `beforeunload` only for real unsaved state. The React administrator workspace warns for dirty revisioned editors and one-time credential state; the legacy chat page does not own administrator drafts.
- Keep service-worker lifecycle behavior in `public/pwa.js` and `public/sw.js`, not in page controllers.

## Data Fetching

- React Agent streaming uses authenticated `useAgent` and `useAgentChat`; ordinary JSON endpoints use the runtime-validating helpers in `client/src/lib/api.ts`.
- The authenticated session projection owns the Agent instance and `basePath`. For the current SDK, `basePath` is `agent` without a leading slash; `chatId` is passed as a query value and never as an authorization decision.
- Legacy pages use their shared page-level request helper for JSON endpoints, credentials, response parsing, and bounded timeouts.
- Non-streaming requests use `fetchWithTimeout`; streaming `/api/chat` remains user-cancellable through its AbortController and does not use a fixed timeout.
- Surface rate-limit type and retry timing to the UI instead of collapsing daily and minute limits into one error.
- Preserve optimistic-concurrency fields such as `expectedRevision` and `expectedUpdatedAt` on writes and deletes.

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
