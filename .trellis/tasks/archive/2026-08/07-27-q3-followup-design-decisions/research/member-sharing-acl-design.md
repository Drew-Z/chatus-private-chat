# Member Sharing, Transfer, And ACL Design

## Status And Scope

This document records a future design decision. It does not authorize or implement sharing, transfer, ACL storage, cross-owner Agent access, schema changes, or data migration.

The target product behavior is conversation-level sharing between stable member principals while preserving Chatus's current owner-scoped memory, tool trust, exports, deletion, and Durable Object isolation.

## Current Evidence

- Root and conversation Agent instance names are derived from the trimmed member label; a conversation instance hashes both the label and chat ID (`src/worker.ts:9425`, `src/worker.ts:9430`).
- Every Agent call reasserts an exact `{ userLabel, scope, chatId, rootInstance }` identity. Conflicting identity cannot replace the stored record (`src/worker.ts:9435`, `src/agent/team-agent.ts:2621`, `src/agent/team-agent.ts:3151`).
- Root memory is a singleton owned by the root Agent. Conversation turns read it through the owner root and update it with a revision (`src/agent/team-agent.ts:1738`, `src/agent/team-agent.ts:1750`, `src/agent/team-agent.ts:2052`).
- Capability trust is stored by conversation, tool, and review revision inside the current owner Agent. It is not a portable authorization grant (`src/agent/team-agent.ts:2664`, `src/agent/team-agent.ts:2676`).
- User export reads the current root memory and owner conversation index, then opens conversation Agents derived from the same member label. The envelope is bounded and may be truncated (`src/worker.ts:4226`, `src/worker.ts:4238`, `src/worker.ts:4259`).
- Permanent deletion revokes sessions, purges owner `UserState`, root/conversation Agents, R2 files, exact legacy KV records, and feedback. It is idempotent but not a cross-store transaction (`src/worker.ts:1983`, `src/worker.ts:1443`, `.trellis/spec/platform/backup-restore.md:96`).
- Access-code revocation and session revocation do not delete configuration or user data; lifecycle domains are deliberately separate (`.trellis/spec/frontend/capability-assignment.md`, scenario "Typed Admin Member Access Lifecycle").

These facts mean a member label is currently both a login-facing identifier and a storage-routing input. Renaming or reassigning that string cannot safely represent durable sharing or transfer.

## Non-goals

- Sharing root memory, member credentials, Provider keys, MCP OAuth tokens, or conversation trust.
- Cross-instance organization, group, or public-link ACLs in the first release.
- Copying a conversation and calling the copy a transfer.
- Making access-code ownership equivalent to resource ownership.
- Changing current runtime behavior in this design task.

## Required Invariants

1. Every member receives an immutable, opaque `principalId`; labels remain mutable display/login aliases.
2. Every shareable conversation has exactly one active owner principal.
3. ACL evaluation uses authenticated principal identity at the Worker boundary. Browser-supplied principal, owner, role, or Agent instance names are never authoritative.
4. Conversation content may be shared only by an explicit resource ACL. Root memory, workspace root state, credentials, OAuth tokens, feedback ownership, and existing tool trust never follow implicitly.
5. Revocation denies new reads and writes before cleanup or cache invalidation is attempted.
6. Transfer is one ownership state transition with an idempotency key and an audit record; partial copy-and-revoke is not transfer.
7. Member deletion cannot orphan a resource or silently promote another member. It must follow a declared owner-deletion policy.
8. Export is principal-scoped and states whether it includes owned content, shared snapshots, or references. It never exports another principal's memory or credentials.
9. Deleted/tombstoned content cannot be revived by stale clients, imports, retries, or old ACL projections.

## Candidate Resource Models

### A. ACL On Each Conversation

Store `ownerPrincipalId` and revisioned ACL entries next to a conversation resource. This matches the first product scope and makes authorization local to the resource.

Trade-off: current conversation Agents are named with the owner label, so a future implementation must separate stable resource identity from owner routing before transfer is safe.

### B. Root Team Workspace Membership

Treat the owner root Agent as a workspace and put all conversation access in one root membership table.

Trade-off: this is operationally compact but over-broad. It makes it easy to leak memory, file workspace state, or future conversations through an inherited root role.

### C. Copy-Based Sharing

Copy a sanitized conversation snapshot into another member's root and retain provenance.

Trade-off: isolation is strong, but edits diverge and it does not satisfy shared editing or transfer semantics. It is a valid separate "duplicate" feature, not the recommended sharing model.

## Recommendation

Adopt model A after introducing stable resource identity:

- `principals` owns immutable member identity and current label aliases.
- `conversation_resources` owns a stable `resourceId`, `ownerPrincipalId`, lifecycle state, and revision.
- `conversation_acl` owns one role per `(resourceId, principalId)` plus grant/revoke metadata.
- Agent routing must derive from `resourceId`, not from the current owner label. The authenticated Worker resolves the resource and passes an exact expected owner/resource identity to the Agent.
- Root memory remains attached to the owner principal's root. Shared conversation execution must either omit root memory by default or use an explicit, bounded conversation-local context approved for that resource.

This recommendation deliberately blocks transfer until resource identity is independent from the owner label.

## Candidate Role And Action Matrix

