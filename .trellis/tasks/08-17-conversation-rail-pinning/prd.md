# Conversation rail pinning

## Goal

Let members pin important conversations using the existing conversation projection/update capability.

## Requirements

- Expose an accessible pin/unpin action in the conversation rail.
- Keep pinned conversations grouped ahead of unpinned conversations while preserving the existing recency order within each group.
- Persist through the existing API contract and recover visibly from failed updates.
- Prevent concurrent clicks from creating contradictory optimistic state.

## Acceptance Criteria

- [x] Members can pin and unpin from keyboard, pointer, and touch with a clear accessible name/state.
- [x] Pinned conversations render before unpinned conversations with stable recency ordering.
- [x] Successful changes survive reload through the existing projection.
- [x] Failed changes roll back or refresh to server truth and expose a retryable error.
- [x] In-flight controls prevent duplicate contradictory updates.
- [x] Tests cover ordering, success, failure, and accessibility semantics.

## Notes

- Baseline evidence: conversation projection `pinned` support near `client/src/lib/api.ts:861`.
