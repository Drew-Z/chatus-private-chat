# Legacy Surface Governance

## 1. Scope / Trigger

Use this contract when changing the bundled legacy-surface manifest, the
per-surface `InstanceCoordinator` state machine, surface-use recording,
administrator legacy-surface APIs or Operations UI, capture/restore behavior, or
a later rollout that instruments or disables one exact legacy surface.

The shared control plane is implemented, but it does not disable a caller or
prove that a surface is unused. All 13 initial records are code-owned,
`owner: "unassigned"`, and capped at `maximumSupportedPhase: "discovered"`.
Raising one ceiling requires a separately approved rollout task with that
surface's caller, parity, recovery, observation, owner, and rollback evidence.

## 2. Signatures

```text
GET  /api/admin/legacy-surfaces?limit=1..100
POST /api/admin/legacy-surfaces/:surfaceId/advance
POST /api/admin/legacy-surfaces/:surfaceId/rollback
```

```typescript
legacySurfaceObjectName(surfaceId)
  = "$legacy-surface:" + surfaceId

InstanceCoordinator.syncLegacySurfaceManifest(input)
InstanceCoordinator.inspectLegacySurface(expectedManifest?)
InstanceCoordinator.advanceLegacySurface(input)
InstanceCoordinator.rollbackLegacySurface(input)
InstanceCoordinator.recordLegacySurfaceUse(input)
InstanceCoordinator.captureLegacySurfaceState(input)
InstanceCoordinator.restoreLegacySurfaceState(input)
```

```text
capture store: legacy_surface_registry
schema: legacy-surface-registry-v1
state class: authoritative
restore behavior: restore
```

Each deterministic surface object uses these SQLite tables:

```text
legacy_surface_manifest
legacy_surface_state
legacy_surface_events
legacy_surface_operations
legacy_surface_daily
```

## 3. Contracts

### Code-owned manifest

`src/contracts/legacy-surface.ts` is the only manifest owner. The initial exact
surface IDs are:

```text
legacy.api.chat-post
legacy.api.cloud-chats
legacy.auth.access-secret-fallback
legacy.browser.admin-alias
legacy.browser.shell
legacy.config.source-fallback
legacy.kv.chat-index
legacy.kv.daily-usage
legacy.kv.memory
legacy.kv.route-reliability
legacy.provider.inline-credential
legacy.provider.route-shadow
legacy.user-state.chat-projection
```

The manifest is sorted by `surfaceId` and hashed from stable JSON. A record owns
its identity, risk, owner, data/caller classes, replacement, rollback route,
recovery class, observation policy, and maximum supported phase. An upgrade may
add a new ID or increase an existing record's version without changing identity
or lowering its phase ceiling. Removal, duplicate/reordered identity, downgrade,
or policy conflict fails closed. The admin API cannot create or rewrite records.

### State, evidence, and use recording

The forward phases are:

```text
discovered -> instrumented -> censused -> parity_proven -> shadowing ->
write_disabled -> write_observing -> recovery_proven -> read_disabled ->
read_observing -> approved_for_cleanup
```

Advance is exactly one phase, cannot exceed the manifest ceiling, requires the
current non-negative safe-integer revision, a bounded operation ID, a request time
within the server clock window, and the exact evidence kinds for the target.
State, event, and operation receipt commit in one SQLite transaction. Repeating
the same operation ID and normalized input returns the stored projection;
reusing the ID with changed input conflicts.

Read and write controls are derived from phase. Read rollback is legal only at
or after `read_disabled` and returns to `recovery_proven`, preserving write
disablement. Write rollback is legal only at or after `write_disabled` and
returns to `shadowing`, enabling both controls. Rollback appends an event and
requires exactly one `rollback_rehearsal` evidence reference.

Surface-use input is exact and content-free:

```typescript
{
  version: 1,
  surfaceId,
  callerClass,
  access: "read" | "write",
  occurredAt,
  deploymentSha
}
```

The caller class must be declared by the manifest. Events older than seven days
or more than five minutes in the future reject. Counts retain at most 100 UTC day
buckets per caller/access pair. A delayed older event may increase its day count,
but it must not replace the deployment SHA associated with a later timestamp.
This RPC is not wired into any initial runtime caller by the foundation task.

Evidence may contain only bounded identifiers, lowercase SHA-256 digests,
40-character lowercase commit SHAs, timestamps, safe-integer counts, and closed
result enums. It must never contain content, labels, URLs, headers, raw logs,
credentials, tokens, or free-form notes.

### Worker, browser, and recovery boundaries

Admin GET inspects every object against the full current bundled record and
manifest digest. Missing or forward-upgradeable records synchronize under the
instance mutation fence. Conflicting stored policy returns
`legacy_surface_manifest_conflict`; a GET never masks it as a valid snapshot.
Mutations require admin authentication, same-origin browser admission, and the
existing instance fence.

