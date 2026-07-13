# Component Guidelines

## Overview

The frontend does not use React or another component runtime. A "component" is an HTML region identified by stable IDs/classes plus JavaScript functions that render or update it.

## Component Structure

- Define stable markup in `public/index.html` or `public/admin.html`.
- Resolve required DOM nodes near the top of the paired page script with `querySelector`.
- Keep rendering in named functions that derive DOM output from application state.
- Attach event listeners once during module initialization; update state and call the relevant render function.
- Prefer native controls and `<dialog>` for modal interactions.

Examples in `public/app.js` include the session list, model picker, settings dialog, message list, and shared application dialog.

## Data and Parameter Conventions

- Page modules use module-scoped state instead of prop objects.
- Reusable helpers accept explicit values and return data or DOM-safe output. See `renderMarkdown` in `public/markdown.js` and `buildAdminReportCsv` in `public/admin-report.js`.
- Pass the owning entity explicitly for asynchronous work. Cloud saves and summaries retain the chat/session ID so results do not update whichever chat happens to be active later.

## Styling Patterns

- Put visual rules in `public/styles.css`; CSP checks forbid `.style.*` mutations in `app.js`, `admin.js`, and `theme.js`.
- Toggle semantic classes and attributes such as `hidden`, `aria-expanded`, and status classes.
- Keep shared page styling in the single stylesheet instead of inline style attributes.

## Accessibility

- Preserve visible `:focus-visible` treatment for keyboard users.
- Keep keyboard behavior for menus and dialogs, including arrow navigation, Escape/Tab closure, and focus restoration.
- Respect `prefers-reduced-motion`; scrolling falls back to `auto` when reduced motion is requested.
- Use labels, native buttons, forms, and dialogs before custom clickable containers.

## Common Mistakes

- Adding a `querySelector("#id")` without adding the ID to the paired HTML; `npm run check:frontend` rejects this.
- Updating DOM from a stale async result without checking the source chat or current revision.
- Applying inline styles, which weakens the Content Security Policy.
- Replacing destructive actions without preserving undo, conflict, or confirmation behavior already present in the UI.
- Treating a native `datalist` popup as an unfiltered list. Browsers filter suggestions by the input's current value, so a fetched total can exceed the visible options. Preserve the current value, but make status copy distinguish the total result count from the filtered suggestion view and explain that clearing the input reveals all options.
