# ACL sharing and revocation implementation plan

- [ ] Run `trellis-before-dev`; enumerate every conversation, stream, search,
      export, file, memory and tool server path and import stable identity contracts.
- [ ] Resolve the initial viewer/editor action matrix and expiry policy in this
      PRD before enabling editor mutations.
- [ ] Define strict grant/revoke/revision/audit/error contracts.
- [ ] Implement authoritative grant lookup and exact resource assertion at every path.
- [ ] Add owner/viewer UI/API, then only explicitly approved editor mutations with
      expected-revision commit checks.
- [ ] Implement revocation-first state change and cache/trust/stream invalidation.
- [ ] Add cross-principal, role matrix, replay, stale cache/client, revoke race,
      denied memory/file/token/tool/export and branch/stream fixtures.
- [ ] Run `trellis-check`, Workspace Playwright/local fake Provider/MCP tests and
      the full parent validation baseline.
- [ ] Update ACL, identity, privacy, stream, file, memory, tool and recovery specs;
      append `ACL-03` and partial `ACL-04` evidence.
- [ ] Commit, PR, CI/deployment evidence, validations and archive checks.

## Rollback Point

Disable new grants and shared mutations, revoke shared execution, clear derived
caches/trust, and retain ACL history plus current-owner access.
