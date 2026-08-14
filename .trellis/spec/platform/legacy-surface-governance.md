# Legacy Surface Governance

## 1. Scope / Trigger

Use this contract when changing the bundled legacy-surface manifest, the
per-surface `InstanceCoordinator` state machine, surface-use recording,
administrator legacy-surface APIs or Operations UI, capture/restore behavior, or
a later rollout that instruments or disables one exact legacy surface.

The shared control plane is implemented, but it does not by itself disable a
caller or prove that a surface is unused. Nine records remain code-owned with
`owner: "unassigned"` and `maximumSupportedPhase: "discovered"`.
`legacy.browser.admin-alias`, `legacy.browser.shell`, `legacy.api.chat-post`,
and `legacy.api.cloud-chats` are the current rollout-owned exceptions. The
browser records are owned by `frontend`; both API records are owned by `data`.
Each uses manifest version 2 and a ceiling of `instrumented`.
Raising any ceiling requires a separately approved rollout task with that
surface's caller, parity, recovery, observation, owner, and rollback evidence.

## 2. Signatures

```text
GET  /api/admin/legacy-surfaces?limit=1..100
GET  /api/admin/legacy-surfaces/:surfaceId/census?days=1..100
POST /api/admin/legacy-surfaces/:surfaceId/advance
POST /api/admin/legacy-surfaces/:surfaceId/rollback
```

```typescript
legacySurfaceObjectName(surfaceId)
  = "$legacy-surface:" + surfaceId

InstanceCoordinator.syncLegacySurfaceManifest(input)
InstanceCoordinator.inspectLegacySurface(expectedManifest?)
InstanceCoordinator.censusLegacySurface(days)
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

The authenticated census projection is also exact and content-free. It returns
only `day`, `callerClass`, `access`, `count`, `lastOccurredAt`, and
`deploymentSha`, in canonical day/caller/access order. `days` is required,
unique, and bounded to 1..100; unknown query keys, unknown surface IDs, malformed
stored rows, duplicate identities, or policy drift fail closed. The read-only
endpoint inspects the exact bundled manifest and never synchronizes or mutates
the coordinator as a side effect. A bundled surface whose coordinator has not
yet been initialized returns a valid empty census; an unknown surface still
returns `legacy_surface_not_found`.

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
recordLegacyBrowserSurfaceUse(surfaceId, request, env, url): Promise<void>
classifyLegacyBrowserSurfaceCaller(request, allowedCallerClasses): LegacySurfaceCallerClass
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
- Manifest tests assert the four rollout-owned records are versioned/owned and
  all other records remain version 1, owner `unassigned`, ceiling `discovered`.
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
await recordLegacyBrowserSurfaceUse("legacy.browser.admin-alias", request, env, url);
const target = new URL("/react-chat/admin", url);
target.search = url.search;
return Response.redirect(target.toString(), 308);
```

The event is content-free and best-effort, while the redirect remains the
authoritative compatibility behavior.

## Scenario: `legacy.browser.shell`

### 1. Scope / Trigger

- Trigger: instrument `/legacy`, `/legacy/`, the generated legacy entry, legacy-
  exclusive static assets, the `DEFAULT_CLIENT=legacy` root switch, service-
  worker pre-cache, tests, and deployment smoke without disabling the shell.
- Ownership: `frontend`; chat APIs and storage compatibility records remain
  independently governed.
- Current ceiling: `instrumented`; static rollback source and routing remain
  available while the 14-day write/read windows are still future gates.

### 2. Signatures

```text
GET /legacy              -> 308 Location: /legacy/
GET /legacy/             -> generated public/legacy/index.html
GET /legacy/index.html   -> generated legacy entry
GET /{app.js,markdown.js,theme.js,styles.css,icons.svg}
GET / or /index.html when DEFAULT_CLIENT=legacy -> legacy shell
```

```typescript
recordLegacyBrowserSurfaceUse("legacy.browser.shell", request, env, url): Promise<void>
x-chatus-legacy-caller:
  "browser" | "deployment" | "service_worker" | "test" | "worker_api"
```

### 3. Contracts

- The manifest record is version 2, owner `frontend`, uses 14-day write and read
  windows, and has `maximumSupportedPhase: "instrumented"`.
- Every admitted shell route or legacy-exclusive asset read records only caller
  class, read access, UTC bucket, count, occurrence time, and server-owned exact
  deployment SHA. Paths, queries, local storage, conversations, prompts, model
  data, labels, and headers are never evidence fields.
- Only `/app.js`, `/markdown.js`, `/theme.js`, `/styles.css`, `/icons.svg`, and
  the generated legacy entry are legacy-exclusive. Shared `/pwa.js`, manifest,
  and application icons must not be counted merely because React uses them.
