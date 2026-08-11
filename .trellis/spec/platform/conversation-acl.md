# Conversation ACL And Authoritative Revocation

## 1. Scope / Trigger

Use this contract when changing conversation discovery, reads, Agent transport,
message/title mutations, share management, principal retirement, tool trust,
capture/restore, or any API that accepts a conversation `resourceId`.

Conversation ACL is resource-scoped. It never turns an owner Root `TeamAgent`,
Workspace, memory, credential, OAuth connection, feedback record, export scope,
or capability assignment into shared state.

## 2. Signatures

```typescript
type ConversationAccessRoleV1 = "owner" | "editor" | "viewer";
type ConversationGrantRoleV1 = "editor" | "viewer";

type ConversationAccessSnapshotV1 = {
  version: 1;
  resourceId: string;
  conversationId: string;
  ownerPrincipalId: string;
  actorPrincipalId: string;
  role: ConversationAccessRoleV1;
  accessRevision: number;
  grantRevision: number;
  agentInstanceName: string;
  ownerRootInstanceName: string;
};
```

```text
resolveConversationAccess({ version: 1, actorPrincipalId, resourceId,
  conversationId, action, expectedAccessRevision? })
listConversationAccessRoutes({ version: 1, actorPrincipalId, cursor?, limit })
listConversationGrants({ version: 1, actorPrincipalId, resourceId })
upsertConversationGrant({ version: 1, operationId, actorPrincipalId, resourceId,
  targetPrincipalId, role, expectedAccessRevision })
revokeConversationGrant({ version: 1, operationId, actorPrincipalId, resourceId,
  targetPrincipalId, expectedAccessRevision })
assertConversationMutationCommit({ version: 1, actorPrincipalId, resourceId,
  conversationId, action, accessRevision, grantRevision })
```

```text
GET  /api/agent/conversations
GET  /api/agent/conversations/:id/shares?resourceId=<res_...>
PUT  /api/agent/conversations/:id/shares
POST /api/agent/conversations/:id/shares/revoke
GET  /agent?chatId=<id>&resourceId=<res_...>
```

The PUT body is exactly `{ version, operationId, resourceId, granteeLabel,
role, expectedAccessRevision }`. The revoke body is exactly `{ version,
operationId, resourceId, granteePrincipalId, expectedAccessRevision }`.

IdentityRegistry SQLite schema v2 adds `conversation_resources.access_revision`,
`conversation_acl_entries`, and append-only `conversation_acl_events`. The
Wrangler Durable Object migration tag remains `v6`.

## 3. Contracts

### Authority And Role Matrix

- `IdentityRegistry` is the only ACL authority. The Worker derives the actor from
  the authenticated member session and never trusts browser role, principal,
  owner, Agent route, or revision fields.
- Owners are synthesized from `conversation_resources.principal_id`; no owner
  grant row exists. One `(resourceId, granteePrincipalId)` row stores the current
  `editor|viewer` grant state.
- Owner permits every declared action. Viewer permits only
  `conversation.list` and `conversation.read`. Editor additionally permits
  `conversation.message.send`, `conversation.message.stop`, and
  `conversation.title.update`.
- Route/Skill changes, branches, delete, ACL management, Workspace references,
  tools, feedback, and export remain owner-only.
- Unknown, inactive, revoked, or mismatched resource/chat access returns the same
  `conversation_not_found` response. A known active grant with an insufficient
  role returns `conversation_action_denied`.

### Grant, Replay, And Discovery

- `accessRevision` starts at `1` and advances exactly once for each effective
  grant, role change, revoke, or lifecycle-derived revoke. `grantRevision` is the
  revision that activated the current grant; owner snapshots use `0`.
- Grant and revoke run inside one `transactionSync` with the existing
  `identity_operations` fingerprint record. Same operation and fingerprint
  replays the original result. Reusing an operation ID for another payload fails.
- A new operation that requests the already-current state returns `changed:false`
  without advancing the revision or appending an ACL event.
- Targets are requested by exact bounded active alias, then stored by immutable
  principal ID. Self-grant, expiry fields, public links, groups, and invitations
  are invalid or unsupported.
- Accessible lists are bounded to 50 routes and ordered by stable resource ID.
  Shared summaries are fetched with `ownerRoot.getConversationSummary(id)` only;
  the Worker never lists another principal's Root conversations.
- Shared summary projection includes `resourceId`, `accessRole`, and
  `accessRevision`, removes `parentChatId`, and forces `workspaceFiles: []`.

### Agent Execution And Revocation

- The Worker opens the stable resource Agent and supplies a server-derived
  `ConversationAgentAccessContextV1`. Stable owner identity stays separate from
  the per-request actor used for quota and Provider attribution.
- Viewer sends fail before Provider preparation. Editor turns reuse the owner's
  stored route/Skill settings but receive empty root memory, empty Workspace
  context, no browser API key, no OAuth credential, and an empty tool set.
