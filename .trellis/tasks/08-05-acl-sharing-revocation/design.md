# ACL sharing and revocation design

## 1. Architecture and authority

`IdentityRegistry` remains the single routing and ACL authority. It owns stable
resource routes, access revisions, grant projection, idempotency evidence and ACL
events in one Durable Object SQLite transaction. The owner root `TeamAgent` owns
the bounded conversation summary/settings. The stable resource `TeamAgent` owns
the transcript and active-turn cancellation.

```text
member session
  -> Worker resolves server session principal
  -> IdentityRegistry resolves resource + role + accessRevision + action
  -> Worker opens exact owner-root or resource Agent route
  -> Agent rechecks the server access snapshot at mutation boundaries
  -> IdentityRegistry final commit fence linearizes before transcript/index write
```

The browser never chooses an owner, role, principal, Agent instance or accepted
revision. `resourceId` is a locator only; possession is not authorization.

## 2. Versioned contracts

Add to `src/contracts/identity.ts`:

```ts
type ConversationAccessRoleV1 = "owner" | "editor" | "viewer";
type ConversationGrantRoleV1 = Exclude<ConversationAccessRoleV1, "owner">;
type ConversationGrantStateV1 = "active" | "revoked";
type ConversationAccessActionV1 =
  | "conversation.list" | "conversation.read" | "conversation.message.send"
  | "conversation.message.stop"
  | "conversation.title.update" | "conversation.settings.update"
  | "conversation.branch.create" | "conversation.delete"
  | "conversation.acl.read" | "conversation.acl.mutate"
  | "conversation.workspace_refs.read" | "conversation.workspace_refs.mutate"
  | "conversation.tools.execute" | "conversation.feedback.create"
  | "conversation.export";

type ConversationAccessSnapshotV1 = {
  version: 1;
  resourceId: string;
  conversationId: string;
  ownerPrincipalId: string;
  actorPrincipalId: string;
  role: ConversationAccessRoleV1;
  accessRevision: number;
  grantRevision: number; // owner uses 0
  agentInstanceName: string;
  ownerRootInstanceName: string; // internal routing only; never projected to browsers
};
```

All decoders use exact keys, current opaque-ID validators and bounded operation
IDs. Unknown action/role/state/version/expiry keys are invalid input.

`ConversationResourceRouteV1` remains version 1 and retains `principalId` as the
current owner for compatibility, but adds no ACL fields. ACL RPC results use the
explicit `ownerPrincipalId` name to prevent ownership/actor ambiguity.

## 3. SQLite migration v2

Raise `IDENTITY_REGISTRY_SCHEMA_VERSION` to `2` and append migration 2 inside
`IdentityRegistry.applySchemaMigrations()`:

```sql
ALTER TABLE conversation_resources
  ADD COLUMN access_revision INTEGER NOT NULL DEFAULT 1;

CREATE TABLE conversation_acl_entries(
  resource_id TEXT NOT NULL,
  grantee_principal_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('editor', 'viewer')),
  state TEXT NOT NULL CHECK(state IN ('active', 'revoked')),
  grant_revision INTEGER NOT NULL,
  revoke_revision INTEGER,
  granted_by_principal_id TEXT NOT NULL,
  revoked_by_principal_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY(resource_id, grantee_principal_id)
);
CREATE INDEX conversation_acl_active_grantee_idx
  ON conversation_acl_entries(grantee_principal_id, resource_id)
  WHERE state = 'active';

CREATE TABLE conversation_acl_events(
  operation_id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  actor_principal_id TEXT,
  target_principal_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('grant', 'role_change', 'revoke')),
  before_role TEXT,
  after_role TEXT,
  access_revision INTEGER NOT NULL,
  occurred_at INTEGER NOT NULL
);
CREATE INDEX conversation_acl_events_resource_idx
  ON conversation_acl_events(resource_id, access_revision);
```

The existing `conversation_resources.principal_id` remains the only owner record;
no owner ACL row is inserted. A mutation validates owner/principal lifecycle and
target inequality, increments `access_revision` exactly once, upserts the current
grant, appends one event and stores the replay result in `identity_operations`
inside one `transactionSync`. Repeating an already-current desired state with a
new operation returns `changed:false` without incrementing revision or appending
an event. Same operation/fingerprint replays the original result; same operation
with another fingerprint returns `conversation_acl_operation_conflict`.

