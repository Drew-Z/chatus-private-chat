# Implementation plan: Quota-aware member composer

1. Trace session/usage types and the terminal send lifecycle.
2. Expose a safe usage refresh callback from the app shell.
3. Refresh after turns and derive composer quota state from server values.
4. Add explanatory disabled UI and focused tests.
5. Run frontend checks, focused tests, typecheck, and `trellis-check`.
