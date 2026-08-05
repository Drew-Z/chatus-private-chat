# DR manifest and maintenance capture

## Goal

Produce a versioned, encrypted, internally consistent offline instance archive
under a stop-write maintenance boundary. This task proves capture integrity; it
does not claim that Chatus can yet restore a full instance.

## Dependencies

- None. This is the first implementation candidate in the parent roadmap.

## Applicable Decisions and Risks

- `DR-01`: every included store belongs to one capture epoch and unresolved
  cross-store references fail the capture.
- `DR-02`: archive keys are separate from application route keys, externally
  controlled, dual-controlled, rotatable, and never logged.
- `DR-04`: Queue work is paused/drained or classified from durable generation or
  outbox evidence; queued/extracting/failed/DLQ state cannot disappear silently.
- Full-instance recovery remains unsupported until the isolated restore child
  completes its drill.

## Requirements

- Define a versioned manifest that lists every authoritative, transitional,
  reconstructable, and excluded state class with source identity,
  schema/migration version, count, size, checksum, capture epoch, exclusion
  reason, and restore-time behavior.
- Enter a revisioned maintenance state before capture; reject member/admin
  mutations and new Provider turns, pause/drain Queue delivery, and wait for
  fenced streams, tools, uploads, purges, branches, and background operations.
- Capture D1/SQLite, root/conversation Durable Object state, UserState, KV, R2,
  Queue/DLQ topology or durable regeneration evidence, configuration metadata,
  and secret references as required by the inventory.
- Encrypt the archive with a dedicated externally supplied archive key and emit
  only content-free audit evidence.
- Abort without publishing a valid archive when state inventory, generations,
  counts, checksums, key preflight, or maintenance fencing is incomplete.
- Reopen writes only after successful capture or clean rollback.

## Acceptance Criteria

- [x] AC1. A schema-versioned manifest fixture covers every known durable and
      transitional store and makes every exclusion explicit.
- [x] AC2. Concurrent mutation/Provider/Queue fixtures prove no new operation
      crosses an active maintenance capture boundary.
- [x] AC3. A single capture epoch and cross-store generation checks reject
      missing, stale, duplicate, orphaned, or unresolved references.
- [x] AC4. Archive output is encrypted; wrong/missing keys fail before capture or
      publication and no key, token, secret, content, or memory reaches logs.
- [x] AC5. Queue fixtures cover queued, extracting, failed, and DLQ state without
      silent loss or duplicate regeneration evidence.
- [x] AC6. Counts, sizes, checksums, source identities, and schema versions are
      deterministic and tamper detection invalidates the archive.
- [x] AC7. Failure injection at each phase exits or rolls back maintenance safely
      and never publishes a recoverable-instance claim.
- [x] AC8. Focused tests, full shipping gates, spec updates, PR evidence, exact
      work commit, and archive validation are retained before task archive.

## Out of Scope

- Restore, cutover, production recovery, numeric RPO/RTO, or online capture.
- Storing archive encryption keys inside the archive or application key store.
- Destructive removal of any legacy source.
