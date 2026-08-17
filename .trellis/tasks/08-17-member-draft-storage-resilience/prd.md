# Member draft storage resilience

## Goal

Keep draft and active-conversation persistence helpful without allowing browser storage failures or per-keystroke writes to degrade chat.

## Requirements

- Encapsulate storage reads, writes, and removals behind a best-effort browser-storage helper.
- Debounce draft persistence while ensuring the latest draft is flushed on relevant lifecycle boundaries.
- Treat unavailable, full, blocked, or malformed storage as non-fatal.
- Preserve per-conversation draft restoration and active-conversation behavior.

## Acceptance Criteria

- [x] Typing does not synchronously write to `localStorage` on every keystroke.
- [x] The latest draft is restored after a normal reload or conversation switch.
- [x] Storage `getItem`, `setItem`, and `removeItem` exceptions do not crash or block the workspace.
- [x] Malformed persisted values are ignored safely.
- [x] Focused tests cover debounce/flush and storage failure paths.

## Notes

- Baseline evidence: `client/src/features/chat/ChatWorkspace.tsx:711,846`.
- Validation: frontend structure/build, client TypeScript, and 80 focused API/device-storage tests pass.
- Spec update: `.trellis/spec/frontend/state-management.md` now records the best-effort debounced storage contract.
