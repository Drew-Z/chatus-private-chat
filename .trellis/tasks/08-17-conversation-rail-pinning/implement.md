# Implementation plan: Conversation rail pinning

1. Trace conversation projection, update endpoint, rail rendering, and ordering.
2. Add/confirm the typed pin update contract.
3. Add accessible pin/unpin control with in-flight and error behavior.
4. Derive pinned-first stable ordering.
5. Add component/API tests, run frontend checks and typecheck, then `trellis-check`.
