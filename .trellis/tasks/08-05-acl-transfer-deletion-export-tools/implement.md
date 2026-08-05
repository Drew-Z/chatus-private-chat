# ACL transfer deletion export and tools implementation plan

- [ ] Run `trellis-before-dev`; import identity/sharing contracts and resolve all
      named product policies in the PRD before enabling entry points.
- [ ] Define strict transfer/recovery/tombstone/disposition/export/file/tool/trust
      contracts and stable errors.
- [ ] Implement step-up-authenticated idempotent transfer and interrupted recovery.
- [ ] Implement owner/non-owner deletion disposition and anti-resurrection fences.
- [ ] Implement principal-scoped owned/shared export with leak-safe matrices.
- [ ] Add explicit file/tool permissions, revision-scoped trust and per-call
      confirmation for side effects.
- [ ] Add interruption/retry, deletion, export, stale input, routing, revoke and
      zero-tool-call deterministic fixtures using only local fake MCP/Provider.
- [ ] Run `trellis-check`, Workspace Playwright/local fake MCP/Provider tests and
      the full parent validation baseline.
- [ ] Update ACL, identity, deletion, export, file, tool, privacy and recovery
      specs; append `ACL-02`, `ACL-04`, and `ACL-05` evidence.
- [ ] Commit, PR, CI/deployment evidence, validations and archive checks.

## Rollback Point

Freeze transfer and shared tool/file changes, preserve current owner and all
tombstones/history, deny pending side effects, and reconcile fenced operations.
