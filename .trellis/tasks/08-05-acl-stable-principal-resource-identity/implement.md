# ACL stable principal and resource identity implementation plan

- [ ] Run `trellis-before-dev`; locate exact auth/member, Root TeamAgent,
      UserState, conversation Agent, route, deletion/export and migration owners.
- [ ] Define strict versioned principal/alias/resource/owner/marker contracts.
- [ ] Implement additive principal and alias creation without routing changes.
- [ ] Implement idempotent resource/owner backfill and unresolved mapping reports.
- [ ] Add resource-derived route assertion and dual-read reconciliation.
- [ ] Add rename/reuse/replay/duplicate/orphan/conflict/wrong-Agent/cross-principal
      deterministic migration fixtures.
- [ ] Keep every ACL/share/transfer entry point disabled and test its absence.
- [ ] Run `trellis-check`, impact-path Workspace Playwright and full baseline.
- [ ] Update identity, Agent, auth, migration, recovery and compatibility specs;
      append `ACL-01` evidence.
- [ ] Commit, PR, CI/deployment evidence, validations and archive checks.

## Rollback Point

Switch back to old routing, retain stable identities/markers, preserve current
owner access, and repair mappings without deleting migrated Agent data.