- Every editor turn records actor/resource/access/grant revisions plus the
  pre-turn transcript length. Before stream chunks and final persistence, the
  Agent calls `assertConversationMutationCommit` with the exact snapshot.
- A stale fence aborts the stream, restores the transcript baseline, drops
  pending activity/index updates, and releases Provider, tool, and maintenance
  resources exactly once.
- `applyConversationAccessRevision` is best-effort derived invalidation. It clears
  conversation tool trust and aborts older active turns, but correctness depends
  on authoritative resolution and the final commit fence, not callback delivery.
- Principal retirement transactionally revokes every active grant held by that
  principal. System-derived revoke events use null actor/revoker fields.

### Privacy, Recovery, And Unsupported Behavior

- ACL rows/events contain opaque principal/resource IDs, roles, revisions,
  operation IDs, and timestamps only. They contain no labels in events, content,
  memory, filenames, Provider data, credentials, OAuth tokens, or tool payloads.
- IdentityRegistry capture/restore includes ACL entries/events and resource access
  revisions. Inspection exposes bounded active/revoked/event counts only.
- User export remains caller-owned and does not include shared conversations or
  grant metadata. Shared/resource-local files, shared tools, shared export,
  ownership transfer, owner deletion disposition, tombstones, expiry, public
  links, groups, and organization RBAC remain unsupported.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Unknown, revoked, inactive, or mismatched actor/resource/chat | `404 conversation_not_found`; disclose no owner or grant metadata |
| Active viewer/editor attempts a disallowed action | `403 conversation_action_denied` |
| Missing/extra/invalid v1 share input or expiry field | `400 conversation_acl_input_invalid` or exact input error; no mutation |
| Expected access revision is stale | `409 conversation_access_revision_conflict`; preserve current state |
| Operation ID is reused with another fingerprint | `409 conversation_acl_operation_conflict` |
| Target alias is unknown or retired | `404 acl_target_unavailable`; do not distinguish lifecycle state |
| Owner targets the owner principal | `400 conversation_acl_target_invalid` |
| ACL authority is unavailable for shared access | `503 conversation_acl_unavailable`; perform zero Provider/tool/storage mutation |
| Derived Agent invalidation fails after ACL commit | Keep the committed ACL result; retry cleanup and never restore old access |
| Editor fence becomes stale during prepare/stream/persistence | Abort, restore baseline, record no successful activity, make zero tool calls |
| Owner request omits `resourceId` during compatibility window | Resolve only through the authenticated owner's exact resource; never use fallback for shared access |

## 5. Good / Base / Bad Cases

- Good: a grant response is lost after commit; retrying the same operation ID and
  revision returns the committed result without another event.
- Good: revoke commits while an editor stream is active; derived invalidation is
  dropped, but the next commit fence aborts and removes tentative transcript data.
- Base: an owner continues using a compatible client without `resourceId`; the
  server resolves only that owner's exact `(principalId, conversationId)` route.
- Bad: open the caller's Root and search by conversation ID, trust a browser role,
  or treat cache invalidation as the revocation authority.

## 6. Tests Required

- Contract tests cover exact decoders, all owner/editor/viewer actions, unknown
  actions/fields, no expiry, and access/grant revision validation.
- Registry tests cover migration v1 -> v2, owner synthesis, bounded cursor,
  grant/role/revoke/no-op/replay/conflict, append-only events, principal retirement,
  inspection privacy, and capture/restore table coverage.
- Worker tests cover list/share/title plus every owner-only path, forged IDs and
  roles, non-enumerating denial, stale revisions, target lifecycle, and committed
  results when invalidation fails.
- Local fake Provider/MCP tests prove editor attribution, no owner/editor memory,
  file, API-key, OAuth, or tool leakage, viewer denial, revoke races, transcript
  rollback, stale resume denial, and zero remote calls.
- Browser tests cover owner management, viewer/editor control matrices, revoke,
  reload/error recovery, and narrow viewports. Never use live Provider/MCP,
  synthetic production probes, or local production deployment.

## 7. Wrong vs Correct

### Wrong

```typescript
const agent = await getTeamAgent(env, session.label, session);
await agent.sendMessage({ chatId, role: body.accessRole });
```

### Correct

```typescript
const access = await registry.resolveConversationAccess({
  version: 1,
  actorPrincipalId: session.principalId,
  resourceId,
  conversationId: chatId,
  action: "conversation.message.send",
});
const agent = env.TEAM_AGENT.getByName(access.agentInstanceName);
const headers = new Headers(request.headers);
headers.set(
  CONVERSATION_AGENT_ACCESS_HEADER,
  JSON.stringify(conversationAgentAccessContext(session, access)),
);
return agent.fetch(new Request(request, { headers }));
```

Inside the resource Agent, the final durable boundary repeats:

```typescript
await registry.assertConversationMutationCommit({
  version: 1,
  actorPrincipalId: access.actorPrincipalId,
  resourceId: access.resourceId,
  conversationId: access.conversationId,
  action: "conversation.message.send",
  accessRevision: access.accessRevision,
  grantRevision: access.grantRevision,
});
```
