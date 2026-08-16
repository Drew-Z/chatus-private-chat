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
- Clear user drafts only after authoritative logout/session revocation or account deletion succeeds. Network, HTTP, and response-decoder failures preserve the authenticated workspace and its current-member drafts for retry.
- Keep derived UI state derived; do not persist values that can be recalculated from sessions/configuration.
- Store timers, queues, and in-flight operations per entity using `Map`/`Set`, not one global slot.
- Keep the newest server version during conflicts and preserve a recognizable local conflict copy when necessary.
- A memory `409` refreshes the authoritative revision and metadata while retaining the rejected local draft for comparison and retry.
- A typed-admin `409` replaces the authoritative configuration snapshot and rebases the local assignment draft. Inherited values follow the new defaults, route mode `all` absorbs newly added routes, explicit route lists remain closed, and unrelated fields come only from the new snapshot.
- Keep `routesDirty` false until a route control changes so a Skill/tool-only save cannot reserialize `defaultRoute` or `allowedRoutes`. Preserve route `all` versus explicit-selection intent separately from the visible checkbox list.
- Keep separate `enabledDirty`, `dailyMessageLimitDirty`, and `minuteMessageLimitDirty` flags. Untouched policy fields come from the latest server snapshot after conflict, while dirty fields retain local explicit/inherit intent; inherited dirty fields follow the latest defaults without becoming stored overrides.
- Keep access revisions beside member metadata, separate from the configuration revision. Access mutations update only the member projection and access revision, so they do not discard or reserialize an unrelated capability draft.
- A newly generated access code may exist only in transient dialog state. Closing the dialog, logout, and unmount clear it; page navigation warns while the one-time credential is visible.
- When access-only revocation removes the selected member, return to defaults if there is no dirty draft. A dirty assignment draft may retain a temporary local member placeholder until the administrator saves or discards it.
- Member configuration removal replaces the authoritative config snapshot and resets the selected member draft to inherited/default values. If a different member has a dirty draft, rebase it onto the returned snapshot instead of clearing it.
- Session revocation changes no configuration or member projection; close only its confirmation dialog and report the server's `complete` flag as success or warning.
- Current-day usage reset changes no configuration or assignment draft. Close only its confirmation dialog after the exact response validates, then invalidate the Operations projection independently so a later view reloads the current counters.
- User account actions share an `accountBusy` lock with the workspace header, sidebar controls, memory entry, and composer. Session revocation clears user-scoped drafts and returns to login without deleting server data; user-data deletion clears chats, Agent memory, usage, feedback, and sessions while retaining access/configuration.
- User-data export is an authenticated, secret-free JSON v1 attachment. It contains the member label, root-Agent memory, conversation metadata, text parts, and file names/types only; credentials, provider/admin configuration, message metadata, raw tool payloads, and file URLs never enter the export. The Worker reads conversations sequentially, caps the attachment at 5 MB and each conversation at 512 KB, and marks omitted content with top-level `truncated` and per-conversation `messagesTruncated` flags. The client validates this exact envelope before creating a download and reports truncation instead of presenting it as a complete archive.
- The mobile sidebar drawer is removed from hit testing and accessibility flow while closed. Opening it moves focus to the close control after the opening click/visibility transition settles, but only while focus remains on the opener; it traps Tab, closes on Escape, and restores focus only on an actual close or unmount. Account dialogs retain their own native modal focus lifecycle.
- A rejected `sendMessage()` restores the submitted draft only when the user has not already entered newer text.
- Typed provider and logical-model editors own ephemeral local drafts. Their parent owns only the dirty flag and revisioned snapshot; leaving those views discards the unmounted pool draft after an explicit confirmation and resets the shared dirty flag. Member capability drafts remain parent-owned and may survive a view switch.
- A provider-pool configuration conflict replaces the authoritative snapshot but does not silently replace the local entity draft. The editor remains dirty until a successful save or an explicit server-version reset.
- Provider secret input is ephemeral and keyed by the currently selected saved provider/ref. It is cleared on ref or view changes and never participates in the configuration draft.
- Skill, tool-policy, and MCP-server editors follow the same entity-draft rule. A configuration conflict refreshes the authoritative snapshot while retaining the local draft and any pending discovery result for an explicit retry; snapshot effects must not reset a dirty entity draft.
- An MCP secret value is local-only state keyed by the selected saved server and saved `secretRef`. It never joins the revisioned config draft and is cleared on every entity/ref/view/snapshot transition, mutation outcome, conflict, refresh, and unmount.
- MCP discovery remains read-only until its result is merged into the latest revisioned configuration. A conflict preserves the response in `pendingDiscovery`; retry merges it over the refreshed snapshot instead of replaying an old full config.
- Failed-turn retry uses the latest parent conversation snapshot and the latest user message ID, so a stream error can be retried as a durable resend branch without replaying stale conversation metadata.
- Transcript auto-scroll is conditional on a near-bottom check; a reader who scrolls upward is not pulled back to the newest chunk.
- Member theme preference is a device-local value keyed by the signed-in member label. The only accepted values are `follow-system`, `light`, and `dark`; malformed, unavailable, or missing storage falls back to `follow-system`. Applying a theme must not add a server preference field or cross-device synchronization.
- Conversation-scoped route/model, Skills, tools, files, and sharing state belongs to the active conversation inspector; member-global appearance, memory, MCP, account/data, and session/device actions belong to the member settings center. Moving a control between these surfaces must reuse the existing API/dialog owner and preserve its revision, permission, pending, retry, and confirmation behavior.

