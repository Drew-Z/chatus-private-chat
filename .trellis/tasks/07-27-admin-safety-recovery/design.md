# Design: Admin Safety and Error Recovery

## Logout Contract

`adminLogout()` does not swallow failures. It returns explicit success or throws a structured API error. The server returns 2xx only after deleting the session from KV, and the client calls `onLogout()` only after that success. Failure keeps the current page open and displays a notice. Cookie clearing and revocation stay atomic from the client's perspective, avoiding a logged-out UI with a still-valid server session.

## Async View State

AdminWorkspace and operations each use a discriminated union: `loading`, `ready(data)`, or `error(message)`. Refresh may retain old data with a non-blocking busy state, but an initial load error renders neither ready content nor indefinite loading.

## Long Lists

Use a stable page size of 20. State contains query and page, with filtering before pagination. Each heading shows the currently displayed count and filtered total. Previous/next controls make item 21 keyboard-accessible.

## Confirmation Dialog

Add a shared `ConfirmDialog`. Callers provide the title, description, confirm label, tone, focus fallback, and an asynchronous confirmation action. The dialog owns the pending and error state for each confirmation attempt; callers communicate mutation success or failure by resolving or rejecting the action. A React-managed `<dialog>` centralizes focus and close constraints. Panels hold only the pending action and do not duplicate DOM, mutation-state, or focus logic.

## Tests

Behavior-first tests cover state transitions and the dialog. The visual fixture grows to 21+ items and covers error/retry. Worker logout tests simulate KV delete failure and verify status, cookie, and session semantics.

## Rollback

The API error contract and shared dialog can be rolled back independently. The server session data format does not change.
