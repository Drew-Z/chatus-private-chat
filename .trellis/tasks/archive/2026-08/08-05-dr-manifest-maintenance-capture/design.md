# DR manifest and maintenance capture design

## Boundary

The capture service is an offline coordinator around existing storage owners. It
does not invent a cross-store transaction. Instead, a revisioned maintenance
state blocks new work, drains fenced operations, then freezes one capture epoch.

## Contracts

- `CaptureManifestV1`: archive/version identity, exact source instance and
  binding identities, capture epoch, code/schema/migration versions, encrypted
  payload inventory, exclusions, counts, sizes, checksums, and completion state.
- `MaintenanceState`: monotonic revision, requested/active/releasing state,
  operator/action identity, operation-fence summaries, Queue state, and audit
  timestamps without request content.
- `CaptureStoreEntry`: state class, owner/binding, authoritative/transitional/
  reconstructable classification, generation, encrypted object location,
  checksum, and restore behavior.

The exact persisted schemas and owners are selected during `trellis-before-dev`
after current Worker, Agent, Queue, KV, R2 and SQLite contracts are located.

## Flow

1. Preflight inventory, bindings, archive destination and dedicated key access.
2. Request maintenance and stop new state-changing work at server boundaries.
3. Pause/drain Queue delivery and wait for registered operation fences.
4. Freeze the epoch and export each store through its owning adapter.
5. Verify references, counts and checksums before sealing the manifest.
6. Persist secret-safe evidence, then release maintenance.

Every phase is idempotent under one capture operation ID. An interrupted run is
resumed or invalidated explicitly; a partial archive cannot be marked complete.

## Security

Archive payloads are encrypted before durable transport. Key identifiers and
custody evidence may appear in the manifest, but key material cannot. Wrong-key,
lost-key, tamper and log-leak fixtures are required.

## Compatibility and Rollback

The manifest is additive and versioned. Unknown required state classes fail
closed; older readers reject newer incompatible manifests. Rollback invalidates
partial objects, releases maintenance after fenced cleanup, and preserves every
source store untouched.
