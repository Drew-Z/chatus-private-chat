# DR isolated restore drill

## Goal

Restore a verified archive into an isolated target with stable identity mapping,
idempotent checkpoints, Queue recovery, and complete reconciliation. Support
claims remain limited to the evidence actually produced by retained drills.

## Dependencies

- `08-05-dr-manifest-maintenance-capture` completed and archived.

## Applicable Decisions and Risks

- `DR-01`: a full restore must finish with zero unresolved cross-store references.
- `DR-02`: wrong/lost-key and decrypt-canary drills fail safely without leakage.
- `DR-03`: versioned mapping proves exact principal, root, conversation, object,
  binding, and target namespace identity.
- `DR-04`: queued/extracting/failed/DLQ work is regenerated idempotently or
  reported unresolved.
- `DR-05`: no numeric RPO/RTO is published until repeated representative drills
  measure capture interval, loss, phase timings, operator waits, and throughput.

## Requirements

- Restore only into a newly provisioned isolated target after exact manifest,
  key, binding, schema, migration, capacity, and target-emptiness preflight.
- Use a versioned identity mapping table and reject duplicate, orphaned,
  conflicting, mutable-label-derived, or wrong-target mappings.
- Apply checkpointed idempotent phases in the approved order: durable stores,
  UserState, root Agent, conversation Agents, R2, Queue regeneration, then full
  reconciliation and acceptance.
- Keep writes closed until checksum/count/reference, authentication, isolation,
  deletion, conversation, memory, file and Queue invariants pass.
- Retain exact-SHA drill artifacts and phase measurements without turning a
  single best result into an RPO/RTO promise.

## Acceptance Criteria

- [ ] AC1. Exact-target preflight rejects incompatible manifest/schema/bindings,
      non-empty targets, duplicate mappings, wrong keys and tampered archives.
- [ ] AC2. Fault injection after every checkpoint can be retried to one identical
      converged target without duplicate or missing state.
- [ ] AC3. Stable identity reconciliation reports zero unresolved references and
      proves no cross-principal or cross-conversation access.
- [ ] AC4. Queue fixtures restore/regenerate queued, extracting, failed and DLQ
      work without silent drop or double extraction.
- [ ] AC5. Reconciliation verifies counts/checksums/exclusions, R2 metadata,
      decrypt canaries, auth, isolation and permanent deletion behavior.
- [ ] AC6. Failed targets remain isolated and can be retried or discarded without
      mutating or mixing with the untouched source.
- [ ] AC7. A retained local/non-production exact-SHA drill records phase timings,
      loss and operator waits while making no numeric RPO/RTO commitment.
- [ ] AC8. Full gates, specs, PR/commit/deployment evidence and Trellis archive
      validation are complete before recovery support is described.

## Out of Scope

- In-place overwrite, online restore, automatic production cutover, or published
  RPO/RTO.
- Destructive cleanup of source or legacy state.