- A valid declared caller is preserved. Browser Fetch Metadata or HTML
  navigation classifies as `browser`; missing metadata and unknown declarations
  fall back to `worker_api`. The service worker marks legacy pre-cache requests
  as `service_worker`, deterministic tests mark `test`, and production smoke
  marks the shell and exclusive assets as `deployment`.
- Deployment identity comes only from `DEPLOYMENT_SHA` or `release.json`.
  Coordinator, manifest-sync, SHA-resolution, or record failures never block a
  redirect, shell response, static asset, or emergency root routing switch.
- Every retained shell route and legacy-exclusive asset consumes the projected
  read control after recording late-caller evidence. `read_disabled` returns the
  terminal `410 legacy_surface_read_disabled`; a real read rollback returns the
  surface to `recovery_proven` and immediately restores the unchanged redirect,
  shell, and asset sources. Observation-store failure remains fail-open for the
  emergency rollback path.
- Navigation caches remain isolated for `/`, `/react-chat/`, and `/legacy/`.
  Cached rollback assets may cover offline failures, `404`, and `5xx` only.
  Authentication or terminal control responses (`401`, `403`, and `410`) pass
  through unchanged so a stale worker cannot resurrect the shell. This
  instrumentation changes neither `POST /api/chat` nor `/api/chats*` admission,
  telemetry, or authority.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| `/legacy` bookmark | Record its caller, then preserve the 308 rollback redirect |
| `/legacy/`, generated entry, or exclusive asset | Record one best-effort read and preserve the asset response |
| Root request while `DEFAULT_CLIENT=legacy` | Record shell use and serve the retained legacy entry |
| Browser Fetch Metadata is present | Classify `browser` unless a valid explicit declared caller is supplied |
| Caller declaration is `deployment`, `service_worker`, or `test` | Record that exact declared class |
| Caller declaration is unknown or absent without browser metadata | Record `worker_api` |
| SHA or observation store is unavailable | Serve normally and omit the event |
| Shared React/PWA asset is requested | Do not count it solely as legacy shell use |
| Navigation returns `401`, `403`, or `410` | Return it unchanged; never replace it with cached shell HTML |
| Navigation is offline, `404`, or `5xx` | Use only that route family's cached shell when available |
| Shell instrumentation changes a chat API | Reject the change; the surfaces are independent |

### 5. Good / Base / Bad Cases

- Good: a stale service worker pre-caches the retained shell with an explicit
  caller marker while a browser navigation and deployment smoke produce their
  own exact-SHA, content-free buckets; a later `410` read-disable remains
  authoritative over cached shell HTML.
- Base: local tests use the configured zero SHA and assert all five caller
  classes without contacting a Provider, MCP server, or production.
- Bad: count `/pwa.js` as legacy whenever React loads it, trust a caller-supplied
  deployment SHA, persist the requested URL, or gate `/api/chat` with the shell.

### 6. Tests Required

- Manifest tests assert only the admin alias and browser shell are version 2,
  `frontend`, and capped at `instrumented`; the other 11 records remain version
  1, unassigned, and capped at `discovered`.
- Worker integration covers `/legacy`, `/legacy/`, one exclusive asset per
  declared caller class, browser Fetch Metadata, unknown-caller fallback,
  read-only daily counts, the server-owned zero SHA, terminal 410 enforcement,
  and real transactional read rollback to the retained routes/assets.
- Frontend structure checks assert the exact legacy asset set, service-worker
  caller marker, deployment-smoke marker, isolated navigation cache keys, and
  retained `DEFAULT_CLIENT=legacy` routing source.
- A deterministic service-worker harness executes the real `public/sw.js` and
  proves route-family cache isolation, offline/`404`/`5xx` fallback, unchanged
  `401`/`403`/`410` responses, request-boundary exclusions, cache-version
  cleanup, and explicit update activation.
- Workspace Playwright proves React parity across the five approved viewports;
  local fake-Provider Agent Playwright covers direct legacy/React/admin entries
  and fingerprints legacy local-storage fixtures before and after React entry.
  Neither suite may contact production or a live Provider/MCP server.
- Run the complete Vitest suite, typecheck, Wrangler dry-run, diff check, and
  repository-wide Trellis consistency serially with frontend builds.

### 7. Wrong vs Correct

#### Wrong

```javascript
const SHELL_ASSETS = ["/legacy/", "/app.js"];
await cache.addAll(SHELL_ASSETS); // service-worker use becomes worker_api
```

#### Correct

