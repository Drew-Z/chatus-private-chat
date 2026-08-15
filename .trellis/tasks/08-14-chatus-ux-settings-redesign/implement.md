# Chatus UX And Settings Implementation Plan

## Planning Gate

This checklist is intentionally not started while the task is in `planning`. The user must approve the final PRD, `design.md`, Figma direction, and this plan before `task.py start`. No step below authorizes production deployment or changes to legacy rollout gates.

## Ordered Work

### 0. Approval And Baseline

- [x] Review the final PRD and `design.md` with the user.
- [x] Approve the Figma-ready file structure, variables, component inventory, and two review prototype flows described in `design.md`.
- [x] Record the approved Figma direction in the task artifacts without storing private access material or claiming a file link that does not exist.
- [x] Run the existing frontend/test/typecheck/dry-run baseline and record any pre-existing failure separately from UX changes.

### 1. Freeze Contracts And Inventory

- [x] Inventory the current `ChatWorkspace`, `ConversationSidebar`, `WorkspaceHeader`, `MessageView`, `MessageComposer`, `MemoryPanel`, `McpConnectionsDialog`, `ConfirmDialog`, and `ConversationShareDialog` props and state ownership.
- [x] Confirm the member session, conversation, capability, memory, MCP, file, sharing, export, revoke, and delete response decoders in `client/src/lib/api.ts` remain the only browser contract boundary.
- [x] Add no new backend fields, provider contracts, rollout controls, or legacy surface behavior.

### 2. Implement The Semantic Theme Layer

- [x] Replace temporary green/light-only style assumptions with semantic light/dark variables in `client/src/styles.css` based on the approved Figma variables.
- [x] Add a small typed device-preference helper for `follow-system | light | dark`, scoped by signed-in member label and resilient to malformed/unavailable `localStorage`.
- [x] Apply the resolved theme through a root attribute/class and subscribe to system theme changes only while the preference is `follow-system`.
- [x] Tokenize remaining hard-coded typed-client colors, focus rings, status colors, surfaces, and shadows; do not alter legacy `public/styles.css`.
- [x] Add unit tests for preference decoding, fallback, user scoping, system changes, and reduced-motion CSS coverage.

### 3. Split The Member Shell Information Architecture

- [x] Keep the existing conversation rail/history, search, new, rename, share, archive/delete, and mobile drawer focus behavior in the shell.
- [x] Introduce a focused `ConversationInspector` presentational boundary for route/model, Skills, tools, files, and sharing, keyed by active conversation ID.
- [x] Introduce a focused `MemberSettingsCenter` boundary for appearance, memory, MCP, account/data, and sessions/devices, with a master-detail desktop layout and mobile list/detail flow.
- [x] Replace the current all-in-one sidebar settings view without deleting or duplicating its validated API/data flows.
- [x] Keep administrator views and `/legacy/` untouched.

### 4. Add Layered Access And Save Feedback

- [x] Add compact header model/route quick access that delegates to the existing route selection and conversation save queue.
- [x] Add explicit inspector entry/close controls and preserve the closed-by-default per-device UI preference.
- [x] Render low-risk auto-save status (`保存中`, `已保存`, retryable error) with reserved space and owning conversation/preference IDs.
- [x] Keep MCP, export, session, revoke, and delete operations explicit, revision-aware, redacted, and focus-safe.
- [x] Ensure failed member logout/account operations retain current-member drafts until exact server success.

### 5. Apply Workspace Visual Hierarchy

- [x] Restyle rail, header, transcript, message actions, code/table containment, and composer using the approved tokens and comfortable-compact density.
- [x] Keep the transcript centered at the approved maximum readable width; keep the composer stable and reserve status space.
- [x] Keep touch-visible actions at least 44px and desktop icon controls at the approved compact size.
- [x] Use only low-motion transitions and preserve the existing reduced-motion behavior.
- [x] Ensure model/route labels, long titles, file names, errors, and status text wrap or locally scroll without page overflow.
- [x] Revise the visual system after review feedback: use pearl-white neutral surfaces, near-black ink, subtle separators, restrained elevation, and sparse cobalt emphasis; remove dominant teal and dark filled message treatments from the member workspace.
- [x] Recheck the composer-first empty state, quiet rail selection, header hierarchy, inspector/settings surfaces, and neutral near-black dark theme against the approved pattern references.

### 6. Responsive And Accessibility Pass

- [x] Validate wide desktop, tablet, 480px mobile, and touch-enabled 390px layouts for shell, inspector, settings, dialogs, composer, and transcript.
- [x] Verify rail/inspector/settings focus entry, Tab containment, Escape, backdrop/close behavior, and opener/fallback focus restoration.
- [x] Verify keyboard model selection, semantic button names, `aria-pressed`/live status, visible focus, reduced-motion, and no hover-only actions.
- [x] Verify light/dark contrast for text, controls, status colors, code blocks, tables, attachments, and dialogs.

### 7. Reproducible Browser Fixture And Regression Tests

- [x] Extend or add the checked-in Playwright workspace fixture with deterministic synthetic member sessions, conversations, Markdown, code, tables, files, sources, tools, long labels, settings drafts, save/error states, and theme modes.
- [x] Abort unexpected network requests; do not authenticate, mount Agent hooks, open a WebSocket, call a Worker API, or send a model request.
- [x] Assert geometry, containment, no page-level horizontal overflow, focus lifecycle, touch target dimensions, theme application, and pending-state stability at `1920x1080`, `1440x900`, `780x900`, `480x844`, and `390x844`.
- [x] Add focused Vitest tests for pure theme preference and settings ownership/save-state helpers.

