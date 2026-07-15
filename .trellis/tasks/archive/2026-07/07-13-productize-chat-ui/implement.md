# Productize chat UI - Implementation Plan

## 1. Establish The Local Icon Boundary

- [x] Add `public/icons.svg`, generated from the curated `lucide-static@1.24.0` icons used by the chat shell, empty prompts, and message actions.
- [x] Reference it with release-versioned SVG/use elements in static markup and a DOM-safe `createIcon` helper for dynamic controls.
- [x] Add the asset to the service-worker shell and frontend structural checks.
- [x] Checkpoint: run `npm run check:frontend` before broader UI changes.

## 2. Refine Stable Chat Markup

- [x] Replace Unicode glyph content in primary chat controls with accessible icon placeholders while preserving IDs, titles, labels, and form behavior.
- [x] Add only the semantic wrappers/classes needed for header, composer, and responsive layout; do not restructure settings or backend-facing fields.
- [x] Checkpoint: verify every queried ID still exists and no duplicate IDs were introduced.

## 3. Improve New-Chat And Message Rendering

- [x] Update `renderEmptyChat` to render the compact greeting, route context, and icon-led prompt starters without changing click behavior.
- [x] Update message rendering to add assistant identity structure and compact metadata placement.
- [x] Change `actionButton` to render Lucide icon controls with accessible labels/tooltips, preserving every existing callback and active rating state.
- [x] Keep errors and image rendering behavior unchanged.

## 4. Apply The Product Visual System

- [x] Consolidate chat color, sizing, spacing, focus, and surface tokens in the chat product CSS section.
- [x] Refine sidebar, header, empty state, message flow, action toolbar, composer, dialogs, and dark mode.
- [x] Add explicit touch/no-hover rules that keep message actions visible and usable.
- [x] Verify desktop and mobile stable dimensions, wrapping, safe areas, and no horizontal overflow.

## 5. Add Regression Assertions

- [x] Assert the versioned icon import and service-worker asset inclusion.
- [x] Assert dynamic message actions receive accessible icon labels.
- [x] Assert touch/no-hover CSS keeps message actions discoverable.
- [x] Preserve existing CSP, release, draft, route, branching, sync, and update assertions.

## 6. Browser Verification And Quality Gate

- [x] Run browser fixtures with fake data for empty and active conversations at 1440x960 and 390x844.
- [x] Inspect screenshots for hierarchy, clipping, overlap, action visibility, and dark-mode readability.
- [x] Measure body overflow and key header/message/composer bounds.
- [x] Exercise new chat, prompt fill, model picker keyboard navigation, sidebar drawer, message actions, attachment trigger, send/stop presentation, and settings entry.
- [x] Run `npm run check:frontend`.
- [x] Run `npm test`.
- [x] Run `npm run typecheck`.
- [x] Run `npx wrangler deploy --dry-run`.
- [x] Run `git diff --check`.

## 7. Replace Native Model Suggestions

- [x] Remove the `datalist` coupling from `routeModelInput` while keeping manual entry.
- [x] Add the model chooser dialog, independent search, complete fetched list, single-model selection, and reopen behavior.
- [x] Invalidate fetched results when provider connection fields or the selected route change.
- [x] Replace the old "clear the model field" structural assertion with complete-list chooser assertions.

## 8. Add Provider Batch Route Setup

- [x] Add model checkboxes, selected count, editable route ID prefix, and one-click batch creation.
- [x] Clone the provider template without reading or persisting plaintext secrets.
- [x] Generate collision-safe valid route IDs and save all routes through the existing revision-checked config endpoint.
- [x] Preserve explicit user route allow lists and report created route IDs/models clearly.
- [x] Group same-label routes in the signed-in model picker.

## 9. Tighten Conversation Reading And Actions

- [x] Reduce the reading column to 720 px while keeping the composer responsive.
- [x] Move user message actions outside the visual bubble.
- [x] Keep full message action toolbars subtly visible on desktop and touch layouts.
- [x] Re-run empty/active desktop and mobile screenshots after the expanded changes.

## Risk And Rollback Points

- Icon sprite failure: controls retain their accessible names but may appear empty; catch with asset checks, browser screenshots, and failed-request inspection before proceeding.
- Message action regression: compare every existing callback branch in `renderMessages` before and after the signature change.
- Mobile discoverability regression: verify computed opacity and pointer target bounds in the no-hover browser context.
- Service-worker omission: require `public/icons.svg` in shell assertions before shipping.
- If any checkpoint fails, revert the current implementation chunk rather than changing API or state behavior to accommodate presentation.
