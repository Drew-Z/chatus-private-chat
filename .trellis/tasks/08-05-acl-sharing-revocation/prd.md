# ACL sharing and revocation

## Goal

Add explicit conversation-resource sharing with server-side viewer/editor
authorization and authoritative revisioned revocation, while keeping transfer,
shared tools/files and broad export disabled.

## Dependencies

- `08-05-acl-stable-principal-resource-identity` completed and archived with
  resource-derived routing parity.

## Applicable Decisions and Risks

- `ACL-03`: a grant covers only an explicit conversation resource; root memory,
  workspace state, credentials/OAuth, feedback ownership, exports and tool trust
  never follow implicitly.
- `ACL-04` partial: trust is scoped to principal/resource/revision and invalidated
  on ACL/owner revision; shared tools remain denied in this child.
- Revocation is authoritative before cleanup/cache invalidation and in-flight
  mutations recheck expected resource revision at commit.

## Requirements

- Define revisioned owner/viewer/editor grants, idempotent grant/revoke operations,
  discoverability rules, audit evidence and stable authorization errors.
- Enforce authorization server-side for every conversation read/write/stream/
  search/export/file/memory/tool path even when a path remains denied.
- Make viewers read-only; enable editor mutations only through explicit resource
  policy and expected-revision commit checks.
- Revoke access immediately in authoritative state, invalidate caches/trust, and
  ensure zero successful post-revoke mutation.
- Keep shared files, tools, root memory, credentials/OAuth, broad export and
  ownership transfer disabled pending their later task.

## Acceptance Criteria

- [ ] AC1. Owner/viewer/editor matrix covers every server path and unknown roles,
      resources or revisions fail closed.
- [ ] AC2. Shared resources are undiscoverable to non-granted principals and no
      cross-principal memory/file/token/credential data leaks.
- [ ] AC3. Viewers cannot mutate; allowed editor mutations are resource-bounded,
      auditable and revision-fenced.
- [ ] AC4. Revoke-vs-read/write/stream races yield zero post-revoke mutation and
      terminate or deny stale access consistently.
- [ ] AC5. Grant/revoke replay is idempotent and cache/trust invalidation follows
      authoritative revision changes.
- [ ] AC6. Shared tools/files, transfer and broad shared export remain denied and
      their APIs/UI cannot imply support.
- [ ] AC7. Rollback stops new grants/mutations, revokes shared execution and
      preserves principals/resources/ACL history/current owners.
- [ ] AC8. Full gates, specs, PR/commit/deployment evidence and archive checks pass.

## Out of Scope

- Ownership transfer, owner deletion disposition, shared snapshot export,
  shared files/tools, public links, anonymous access or organization-wide RBAC.