### 8. Quality Gate Before Any Release Discussion

- [x] Run `npm run check:frontend` before the test suite.
- [x] Run `npm test` with the repository's serial Cloudflare pool.
- [x] Run `npm run test:browser:workspace` and retain passing screenshots through the fixture output path.
- [x] Run `npm run typecheck`.
- [x] Run `npx wrangler deploy --dry-run` only as a packaging validation; do not perform a production deploy from a local Wrangler account.
- [x] Run `git diff --check` and inspect that no `public/` legacy, rollout, secrets, conversation content, or memory files changed.
- [x] Use `trellis-check` after implementation and before task activation/finish; resolve findings or return to planning.

## Affected Files And Ownership

Likely implementation files are limited to the typed client and its focused tests:

- Existing: `client/src/App.tsx`, `client/src/components/ChatWorkspace.tsx`, `ConversationSidebar.tsx`, `WorkspaceHeader.tsx`, `MessageView.tsx`, `MessageComposer.tsx`, `MemoryPanel.tsx`, `McpConnectionsDialog.tsx`, `ConfirmDialog.tsx`, `ConversationShareDialog.tsx`, `client/src/styles.css`.
- Potential new boundaries: `client/src/components/ConversationInspector.tsx`, `client/src/components/MemberSettingsCenter.tsx`, and a small typed preference helper under `client/src/lib/` if existing state helpers cannot own theme resolution without duplication.
- Tests/fixtures: `tests/browser/` workspace fixture and focused client helper tests. Do not add production UI to `public/` or modify Worker/Agent contracts for visual-only behavior.

## Risk And Rollback Points

| Risk | Detection | Rollback point |
| --- | --- | --- |
| Splitting sidebar settings drops a capability or permission gate | Capability/state inventory and focused component tests | Restore previous `ConversationSidebar` view composition; retain token changes only if independently verified |
| Async save result updates a different conversation | Tests switch active conversation before resolving a deferred save | Revert to existing per-conversation queue and remove the new adapter |
| Theme tokens reduce contrast or leak into legacy/admin surfaces | Contrast assertions, screenshot review, `git diff` path audit | Revert `client/src/styles.css` theme block and root theme attribute only |
| Mobile drawer loses focus or page overflow appears | Playwright geometry/focus matrix | Restore prior drawer CSS/DOM boundary before adjusting visual styling |
| Global settings introduces a backend dependency | Contract review and network-blocked fixture | Keep the preference device-local and leave server-backed controls on existing API/dialog paths |
| Figma variants drift from implementation tokens | Token/component crosswalk review | Freeze implementation at the last approved variable set and return to Figma review |

## Review Gates

1. Product gate: user approves PRD, information architecture, Figma variables, core screens, and prototype flows.
2. Technical gate: `design.md` maps every approved surface to existing component and API ownership; no new backend/rollout contract is required.
3. Accessibility gate: focus, keyboard, reduced-motion, contrast, touch target, and overflow assertions pass for all required viewports.
4. Privacy gate: fixtures and diagnostics contain no access codes, API keys, conversation content, memories, raw tool payloads, or provider secrets.
5. Release gate: required checks pass; production remains GitHub Actions-owned and no legacy rollout gate is changed.

## Explicit Non-Goals

- Do not start `task.py start` before the user approves the final planning artifacts.
- Do not implement a new backend preference schema or cross-device theme sync.
- Do not redesign the typed admin workspace, legacy browser shell, or any rollout/production gate.
- Do not use screenshots or references as permission to copy OpenAI, DeepSeek, or BIAU PORT assets beyond the approved parent mark relationship and pattern-level inspiration.

## Completion Record

- The user approved the final PRD, design direction, and implementation plan before the typed-client implementation continued.
- Implemented the approved member shell split: history rail, on-demand conversation inspector, and member settings center, while retaining existing API, permission, revision, MCP, memory, sharing, export, revoke, delete, and logout owners.
- Implemented device-local `follow-system | light | dark` theme preference with semantic light/dark variables and representative dark states. No server preference or cross-device synchronization was added.
- Added fixture and unit coverage for theme preference behavior, settings ownership, responsive containment, pending/retry states, and focus restoration.
- Validation completed: `git diff --check`, `npm run check:frontend`, `npm run typecheck`, `npm test` (`52` files, `799` tests), `npm run test:browser:workspace` (`112` passed, `58` skipped across 170 projects), and `npx wrangler deploy --dry-run`.
- Scope audit completed: no `public/` legacy source, legacy rollout task, production gate, deployment workflow, API contract, secret, conversation content, or stored memory was changed.

### Visual Revision Record — 2026-08-15

- User feedback: the implemented UI felt visually heavy and not premium enough; requested a cleaner direction similar in pattern quality to OpenAI and DeepSeek.
- Decision: preserve the approved information architecture and contracts, but supersede the teal-led visual tokens with pearl white (`#F7F8FA`), white surfaces, near-black ink, neutral gray separators, and sparse cobalt (`#4D6BFE`).
- Decision: make the composer/transcript the primary anchor, reduce header and rail competition, use subtle active rows instead of saturated fills, and use a neutral near-black dark theme rather than navy/slate panels.
- Boundary: references inform hierarchy and restraint only; no third-party logo, asset, exact styling, or legacy rollout surface is copied or changed.