The browser exact-decodes the bounded snapshot and mutation response. Advance
success must return the requested target. Read rollback must return
`recovery_proven`; write rollback must return `shadowing`. React renders the
server-projected `allowedActions`, keeps a dirty evidence draft through
validation/network/HTTP/decoder/refresh failures, confirms the exact surface and
target with the shared dialog, and clears only after an authoritative refresh.

Capture synchronizes the full manifest, snapshots each deterministic object
twice inside one fenced capture epoch, and rejects any digest change. Isolated
restore prevalidates exactly one authoritative `legacy_surface_registry` entry,
the manifest/digest/count/order, every coordinator identity, event/operation/
daily record, and every per-surface snapshot digest before target mutation. The
prevalidated entry is passed explicitly to the `durable_stores` adapter action.
Target receipts and central checkpoints make retry idempotent.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Unknown manifest/API surface | `404 legacy_surface_not_found` |
| Stale revision, reused operation ID with changed input, or invalid transition | `409 legacy_surface_conflict` |
| Stored manifest differs from current immutable policy | `409 legacy_surface_manifest_conflict`; mutate nothing |
| Missing/wrong evidence, premature observation, or phase above code ceiling | `422 legacy_surface_gate_blocked` |
| Malformed state | `503 legacy_surface_state_invalid` |
| Coordinator RPC unavailable | `503 legacy_surface_unavailable` |
| GET limit is duplicated, unknown, zero, non-integer, or above 100 | `400 invalid_limit` |
| Request or response has unknown/content-bearing fields | Reject at its exact decoder boundary |
| Capture changes between first and second read | `capture_legacy_surface_registry_changed`; do not seal |
| Restore entry/schema/digest/count/identity/event is invalid | Reject before target mutation |
| Retry finds a matching target receipt | Reuse it; do not apply the registry twice |
| Foundation code attempts to move an initial record past `discovered` | Gate-block; runtime read/write behavior remains unchanged |

## 5. Good / Base / Bad Cases

- Good: a later task versions one exact record, wires every declared caller,
  advances one phase per proven gate, and can independently roll that surface
  back without changing another object.
- Base: the foundation initializes all 13 records at `discovered`, displays their
  blockers, captures/restores the registry, and changes no legacy behavior.
- Bad: infer caller absence from quiet logs, raise all surfaces together, accept
  an admin-supplied record/phase ceiling, or call a registry entry cleanup proof.
- Bad: restore registry bytes through a generic store action without handing the
  validated entry to the deterministic per-surface targets.

## 6. Tests Required

- Assert all 13 IDs occur once, stay sorted and `discovered`, and manifest
  additions/forward versions pass while removal, downgrade, duplicate, reorder,
  identity/policy conflict, unknown fields, and digest drift reject.
- Cover every forward phase/evidence gate, revision conflict, same/different
  operation replay, observation timing, separate read/write rollback, malformed
  storage, coordinator outage, counter bounds, delayed events, and content-field
  rejection.
- Cover admin auth/origin/fence admission, exact request/response keys, stable
  HTTP errors, GET synchronization and conflict behavior, bounded audit, and zero
  runtime legacy-path calls from the foundation.
- Characterize the exact Worker snapshot with the browser decoder. Reject invalid
  enums, unsafe integers, uppercase/wrong-length digests or SHAs, duplicate or
  unsorted IDs, inconsistent controls, excess rows, and mutation target/revision
  mismatches.
- Prove React filtering, 20/21 pagination, dirty draft retention, dialog pending/
  error/retry, server refresh, and no desktop or 390px overflow using synthetic
  Workspace fixtures only.
- Prove capture/restore schema, count, manifest, coordinator, event, operation,
  counter, receipt, and retry behavior. Restore all 13 surfaces at `discovered`
  and assert the registry action count remains one after checkpoint ambiguity.
- Run the full local gate and both browser suites with only local fake Provider/
  MCP fixtures. Production deploy and acceptance remain GitHub-Actions-only.

## 7. Wrong vs Correct

### Wrong

```typescript
await globalCoordinator.setLegacyDisabled(true);
await deleteLegacyStores();
```

This has no per-surface caller census, phase ceiling, evidence, rollback, or
recovery boundary.

### Correct

```typescript
const coordinator = env.INSTANCE_COORDINATOR.getByName(
  legacySurfaceObjectName(manifest.surfaceId),
);
const synchronized = await coordinator.syncLegacySurfaceManifest({
  version: 1,
  manifest,
  manifestDigest,
});
if (!synchronized.ok) return failClosed(synchronized.error);
```

The code-owned record establishes the maximum authority. Runtime enforcement and
destructive cleanup remain separate, later, per-surface deliveries.
