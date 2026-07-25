# Design: Workspace Visual And Interaction Pass

## Boundary

This slice changes the typed teammate workspace presentation and local interaction only. `ChatWorkspace`, `ConversationSidebar`, `MessageView`, `MarkdownContent`, and focused presentational helpers remain consumers of the current authenticated session, Agent chat state, and branch APIs. No Worker route, provider contract, session decoder, Agent protocol, or persistence schema changes.

The design keeps existing accessibility and recovery behavior while replacing accidental layout choices with explicit tokens and a reproducible browser fixture.

## Layout Architecture

### One workspace header

`ChatWorkspace` owns one header above the desktop rail/chat grid. It receives the active conversation and selected session route directly. `ConversationChat` reports only its existing connection projection (`connecting`, `ready`, or `error`) through a callback; the callback does not change connection semantics.

The header uses three stable regions:

1. brand/menu region aligned to the desktop rail;
2. min-width-zero conversation title plus logical route/model and passive health control;
3. connection, install, memory, and logout actions.

The route/status control switches the controlled `ConversationSidebar` view to settings and opens the drawer on mobile. The existing route health text is reused. No physical provider or fallback list is added to the teammate projection.

Removing the inner `chat-toolbar` leaves one at-rest header no taller than 60px and returns vertical space to the transcript.

### Scroll ownership

`workspace-shell` remains viewport-bound. The workspace grid and chat panel use `min-height: 0`; the conversation list, settings view, and message list own their local vertical scrolling. The composer is a non-shrinking, bottom-pinned child of the chat column with explicit sticky positioning and safe-area padding. Transcript bottom padding accounts for the composer without overlaying content.

## Visual Tokens

Extend `:root` with narrowly named shared values:

- spacing steps for compact controls and content gutters;
- `--workspace-header-height`, `--rail-width`, and `--transcript-max-width`;
- desktop icon/action target and `--touch-target: 44px`;
- composer/status reserved dimensions;
- control/message radii capped at 8px;
- focus ring, semantic success/warning/danger, text, muted text, and link colors.

Tokens replace repeated workspace literals where they encode a shared contract. Admin-specific geometry remains unchanged unless it consumes an already shared primitive.

## Conversation Rail

Make the sidebar view controlled by `ChatWorkspace` so the header can open route settings. Conversation rows receive `aria-current="page"` on the active selection and a left accent marker in addition to the active background.

Rows keep a fixed action column so titles do not shift when actions strengthen. Desktop actions remain rendered and faint, becoming fully emphasized on row hover or `:focus-within`; touch media keeps them fully emphasized and expands targets to 44px. No zero-opacity or pointer-disabled hiding is allowed.

Replace `window.confirm` with a native modal `dialog`. It names the conversation, distinguishes destructive cleanup from account deletion, focuses Cancel first, closes on Escape, and restores focus to the delete control. The existing account-dialog focus pattern is reused.

## Messages And Rich Content

`MessageView` keeps original part semantics but separates source parts from primary content into one labelled source group after the main content. Sanitized links remain links; rejected URLs remain plain text. Files and sources use min-width-zero text wrappers with ellipsis and retained `title`/accessible names.

Role-specific CSS overrides headings, links, inline code, blockquotes, and table borders inside the dark user bubble. Code blocks reserve a header/right inset for the copy control and scroll horizontally inside the block. Tables, long words, file names, sources, and tool rows cannot widen the transcript or page.

Message action behavior remains owned by `MessageView`. Visual emphasis changes only: compact visible desktop controls, clear `focus-visible`/hover state, and 44px touch targets. Copy remains available independently of generation state.

## Composer

Extract a focused presentational composer if needed so production and browser fixture exercise the same markup. A textarea ref measures `scrollHeight` after input/conversation changes, resets height to auto, and clamps to the configured maximum. It then scrolls internally.

The status row is always present with a fixed minimum block size. Existing state chooses its text; an empty state reserves geometry without announcing content. Send and Stop occupy the same action box and preserve existing disabled and cancellation handlers.

## Browser Fixture

Add `@playwright/test` as a pinned dev dependency and a `test:browser:workspace` script. A test-only Vite root under `tests/browser/workspace-fixture/` imports production CSS and the real presentational components. It supplies deterministic synthetic session/conversation/message/tool/source data and local callbacks; it does not mount `useAgent`, open WebSockets, or call `/api`.

The Playwright config starts that fixture server on an available fixed local port, blocks unexpected network requests, disables animation/reduces motion, and runs Chromium at:

- `1920x1080` wide desktop;
- `1440x900` desktop;
- `780x900` drawer boundary;
- `480x844` narrow mobile;
- `390x844` touch mobile.

Geometry assertions are primary: document width, component bounds, header/transcript/composer ordering, local overflow ownership, equal send/stop dimensions, 44px touch targets, and focus lifecycles. Viewport screenshots are retained in Playwright artifacts for manual inspection; they are not production assets or API fixtures.

## Compatibility And Security

- Existing session, route, message, tool, branch, feedback, memory, and account contracts are unchanged.
- Synthetic fixture content contains no real conversation, credential, provider endpoint, access code, or memory.
- No browser test sends a chat turn or contacts a model.
- Legacy chat/admin shells and typed administration remain untouched.
- Reduced motion, keyboard operation, mobile focus trapping, and source URL sanitization remain mandatory.

## Rollback

The child commit can be reverted without data migration. CSS/React changes are presentation-only, and the test fixture has no runtime persistence. Keep the previous feature commit deployable until the new browser matrix and release gates pass.
