# Stable Principal And Resource Identity

## 1. Scope / Trigger

Use this contract when routing member sessions, Root/UserState/conversation
Durable Objects, Workspace queues, OAuth state, quota, cleanup, export, capture,
or permanent deletion. Browser labels are aliases only; they are never storage
or authorization identities.

## 2. Signatures

```text
GET  /api/admin/identity?limit=<1..50>
POST /api/admin/identity/reconcile
```

```typescript
type DocumentIngestMessage = {
  ownerId: string;
  principalId: string;
  rootInstanceName: string;
  userStateInstanceName: string;
  registryRevision: number;
  fileId: string;
  versionId: string;
  generation: number;
};

reconcilePrincipalIdentity(input: {
  version: 1;
  operationId: string;
  principalId: string;
  expectedRegistryRevision: number;
  conversations: Array<{ conversationId: string; expectedAgentInstance: string }>;
}): Promise<IdentityReconciliationResultV1>

recordStableIdentityMarker(input: {
  version: 1;
  entityType: "principal" | "resource";
  entityId: string;
  markerKind: "root" | "user_state" | "conversation";
  pinnedInstanceName: string;
  expectedRegistryRevision: number;
  expectedPrincipalRevision: number;
  digest: string;
  recordedAt: number;
}): Promise<{ created: boolean }>
```

## 3. Contracts

- `IDENTITY_REGISTRY` is the singleton `$identity-registry` SQLite Durable
  Object. Its append-only schema migration is v6 in Wrangler; its own SQLite
  schema is `identity-registry-v2`.
- A member session carries `principalId`, `rootInstanceName`,
  `userStateInstanceName`, and `registryRevision`. Every authenticated request
  revalidates the exact principal/alias binding before storage or Provider I/O.
- The public `agent.instance` value is a one-way client cache/connection key
  derived from the authenticated principal. It is not a pinned Durable Object
  name, exposes no principal ID, and changes when a retired alias is reused.
- Legacy principals pin their existing label-derived routes. Native principals
  derive Root/UserState from `prn_<uuid>` and conversation Agents from
  `res_<uuid>`. Alias retirement is permanent; reuse creates a new native
  principal and cannot read the old principal's stores.
- Before any pinned route becomes authoritative, legacy principal/resource
  routes must equal the exact label-derived route and native routes must equal
  the exact opaque-ID-derived route. A registry row cannot make an arbitrary
  Durable Object name authoritative; resource ownership must also equal the
  authenticated principal.
- Removing member access retires the active alias even when best-effort
  session-key cleanup is incomplete. A leftover session then fails its registry
  revalidation, and later credential creation for the same label receives a new
  native principal. `DELETE /api/user-data` retains the current principal and
  resource tombstones because it removes data without removing member access.
- Root/UserState/conversation Agents persist an additive stable marker. Marker
  route, scope, principal/resource IDs, and registry revision must match before
  an operation is authoritative.
- Migration marker history is keyed by both the entity registry revision and
  the owning principal revision. Resource marker digests include both values;
  when only the principal revision advances, the same resource revision records
  a new marker instead of conflicting with or overwriting older evidence.
- An already established member conversation Agent revalidates the active alias,
  principal route, principal revision, resource owner, resource ID, pinned Agent
  name, and resource revision before every turn. Alias retirement returns the
  closed unauthorized identity response before Provider execution; registry
  unavailability fails closed as a retryable identity service error.
- Queue payloads require all eight exact fields shown above. They are decoded by
  `decodeDocumentIngestMessage`; missing/extra identity fields are rejected and
  cannot fall back to label-derived Root routing.
- Queue consumers resolve the exact active principal and open the payload's
  pinned Root stub directly for a read-only marker comparison. Missing or drifted
  Root markers are stale messages to ack, not opportunities to initialize or
  rewrite Agent identity. Registry/storage availability failures still retry and
  retain DLQ behavior.
- Admin reconciliation is bounded to 50 conversation entries, requires an exact
  operation ID and expected revision, and returns only IDs, revisions, counts,
  migration state, a digest, and closed issue codes. It never returns labels,
  object names, conversation content, credentials, tokens, or raw exceptions.
