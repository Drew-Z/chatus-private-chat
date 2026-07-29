# Admin Safety and Error Recovery

## Goal

Give the React admin workspace explicit, safe, recoverable, and accessible behavior for logout, initial loading, long lists, and destructive actions.

## Requirements

- R1. Leave the React authenticated state only after the server confirms that logout revoked the session. On failure, keep the workspace open and show a retryable error.
- R2. Initial admin data loading has mutually exclusive `loading | ready | error` states. Error state offers retry and never appears alongside stale loading UI.
- R3. Each operations list shows `displayed N / total`, keeps counts correct after search, and exposes item 21 and later through pagination or expansion.
- R4. Replace every `window.confirm` in the composed React admin workspace with one shared, accessible React dialog.
- R5. The dialog supports cancel/confirm, initial and restored focus, Escape, pending/error states, and explicit titles and targets for dangerous actions.
- R6. Preserve server-side origin/CSRF protection and the legacy `/admin.html` rollback address.
- R7. Tests use only local APIs and fixtures and never print admin tokens or member content.

## Acceptance Criteria

- [x] AC1. Network, 5xx, or revocation failures during logout do not call `onLogout`; success clears the cookie/session and enters the login state.
- [x] AC2. AdminWorkspace and operations initial loading each have automated coverage for loading, ready, error, and successful retry behavior.
- [x] AC3. Every operations list with more than 20 items shows the correct displayed/total count and exposes its last item; filtering updates the count in sync.
- [x] AC4. React admin code contains no `window.confirm`; every prior confirmation path uses the shared dialog.
- [x] AC5. Dialog keyboard behavior, focus restoration, cancel/confirm paths, and mutation failure state have automated coverage.
- [x] AC6. Workspace Playwright, Worker API tests, and all five full validation commands pass.

## Out of Scope

- First-use setup guidance and hiding legacy navigation are not implemented in this task; the next child task owns them.
