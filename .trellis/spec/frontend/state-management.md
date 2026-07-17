# State Management

## Overview

State is managed with React local state, refs, browser storage, legacy module-scoped values, and server APIs. There is no global-state library.

## State Categories

- **Ephemeral UI state:** open dialogs, selected menu item, in-flight requests, pending deletion timers.
- **Active page state:** session arrays, active session ID, route selection, memory revision, admin editor revisions.
- **Device persistence:** user-scoped drafts and session snapshots in `localStorage`.
- **Server state:** chats, memory, configuration, access codes, audit data, and usage returned by Worker APIs.
- **Durable Agent state:** the per-member root Agent owns the conversation index, memory, migration markers, tombstones, and cleanup queue; per-conversation Agents own transcripts and resumable streams.
- **Transitional legacy state:** `UserState` chat records and KV memory records remain rollback/import sources, not the authoritative Agent memory store.

## State Rules

- Scope locally persisted values by user label where data belongs to a signed-in user.
- Clear user drafts on logout and account deletion paths.
- Keep derived UI state derived; do not persist values that can be recalculated from sessions/configuration.
- Store timers, queues, and in-flight operations per entity using `Map`/`Set`, not one global slot.
- Keep the newest server version during conflicts and preserve a recognizable local conflict copy when necessary.
- A memory `409` refreshes the authoritative revision and metadata while retaining the rejected local draft for comparison and retry.
- A rejected `sendMessage()` restores the submitted draft only when the user has not already entered newer text.

## Server State

- Fetch authoritative state at login/startup and after conflict responses.
- Debounce cloud saves per chat ID.
- Send revision/version preconditions on mutations.
- Route delayed async results back to their source session rather than the currently active session.
- Load conversations before rendering per-conversation capability state. Calling `getActiveSession()` before local/cloud session hydration can create and persist a synthetic blank chat.
- Normalize selected Skill IDs into the server-projected administrator order and cap them at three; branches copy the ordered selection while new chats start empty.
- Backup restore and device merge are distinct operations; do not silently evict existing chats on import.
- `/api/memory`, `/api/agent/memory`, admin memory, legacy prompts, and Agent prompts all read/write the root Agent memory record. KV is read only for idempotent import and deleted during full user-data removal.
- Legacy conversation sync is append-only/prefix-safe. It may import new chats and append compatible snapshots, but it must never overwrite a divergent Agent transcript.
- Deleted Agent conversation IDs retain tombstones. Stale Agent reconnects and legacy uploads must not recreate them; transcript cleanup failures remain in a persisted retry queue.

## Common Mistakes

- Using a single debounce timer for multiple chats.
- Persisting unsaved memory/config edits without a revision, then overwriting a newer editor.
- Reusing local data across users because a storage key lacks the user prefix.
- Mutating history destructively instead of creating branches for edit, regenerate, or resend flows.