- Resource-scoped viewer/editor grants and authoritative revocation follow
  `conversation-acl.md`. Transfer, owner deletion disposition, shared files/tools,
  and shared exports remain unsupported.
- Capture requires a registered `identity_registry` object with an actual
  `identity-registry-v2` Durable Object snapshot. Missing registration fails
  `capture_object_registry_incomplete`; placeholder empty inventory must never
  stand in for authoritative registry state. Restore validates the v6 binding
  and snapshot before target mutation.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Queue message missing or adding any key | Ack as stale; perform no R2/Provider work |
| Queue principal, pinned route, or revision differs from the Root marker | Ack as stale; perform no metadata mutation |
| Pinned route differs from its legacy/native derivation or resource owner | Fail closed before Agent, UserState, R2, Provider, or tool I/O |
| Alias is missing, retired, or resolves to another principal | Fail closed; never route by the reused label |
| Established member Agent observes retired/drifted identity | Return `401 agent_identity_unavailable`; perform zero Provider calls |
| Established member Agent cannot read the registry | Return `503 agent_identity_unavailable`; perform zero Provider calls |
| Resource marker is replayed after only principal revision advances | Record distinct cross-revision evidence; do not report marker conflict |
| Session KV cleanup is incomplete after access removal | Retire the alias anyway; leftover sessions fail registry revalidation |
| Reconciliation limit is absent, non-integer, or above 50 | `400 identity_limit_invalid` / `400 identity_reconciliation_input_invalid` |
| Reconciliation revision is stale | `409 identity_registry_revision_conflict` |
| Duplicate operation ID has a different payload | `409` identity operation conflict; preserve the original result |
| Resource, Agent route, marker, or bounded conversation parity is wrong | Return the corresponding closed issue code; do not select a mapping silently |
| Registry/marker storage is unavailable | `503 identity_inspection_unavailable` or `503 identity_reconciliation_unavailable` |
| Capture registry registration is absent | Fail `capture_object_registry_incomplete`; do not emit an empty placeholder |

## 5. Good / Base / Bad Cases

- Good: a queue retry carries the same principal and pinned Root route after a
  Worker restart and completes the exact file generation.
- Base: a legacy alias resolves to its retained pinned route while the browser
  label remains presentation-only.
- Bad: a queue consumer calls `getTeamAgent(env, body.ownerId)` without a
  principal-bound route, or a reconciler copies a label into a new Root name.

## 6. Tests Required

- Registry tests cover legacy/native route creation, marker transitions, alias
  retirement/reuse, duplicate operation replay, bounded reconciliation issues,
  cross-principal-revision marker history, retired-state transition denial, and
  exact response privacy. ACL tests additionally prove lifecycle-derived grant
  revocation increments the resource access revision and records a null-actor
  content-free event.
- Worker tests cover admin inspection/reconciliation, stale revisions, injected
  identity fields, no-label/no-route response projections, and idempotent replay.
- Session and deletion tests prove a reused label receives a different
  principal, Root/UserState route, and public Agent client key, while the old
  cookie becomes unauthorized.
- Queue tests cover exact decoder rejection, pinned-route mismatch, generation
  CAS, read-only Root-marker drift ack, retry/DLQ, and zero R2/Provider/metadata
  mutation on stale identity.
- TeamAgent tests cover an established connection before and after alias
  retirement, registry unavailability, and zero Provider calls on either
  fail-closed path.
- Capture tests register and snapshot the singleton registry and prove missing
  registration cannot be replaced by placeholder inventory.
- Full Worker API, TeamAgent, Workspace, OAuth, quota, capture/restore, and
  permanent-delete suites must remain fake-runtime only.

## 7. Wrong vs Correct

### Wrong

```typescript
const root = await getTeamAgent(env, message.ownerId);
```

### Correct

```typescript
const lookup = await registry.lookupActivePrincipalAlias({
  version: 1,
  alias: message.ownerId,
});
if (!lookup.found || lookup.route.principalId !== message.principalId) return "ack-stale";
if (lookup.route.rootInstanceName !== message.rootInstanceName) return "ack-stale";
const root = env.TEAM_AGENT.getByName(message.rootInstanceName);
const marker = await root.getStableIdentity();
if (!sameQueueRootMarker(marker, message)) return "ack-stale";
```
