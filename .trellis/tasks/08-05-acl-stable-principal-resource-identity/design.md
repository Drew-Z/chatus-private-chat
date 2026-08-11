# ACL stable principal and resource identity design

## Architecture And Ownership

Add a dedicated `IDENTITY_REGISTRY -> IdentityRegistry` SQLite Durable Object
binding, created by append-only migration `v6`. The singleton object name is
`$identity-registry`. It owns only content-free identity and routing metadata:

```text
principals
principal_aliases
conversation_resources
identity_migration_markers
identity_operations
```

The registry registers itself with the instance-maintenance inventory and
supports capture/restore as authoritative state. `CHAT_STORE` keeps session and
managed-member records, Root TeamAgent keeps conversation metadata/memory/files,
UserState keeps quota/OAuth/legacy projections, and conversation TeamAgent keeps
the transcript. None of those content owners move into the registry.

## Versioned Contracts

Representative internal RPCs are strict, exact-key, and versioned:

```typescript
resolveOrCreatePrincipal(input: {
  version: 1;
  operationId: string;
  alias: string;
  origin: "legacy" | "native";
  legacyRootInstance?: string;
  legacyUserStateInstance?: string;
}): Promise<PrincipalResolutionResultV1>

resolvePrincipalSession(input: {
  version: 1;
  principalId: string;
  alias: string;
}): Promise<PrincipalRouteResultV1>

ensureConversationResource(input: {
  version: 1;
  operationId: string;
  principalId: string;
  conversationId: string;
  legacyAgentInstance?: string;
}): Promise<ConversationResourceResultV1>

reconcilePrincipalIdentity(input: {
  version: 1;
  operationId: string;
  principalId: string;
  expectedRegistryRevision: number;
  conversations: Array<{
    conversationId: string;
    expectedAgentInstance: string;
  }>;
}): Promise<IdentityReconciliationResultV1>
```

IDs are server-issued opaque UUID-based values with distinct `prn_` and `res_`
prefixes. Alias normalization follows the current member-label contract. Route
names are stored and returned only by internal RPCs; public/admin projections
contain IDs, revisions, states, counts, digests, and closed error codes, never
labels together with resource topology, content, object keys, tokens, or secrets.

## Migration And Data Flow

### Existing members

1. Enumerate current managed/legacy access labels in bounded administrator work.
2. Create one `legacy` principal and pin the existing label-derived Root
   TeamAgent and UserState instance names.
3. List that pinned Root Agent's active/tombstoned conversation metadata.
4. Create one resource per conversation and pin the existing
   label/chat-derived conversation Agent instance.
5. Assert stable markers in Root, UserState, and conversation Agents.
6. Re-read the Root projection and every marker, then commit a reconciliation
   digest. Unknown or divergent entries remain blocked and retryable.

The registry never copies transcripts, memory, OAuth records, files, or Agent
SQLite. For a migrated record, the stable route is the stored existing route.

### New members and conversations

Member creation reserves a native principal before the credential record is
committed and reuses the same operation ID after ambiguous failure. Native Root
and UserState routes are derived from `principalId`; native conversation routes
are derived from `resourceId`. An unused reservation contains no credential and
grants no session.

Login resolves the alias to a principal before writing a member session. The
session stores both current alias and `principalId`; each authenticated request
revalidates that binding. Existing sessions without `principalId` are upgraded
only through an exact active alias mapping and rewritten with the remaining TTL.

### Routing

Worker helpers accept a resolved `PrincipalRouteV1` or
`ConversationResourceRouteV1`, never a raw browser ID. Backfilled records compare
the legacy-computed route with the pinned route. Native records have no legacy
comparison. The registry state advances:

```text
backfilled -> reconciled -> authoritative
```

Only exact one-step transitions are allowed. A route mismatch, wrong Agent
marker, stale revision, alias conflict, or missing resource fails before
Provider/tool/file I/O. Existing TeamAgent `chatus:agent-identity:v1` remains;
an additive stable marker binds principal/resource IDs to the pinned instance.

## Alias Retirement And Reuse

Revocation retires the active alias binding after sessions are revoked. The old
principal and pinned routes remain preserved for deletion/recovery, but the
alias cannot authenticate it. Reusing the same display/login string creates a
new native principal and new stable-derived routes. Alias history makes reuse
detectable and prevents fallback to a label-named UserState or Agent.

This child does not expose rename UI. Registry rename/retire behavior is tested
as an internal lifecycle contract for the later ACL/member-management tasks.

## Recovery, Deletion, And Rollback

The new v6 binding and registry snapshot join the exact capture/restore binding
matrix. Restore validates principal/alias/resource/marker uniqueness, pinned
route syntax, ownership, and reconciliation digests before target writes.

Permanent member deletion resolves the principal first, purges only its pinned
stores, retains alias/resource tombstones required for anti-resurrection, and
never searches by a reused label. Partial failure keeps the existing autonomous
cleanup ownership and exact retry identity.

Rollback prevents new `authoritative` transitions and uses the retained pinned
legacy routes for migrated principals. Native principals continue on their
stable routes. Stable IDs, markers, alias history, and data are never deleted or
rebound as rollback.

## Security And Compatibility

- Guests remain on their current ephemeral label-derived isolation and cannot
  acquire a member principal or resource registry entry.
- Current labels may still select configuration/display policy in this child,
  but never storage or authorization identity.
- Public responses do not expose pinned Durable Object names.
- ACL/share/transfer endpoints and discovery do not exist; later children must
  use these IDs and cannot weaken the exact server-side resolution boundary.
