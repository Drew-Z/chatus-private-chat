# Productize chat UI - Technical Design

## Scope And Boundaries

This is a frontend-only redesign of the signed-in user chat shell plus the admin route-model workflow. It will change stable markup, DOM rendering, icons, and CSS in `public/`, plus static contract checks. It will not change Worker APIs, storage schemas, authentication, route execution, sync semantics, or the persisted one-route-per-model contract.

Primary files:

- `public/index.html`: stable control markup and icon placeholders.
- `public/app.js`: empty-state and message-action DOM rendering.
- `public/admin.html`: explicit model chooser dialog and batch setup controls.
- `public/admin.js`: fetched-model state, search, selection, and batch route creation.
- `public/styles.css`: shared chat visual system and responsive behavior.
- `public/icons.svg`: small local sprite generated from a curated set of Lucide SVG assets.
- `public/sw.js`: offline shell inclusion for the new icon module.
- `scripts/check-frontend.mjs`: structural regressions for the changed contracts.

## Visual System

### Shell

- Keep the existing 264 px desktop sidebar boundary and responsive drawer behavior.
- Use neutral page/surface colors, restrained borders, Chatus green for primary state, amber for fallback/warnings, and red only for destructive/error state.
- Tighten spacing and active-state contrast so sidebar, header, message canvas, and composer read as one workspace.
- Keep cards at 8 px radius or less and avoid cards around page sections.

### Header

- Preserve three logical zones: model/BYOK controls, centered conversation identity, and conversation actions.
- Replace Unicode control glyphs with local Lucide icons while retaining native button elements, titles, and accessible labels.
- On mobile, keep the navigation bar and compact model row stable rather than merging workflows or hiding the current model.

### New Chat

- Render a compact Chatus identity mark, personalized greeting, one-line route context, and four prompt starters.
- Prompt starters remain buttons but gain an icon/category cue and concise copy hierarchy; their click handler only fills, resizes, saves, and focuses the composer.
- Vertically position the block as a task starting area related to the composer, not as an oversized centered hero.

### Messages

- Keep user messages as compact right-aligned bubbles and assistant messages as unframed readable content.
- Add a small assistant identity marker/header so metadata and content have a stable reading anchor.
- Retain route/fallback and timestamp metadata, with fallback shown as a semantic warning badge.
- Convert action labels to icon buttons through the existing `actionButton` helper. Each action receives a Lucide icon name, `aria-label`, `title`, and active state.
- Desktop pointer layouts may fade inactive toolbars until message hover/focus, but toolbar space must not cause layout shift.
- Touch/no-hover layouts always show toolbars. The toolbar wraps within the message width and uses stable square targets.
- Use a 720 px message reading column. User bubbles are nested inside an unframed message row so their action toolbar sits below and outside the bubble.
- Keep icon action toolbars visibly present in a low-contrast state rather than relying on hover to reveal capabilities.

### Composer

- Preserve the current form and input IDs. Refine border, shadow, toolbar spacing, placeholder hierarchy, attachment row, and busy/offline states.
- Use Lucide image/plus, send, and stop icons without changing event wiring.
- Keep the composer width aligned with the message reading column and retain mobile safe-area padding.

### Admin Model Discovery

- Keep `routeModelInput` as a normal manual text input and remove its native `datalist` coupling.
- Add a native dialog with a dedicated search input, result count, model rows, per-model "use" action, checkboxes, and batch footer.
- `fetchRouteModels` stores only the normalized string list returned by the existing endpoint, clears dialog search, renders the full list, and opens the dialog.
- A separate "choose" button reopens the fetched list. Changing route, Base URL, API Key Ref, or interface type invalidates the in-memory list.
- Search filters case-insensitively without modifying the selected route model. Escape and the dialog close button use native dialog behavior.

### Provider Batch Setup

- Runtime semantics remain one route per model. The admin UI treats the current route form as a provider template and creates the repetitive route objects in one save.
- The dialog includes an editable route ID prefix derived from the current route ID, provider label, or Base URL hostname.
- For each checked model, generate `<prefix>-<sanitized-model>` and append a numeric suffix if needed. Existing route IDs are never replaced.
- Clone only non-secret route configuration fields from the editor: label, type, Base URL, API Key Ref, fallbacks, enabled state, user-key requirement, and image capability. Plaintext route-secret input is never read.
- Do not modify `defaults.allowedRoutes` or any user `allowedRoutes`. Existing implicit-all access semantics continue to work naturally; explicit allow lists remain unchanged.
- Routes sharing the same label render under one provider group in the signed-in model picker.

