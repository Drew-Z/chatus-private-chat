# Legacy surface registry and control plane design

## 1. Ownership boundary

The existing `INSTANCE_COORDINATOR` namespace is the authoritative owner. The
fixed `$instance-maintenance` object continues to own maintenance, operation
fences, and the external object baseline. Each legacy surface instead uses a
deterministic object name derived from `surfaceId`, so one surface is one
coordination atom and future runtime hits cannot bottleneck on the global
maintenance object.

Each surface object uses the existing SQLite-backed `InstanceCoordinator` class.
Its schema initializes once in the constructor, while state/event/counter writes
use synchronous SQLite statements and transactions rather than wrapping every
RPC in `blockConcurrencyWhile`. This follows the current Cloudflare guidance for
sharded coordination and durable state. It avoids another binding/migration and
keeps retirement evidence inside the existing recovery namespace.

`CHAT_STORE` is not authoritative for transition state because it mixes data
classes and cannot provide one atomic compare-and-set transition plus append-only
event. Root `TeamAgent` is member-scoped and must not own instance governance.
Ordinary admin audit remains a secondary human-readable projection, not the
durable source of approval or observation truth.

## 2. Contracts

Add `src/contracts/legacy-surface.ts` with exact decoders and these closed sets:

```text
LegacySurfaceKind = browser | api | kv | durable_substate | provider | credential
LegacySurfaceRisk = low | medium | high | critical
LegacySurfaceOwner = unassigned | frontend | operations | data | provider | security
LegacySurfaceAccess = read | write
LegacySurfacePhase =
  discovered | instrumented | censused | parity_proven | shadowing |
  write_disabled | write_observing | recovery_proven |
  read_disabled | read_observing | approved_for_cleanup
```

The manifest record contains immutable identity/policy plus a forward-only
`manifestVersion` and `maximumSupportedPhase`. Observation duration, required
evidence kinds, and owner become code-owned policy only in the rollout child that
raises the maximum phase. An administrator supplies evidence references but
cannot weaken policy.

The durable projection contains `revision`, current phase, independent
`readControl`/`writeControl`, manifest version/digest, last transition time,
observation bounds, blocker codes, and bounded evidence summaries. Events contain
the before/after revision and phase, operation ID, action, server timestamp,
deployment SHA, and evidence references.

## 3. Manifest synchronization

The bundled manifest is sorted and hashed deterministically. The Worker routes
each manifest record to
`INSTANCE_COORDINATOR.getByName("$legacy-surface:" + surfaceId)` and calls
`syncLegacySurfaceManifest()` before admin reads, transitions, surface-use
recording, and capture. The object verifies `ctx.id.name` matches the supplied
surface identity.

Synchronization rules:

1. First sync creates every bundled record at `discovered`.
2. Exact replay is idempotent.
3. New IDs are additive and begin at `discovered`.
4. Existing IDs may only move to a higher manifest version with unchanged
   identity and a non-decreasing maximum phase.
5. Missing stored IDs, removal, downgrade, conflicting identity/policy, duplicate
   ID, or digest mismatch returns `legacy_surface_manifest_conflict` and mutates
   nothing.

The initial manifest includes the 13 IDs recorded by the parent census. No
initial record supports an operational transition beyond `discovered`.

## 4. State machine and evidence gates

Advance is one step only. The coordinator derives required evidence from the
manifest; the request cannot choose it. A later rollout manifest may require:

| Target phase | Required evidence class |
| --- | --- |
| `instrumented` | caller map, instrumentation contract/version, deploy SHA |
| `censused` | bounded census window, zero unknown caller classes |
| `parity_proven` | deterministic parity digest, zero unexplained mismatches |
| `shadowing` | shadow contract and bounded reconciliation counters |
| `write_disabled` | approved stop-write control and rollback rehearsal |
| `write_observing` | required window plus exact deployment SHA |
| `recovery_proven` | per-surface capture/isolated-restore evidence |
| `read_disabled` | approved read control and rollback rehearsal |
| `read_observing` | required window plus exact deployment SHA |
| `approved_for_cleanup` | completed window, owner approval reference, zero blockers |

