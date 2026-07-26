# Design

## Boundary

The change belongs at the existing conversation-create validation boundary. The server already loads current configuration, resolves effective member access, and builds the enabled assigned Skill projection there. It remains the only authority for initial selection; the browser only signals whether the caller supplied an explicit selection.

No storage schema or migration is required because every conversation already persists an exact `skillIds` array.

## Request Semantics

| Operation | `skillIds` input | Result |
| --- | --- | --- |
| Create member conversation | omitted | Persist up to the first three current enabled, assigned Skills in registry order |
| Create member conversation | `[]` | Persist an explicit empty selection |
| Create member conversation | non-empty array | Normalize, enforce the existing limit, and reject unassigned IDs |
| Create guest conversation | omitted | Persist an empty selection because the guest assignment exposes no Skills |
| PATCH conversation | omitted | Do not change the stored selection |
| PATCH conversation | `[]` | Clear the stored selection |
| Branch conversation | n/a | Inherit the source selection after current access repair |

The default branch uses `getPublicCapabilities(config, access.user).skills`, which already applies enabled state, assignment semantics, executor-safe public projection, and stable administrator order. It slices that projection to `MAX_SELECTED_SKILLS` and stores only IDs.

## Client Flow

`ChatWorkspace.createConversation()` sends the chosen route but omits `skillIds` for the ordinary new-conversation action. After the response, the existing active-conversation effect restores the server-persisted selection. That effect continues to sanitize only; it must never replace an empty array with defaults.

The existing settings checkboxes remain the explicit per-conversation manual control. Clearing all Skills continues to PATCH `skillIds: []`.

## Security And Compatibility

- Default selection never reads raw assignment arrays directly; it consumes the current server projection so disabled or unassigned Skills cannot enter the conversation.
- Turn preparation keeps its existing current-access filter, preventing stale conversations from recovering revoked instructions or tools.
- Existing conversations and legacy imports are untouched. Historical empty selections remain empty.
- The change does not add a model call, active health check, secret flow, browser persistence key, or new externally visible provider metadata.
- A future relevance-based automatic mode must introduce an explicit mode field. It cannot use `skillIds: []` as an implicit automatic signal.

## Verification

Worker integration tests cover omitted, explicit empty, deny-all, legacy all-assigned, disabled, over-limit, guest, and unauthorized selections. Frontend structure coverage proves the default create request omits the field while the hydration path still preserves persisted arrays. Existing branch and turn-revocation tests remain regression evidence.
