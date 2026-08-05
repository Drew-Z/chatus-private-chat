# ACL stable principal and resource identity

## Goal

Introduce immutable opaque principal IDs and owner-independent conversation
resource IDs with reconciled dual-read routing. Sharing and transfer remain
disabled until identity parity is proven.

## Dependencies

- `08-05-legacy-surface-disable-observation` completed and archived for any
  legacy identity/routing sources included in migration census.

## Applicable Decisions and Risks

- `ACL-01`: mutable labels are aliases, never durable identity; rename/reuse must
  produce zero cross-principal reads.
- Stable resource identity and resource-derived Agent routing are mandatory
  before ACL grants or ownership transfer.
- Migration markers and one-to-one reconciliation are retained for every root and
  conversation Agent.

## Requirements

- Create stable opaque principals and a versioned alias registry without changing
  existing Agent routing in the first migration phase.
- Backfill stable conversation `resourceId` and owner `principalId`, with exact
  migration markers, duplicate/orphan/conflict detection, and idempotent replay.
- Add resource-derived routing with exact identity assertion and dual-read
  compatibility; compare old/new projections deterministically.
- Keep ACL, sharing and transfer disabled until projection parity and rename/reuse
  isolation tests pass.
- Preserve IDs and migration evidence through rollback; never derive resource
  ownership from a mutable label.

## Acceptance Criteria

- [ ] AC1. Every active principal/root/conversation has one immutable ID and one
      unambiguous migration marker; duplicates/orphans/conflicts block rollout.
- [ ] AC2. Rename, alias change and label reuse fixtures cannot redirect Agent
      routing or reveal another principal's resource.
- [ ] AC3. Resource IDs are stable across owner-label changes and route to the
      exact expected Durable Object identity.
- [ ] AC4. Backfill/replay is idempotent and reports all unresolved mappings.
- [ ] AC5. Dual-read old/new projections reconcile exactly on deterministic local
      fixtures before resource-derived routing becomes authoritative.
- [ ] AC6. ACL, sharing, transfer, shared files/tools and shared export remain
      unavailable throughout this child.
- [ ] AC7. Rollback disables new routing but preserves stable IDs, markers and
      current owner access without data rebinding.
- [ ] AC8. Full gates, specs, PR/commit/deployment evidence and archive checks pass.

## Out of Scope

- ACL grants, sharing UI/API, editor access, transfer, deletion disposition,
  shared exports or tools.