Read rollback returns from `read_disabled`/`read_observing` to
`recovery_proven`, leaving writes disabled. Write rollback returns any
post-write-disable state to `shadowing`, re-enabling reads and writes. Both append
events and retain sealed evidence. Rollback never raises a phase and does not
require the normal forward gate, but it requires a bounded reason code and exact
rollback evidence.

## 5. Storage shape

Each deterministic surface object uses SQLite tables:

```text
legacy_surface_manifest  (one current manifest row)
legacy_surface_state     (one current projection row)
legacy_surface_events    (surface revision primary key)
legacy_surface_operations(operation ID primary key for replay fencing)
legacy_surface_daily     (UTC day, caller class, access composite key)
```

State, event, and operation replay evidence are committed in one SQLite
transaction. Same operation/same normalized input returns the prior result,
while changed input conflicts. Daily counters use safe integers and a bounded
manifest-declared caller set. Pruning keeps at most 100 UTC daily buckets per
surface/caller/access; a sealed observation event preserves the accepted
aggregate and digest.

## 6. Runtime surface-use API

The coordinator RPC accepts only:

```text
{ version: 1, surfaceId, callerClass, access, occurredAt, deploymentSha }
```

It records a bounded counter and returns `{ revision, phase, readControl,
writeControl, blockerCodes }`. It never accepts member identity, URL/query,
payload size, content, route ID, Provider ID, credential reference, or free text.

The Worker obtains the stub by deterministic surface name, so unrelated surfaces
remain independently scalable. This task ships the RPC and tests only.
Per-surface rollout children must wire it at every declared caller and decide
fail-open/fail-closed behavior for that exact phase. Until then, all manifest
records remain `discovered` and runtime behavior is unchanged.

## 7. Capture and restore

Add `legacy_surface_registry` to the capture-store contract. The capture adapter
iterates the code-owned manifest, calls each deterministic surface object, and
aggregates normalized manifest records, current projections, append-only events,
sealed evidence, and active bounded counters. It is `authoritative/restore` and
uses a new exact schema version `legacy-surface-registry-v1`.

Capture reads a coordinator snapshot and digest, then checks the digest again
before completing the store adapter. Restore validates the entire payload before
target mutation and applies each record to its deterministic target object in the
existing `INSTANCE_COORDINATOR` namespace. Existing
`instance_coordinator_runtime` remains excluded; maintenance and operation fences
still rebuild empty.

## 8. Worker API

Add admin-only routes:

```text
GET  /api/admin/legacy-surfaces?limit=100
POST /api/admin/legacy-surfaces/:surfaceId/advance
POST /api/admin/legacy-surfaces/:surfaceId/rollback
```

All routes require admin authentication. Mutations also require the existing
instance fence. Input and output use exact keys and bounded arrays. Suggested
status mapping:

| Error | HTTP |
| --- | --- |
| `legacy_surface_not_found` | 404 |
| `legacy_surface_conflict` / manifest conflict | 409 |
| `legacy_surface_gate_blocked` | 422 |
| `legacy_surface_state_invalid` / unavailable | 503 |

Admin audit stores only action, surface ID, target phase, result, revision, and
evidence IDs/digests. It is not the authoritative event ledger.

## 9. React Operations

`fetchAdminOperations()` fetches the new snapshot in parallel and validates it
with an exact decoder. `AdminOperationsPanel` adds a paginated surface list and
a single transition tool. The list shows phase, read/write control, owner,
blockers, observation bounds, last deployment SHA, and evidence completeness.

The server returns allowed actions; the client does not derive authority. A
transition form gathers only allowed bounded references. Submit opens the shared
React `ConfirmDialog`, naming the surface and exact state change. Success refreshes
the full snapshot; failure preserves the draft and renders a recoverable error.
Desktop and 390px fixtures cover loading, ready, error, 20/21 pagination, blocked
action, confirmation, mutation failure, and refresh success.

## 10. Rollout and rollback

The foundation rollout is additive. All seeded records remain `discovered`, so
no legacy path behavior changes. Rollback hides the admin projection and stops
new registry mutations while retaining coordinator state and capture support.
Removing stored registry evidence, lowering phase ceilings, deleting migrations,
or disabling a legacy surface is not a valid rollback for this task.
