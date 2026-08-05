# Legacy surface destructive cleanup implementation plan

- [ ] Run `trellis-before-dev`; import final surface registry, DR archive/restore,
      deletion and production workflow contracts.
- [ ] Define strict approval envelope, preview, checkpoint, tombstone and result
      schemas with exact target bounds.
- [ ] Revalidate final census/parity/restore/rollback evidence per surface.
- [ ] Implement dry preview and idempotent bounded cleanup adapters per storage type.
- [ ] Add anti-resurrection fences and post-cleanup reconciliation.
- [ ] Add local fixtures for stale approval, unknown/shared target, partial crash,
      replay, stale client/import/Queue resurrection and cross-resource isolation.
- [ ] Add GitHub Actions-only production approval/execution/evidence path.
- [ ] Run `trellis-check`, focused tests and the full parent validation baseline.
- [ ] Update deletion, legacy, recovery and delivery specs; close or persist each
      surface's `DR-06` evidence independently.
- [ ] Commit, PR, exact-head CI, exact-main production acceptance, validation
      records and archive checks.

## Rollback Point

Abort before deletion if evidence or target inventory drifts. After partial
deletion, keep the surface isolated and run the approved forward-repair/restore
path; never broaden target scope during recovery.