| Action | Owner | Editor | Viewer |
| --- | --- | --- | --- |
| Read conversation history | allow | allow | allow |
| Send a message | allow | allow | deny |
| Edit title/pin | allow | allow | deny |
| Create a branch | allow | allow | deny |
| Attach an owner workspace file | allow, explicit version | deny by default | deny |
| Add a resource-local file | allow | allow, if future file ACL exists | deny |
| Invoke read-only reviewed tools | allow, fresh confirmation policy | deny by default | deny |
| Invoke write/destructive tools | allow, per-call confirmation | deny | deny |
| View owner root memory | deny through share | deny | deny |
| Change ACL | allow | deny | deny |
| Transfer ownership | allow, step-up required | deny | deny |
| Delete conversation | allow | deny | deny |
| Export owned conversation | allow | deny | deny |
| Export shared snapshot/reference | configurable, explicit | configurable, explicit | configurable, explicit |

The default editor policy is intentionally narrower than "owner except ACL". File and tool boundaries require their own future design and cannot be inferred from conversation edit permission.

## State And Data Flow

Conceptual states:

```text
active -> transfer_pending -> active(new owner)
active -> revoke_pending -> active
active -> owner_deletion_blocked | tombstoned
tombstoned -> purged
```

Authorization flow:

```text
session -> principal alias lookup -> resource lookup -> ACL revision check
        -> action policy -> Agent identity assertion -> operation
```

Every mutating request carries `expectedResourceRevision`. ACL changes, transfer, delete, and owner-deletion handling use separate idempotency keys. A stale role or revision fails before Agent/R2 mutation.

## Transfer Decision

Recommended semantics are atomic ownership reassignment, not copy-and-revoke:

1. Step-up authenticate the current owner.
2. Validate target principal, target acceptance if required, and no pending delete/purge.
3. Reserve transfer under one resource revision.
4. Change `ownerPrincipalId`, demote or remove the old owner according to the chosen product policy, and append an audit event.
5. Invalidate all prior ACL projections and tool trust.
6. Rebind storage routing only after resource identity is stable and independent of either label.

If step 6 cannot be made atomic with the authorization record, transfer remains unsupported. A copied duplicate may be offered separately with explicit divergence.

## Revoke, Deletion, Memory, Trust, And Export

### Revoke

- The ACL row becomes revoked at a new resource revision before session caches are cleared.
- In-flight writes must compare the revision at commit and fail if revoked.
- Existing browser transcripts are local observations, not continuing authorization.

### Member Deletion

- Non-owner deletion removes that principal's ACL rows and resource-local drafts; owned data is untouched.
- Owner deletion must be blocked until every owned resource is transferred or explicitly tombstoned, unless the approved policy is cascading deletion.
- No automatic "oldest editor becomes owner" behavior is allowed.

### Memory

- Root memory is never visible or editable through a shared conversation.
- A future conversation-local memory must be a separate resource with its own projection, revision, and deletion policy.

### Tool Trust

- Existing trust rows remain owner/conversation/review-revision state and are invalidated on transfer or ACL revision change.
- Editors do not inherit owner tool trust. Any future editor tool use starts from the tool's current confirmation policy.
- Write/destructive tools remain per-call `once/deny` even for the owner.

### Export

- Owned export may include the resource subject to existing size/truncation limits.
- Shared export defaults to a reference list or an explicitly labeled point-in-time snapshot.
- Export metadata includes role, owner-independent resource ID, snapshot time, and truncation state, but excludes other principals' labels unless product/privacy review approves disclosure.

## Migration And Compatibility

1. Create stable principals and a label alias mapping without changing Agent names.
2. Backfill stable resource IDs and owner principal IDs for existing conversations.
3. Verify one-to-one mapping and retain a migration marker for every root/conversation Agent.
4. Keep ACL disabled while routing remains label-derived.
5. Introduce resource-derived Agent routing with a dual-read compatibility period and exact reconciliation.
6. Enable sharing only after old and new projections match in local migration tests.
7. Enable transfer last, after an interrupted transfer drill proves recovery.

Rollback disables new grants and mutations first. It must not delete principals, resource IDs, ACL history, or migrated Agent data. Existing owners retain access while operators reconcile any pending operation.

## Privacy And Security

- ACL/audit projections use opaque principal IDs and bounded display labels; they exclude access codes, session tokens, memory, Provider data, and content.
- Shared resource discovery must not reveal that a resource exists to an unauthorized principal.
- Authorization decisions and resource revisions are server-side and audit-friendly.
- Invite links, if ever added, are a separate credential class with expiry, one-time/revocable state, and no content in the URL.

## Acceptance Scenarios For A Future Implementation

1. A viewer reads one shared conversation but cannot list the owner's other conversations, memory, workspace files, or tools.
2. An editor and owner race a title update with revocation; the editor write fails at commit with zero post-revoke mutation.
3. Ownership transfer preserves the same resource ID and transcript, invalidates trust, and leaves exactly one owner after retry.
4. Deleting a non-owner member removes only that principal's grants.
5. Deleting an owner is blocked until every owned resource has an explicit disposition.
6. Exports distinguish owned and shared data, remain bounded, and contain no other principal's secrets or root memory.
7. A stale label, renamed member, or replayed transfer request cannot select a different Agent resource.

## Open Product Decisions

- Must the target accept a transfer before ownership changes?
- Does the former owner become editor, viewer, or lose access after transfer?
- Can editors create resource-local files or invoke read-only tools?
- Are shared snapshots exportable by default, opt-in per resource, or never exportable?
- Is cascading delete ever acceptable for owner deletion, or must transfer/tombstone always be explicit?
- Do ACL entries support expiry in the first release?

## Risks

The consolidated entries `ACL-01` through `ACL-05` in `risk-register.md` are normative for future planning. No implementation task may close those risks by assertion; each requires the stated acceptance evidence.
