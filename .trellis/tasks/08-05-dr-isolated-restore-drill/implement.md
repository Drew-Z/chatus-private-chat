# DR isolated restore drill implementation plan

- [ ] Run `trellis-before-dev`; import the final manifest/capture contracts and
      locate exact identity, Agent, Queue, R2, deletion and migration owners.
- [ ] Define strict target preflight and versioned stable identity mapping.
- [ ] Implement isolated provisioning and the checkpointed restore state machine
      in the approved store order.
- [ ] Add idempotent Queue/outbox regeneration and unresolved-state reporting.
- [ ] Implement full counts/checksums/reference and product-invariant
      reconciliation with secret-safe evidence.
- [ ] Add failure injection/retry/discard tests for every checkpoint plus wrong
      key, tamper, wrong target, orphan, conflict and cross-principal fixtures.
- [ ] Run one retained exact-SHA local/non-production drill and record phase
      timings, data-loss boundary, operator waits, size and throughput.
- [ ] Run `trellis-check`, focused tests and the full parent validation baseline.
- [ ] Update recovery, identity, Queue, storage, deletion and delivery specs;
      append `DR-01` through `DR-05` evidence without premature RPO/RTO claims.
- [ ] Commit, PR, exact-head CI, exact-main deployment/acceptance when applicable,
      validation records and archive checks.

## Rollback Point

Keep the target isolated at every checkpoint. A failed operation is resumed from
verified state or the target is discarded; the source remains untouched.
