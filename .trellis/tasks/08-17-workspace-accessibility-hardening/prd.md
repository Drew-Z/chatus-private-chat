# Workspace accessibility hardening

## Goal

Make the primary member workspace reliably perceivable and operable by keyboard, screen-reader, touch, and reduced-motion users.

## Requirements

- Provide focus indicators with at least 3:1 contrast against adjacent light and dark surfaces.
- Give primary compact workspace controls a dependable touch/click target without relying on icon glyph size.
- Announce concise streaming status changes instead of marking the entire changing transcript as live.
- Preserve visible focus, semantic names, and reduced-motion behavior across responsive states.

## Acceptance Criteria

- [ ] Focus tokens meet the documented contrast target in both themes.
- [ ] Audited 29–36px controls have at least a 44px target or a documented WCAG target-size exception.
- [ ] Streaming does not cause the full transcript to be repeatedly announced.
- [ ] Send/stop/loading completion is conveyed through a concise status region.
- [ ] Keyboard and automated accessibility tests cover the affected controls and live-region contract.

## Notes

- Baseline evidence: `client/src/styles.css:30,71,114,165,770,1128` and `client/src/features/chat/ChatWorkspace.tsx:1067`.