```javascript
const response = await fetch(path, {
  headers: { "x-chatus-legacy-caller": "service_worker" },
});
await cache.put(path, response);
```

The explicit caller marker distinguishes service-worker use while the Worker
continues to own SHA resolution and the response remains the retained asset.

## Scenario: `legacy.api.chat-post`

### 1. Scope / Trigger

- Trigger: instrument the compatibility `POST /api/chat` boundary while callers
  migrate to the TeamAgent transport; this rollout does not delete the route or
  alter `/api/chats*` storage projections.
- Ownership: `data`; manifest version 2; read/write observation windows are 30
  days; the code ceiling is `instrumented` until a separately approved rollout
  proves later gates.

### 2. Signatures

```text
POST /api/chat -> legacy read admission, then legacy write admission, then the
TeamAgent-equivalent legacy handler
```

```typescript
recordLegacySurfaceUse(
  "legacy.api.chat-post",
  request,
  env,
  url,
  access: "read" | "write",
): Promise<{ ok: true; disabled: boolean; writeDisabled: boolean } | { ok: false; error: string }>
```

### 3. Contracts

- The route records exact, content-free caller/access/SHA evidence. Request,
  conversation, model, Provider, credential, memory, tool, and response content
  never enters the registry.
- A POST performs a read control check before request dispatch. The write check
  runs after admission but before message construction or Provider/tool I/O.
- `read_disabled` returns HTTP `410 legacy_surface_read_disabled`; a write-disabled
  route returns HTTP `410 legacy_surface_write_disabled` and records no admitted
  write event.
- If a write is rejected after member/guest quota admission, the admission is
  released and its one-shot `refundQuota()` restores the consumed member bucket
  or both guest personal/source buckets. A rejected write therefore has no
  hidden Provider/tool side effect and no net message charge.
- The TeamAgent response body is wrapped so downstream reader cancellation aborts
  the internal turn. After visible output, fallback monitoring treats parent
  abort and reader cancellation as one idempotent cancellation: cancel the
  upstream reader, settle the attempt as `cancelled`, dispose deadlines, and
  release the Provider lease without fallback or failure telemetry.
- Observation or coordinator failures fail closed for this API boundary with the
  stable `legacy_surface_unavailable` error; no secret-bearing diagnostic is
  returned.
- The pre-disable routing rehearsal uses the real `rollbackLegacySurface` RPC:
  a simulated `write_disabled` projection rolls back to `shadowing`, both
  controls become enabled, and a subsequent local fake-Provider POST succeeds.
  Read-disable remains an independent terminal check after that rehearsal.
- Isolated restore evidence for this surface must use the runtime-exported
  TeamAgent and UserState schema versions, include a non-empty transitional
  `chatus_conversations` row, map it to the isolated target conversation Agent,
  retain the exact `legacy.api.chat-post` registry atom, and keep target writes
  closed through acceptance. A fixture-derived invented schema is not recovery
  evidence even when both fixture producer and consumer agree with each other.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Manifest/coordinator unavailable or conflicting | `503 legacy_surface_unavailable`; no Provider call |
| Read control disabled | `410 legacy_surface_read_disabled`; no admission or Provider call |
| Write control disabled | `410 legacy_surface_write_disabled`; quota is refunded; no write event or Provider/tool call |
| Client cancels before visible output | `request_cancelled`; no fallback and the lease/attempt settles once |
| Client cancels after visible output | Upstream reader cancellation; attempt `cancelled`; no synthetic failure telemetry |
| Normal legacy POST | One content-free read and one content-free admitted-write event; TeamAgent-equivalent result |

### 5. Good / Base / Bad Cases

- Good: a write-disabled request records the compatibility read, refunds the
  provisional quota admission, and returns 410 without touching a fake Provider.
- Base: an enabled request emits bounded read/write evidence and reaches the
  same route, Skill, tool, file, stream, error, and attempt semantics as Agent.
- Bad: check the write control after starting Provider work, count a rejected
  write as admitted evidence, charge quota twice, or expose the coordinator
  conflict text to the member.

### 6. Tests Required

- Worker tests compare legacy and TeamAgent member/guest admission, route and
  Skill selection, quota, fallback, tools/files, stable errors, streams,
  cancellation, attempt identity, and secret-free telemetry using local fake
  Provider/MCP fixtures only.
- The legacy control test asserts read/write evidence counts, zero Provider calls
  on disabled writes, unchanged quota after the one-shot refund, transactional
  rollback to `shadowing`, and successful route reuse after rollback.
- The isolated restore drill decodes the restored conversation Agent payload,
  asserts the real runtime schema, non-empty transitional conversation row,
  stable target identity mapping, preserved legacy-surface controls, zero loss,
  unchanged source digest, and writes closed through acceptance.