## Server State

- Fetch authoritative state at login/startup and after conflict responses.
- Debounce cloud saves per chat ID.
- Send revision/version preconditions on mutations.
- Route delayed async results back to their source session rather than the currently active session.
- Load conversations before rendering per-conversation capability state. Calling `getActiveSession()` before local/cloud session hydration can create and persist a synthetic blank chat.
- Normalize restored `skillMode` and Skill IDs from the returned conversation. New member creates omit both mode and IDs so the Worker owns the `automatic` default; guests always hydrate as `manual` with no Skills.
- In manual mode, persisted IDs are the exact selection. In automatic mode, they are only the last-success fallback snapshot; disable manual checkboxes and never present that snapshot as the current turn's model decision.
- Serialize route, mode, Skill IDs, and conversation ID in the Agent body for compatibility, but the conversation Agent must reload authoritative settings from the root Agent. Queue revisioned mode/ID PATCHes per conversation so rapid toggles cannot race `updatedAt`.
- Store actual automatic selection evidence in assistant message metadata, not in global React state. Hydration, history, and branches then render the selection that actually applied to each response.
- Branches copy mode and the repaired ordered snapshot/selection without reapplying create defaults. Legacy imports stay manual; PATCH omission preserves the member mode; an explicit manual empty array remains empty across refresh and switching.
- Backup restore and device merge are distinct operations; do not silently evict existing chats on import.
- `/api/memory`, `/api/agent/memory`, admin memory, legacy prompts, and Agent prompts all read/write the root Agent memory record. KV is read only for idempotent import and deleted during full user-data removal.
- Agent-proposed memory changes use the built-in AIChat tool-approval record as the durable proposal boundary. The tool is available only to members on a tool-capable logical route, carries the complete replacement memory plus the exact root-memory revision, and always requires approval. Rejection performs no write; approval calls the root Agent with the proposed revision, so an intervening edit returns a conflict instead of being overwritten. Manual user/admin memory editing remains revision-checked and independent of the proposal flow.
- Legacy conversation sync is append-only/prefix-safe. It may import new chats and append compatible snapshots, but it must never overwrite a divergent Agent transcript.
- Deleted Agent conversation IDs retain tombstones. Stale Agent reconnects and legacy uploads must not recreate them; transcript cleanup failures remain in a persisted retry queue.

## Common Mistakes

- Using a single debounce timer for multiple chats.
- Persisting unsaved memory/config edits without a revision, then overwriting a newer editor.
- Reusing local data across users because a storage key lacks the user prefix.
- Mutating history destructively instead of creating branches for edit, regenerate, or resend flows.
