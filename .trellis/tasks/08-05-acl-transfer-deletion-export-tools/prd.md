# ACL transfer deletion export and tools

## Goal

Complete the ACL program with one-owner transfer, explicit deletion disposition,
anti-resurrection tombstones, bounded export, and separately permissioned files/
tools with per-call confirmation for side effects.

## Dependencies

- `08-05-acl-sharing-revocation` completed and archived.
- Before implementation, persist approved former-owner behavior, transfer
  acceptance, editor file/read-only-tool rights, shared snapshot export default,
  owner cascading-delete policy, and ACL expiry behavior.

## Applicable Decisions and Risks

- `ACL-02`: transfer is an atomic idempotent revisioned ownership transition,
  never copy-and-revoke; interrupted retry preserves exactly one owner/resource.
- `ACL-04`: trust is principal/resource/review scoped, invalidated on ACL/owner
  revision; side-effect tools require confirmation for each call.
- `ACL-05`: owner deletion requires explicit per-resource transfer or tombstone;
  exports are principal-scoped and stale inputs cannot resurrect tombstones.

## Requirements

- Implement step-up-authenticated transfer with versioned acceptance/recovery
  state, operation fence, audit trail, one-owner invariant and trust invalidation.
- Block owner deletion while any resource lacks explicit transfer or tombstone;
  non-owner deletion removes only that principal's grant/local state.
- Distinguish owned content from bounded shared reference/snapshot export and
  exclude other principals' memory, files, credentials, tokens and private state.
- Add explicit shared file and read-only/side-effect tool policies; deny unknown
  capabilities and require per-call confirmation for side effects.
- Prevent stale clients, imports, retries, projections or Agent routes from
  resurrecting deleted grants/resources or former ownership.

## Acceptance Criteria

- [ ] AC1. Approved transfer/file/tool/export/deletion/expiry product policies are
      versioned and testable before their entry points are enabled.
- [ ] AC2. Interrupted transfer at every phase plus retry converges to one stable
      resource and exactly one active owner with no cross-principal leakage.
- [ ] AC3. Owner deletion is blocked pending explicit disposition; non-owner
      deletion cannot affect the owner or other recipients.
- [ ] AC4. Export matrices clearly distinguish owned and shared content and never
      include another principal's memory, credentials, tokens or ungranted files.
- [ ] AC5. ACL/owner revision invalidates prior trust; shared side-effect tools
      require confirmation on every call and revocation yields zero tool calls.
- [ ] AC6. Tombstone/replay/import/stale-client/projection tests prove no
      resurrection or routing redirection.
- [ ] AC7. Rollback freezes transfer/tools, retains current owner/tombstones/history
      and reconciles pending operations without deleting stable identities.
- [ ] AC8. Full gates, specs, PR/commit/deployment evidence and archive checks pass.

## Out of Scope

- Anonymous/public links, external organization federation, implicit memory/
  credential sharing, or global RBAC unrelated to explicit resources.
