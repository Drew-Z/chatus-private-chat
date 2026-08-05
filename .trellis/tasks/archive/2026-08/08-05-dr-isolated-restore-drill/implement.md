# DR isolated restore drill implementation plan

- [x] Run `trellis-before-dev`; import the final manifest/capture contracts and
      locate exact identity, Agent, Queue, R2, deletion and migration owners.
- [x] Define strict target preflight and versioned stable identity mapping.
- [x] Implement isolated provisioning and the checkpointed restore state machine
      in the approved store order.
- [x] Add idempotent Queue/outbox regeneration and unresolved-state reporting.
- [x] Implement full counts/checksums/reference and product-invariant
      reconciliation with secret-safe evidence.
- [x] Add failure injection/retry/discard tests for every checkpoint plus wrong
      key, tamper, wrong target, orphan, conflict and cross-principal fixtures.
- [x] Run one retained exact-SHA local/non-production drill and record phase
      timings, data-loss boundary, operator waits, size and throughput.
- [x] Run `trellis-check`, focused tests and the full parent validation baseline.
- [x] Update recovery, identity, Queue, storage, deletion and delivery specs;
      append `DR-01` through `DR-05` evidence without premature RPO/RTO claims.
- [x] Commit, PR, exact-head CI, exact-main deployment/acceptance when applicable,
      validation records and archive checks.

## Rollback Point

Keep the target isolated at every checkpoint. A failed operation is resumed from
verified state or the target is discarded; the source remains untouched.
