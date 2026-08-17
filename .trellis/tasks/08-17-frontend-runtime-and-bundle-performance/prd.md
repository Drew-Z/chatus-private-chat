# Frontend runtime and bundle performance

## Goal

Reduce avoidable initial JavaScript and per-token rendering work without weakening offline behavior or chat correctness.

## Requirements

- Lazy-load member/admin workspace branches that are not needed for the current authenticated role.
- Give lazy chunks an offline-safe same-origin service-worker caching contract.
- Avoid remapping the entire transcript solely to mark the current streaming message.
- Coalesce follow-scroll work and avoid smooth-scroll scheduling on every token.
- Preserve user scroll position when they have intentionally moved away from the bottom.

## Acceptance Criteria

- [x] Initial role-specific entry does not eagerly evaluate both full workspace branches.
- [x] Lazy chunks load online and can be served from runtime cache after a successful first load.
- [x] Streaming updates do not rebuild unchanged message objects solely for status decoration.
- [x] Follow-scroll runs at most once per animation frame and does not pull a user who has scrolled away.
- [x] Reduced-motion behavior remains respected.
- [x] Unit/browser tests cover lazy fallback, cache matching, and streaming scroll behavior.

## Notes

- Baseline evidence: `client/src/App.tsx:2`, `AdminWorkspace.tsx:60`, `ChatWorkspace.tsx:894,1075`, and `public/sw.js:92-98`.
