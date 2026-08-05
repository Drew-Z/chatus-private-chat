# Legacy surface destructive cleanup

## Goal

Physically remove only those legacy surfaces that have independently completed
disable, observation, recovery and rollback gates, with a separate explicit
production approval and retained restoration evidence for every deletion.

## Dependencies

- `08-05-legacy-surface-disable-observation` completed and archived.
- The exact surface must have passed its approved post-disable observation window.
- `08-05-dr-isolated-restore-drill` evidence must still restore the retained
  pre-cleanup archive.

## Applicable Decisions and Risks

- `DR-06`: deletion is authorized per surface only after census, parity,
  backup/restore, rollback rehearsal, observation and owner approval.
- Disable and deletion occur in different releases.
- Durable Object migration history remains append-only and a namespace is not
  deleted merely to roll back code.

## Requirements

- Revalidate no-callers/no-writes census, replacement parity, rollback rehearsal,
  archive/key availability, exact restore result and surface-owner approval.
- Produce an exact deletion inventory, blast-radius preview, recovery command,
  approver, deployment SHA, monitoring window and abort criteria per surface.
- Execute one bounded surface cleanup per independently approved production
  change; use idempotent tombstone/cleanup checkpoints and secret-safe evidence.
- Verify no stale client, retry, import, projection or Queue work can resurrect or
  redirect deleted state.

## Acceptance Criteria

- [ ] AC1. Every cleanup candidate has complete disable/observation evidence and
      a fresh final census with zero unexplained callers or writes.
- [ ] AC2. The retained archive/key path restores the exact candidate into an
      isolated target immediately before cleanup approval.
- [ ] AC3. A bounded preview lists exact objects/rows/keys/namespaces and rejects
      unknown, shared, active or out-of-scope targets.
- [ ] AC4. Cleanup is idempotent, checkpointed and separately approved per
      surface with exact-main GitHub Actions deployment evidence.
- [ ] AC5. Post-cleanup auth, isolation, parity, deletion, Queue and stale-client
      tests pass with no resurrection or cross-resource impact.
- [ ] AC6. Rollback/forward-repair evidence is retained and append-only migration
      history is unchanged.
- [ ] AC7. Any surface lacking evidence remains disabled-but-retained and is
      reported as a persistent residual `DR-06` risk.
- [ ] AC8. Full gates, specs, PR/commit/production acceptance and archive checks pass.

## Out of Scope

- Cleaning any surface in the same release as first disable, broad wildcard
  deletion, removing migration history, or deleting unclassified legacy state.
