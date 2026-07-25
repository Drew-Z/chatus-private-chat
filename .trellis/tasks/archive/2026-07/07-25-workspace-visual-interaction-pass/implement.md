# Implementation Plan: Workspace Visual And Interaction Pass

## Ordered Slices

### 1. Reproducible baseline and shared tokens

- [x] Add the pinned Playwright dev dependency, workspace browser-test script, test-only Vite fixture, and strict no-network guard.
- [x] Seed deterministic long conversations, Markdown/code/table/file/source/tool/action states, waiting/recovery/error labels, and long composer drafts with synthetic data only.
- [x] Add shared workspace spacing, radius, width, header, action, touch, status, focus, and semantic-color tokens.
- [x] Extend `scripts/check-frontend.mjs` to inspect React CSS contracts without pretending string checks prove runtime geometry.

### 2. Conversation rail and compact header

- [x] Control the sidebar history/settings view from `ChatWorkspace` so the header route/status action can open existing safe route settings.
- [x] Replace the stacked headers with one at-rest header at or below 60px, including title, logical route/model, passive health, connection, memory, install, and logout controls.
- [x] Compact conversation rows, add semantic/non-color-only active state, stabilize the action column, and apply desktop/touch emphasis rules.
- [x] Replace conversation `window.confirm` deletion with an accessible native dialog and preserve focus on cancel/close/failure.

### 3. Transcript and rich message hierarchy

- [x] Preserve the 720px readable column and make assistant/user hierarchy, labels, spacing, and action placement consistent.
- [x] Correct user-bubble Markdown heading/link/code/blockquote/table contrast.
- [x] Reserve code-copy space, contain tables/code locally, and prevent long words, attachment names, sources, tools, or edit forms from widening the page.
- [x] Group sanitized source parts in a compact labelled region while preserving reasoning/tool disclosure and action-state behavior.
- [x] Keep message actions visibly discoverable on desktop and at least 44px on touch layouts.

### 4. Stable composer

- [x] Make message-list scroll ownership and composer bottom pinning explicit, including mobile safe-area padding.
- [x] Add bounded textarea auto-growth and preserve Enter/Shift+Enter, draft, offline, route, busy, and cancellation behavior.
- [x] Reserve composer status height and keep send/stop dimensions identical through waiting, streaming, recovery, error, and idle presentation.
- [x] Add focused unit/structure assertions for any extracted pure size/state helpers.

### 5. Browser matrix and task verification

- [x] Run Playwright geometry, overflow, keyboard, focus-return, touch-target, drawer, edit, and composer checks at `1920x1080`, `1440x900`, `780x900`, `480x844`, and `390x844`.
- [x] Inspect the generated viewport screenshots and record the artifact paths/results in this task checkpoint.
- [x] Run `npm run check:frontend` before `npm test`, then `npm run typecheck`, `npx wrangler deploy --dry-run`, and `git diff --check`.
- [x] Confirm no Worker API, Agent WebSocket, live model, production deployment, credential, private conversation, or memory entered the test path.
- [x] Update the frontend component/state/quality specs with stable contracts learned during implementation.

## Completion Checkpoint (2026-07-25)

- Playwright: 18 passed, 2 desktop-only drawer cases skipped by breakpoint across all five configured projects.
- Retained screenshots: `test-results/workspace-visual/**/workspace-{wide-1920,desktop-1440,boundary-780,mobile-480,touch-390}.png`; drawer-close screenshots are retained for the three mobile projects. The entire artifact root is Git-ignored.
- Quality gates passed: `npm run check:frontend`, 248 Vitest tests, `npm run test:browser:workspace`, all TypeScript projects, `npx wrangler deploy --dry-run`, `git diff --check`, and Trellis context validation.
- The fixture uses only synthetic data and blocks/asserts unexpected network requests through test teardown. No Worker API, Agent WebSocket, model request, production deployment, credential, private conversation, or stored memory entered the test path.

## Validation Commands

```powershell
npm.cmd run check:frontend
npm.cmd test
npm.cmd run test:browser:workspace
npm.cmd run typecheck
npx.cmd wrangler deploy --dry-run
git diff --check
python ./.trellis/scripts/task.py validate 07-25-workspace-visual-interaction-pass
```

## Risky Files And Boundaries

- `client/src/components/ChatWorkspace.tsx`: preserve Agent connection, draft restoration, manual-scroll, stop, branch, and error behavior while moving presentation.
- `client/src/components/ConversationSidebar.tsx`: preserve mobile focus trapping, settings/account state, and busy guards while adding controlled view/deletion dialog behavior.
- `client/src/components/MessageView.tsx`: preserve part order semantics, action availability, edit focus restoration, sanitized source URLs, and tool approval behavior.
- `client/src/styles.css`: tokens must not unintentionally restyle typed administration, auth, legacy shells, or fixed-format admin grids.
- `tests/browser/`: fixture data must remain synthetic and tests must fail on unexpected network access.
- `package.json` / `package-lock.json`: keep the browser runner reproducible and do not rely on another workspace's Playwright installation.

## Phase Boundaries

- Do not change Agent/AIChat status derivation, first-output timing, stream telemetry, provider-busy/error classification, reconnect semantics, or provider/session projections.
- Do not change branch persistence, quota/idempotency, tool payload transport, or feedback APIs.
- Full local Worker acceptance, provider administration acceptance, release documentation, push, and production deployment remain Phase F.

## Rollback

- Revert the child feature commit; no storage or configuration migration is involved.
- Remove only the test-only browser fixture and dependency if the browser runner itself blocks the build; do not weaken runtime focus/overflow contracts to make a screenshot pass.
- Keep the existing responsive React workspace deployable until the complete viewport matrix passes.

## Start Gate

Before `task.py start`, review `prd.md`, `design.md`, and this implementation plan. Confirm the exact viewport/touch/header/composer contracts, verify no product-intent question remains, and obtain explicit user approval to enter implementation.
