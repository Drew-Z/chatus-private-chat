# State Management

## Overview

State is managed with module-scoped JavaScript values, browser storage, and server APIs. There is no global-state library.

## State Categories

- **Ephemeral UI state:** open dialogs, selected menu item, in-flight requests, pending deletion timers.
- **Active page state:** session arrays, active session ID, route selection, memory revision, admin editor revisions.
- **Device persistence:** user-scoped drafts and session snapshots in `localStorage`.
- **Server state:** chats, memory, configuration, access codes, audit data, and usage returned by Worker APIs.
- **Durable concurrency state:** per-user chat/quota state in the `UserState` Durable Object.

## State Rules

- Scope locally persisted values by user label where data belongs to a signed-in user.
- Clear user drafts on logout and account deletion paths.
- Keep derived UI state derived; do not persist values that can be recalculated from sessions/configuration.
- Store timers, queues, and in-flight operations per entity using `Map`/`Set`, not one global slot.
- Keep the newest server version during conflicts and preserve a recognizable local conflict copy when necessary.

## Server State

- Fetch authoritative state at login/startup and after conflict responses.
- Debounce cloud saves per chat ID.
- Send revision/version preconditions on mutations.
- Route delayed async results back to their source session rather than the currently active session.
- Load conversations before rendering per-conversation capability state. Calling `getActiveSession()` before local/cloud session hydration can create and persist a synthetic blank chat.
- Normalize selected Skill IDs into the server-projected administrator order and cap them at three; branches copy the ordered selection while new chats start empty.
- Backup restore and device merge are distinct operations; do not silently evict existing chats on import.

## Common Mistakes

- Using a single debounce timer for multiple chats.
- Persisting unsaved memory/config edits without a revision, then overwriting a newer editor.
- Reusing local data across users because a storage key lacks the user prefix.
- Mutating history destructively instead of creating branches for edit, regenerate, or resend flows.
