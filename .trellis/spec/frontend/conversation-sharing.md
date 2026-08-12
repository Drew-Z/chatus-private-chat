# Conversation Sharing Experience

## 1. Scope / Trigger

Use this contract when changing conversation list decoding, shared-resource Agent
connections, the owner share dialog, role indicators, action visibility, access
recovery, or asynchronous conversation-list refresh behavior.

The frontend is a projection of server ACL state. Hiding controls improves the
experience but never replaces Worker and Agent authorization.

## 2. Signatures

```typescript
type AgentConversation = {
  resourceId?: string;
  accessRole?: "owner" | "editor" | "viewer";
  accessRevision?: number;
  // existing summary fields
};

resolveConversationAccessPermissions(role): {
  canSend: boolean;
  canRename: boolean;
  canManageSettings: boolean;
  canBranch: boolean;
  canDelete: boolean;
  canManageShares: boolean;
  canUseWorkspace: boolean;
  canUseConversationTools: boolean;
  canSubmitFeedback: boolean;
}
```

```typescript
listConversationShares(conversation): Promise<ConversationGrantList>
upsertConversationShare({ conversation, operationId, granteeLabel, role,
  expectedAccessRevision }): Promise<ConversationGrantMutationResult>
revokeConversationShare({ conversation, operationId, granteePrincipalId,
  expectedAccessRevision }): Promise<ConversationGrantMutationResult>
```

```typescript
useAgent({
  name: conversationAgentClientName(conversation.resourceId || session.agent.instance,
    conversation.id),
  query: { chatId: conversation.id, resourceId: conversation.resourceId },
  queryDeps: [conversation.id, conversation.resourceId],
})
```

## 3. Contracts

### Strict Projection And Connection Identity

- A conversation either omits all three access fields for legacy compatibility or
  supplies valid `resourceId`, `accessRole`, and positive `accessRevision`
  together. Shared projections must have `workspaceFiles: []` and no
  `parentChatId`; the decoder rejects partial or private shared fields.
- The Agent client cache key uses the stable resource ID plus conversation ID.
  The transport query and message body send the same `resourceId`. This prevents
  a shared resource from reconnecting to the actor's Root-derived conversation.
- The mounted chat is keyed by resource/revision so a role change or revoke does
  not retain a stale AIChat connection, message action, or tool approval state.

### One Permission Projection

- `resolveConversationAccessPermissions` is the shared owner/editor/viewer UI
  matrix. Sidebar, header, composer, message actions, settings, file view,
  feedback, and tool approval surfaces consume it instead of inventing local
  role checks.
- Owner keeps existing controls and receives share management. Editor receives
  composer/stop and rename only. Viewer receives transcript navigation only.
- Shared editor/viewer never see file/settings entry points, attachments,
  route/Skill controls, branch/edit/resend/regenerate, delete, share management,
  feedback, or tool approval controls.

### Share Dialog State And Replay

- `ConversationShareDialog` is owner-only and uses a native React dialog plus the
  existing `ConfirmDialog`; `window.confirm` is forbidden.
- Initial state is `loading`, then `ready` or an in-dialog retryable `error`.
  StrictMode must not duplicate the first list request for the same
  `(resourceId, conversationId)`.
- Grant uses an exact trimmed member label and `viewer|editor`. Role changes use
  the grant's current bounded alias; revoke uses immutable grantee principal ID.
- Each mutation captures one `operationId` and `expectedAccessRevision`.
  Ambiguous network/server loss retries the same attempt unchanged so the server
  can replay a committed result. User changes to label/role discard the old
  grant attempt.
- `conversation_not_found` or `conversation_access_revision_conflict` first
  reloads the share list. A later retry uses the refreshed revision and a new
  operation ID. Revoke confirmation keeps the same attempt across ordinary
  failure and creates a new one only after a successful conflict refresh.
- While a mutation is pending, close/backdrop/cancel and conflicting controls are
  disabled. Initial focus moves after loading, Tab/Shift+Tab stay inside the
  dialog, Escape closes only when not pending, and focus returns to the opener.

### Refresh And Access Recovery

- Conversation-list refreshes own a monotonically increasing generation. Only
  the latest response may replace list state; local create/update/delete and
  access mutations advance the generation so an older request cannot overwrite
  them or switch the active resource.
- `conversation_not_found` and `conversation_access_revision_conflict` trigger
  one list refresh and predictable fallback selection. Settings persistence does
  not immediately issue a second refresh after access recovery.
- A revoked resource disappears from the refreshed list. If it was selected,
  choose the preferred surviving ID, current surviving ID, first conversation,
  or empty state in that order. Do not reconnect-loop the stale resource.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Missing `resourceId` for share helper | Throw `conversation_resource_required`; send no request |
| Partial/unknown access projection or private shared fields | Reject `invalid_conversation_response` |
| Initial share list request fails | Keep dialog open with alert and explicit retry |
| Grant/role/revoke response shape or operation ID differs | Reject `invalid_conversation_share_response` |
| Mutation response is lost after server commit | Explicit retry reuses operation ID and expected revision |
| Access revision conflict or resource disappears | Refresh once; discard stale attempt; do not loop |
| Mutation is pending | Disable close and conflicting controls; expose pending text and `aria-busy` |
| Viewer/editor reaches an unsupported UI path | Hide/disable the entry point and retain server denial as authority |
| Older conversation refresh resolves after local mutation/newer refresh | Ignore it through the generation fence |
| Dialog closes | Restore focus to the connected opener when possible |

## 5. Good / Base / Bad Cases

- Good: the server commits a grant but the response fails; the dialog's retry
  sends the same operation and renders the replayed grant once.
- Good: a selected editor is revoked in another tab; one refresh removes the
  resource and selects a surviving owned conversation without reconnect loops.
- Base: a 390 px viewport keeps the dialog, grant row, role selector, and revoke
  action contained without text or controls overlapping.
- Bad: generate a new operation ID on every retry, keep file/tool buttons merely
  disabled in a hidden drawer, or let an older list request overwrite a branch.

## 6. Tests Required

- Client decoder tests cover complete/partial access projections, shared private
  field rejection, exact share responses, operation ID matching, and resource-
  required helper failures.
- State tests cover the full permission matrix and message-action availability.
- Workspace Playwright covers owner grant/role/revoke, committed-response-loss
  replay, list failure recovery, confirmation pending/error/retry, focus trap,
  Escape/focus restoration, viewer/editor controls, reload, and 390 px containment.
- Race tests delay list responses across create/update/delete/access refresh and
  assert only the newest generation changes list or selection.
- Use stateful local share fixtures and fake Provider/MCP only.

## 7. Wrong vs Correct

### Wrong

```typescript
async function retryGrant() {
  return upsertConversationShare({
    ...input,
    operationId: crypto.randomUUID(),
    expectedAccessRevision: currentConversation.accessRevision,
  });
}
```

### Correct

```typescript
const attempt = retryAttempt ?? {
  operationId: `conversation-share-${crypto.randomUUID()}`,
  expectedAccessRevision: shareList.accessRevision,
  granteeLabel,
  role,
};
await upsertConversationShare({ conversation, ...attempt });
```

Keep the attempt stable until the desired mutation changes or an authoritative
revision conflict is successfully refreshed.