Direct grants have no `expires_at`; adding expiry requires a later schema and
contract version. Revoked rows and events are retained.

Owner grant/role/revoke mutations persist the authenticated owner principal as
the actor and revoker. Lifecycle-derived revocation after a grantee's final alias
retires uses `NULL` actor/revoker fields so the audit does not falsely attribute
an administrator/system transition to the retired member; the deterministic
operation ID and target principal retain the content-free cause boundary.

Capture/restore inspection adds both ACL tables to `IDENTITY_REGISTRY_TABLES` and
reports bounded active/revoked counts without labels or content.

## 4. IdentityRegistry RPCs

All RPC input/output contracts are version 1.

- `lookupConversationResourceById({ resourceId })`: exact stable route lookup;
  returns no authority decision.
- `resolveConversationAccess({ actorPrincipalId, resourceId, conversationId,
  action, expectedAccessRevision? })`: verifies active actor/owner/resource,
  exact chat/resource pair and the action matrix. It returns an access snapshot,
  or a stable not-found/denied/revision error.
- `listConversationAccessRoutes({ actorPrincipalId, cursor?, limit })`: bounded
  owner plus active-grant routes, ordered by stable resource ID with opaque cursor;
  limit is `1..50`. It returns route/access fields, not titles or other aliases.
- `listConversationGrants({ actorPrincipalId, resourceId })`: owner-only active
  entries with target principal ID/current bounded alias, role, grant revision and
  timestamps. It never returns retired alias history.
- `upsertConversationGrant({ operationId, actorPrincipalId, resourceId,
  targetPrincipalId, role, expectedAccessRevision })`: owner-only grant or role
  change with transaction/replay semantics.
- `revokeConversationGrant({ operationId, actorPrincipalId, resourceId,
  targetPrincipalId, expectedAccessRevision })`: owner-only authoritative revoke;
  already-revoked returns `changed:false`.
- `assertConversationMutationCommit({ actorPrincipalId, resourceId,
  conversationId, action, accessRevision, grantRevision })`: final read-only
  transaction fence. It succeeds only for the exact still-current access snapshot.

ACL authority unavailability fails shared access closed. Owner resolution may use
the existing exact stable identity path and must never silently treat a grantee as
owner.

## 5. HTTP and Agent contracts

### 5.1 Conversation list and summary

`GET /api/agent/conversations` keeps its existing response and adds these fields
to each summary:

```ts
{ resourceId: string; accessRole: "owner"|"editor"|"viewer";
  accessRevision: number }
```

The Worker reads bounded access routes, groups owner-root lookups, and calls a new
`root.getConversationSummary(conversationId)` RPC for only the target ID. Missing,
deleted or mismatched summaries are omitted and recorded as content-free drift;
the Worker never calls another owner's `listConversations()` for sharing.

Owned creation remains `POST /api/agent/conversations`. Shared resources cannot
be created implicitly. All new client mutations send `resourceId`; the server
asserts the summary `conversationId` matches. A temporary owner-only fallback for
requests without `resourceId` preserves one-release browser compatibility.

### 5.2 Share management

- `GET /api/agent/conversations/:id/shares?resourceId=...`: owner-only list.
- `PUT /api/agent/conversations/:id/shares`: strict body
  `{ version:1, operationId, resourceId, granteeLabel, role,
  expectedAccessRevision }`.
- `POST /api/agent/conversations/:id/shares/revoke`: strict body
  `{ version:1, operationId, resourceId, granteePrincipalId,
  expectedAccessRevision }`.

An unknown/retired target label returns the non-enumerating
`acl_target_unavailable`. Owner self-grant is invalid. Successful grant/revoke
returns the new resource access revision, `changed`, and current bounded entries.

### 5.3 Existing conversation APIs

The Worker resolves one `ConversationAccessActionV1` before opening a root or
resource Agent:

- PATCH title: owner/editor; route and Skill fields: owner only. Mixed unauthorized
  fields reject the whole request.
- branch/edit/resend/regenerate: owner only.
- delete: owner only.
- workspace refs and attachment version resolution: owner only.
- user export/feedback: only owned resources under existing principal policy.
- memory/workspace/OAuth APIs remain caller-principal APIs and never accept a
  shared resource as an authority bridge.

### 5.4 Agent transport

