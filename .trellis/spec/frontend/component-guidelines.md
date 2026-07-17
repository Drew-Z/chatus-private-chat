# Component Guidelines

## Overview

The default teammate frontend uses typed React components under `client/`. The legacy chat and administration surfaces still use HTML regions plus page-controller functions under `public/`.

## Component Structure

- Keep the React composition root small: session gating belongs in `App.tsx`; daily workspace, conversation navigation, message rendering, and memory controls belong in focused components.
- Pass stable owning IDs and server projections explicitly. Async results must update the conversation or editor that initiated them, not whichever view is active later.
- Prefer native controls and semantic dialog roles. Modal drawers must receive initial focus, contain Tab navigation, support Escape, and restore focus to the opener.
- In legacy pages, define stable markup in `public/index.html` or `public/admin.html`, resolve nodes near the top of the paired script, and attach listeners once.

Examples in `public/app.js` include the session list, model picker, settings dialog, message list, and shared application dialog.

## Data and Parameter Conventions

- React components use typed props and local state; shared asynchronous/browser contracts stay in `client/src/lib/` rather than being redefined inside components.
- Legacy page modules use module-scoped state. Reusable helpers accept explicit values and return data or DOM-safe output.
- Pass the owning entity explicitly for asynchronous work. Cloud saves and summaries retain the chat/session ID so results do not update whichever chat happens to be active later.

## Admin Model Discovery And Batch Routes

- Keep `routeModelInput` as an ordinary manual text input. A native `datalist` is not an acceptable full-list browser because the browser filters options using the current input value.
- Store fetched provider models in module-scoped ephemeral state. Opening the model dialog clears only its dedicated search field and renders the complete fetched list; it must not clear or filter from `routeModelInput`.
- Invalidate fetched models when the selected route, interface type, Base URL, or API Key Ref changes. Do not persist or log upstream model responses.
- Keep the runtime contract as one route ID per executable model. Batch setup clones the visible provider editor fields into ordinary route objects and saves them through `/api/admin/config` with `expectedRevision`.
- Batch setup may copy an `apiKeyRef`, but it must never read `routeSecretInput`, copy a legacy plaintext `apiKey`, overwrite an existing route ID, or modify `defaults.allowedRoutes` / user `allowedRoutes`.
- Routes with the same `label` are one provider group in the signed-in model picker. Keep every selectable button discoverable through the shared `.model-option` query so Arrow, Home, End, Escape, and Tab behavior continues to work across groups.

## AI Capability Editors And Tool Timeline

- Keep Skills, tools, and MCP servers in one admin section with native tab, form, checkbox, and password controls. The revisioned config remains the only persisted browser draft.
- MCP plaintext may be read only by the dedicated secret save action. Clear the password input on save success/failure, auth-type changes, editor/tab/section switches, refresh, login transitions, and discarded edits.
- Discovery sends only `serverId`, endpoint metadata, auth type, and a saved `secretRef`. New tools and tools whose `schemaFingerprint` changes must be saved with `enabled: false`; unchanged tools preserve their existing enabled state and confirmation policy.
- Capability chat responses are selected by `X-Chatus-Stream: capability-v1`. Tool approval writes must include `X-Chatus-Client: web` and `{ runId, callId, decision }`; disable or remove the visible approval controls after the first decision.
- Keep an active capability stream attached to its source chat. Do not allow chat switching, active-chat deletion, logout, or local-data clearing until the user stops the run.
- Render persisted tool summaries as compact unframed rows in the assistant message. Never reconstruct or persist raw arguments, raw results, remote endpoints, schemas, or credentials in the browser timeline or Markdown export.

## Styling Patterns

- Put React visual rules in `client/src/styles.css` and legacy/admin rules in `public/styles.css`; CSP checks forbid `.style.*` mutations in legacy scripts.
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
- Reintroducing a native `datalist` for remote model discovery. It couples the selected value to browser filtering and makes the fetched total differ from what administrators can inspect.
- Building a persisted provider abstraction when the existing route API is sufficient. Preserve route-level health, permission, fallback, and metric boundaries; remove repetitive administration in the UI instead.
- Hiding message actions at zero opacity or disabling their pointer events until hover. Desktop may use a low-contrast visible state, while touch layouts keep the toolbar fully visible.