## Icon Contract

`public/icons.svg` will contain only the symbols needed by the chat page, generated from `lucide-static@1.24.0` under its ISC license. The icon boundary will:

- Keep the original 24 by 24 Lucide geometry, `currentColor` stroke, rounded line caps, and line joins.
- Expose symbols through same-origin `<svg><use href="/icons.svg?v=development#name"></use></svg>` references.
- Mark owning SVG elements `aria-hidden="true"` and `focusable="false"`; accessible names remain on the native controls.
- Avoid `innerHTML`, remote scripts, inline styles, runtime package code, and runtime network dependencies beyond the cached local asset.
- Stay at the `public/` root, use the release placeholder in references, and be included in the service-worker shell.

Static controls embed a stable SVG/use element directly. Dynamic message and suggestion controls call a small `createIcon(name)` DOM helper in `public/app.js` that references the same sprite.

### Selected Icon Mapping

| Existing control or action | Lucide symbol |
| --- | --- |
| Open/close sidebar | `menu` / `x` |
| New chat | `plus` |
| Search | `search` |
| Logout | `log-out` |
| Model disclosure | `chevron-down` |
| Show/hide personal key | `eye` / `eye-off` |
| Return to source branch | `corner-up-left` |
| Export chat | `download` |
| Start blank chat | `eraser` |
| Add image | `image-plus` |
| Send/stop | `arrow-up` / `square` |
| Return to latest message | `arrow-down` |
| Copy message | `copy` |
| Branch message | `git-branch` |
| Edit user message | `pencil` |
| Resend user message | `send-horizontal` |
| Continue assistant output | `refresh-cw` |
| Helpful/needs improvement | `thumbs-up` / `thumbs-down` |
| Regenerate or retry | `rotate-cw` |
| Prompt: problem analysis | `list-checks` |
| Prompt: content review | `file-search` |
| Prompt: solution ideation | `lightbulb` |
| Prompt: code/text improvement | `code-xml` |

The symbol set is closed for this task. Adding another icon requires an existing requirement rather than visual experimentation during implementation.

## State And Data Flow

No application state contract changes.

1. `showChat` loads the current session, chats, routes, and memory as before.
2. `renderMessages` still derives DOM from the `messages` array and invokes the same action callbacks.
3. `renderEmptyChat` still derives route/user copy from module state and only populates the composer.
4. Icon child nodes change presentation only; IDs and event listeners remain on the owning native controls.
5. CSS media features (`hover`, `pointer`, viewport width, reduced motion) determine presentation without changing state.
6. Admin model-list results remain ephemeral; batch creation writes ordinary existing `routes` objects through the current revision-checked config save.

## Compatibility And Security

- Do not change IDs queried by `public/app.js`.
- Do not add `.style.*` or style attributes; semantic classes and attributes remain the styling boundary.
- Keep all icon data local for CSP and offline use; add the module to service-worker shell assets.
- Preserve `aria-expanded`, listbox keyboard behavior, native dialogs, focus rings, and reduced-motion scrolling.
- Browser verification uses intercepted fake `/api/session`, `/api/chats`, and `/api/memory` responses only.
- Admin browser verification intercepts the existing model-list/config endpoints with fake providers and model names only.

## Tradeoffs

- A small curated SVG sprite adds one asset but avoids a large framework, CDN dependency, runtime icon script, and hundreds of unused icons.
- Keeping all message actions available avoids behavior changes. It is slightly denser than an overflow menu, but removes new menu state and preserves one-click workflows.
- Maintaining the separate mobile model row consumes vertical space, but keeps route visibility and BYOK behavior predictable.
- Keeping one route per model preserves health, fallback, permission, and metric contracts. Batch setup removes repetitive administration now without forcing a storage migration; a first-class provider schema remains a future architectural option.

## Rollout And Rollback

- The change is static and deploys through the existing GitHub Actions release path.
- No data migration or feature flag is required.
- Rollback is a normal code revert because backend and persisted state remain unchanged.
