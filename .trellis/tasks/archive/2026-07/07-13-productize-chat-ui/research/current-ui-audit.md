# Current Chat UI Audit

## Code Evidence

- Stable signed-in shell: `public/index.html:42-147`.
- Desktop sidebar width and shell grid: `public/styles.css:1438-1451`.
- Header model/title/action zones: `public/index.html:100-125`, `public/styles.css:1955-2230`.
- Empty state and four prompt starters: `public/app.js:1998-2032`, `public/styles.css:2412-2470`.
- Message content, metadata, and actions: `public/app.js:1913-1983`, `public/styles.css:2274-2410`.
- Composer: `public/index.html:130-146`, `public/styles.css:2472-2561`.
- Mobile layout: `public/styles.css:3081-3192`.

## Existing Strengths

- The signed-in workspace is already the first product screen.
- Sidebar supports new chat, semantic search, date grouping, pin/rename/delete, memory, settings, account quota, and mobile drawer behavior.
- The header preserves current model visibility, title/status, branch-origin navigation, export, and blank-chat actions.
- Message rendering preserves markdown, images, route/fallback metadata, timestamps, branching, edit/resend, rating, regenerate, continue, and retry.
- The composer supports images, multiline input, send/stop, draft persistence, busy/offline state, and responsive safe-area spacing.
- Browser measurements found no body-level horizontal overflow at 1440x960 or 390x844.

## Observed Weaknesses

- The empty state is a large centered block with four uniform text cards, so the greeting, suggestions, and composer feel disconnected.
- The active-conversation canvas has weak assistant identity and limited visual anchoring for metadata/actions.
- Primary controls use ad hoc Unicode symbols, reducing consistency and polish.
- Message action rows render many text buttons and are hidden at `opacity: 0` until hover/focus.
- At 390x844, 18 message action buttons existed in the DOM while zero action rows had visible opacity; touch users cannot rely on hover to discover them.
- The mobile screen uses a 52 px navigation bar plus a 52 px model/action row. The structure is functional but needs careful density control.

## Safe Browser Fixture

The audit intercepted `/api/session`, `/api/chats`, `/api/memory`, and `release.json` with invented values. It did not use a real access code, route key, conversation, or memory.

Screenshots:

- `D:/Agent/codex/visualizations/2026/07/13/019f595e-147b-7352-9eb1-756cb5a0678b/chat-ui-before-desktop.png`
- `D:/Agent/codex/visualizations/2026/07/13/019f595e-147b-7352-9eb1-756cb5a0678b/chat-ui-before-mobile.png`
- `D:/Agent/codex/visualizations/2026/07/13/019f595e-147b-7352-9eb1-756cb5a0678b/chat-ui-active-before-desktop.png`
- `D:/Agent/codex/visualizations/2026/07/13/019f595e-147b-7352-9eb1-756cb5a0678b/chat-ui-active-before-mobile.png`

## Icon Delivery Research

- `lucide-static@1.24.0` is published under the ISC license and exposes individual root SVG files with consistent 24 by 24 `currentColor` stroke geometry.
- The full unpacked package is about 47 MB, so vendoring the runtime/package is disproportionate for this no-build frontend.
- A generated same-origin sprite containing only the selected symbols keeps the delivered asset small, works with native SVG/use references, and can join the existing service-worker shell.
- Release references can use `?v=development`; the GitHub Actions deployment already replaces this placeholder in `public/index.html` and `public/app.js`.
