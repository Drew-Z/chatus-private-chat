# Legacy surface disable and observation

## Goal

For each legacy chat, memory, usage, route/provider, API, admin, credential, and
Durable Object surface, prove caller/data census, replacement parity, rollback
and recovery before disabling reads. Preserve all legacy data in this task.

## Dependencies

- `08-05-dr-isolated-restore-drill` completed and archived.
- Each surface's replacement must have deterministic parity evidence before that
  surface enters stop-write or disable-read stages.

## Applicable Decisions and Risks

- `DR-06`: destructive or premature retirement can remove active callers/data or
  the only rollback source; each surface owns independent evidence and approval.
- No recent logs do not prove no callers.
- First disable and physical deletion cannot ship in the same release.
- Durable Object migration tags remain append-only; namespace deletion is not a
  code rollback mechanism.

## Requirements

- Maintain a machine-readable record per surface: owner, callers, authoritative
  and transitional data, replacement, parity result, recovery classification,
  rollback route, observation window, approval and current state.
- Follow `instrument -> census -> parity -> dual-read/shadow -> stop writes ->
  observe -> backup/drill -> disable reads -> observe` independently per surface.
- Keep compatibility shims observable, time-bounded and non-authoritative.
- Rehearse rollback before disable-read approval and retain exact-SHA evidence.
- Continue including a surface in the DR manifest until its later cleanup child
  completes destructive cleanup.

## Acceptance Criteria

- [ ] AC1. Every in-scope surface has a unique owner and complete caller/data/
      replacement/recovery/rollback record; unknowns block progression.
- [ ] AC2. Instrumentation and deterministic census cover runtime, tests,
      migrations, scheduled/Queue work, scripts and operator paths.
- [ ] AC3. Replacement parity and dual-read/shadow reconciliation show no
      unexplained missing, duplicate or divergent state before stop-write.
- [ ] AC4. Stop-write observation proves the legacy source no longer receives
      authoritative mutations and compatibility shims remain observable.
- [ ] AC5. Backup/isolated-restore evidence covers each transitional surface.
- [ ] AC6. Disable-read rollback rehearsal restores service without data mixing,
      and the approved observation window passes after disable.
- [ ] AC7. No physical data, namespace, migration, route rollback source or
      credential record is destructively removed by this task.
- [ ] AC8. Full gates, specs, PR/commit/deployment evidence, owner approval and
      archive checks pass for every disabled surface.

## Out of Scope

- Physical deletion, migration-tag removal, source archive destruction, or
  bundling multiple unproven surfaces behind one umbrella approval.
