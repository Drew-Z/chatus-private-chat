# Legacy Surface Governance

## 1. Scope / Trigger

Use this contract when changing the bundled legacy-surface manifest, the
per-surface `InstanceCoordinator` state machine, surface-use recording,
administrator legacy-surface APIs or Operations UI, capture/restore behavior, or
a later rollout that instruments or disables one exact legacy surface.

The shared control plane is implemented, but it does not by itself disable a
caller or prove that a surface is unused. Twelve records remain code-owned with
`owner: "unassigned"` and `maximumSupportedPhase: "discovered"`.
`legacy.browser.admin-alias` is the only current rollout-owned exception: its
owner is `frontend`, manifest version is 2, and ceiling is `instrumented`.
Raising any ceiling requires a separately approved rollout task with that
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

## Scenario: `legacy.browser.admin-alias`

### 1. Scope / Trigger

- Trigger: instrument and roll out the exact read-only `/admin.html` browser
  compatibility alias while keeping `/react-chat/admin` authoritative.
- Ownership: `frontend`; no other legacy surface may inherit this rollout's
  version, owner, phase ceiling, or observation evidence.
- Current ceiling: `instrumented`; the route remains recoverable and is not
  disabled by this change.

### 2. Signatures

```text
GET /admin.html[?query] -> 308 Location: /react-chat/admin[?query]
```

```typescript
recordLegacyAdminAliasUse(request, env, url): Promise<void>
classifyLegacyAdminAliasCaller(request):
  "browser" | "deployment" | "test" | "worker_api"
resolveLegacySurfaceDeploymentSha(env, url): Promise<LowercaseSha | undefined>
```

### 3. Contracts

- Every admitted alias hit records `{ access: "read", callerClass,
  occurredAt, deploymentSha }` against `legacy.browser.admin-alias`.
- Declared callers are `browser`, `deployment`, `test`, and `worker_api`.
  Missing or unknown declarations fall back to `worker_api`; the fallback is
  deterministic and never blocks the compatibility redirect.
- `deploymentSha` is server-owned: use a valid `env.DEPLOYMENT_SHA`, then the
  valid `commit` in the release asset. A client header cannot provide it.
- Query text is not recorded; it is copied byte-for-byte by URL semantics to
  the React route. Observation storage failure must not break the 308 redirect.
- The manifest record is version 2, owner `frontend`, with 7-day write/read
  windows and `maximumSupportedPhase: "instrumented"`.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| `GET /admin.html` | `308` to `/react-chat/admin` |
| `GET /admin.html?query` | `308` to `/react-chat/admin?query` |
| Caller header is missing or unknown | Record `worker_api`; still redirect |
| Caller header is one of the four declared values | Record that caller class |
| Server SHA is valid | Record it; ignore client-provided SHA |
| Server SHA is absent/invalid and release commit is valid | Record release commit |
| Both server SHA sources are invalid/unavailable | Keep redirect; omit use event |
| Coordinator sync/record fails | Keep redirect; do not emit content-bearing data |
| Non-GET or unrelated path | Existing route behavior; no alias event |

### 5. Good / Base / Bad Cases

- Good: a browser bookmark reaches the React admin page with its query intact,
  and a content-free event identifies the caller and exact server deployment.
- Base: local tests use the zero SHA in local config and assert redirect plus
  bounded daily counters without Provider or production calls.
- Bad: trust `x-chatus-deployment-sha` from the browser, persist query text, or
  classify an unknown caller as an approved browser/deployment caller.

### 6. Tests Required

- Worker API test asserts 308 status, query preservation, declared caller use,
  unknown-caller fallback, and server-owned zero-SHA evidence.
- Manifest test asserts exactly one versioned/owned admin-alias record and all
  other records remain version 1, owner `unassigned`, ceiling `discovered`.
- Deployment-config test asserts `prepare-deployment.mjs` requires a valid
  lowercase 40-character `GITHUB_SHA` and writes server-only `DEPLOYMENT_SHA`.
- Agent browser and production smoke tests use the React route, exercise the
  alias redirect with manual redirect handling, and retain bounded output.
- Full repository checks and both browser suites must use only local fake
  Provider/MCP fixtures; no live model or local production deployment.

### 7. Wrong vs Correct

#### Wrong

```typescript
const deploymentSha = request.headers.get("x-chatus-deployment-sha");
return Response.redirect("/react-chat/admin", 308);
```

This loses query state, lets a client forge evidence, and provides no caller
census.

#### Correct

```typescript
await recordLegacyAdminAliasUse(request, env, url);
const target = new URL("/react-chat/admin", url);
target.search = url.search;
return Response.redirect(target.toString(), 308);
```

The event is content-free and best-effort, while the redirect remains the
authoritative compatibility behavior.

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

- Assert all 13 IDs occur once and stay sorted; the admin alias alone is version
  2/owned/`instrumented`, the other 12 remain version 1/unassigned/`discovered`,
  and every synchronized runtime state still begins at phase `discovered`.
  Manifest additions/forward versions pass while removal, downgrade, duplicate,
  reorder, identity/policy conflict, unknown fields, and digest drift reject.
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

The code-owned record establishes the maximum authority. The admin alias may
advance only to `instrumented`; runtime disablement and destructive cleanup
remain separate, later, per-surface deliveries.
