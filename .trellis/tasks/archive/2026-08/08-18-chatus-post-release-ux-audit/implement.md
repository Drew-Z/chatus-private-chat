# Chatus Post-release UX Optimization Implementation Plan

## Planning Gate

The final planning set, compact Figma direction, and separate implementation authorization were approved on 2026-08-19. The task still reports `planning`, and the current workflow requires this planning turn to remain there. UI implementation may begin only after a permitted workflow transition and successful `task.py start`.

## Ordered Work

### 0. Final Planning And Figma Review

- [x] Run the PRD convergence pass and verify every accepted decision is represented once.
- [x] Review the audit priorities, target design, affected boundaries, and rollback plan with the user.
- [x] Update the existing Figma file with the compact review set defined in `design.md`; do not claim unsupported native variables/components when using bridge scaffolding.
- [x] Capture desktop light/dark, mobile, member availability, and administrator monitor populated/no-observation frames.
- [x] Receive explicit user approval for the final Figma direction before activating the task.
- [x] Receive separate explicit user authorization to start implementation.
- [x] Run `task.py start` only when the Trellis workflow permits leaving `planning`.

#### Figma Review Evidence

- Target file: `泊语 HarborTalk | Chatus · Member UX System` (`unsaved-msymdaei-30c4zgzn`).
- Review container: `05 Post-release Audit Review` (`34:139`), `3000x5200`, with 12 major frames contained and no major-frame overlap.
- Final inventory: `Component / Variable / State Inventory` (`37:679`), child range `37:680-37:694`.
- Visual evidence: `figma-review/component-variable-state-inventory.png` and `figma-review/post-release-audit-review-overview.png`.
- Native Figma Variables, Styles, Components/Variants, library discovery, and Code Connect remain deferred until the file is saved and official edit access is available. This does not block review of the editable visual specification, but it remains a separate handoff gate.

### 1. Freeze Baseline And Contracts

- [x] Record the reviewed implementation base SHA and regenerate deterministic baseline screenshots.
- [x] Confirm `App`, `ChatWorkspace`, `WorkspaceHeader`, `MessageView`, `MessageComposer`, `ConversationInspector`, `MemberSettingsCenter`, and `AdminOperationsPanel` props and owners.
- [x] Confirm member availability and administrator monitoring decoders remain exact and unchanged.
- [x] Add no backend field, monitoring aggregate, Provider identity, preference schema, or deployment/rollout behavior.

### 2. P1 Member Workspace Rhythm

- [x] Refine semantic surface and type variables in `client/src/styles.css` using the approved Figma delta; preserve variable names unless a real additional semantic role is required.
- [x] Rebalance `WorkspaceHeader` desktop zones and implement the approved compact/two-zone mobile route presentation.
- [x] Adjust transcript turn spacing, user-message width/surface, assistant content rhythm, and supporting execution blocks without changing message semantics.
- [x] Quiet message actions at rest while preserving visible touch and keyboard access.
- [x] Integrate the composer visually with the transcript while preserving sticky behavior, safe areas, textarea growth, attachment workflow, and stable send/stop dimensions.
- [x] Extend focused fixture assertions for header containment, transcript/composer alignment, message spacing bounds, and touch action visibility.

### 3. P1/P2 Member Settings And Dark Layering

- [x] Add consistent Lucide icons and current-location semantics to settings navigation.
- [x] Rebalance desktop navigation/detail widths and spacing without card nesting.
- [x] Refine mobile list/detail header continuity and touch spacing.
- [x] Apply approved dark surface separation to navigation, detail, rows, dialogs, focus, and destructive actions.
- [x] Keep appearance persistence, memory/MCP dialogs, export, revoke, delete, pending, error, and confirmation contracts unchanged.
- [x] Add representative light/dark screenshot and geometry assertions for appearance, account/data, and one operational nested state.

### 4. Member Model Availability Clarity

- [x] Extend the presentation helpers in `ModelAvailabilityBadge.tsx` to map existing confidence/freshness states to explicit labels and descriptions.
- [x] Update `WorkspaceHeader` compact state and `ConversationInspector` detail rows without exposing Provider identity or aggregate diagnostics.
- [x] Distinguish no observation, limited sample, stale evidence, active refresh, degraded, unavailable, and recent healthy states with text/icon/shape plus color.
- [x] Preserve refresh generation fencing and keep prior advisory data on transient fetch failure.
- [x] Add Vitest and browser fixture coverage for every presentation state and long model/route labels.

### 5. Bounded Administrator Monitor Refinement

- [x] Reorder existing summary fields into primary counts and derived metrics without changing data semantics.
- [x] Add an explicit legitimate no-observation state for an all-zero window.
- [x] Replace the repeated hourly row layout with the approved compact 24-bucket plot while preserving accessible exact bucket descriptions.
- [x] Keep route/Provider/model grouping, failure classes, pagination, and freshness/window metadata administrator-only.
- [x] Refine the touch layout so primary evidence appears before low-value detail and all content remains locally contained.
- [x] Add populated, zero-observation, stale/refresh, long-label, and touch regression coverage.

### 6. Full Responsive And Accessibility Pass

