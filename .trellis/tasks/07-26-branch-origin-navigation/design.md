# Branch Origin Navigation - Design

## UI Boundary

The active conversation header owns branch-origin visibility because it already displays the current title, route state, connection state, and compact actions. The sidebar remains a flat conversation list in this task.

`ChatWorkspace` derives `parentConversation` from the current `conversations` array:

- `activeConversation.parentChatId` absent: no origin row.
- Parent ID present and found: pass `{ id, title }` plus a navigation callback to `WorkspaceHeader`.
- Parent ID present but missing: pass a missing-parent marker; no server fetch is added in this task.

The header renders a compact `origin-chip` below the title. The parent-present variant is a button with a "return to parent" label. The missing-parent variant is static text.

## Branch Naming

The Worker remains the authority for branch titles so repeated browser requests and idempotent branch reservation produce the same conversation metadata.

`branchConversationTitle(title, action)`:

- trims the source title;
- removes known generated suffixes from previous branches;
- applies an action-specific suffix;
- enforces a bounded title length before adding the suffix;
- falls back to `新对话` when the source is blank.

Action suffixes:

| Action | Suffix |
| --- | --- |
| `branch` | `分支` |
| `edit` | `编辑分支` |
| `resend` | `重发分支` |
| `regenerate` | `重生成分支` |
| `continue` | `续写分支` |

## Compatibility

- Existing `parentChatId` response shape stays unchanged.
- Branch idempotency remains keyed by request ID and fingerprint. Retried requests return the reserved title rather than recalculating from a later rename.
- Deleted or inaccessible parent conversations are not fetched or resurrected.

## Rollback

Reverting this task restores generic branch titles and removes the header origin hint. Conversation data remains compatible because `parentChatId` already exists and no storage schema changes are introduced.
