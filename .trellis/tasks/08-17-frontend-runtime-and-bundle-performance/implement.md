# Implementation plan: Frontend runtime and bundle performance

1. Inspect build output boundaries and current service-worker fetch handling.
2. Lazy-load role workspaces with an accessible fallback/error path.
3. Add runtime caching for fingerprinted same-origin chunks.
4. Refactor streaming status projection and coalesce bottom-follow scrolling.
5. Add focused unit/browser tests and compare build output.
6. Run frontend checks, focused tests, typecheck, dry-run bundle validation, and `trellis-check`.