- [x] Validate `1920x1080`, `1440x900`, `780x900`, `480x844`, and touch-enabled `390x844` for the approved screens.
- [x] Validate light and dark representative states, 200% zoom, keyboard traversal, focus restoration, reduced motion, live status, and touch targets.
- [x] Verify no page-level horizontal overflow and local containment for Markdown, code, tables, files, tools, long Chinese text, and model names.
- [x] Compare final screenshots to the approved Figma frames and document intentional differences.

### 7. Quality And Scope Gate

- [x] Run `npm run check:frontend`.
- [x] Run `npm test` with the repository's serial Cloudflare pool. The final clean run passed 55 files and 811 tests in 212.23 seconds.
- [x] Run `npm run test:browser:workspace`.
- [x] Run `npm run test:browser:agent` when shared workspace/message behavior is touched.
- [x] Run `npm run typecheck`.
- [x] Run `npx wrangler deploy --dry-run` only as packaging validation; never deploy production from local Wrangler.
- [x] Run `git diff --check` and `python ./.trellis/scripts/task.py validate-all`.
- [x] Audit changed paths for secrets, prompts, responses, conversations, memories, Provider payloads, member identities, `public/`, legacy tasks, rollout gates, and deployment workflow changes.
- [x] Use `trellis-check` before commit and resolve findings before release discussion.

## Implementation And Check Record

- Implementation base: `83c87c4b92227c29a99cf101837a31777e01c31f` on `codex/chatus-ux-settings-redesign-ui`.
- The final Workspace browser matrix passed `119` cases with `71` intentional project-scoped skips across 1920, 1440, 780, 480, and touch-enabled 390 projects. It includes retained light/dark screenshots, a 1920-at-200%-equivalent 960px layout check, reduced-motion emulation, focus recovery, 44px touch targets, and local-overflow assertions.
- The member availability state matrix passed at desktop and touch width for limited, stale, degraded, unavailable, no observation, and refreshing; recent healthy remains covered by the standard fixture.
- Screenshot review found and corrected one 960px compact-desktop overlap between the route control and context action; the context action now becomes an accessible icon-only command from 781px through 1024px, and the regression assertion verifies the regions do not overlap.
- Agent browser acceptance passed `3/3`. Frontend structure/build, TypeScript, Wrangler dry-run, diff checks, and Trellis validation passed.
- The serial Cloudflare pool showed two environment-only retry outcomes before the final green run: one Undici forbidden random-port startup error after 54 files / 786 tests had passed, and one existing cross-Durable-Object cleanup warning followed by a hang. Neither produced an assertion failure; each process was isolated and ended before the final clean `55/811` run.
- Final implementation intentionally uses CSS/React presentation and existing contract fields. No native Figma Variables/Components were created, no backend or monitoring aggregation changed, and no production or legacy rollout action ran.

## Likely Affected Files

- `client/src/styles.css`
- `client/src/components/WorkspaceHeader.tsx`
- `client/src/components/MessageView.tsx`
- `client/src/components/MessageComposer.tsx`
- `client/src/components/ConversationInspector.tsx`
- `client/src/components/ModelAvailabilityBadge.tsx`
- `client/src/components/MemberSettingsCenter.tsx`
- `client/src/components/AdminOperationsPanel.tsx`
- Focused client unit tests and `tests/browser/workspace-visual.spec.ts`

`ChatWorkspace.tsx` should change only if local presentation props or semantic turn grouping cannot be implemented cleanly in existing children. `App.tsx`, API decoders, Worker/Agent code, monitoring contracts, and storage are expected to remain unchanged.

## Risk And Rollback Points

| Risk | Detection | Rollback point |
| --- | --- | --- |
| Header refinement hides model state or breaks narrow containment | Long-label screenshots and 390/480 geometry assertions | Revert the header batch while retaining independent token changes |
| Turn grouping changes semantic order or action ownership | DOM order, screen-reader, and message-action tests | Revert grouping markup and retain spacing-only CSS |
| Composer refinement causes layout shift or safe-area regression | Composer dimension, growth-cap, send/stop, and mobile keyboard fixtures | Restore the prior composer shell and retain transcript changes |
| Dark token delta reduces contrast or leaks into unrelated surfaces | Theme screenshots, contrast review, changed-selector audit | Revert only the semantic value delta |
| Confidence copy overstates monitoring evidence | State matrix tests against exact decoded fields | Restore prior badge copy; do not change the API contract |
| Compact monitor hides exact buckets or breaks reconciliation meaning | Accessible bucket assertions and zero/populated fixtures | Restore the row trend while keeping summary/no-data improvements |
| Scope drifts into administrator or legacy redesign | Changed-path audit and PR review | Drop all unrelated paths before commit |

## Review Gates

1. Audit gate: the user accepts the keep/change decisions and priority order.
2. Design gate: the user approves the compact Figma review set and semantic state language.
3. Implementation gate: the user explicitly authorizes `task.py start` after all planning artifacts are final.
4. Quality gate: all required frontend, unit, browser, type, packaging, Trellis, privacy, and scope checks pass.
5. Release gate: any later production release uses GitHub Actions and a separate release task; this task never advances legacy rollout evidence.