- Fallback unit tests assert committed-stream parent abort cancels the upstream
  reader, releases the lease once, and leaves failure telemetry at zero.
- Any test that mutates a Durable Object manifest/state directly must restore the
  exact code-owned manifest/state in `finally`; otherwise later legacy callers
  correctly fail closed and the suite becomes order-dependent.
- Census tests that require an exact count must capture the full surface atom,
  clear only their local daily rows, then delete and restore the exact snapshot
  in `finally`; they must not assume earlier tests left the shared coordinator
  empty.

### 7. Wrong vs Correct

#### Wrong

```typescript
await admitTurn();
await provider.stream();
if (legacyWriteDisabled) return new Response("disabled", { status: 410 });
```

#### Correct

```typescript
const admission = await admitTurn();
const control = await recordLegacySurfaceUse("legacy.api.chat-post", request, env, url, "write");
if (!control.ok || control.disabled) {
  await Promise.allSettled([admission.release(), admission.refundQuota()]);
  return legacySurfaceUnavailableOrWriteDisabled(control);
}
```

## Scenario: `legacy.api.cloud-chats`

### 1. Scope / Trigger

- Trigger: instrument the compatibility `GET/PUT/DELETE /api/chats` and
  `POST /api/chats/migrate` boundaries while callers move to the Agent
  conversation API; this rollout does not delete routes or storage.
- Ownership: `data`; manifest version 2; separate 30-day read/write windows;
  code ceiling `instrumented` until later gates are separately approved.

### 2. Signatures

```text
GET /api/chats -> read admission
PUT /api/chats, DELETE /api/chats, POST /api/chats/migrate
  -> read admission, then write admission, then retained handler
```

### 3. Contracts

- Every method records only declared caller class, read/write access, UTC
  bucket, occurrence time, and server-owned deployment SHA.
- PUT, DELETE, and migrate perform read admission before parsing or mutating,
  then perform write admission immediately before UserState/Agent changes.
- Read-disable returns `410 legacy_surface_read_disabled`; write-disable
  returns `410 legacy_surface_write_disabled` before any UserState, Agent, KV,
  cleanup, or accounting side effect.
- Coordinator or manifest failures return `503 legacy_surface_unavailable` and
  never expose internal state or request content.
- Caller classes are `agent_runtime`, `browser`, `operator`, `test`, and
  `worker_api`; unknown declarations fail closed to `worker_api`.

### 4. Parity and Recovery Gates

- Before write-disable, deterministic fixtures must reconcile list/read/upsert/
  delete/migrate ordering, pagination, metadata, tombstones, retries,
  idempotency, cleanup, and UserState/Agent identity mappings.
- Capture/isolated restore retains transitional UserState and Agent state;
  `compatibility_read` rollback re-enables the retained route against the same
  authoritative source without mixing restored/source data.
- The local pre-disable rehearsal captures the complete surface atom, exercises
  the real write rollback to `shadowing`, then exercises the real read rollback
  to `recovery_proven`. The retained compatibility read becomes available while
  writes stay disabled, and the exact pre-test atom is restored in `finally`.
- Isolated restore uses the runtime-exported UserState and TeamAgent schema
  versions, retains non-empty compatible UserState and conversation-Agent rows,
  preserves one-to-one stable principal/resource mappings plus the exact
  `legacy.api.cloud-chats` registry atom, and keeps target writes closed.
- Any unexplained caller, parity divergence, or recovery failure resets only
  the affected observation window.

### 5. Tests Required

- Worker tests cover all four methods, all declared callers, content-free
  counters, server-owned SHA, read/write controls, and zero side effects on
  disabled writes.
- The route rehearsal must use real rollback RPCs, prove legacy and Agent state
  stay unchanged on a blocked write, restore compatibility reads without
  reopening writes, and restore the exact code-owned surface atom after the test.
- The isolated restore drill must decode the current UserState and TeamAgent
  snapshots, prove their non-empty conversation mapping and unique stable target
  identities, retain the cloud-chats registry projection, and emit no content.
- Census policy tests require the exact 30-day window, caller allowlist, and
  aggregate anomaly gate; production collection remains read-only and
  GitHub-Actions-only.

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

- Assert all 13 IDs occur once and stay sorted; the admin alias, browser shell,
  chat POST, and cloud-chats records are version 2/owned/`instrumented`, the
  other 9 remain version 1/unassigned/`discovered`,
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

The code-owned record establishes the maximum authority. The admin alias and
browser shell may advance only to `instrumented`; runtime disablement and
destructive cleanup remain separate, later, per-surface deliveries.
