# Workspace Visual And Interaction Pass

## Goal

Make the typed teammate workspace quieter, denser, and easier to operate for repeated daily chat work. The conversation rail, one compact workspace header, readable transcript, message actions, and pinned composer must remain stable from wide desktop through 390px touch layouts without changing backend streaming, provider routing, or telemetry semantics.

## Confirmed Baseline

- `ChatWorkspace` already provides a fixed-height application shell, a 280px desktop rail, a focus-managed mobile drawer, a centered 720px transcript, branch-aware message actions, waiting/recovery rows, and a bottom composer.
- `ConversationSidebar` already traps focus on mobile, closes on Escape, restores focus, exposes route health in settings, and preserves account operations.
- `MessageView` already renders Markdown/GFM, files, sanitized sources, reasoning, tool state, copy/edit/resend/regenerate/feedback/branch/continue actions, and edit focus restoration.
- The current visual layer has concrete gaps: two stacked headers consume at least 124px, rail and message actions use 30px targets, send/stop use 36px targets, the textarea does not auto-grow, user-bubble Markdown colors can lose contrast, and long file/code content has incomplete containment.
- Previous browser acceptance was recorded at selected sizes, but the repository has no committed Playwright runner or reproducible DOM fixture. Static source checks cannot prove geometry, focus, touch size, or overlap.

## Requirements

### R1. Shared workspace visual system

- Define shared spacing, radius, readable-width, header-height, icon-target, touch-target, status-height, focus, and semantic color tokens in `client/src/styles.css`.
- Keep the product work-focused: restrained neutral surfaces, one primary accent, explicit warning/danger states, no decorative gradients/orbs, no nested presentation cards, and no radius above 8px for workspace controls.
- Preserve a visible `:focus-visible` treatment and reduced-motion behavior. Do not use hover, opacity zero, or pointer suppression as the only way to discover an action.

### R2. Dense conversation rail and mobile parity

- Keep the rail scannable at a stable desktop width with compact rows, clear current-conversation semantics, title/date/message-count truncation, and a non-color-only active indicator.
- Keep rename and delete controls in a stable action region. Desktop may de-emphasize them until row hover/focus, but they remain visible and keyboard reachable; touch layouts keep them fully visible with at least 44px targets.
- Preserve mobile drawer initial focus, Tab containment, Escape close, scrim close, and opener focus restoration.
- Replace the conversation `window.confirm` path with an accessible destructive confirmation that prevents accidental touch deletion and restores focus.

### R3. One compact workspace header

- Replace the stacked global and conversation toolbars with one header no taller than 60px at rest.
- Show the active conversation title, selected logical-route label and model, passive route-health state, and Agent connection state without exposing provider IDs, credentials, or internal failure payloads.
- Provide a compact route/status control that opens the existing sidebar settings/health view. It is an access point to existing safe projections, not a new fallback or telemetry contract.
- Keep mobile menu, memory, install, and logout actions reachable without allowing long titles or status labels to overlap them.

### R4. Readable transcript and message hierarchy

- Keep the transcript centered and no wider than 720px on wide screens; assistant content remains unframed and user content remains a compact bubble.
- Make headings, links, inline code, blockquotes, tables, and code blocks readable in both roles. Code-copy controls must not cover code, and tables/code may scroll locally without widening the page.
- Group source parts into a compact labelled source region, keep tool/reasoning details progressively disclosed, and truncate long source or attachment names without losing their accessible text.
- Keep the complete role-aware message action set immediately below its message. Desktop actions remain visibly present at low emphasis and strengthen on hover/focus; touch actions remain fully visible with at least 44px targets.

### R5. Stable pinned composer

- Make the message list the vertical scroll owner and pin the composer to the bottom of the chat panel, including mobile safe-area padding.
- Auto-grow the textarea from one line to a bounded maximum, then scroll internally. Enter sends and Shift+Enter inserts a newline as today.
- Keep send and stop controls the same dimensions in every state, with at least 44px touch targets. Status changes use reserved space so waiting/recovering/error copy does not shift the composer or cover the latest message.
- Preserve offline, unavailable-route, active-run, draft restoration, cancellation, and disabled-state behavior.

### R6. Reproducible browser acceptance

- Add a checked-in Playwright workspace fixture that renders the real presentational React components with deterministic synthetic conversations, Markdown, code, sources, files, tool states, long titles, long words, and composer/status states.
- The fixture must not authenticate, open an Agent WebSocket, call a Worker API, or send a model request. Unknown network requests fail the test.
- Validate `1920x1080`, `1440x900`, `780x900`, `480x844`, and touch-enabled `390x844` layouts. Geometry/overflow/focus assertions are authoritative; screenshots are retained as local test artifacts for inspection.
- Assert document and component containment, stable header/composer dimensions, allowed local code/table scrolling, focus-visible controls, drawer and edit focus lifecycles, and tappable message/composer actions.

### R7. Phase boundary

- This task may rearrange and style existing submitted, waiting-first-output, streaming, recovering, offline, and failed projections, but it must not redefine those states or their timing.
- First-visible latency, progressive-versus-single-chunk telemetry, provider failure classification, reconnect semantics, branch persistence, and release documentation remain in the later streaming/integrated-acceptance work.
- Do not add a live-provider test, production deployment path, or new administrator/provider data contract.

## Acceptance Criteria

- [x] Shared workspace tokens are consumed by the rail, header, transcript/actions, and composer; focus and reduced-motion rules remain effective.
- [x] The workspace uses one compact header at or below 60px and exposes title, logical route/model, passive health, connection, memory, and account actions without overlap.
- [x] The desktop rail is denser, has semantic/non-color-only active state, stable rename/delete affordances, and an accessible delete confirmation; mobile drawer behavior remains equivalent.
- [x] Assistant and user Markdown, code, tables, files, sources, reasoning, tools, and role-aware actions remain readable and contained; user-bubble Markdown meets visible contrast expectations.
- [x] The transcript never exceeds 720px, long content creates no page-level horizontal overflow, and message actions remain visible, keyboard reachable, and at least 44px on touch layouts.
- [x] The composer remains pinned, grows from one line to its cap, keeps equal send/stop dimensions, reserves status space, and does not cover the latest message or action row.
- [x] A committed Playwright fixture passes geometry, overflow, focus, touch, and selected screenshot checks at `1920x1080`, `1440x900`, `780x900`, `480x844`, and `390x844` without network or model calls.
- [x] `npm run check:frontend`, focused Vitest tests, `npm test`, `npm run typecheck`, `npx wrangler deploy --dry-run`, and `git diff --check` pass.

## Out Of Scope

- Redefining Agent/AIChat status derivation, first-output thresholds, reconnect/resume, provider-busy behavior, error taxonomy, or stream telemetry.
- Adding fallback/provider details to the teammate session API or exposing physical provider identity.
- Changing message branch persistence, quota, idempotency, tool payload transport, or feedback APIs.
- Redesigning the typed administrator, legacy rollback shells, sign-in, memory data model, or account lifecycle.
- Production deployment, GitHub Actions release, or documentation closure.

## Planning Decisions

- Use 44px as the measurable touch-target floor while retaining denser 32-36px desktop icon controls.
- Treat the message list as the sole vertical scroll owner; "sticky composer" means visually pinned inside the chat panel, not a page-overlay that covers transcript content.
- Interpret fallback/health access as a route-status control that opens the existing safe route settings and passive-health projection. New telemetry or provider details do not enter this slice.
- Use a component fixture instead of a mocked Agent protocol so browser acceptance exercises production presentational components without coupling visual tests to AIChat WebSocket internals.
