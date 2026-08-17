# Workspace intermediate responsive layout

## Goal

Keep chat readable and operable from small tablet through narrow desktop widths, including when persisted side panels are open.

## Requirements

- Define intentional layout behavior throughout 781–1439px rather than jumping directly from mobile to wide desktop.
- Guarantee a practical minimum chat column and prevent persisted inspector state from trapping the layout.
- Keep conversation navigation and inspector content reachable through drawers, overlays, or collapsible panels as space narrows.
- Preserve wide-desktop behavior at and above the existing large breakpoint.

## Acceptance Criteria

- [ ] At 781, 1024, 1280, and 1439px, the primary chat column remains readable and composer controls are not clipped.
- [ ] Reopening with a persisted inspector cannot leave an unusably narrow main column.
- [ ] Conversation and inspector panels remain discoverable and keyboard operable.
- [ ] No new horizontal page overflow occurs at the target widths.
- [ ] Browser tests cover target widths with panel state persisted on and off.

## Notes

- Baseline evidence: `client/src/styles.css:677,1009`.