The React client sends `/agent?chatId=...&resourceId=...` and derives its SDK name
from stable `resourceId + conversationId`, not caller root. The Worker authenticates
the session, resolves `conversation.read`, replaces any inbound internal access
headers, opens the exact stable resource Agent with owner stable-identity props,
and forwards a server-derived actor/access snapshot.

The Agent keeps stable owner identity separate from the per-request actor. It
constructs quota/Provider telemetry identity from the authenticated actor, while
owner root routing is used only for the bounded conversation settings/summary.
Viewer sends fail before Provider work. Editor sends ignore browser API keys and
prepare with empty root memory/workspace context and an empty tool set.

## 6. Mutation and revocation state machines

### 6.1 Grant/revoke

```text
owner request(expected r)
  -> registry transaction verifies owner + r
  -> accessRevision r+1, grant row/event/replay evidence commit
  -> response authority is now r+1
  -> best-effort resource Agent invalidation + trust clear + client refresh
```

If derived invalidation fails, retry it; never restore the old active grant. Every
new route/read/send resolves against the new registry revision.

### 6.2 Editor turn commit fence

```text
resolve editor snapshot r
  -> snapshot transcript state before submitted user message
  -> register active turn(actor, r, abort controller)
  -> prepare without memory/files/tools/user API key
  -> stream
  -> before any durable transcript/index/activity commit:
       registry.assertConversationMutationCommit(snapshot r)
       success => commit linearizes before a later revoke
       stale/revoked => abort, restore snapshot, no activity commit
  -> release turn/provider/instance fences exactly once
```

Tool execution callbacks also assert the current access snapshot. Since editor
tools are empty, their remote-call count is deterministically zero. Automatic
Skill Provider selection is part of the editor's permitted message turn and uses
the same abort/access lifecycle; it does not gain root context.

`TeamAgent.applyConversationAccessRevision(...)` is a best-effort post-authority
RPC. It stores the latest observed revision, clears conversation trust, and aborts
active turns for a revoked/downgraded actor. Correctness still comes from the
registry resolution and final commit fence.

Read requests linearize at `resolveConversationAccess`. A read resolved before a
revoke may finish; a read resolved afterward is 404. A stream may already have
emitted bytes when revoked; invalidation aborts remaining work, resume/reconnect
fails, and no stale transcript/index mutation commits.

## 7. Client design

Extend the conversation model/API helpers with `resourceId`, `accessRole` and
`accessRevision`. Add an owner-only `ConversationShareDialog` using the existing
React Dialog primitives: exact-label input, viewer/editor selector, active grant
list, role change and revoke confirmation. No `window.confirm` is introduced.

Show a compact role indicator for shared conversations. Gate controls as follows:

- viewer: transcript navigation only; no composer or message actions;
- editor: composer and rename only; no attachment, route/Skill, branch/message
  actions, delete, share, file context, feedback or tool approval;
- owner: existing controls plus share management.

The client refreshes the list after grant/revoke and treats 404/409 during an open
conversation as an access-state refresh, not an infinite retry. Revoked resources
are removed and selection falls back predictably.

## 8. Compatibility, rollout and rollback

1. Deploy schema/RPC and owner-compatible access snapshots with sharing disabled.
2. Enable owner share management and viewer reads after identity/list parity tests.
3. Enable editor send/title only after revoke-race and context-leak tests pass.
4. Retain owner-only missing-resource-ID compatibility for one release and record
   its use; shared requests never use it.

Rollback sets a code-owned ACL mode to deny new grants/shared mutations, revokes
active grants transactionally, aborts/clears derived execution state and retains
all principals, routes, ACL entries/events and owner data. Applied DO migrations
are append-only and are not removed by rollback.

## 9. Validation and risk closure

- `ACL-03`: exhaustive role/path tests with content/secret canaries across root
  memory, workspace files/refs, API key, OAuth, feedback, export and transcript.
- `ACL-04` partial: trust invalidation on every access revision, empty editor tool
  set, zero fake-MCP calls after deny/revoke and active-turn abort tests.
- Local fake Provider/MCP only; no live model, live MCP, synthetic production
  probe or local production deployment.
- Production evidence is exact SHA GitHub Actions CI/deploy/smoke plus retained
  artifacts. Docs/Trellis-only commits remain deployment-skipped.

Remaining unsupported after this design: transfer, owner deletion disposition,
tombstones, shared export, shared/resource-local files, shared tools, grant expiry,
public links, groups and organization RBAC.
