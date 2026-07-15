# Productize chat UI

## Goal

Make the signed-in Chatus workspace feel like a coherent, production-ready chat product across both new-chat and active-conversation journeys, using selected Doubao interaction patterns as inspiration while preserving Chatus identity and behavior.

## Background

- The current shell already contains conversation grouping, search, pin/rename/delete, memory, settings, model selection, cloud sync, branching, export, image input, and responsive navigation (`public/index.html:42`, `public/app.js:1390`, `public/app.js:1913`).
- The new-chat state greets the signed-in user and offers four reusable prompts, but its large centered block is weakly connected to the composer (`public/app.js:1998`, `public/styles.css:2412`).
- Active conversations render user and assistant messages differently and preserve route, fallback, timestamp, branch, edit, resend, rating, and regenerate behavior (`public/app.js:1921`).
- Message actions are currently hidden with `opacity: 0` until hover or focus (`public/styles.css:2328`). Browser evidence confirmed that the same rule applies at a 390 px touch viewport, leaving 18 rendered actions undiscoverable without hover.
- The admin route editor uses a native `datalist` for fetched models. Because the current model value is also the browser filter, administrators must clear it before they can inspect the complete fetched list (`public/admin.html:221`, `public/admin.js:1758`).
- Route configuration intentionally uses one `routeId` per executable model because permissions, fallbacks, health checks, and metrics all reference route IDs. Repeating the same provider connection fields for every model is therefore an administration problem, not a reason to discard those runtime boundaries (`src/worker.ts:40`, `src/worker.ts:2283`).
- The app is a framework-free static frontend with CSP-safe class-based styling, versioned assets, explicit service-worker updates, and no frontend build step (`.trellis/spec/frontend/directory-structure.md`).

## Requirements

### R1. Core journey scope

- Redesign both the empty/new-chat state and the active-conversation state in one coherent pass.
- Keep the first signed-in screen as the actual workspace, not a landing or marketing page.
- Preserve all existing chat, navigation, model, route, sync, memory, export, image, branching, feedback, offline, and settings workflows.

### R2. Product hierarchy

- Establish a calm, work-focused hierarchy between sidebar, model/title header, message canvas, and composer.
- Reduce unused or visually disconnected whitespace without making the interface dense or decorative.
- Keep Chatus branding and green accent; use neutral surfaces plus semantic warning/error colors so the palette is not one-note.
- Do not use oversized hero copy, nested cards, decorative gradients/orbs, or explanatory feature marketing.

### R3. New-chat experience

- Keep the personalized greeting and selected-model context concise and visually connected to the composer.
- Present reusable prompt starters as lightweight commands with clear scanning hierarchy and keyboard focus behavior.
- Prompt starters must populate and focus the existing composer; they must not send automatically.

### R4. Active-conversation experience

- Improve differentiation and scanability of user messages, assistant responses, route/fallback metadata, timestamps, and errors.
- Replace text-heavy message action rows with a compact icon toolbar using recognizable Lucide icons and accessible names/tooltips.
- Preserve copy, branch, edit, resend, continue, feedback, regenerate, and retry behavior exactly.
- Make message actions discoverable on touch devices and operable by keyboard; desktop hover may reduce visual noise but cannot be the only access path.

### R5. Shell and composer polish

- Keep model selection, conversation title/status, export, branch-origin, and blank-chat actions in predictable header positions.
- Improve sidebar active state, search, navigation controls, account status, and mobile drawer clarity without changing data behavior.
- Refine the composer as the stable primary action area while preserving attachment, multiline input, draft persistence, send/stop, character state, image constraints, and offline/busy states.
- Replace ad hoc text symbols in primary chat controls with a small local Lucide SVG sprite; do not add a CDN or a frontend framework/build step.

### R6. Responsive and accessible behavior

- Support desktop and mobile viewports without horizontal overflow, clipped controls, incoherent overlap, or unreadable text.
- Preserve semantic buttons, labels, `aria-*` state, visible focus treatment, keyboard model-picker behavior, and reduced-motion handling.
- Ensure touch targets and touch-visible message actions are usable at a 390 px viewport.

### R7. Platform compatibility

- Keep all visual rules in `public/styles.css`; do not add `.style.*` mutations.
- Preserve release placeholders, CSP compatibility, service-worker asset coverage, offline shell behavior, and explicit update activation.
- Never expose or fixture real access codes, API keys, conversation content, or memories during implementation or browser verification.

### R8. Model discovery

- Replace the native route-model `datalist` workflow with an explicit searchable model chooser.
- Opening the chooser must show every fetched model regardless of the current model field value; search text is separate from the selected value.
- Preserve manual model entry for providers that do not expose a compatible model-list endpoint.
- Keep fetched model values in memory only and never persist or log upstream response bodies or credentials.

### R9. Provider-level batch setup

- Let an administrator fetch a provider's models, select multiple models, and create their routes in one operation.
- Generated routes inherit the current provider connection, API Key Ref, interface type, image/key requirements, enabled state, and label without copying plaintext secrets.
- Generate unique, valid route IDs from an editable provider prefix plus each model name; never overwrite an existing route silently.
- Preserve existing explicit user route assignments. Batch setup must not silently grant new models to users whose allowed routes are explicitly restricted.
- Group routes with the same provider label in the signed-in model picker so many models remain scannable.

## Out Of Scope

- Voice input or output.
- Agents, projects, document workspaces, or new navigation domains.
- Executable `/` commands or a skill command palette.
- New sharing modes, backend APIs, storage migrations, or a new persisted provider schema.
- A direct visual copy of Doubao.
- Login or broad admin workspace redesign beyond the route-model workflow.

## Acceptance Criteria

- [x] AC1: New-chat and active-conversation views share one coherent Chatus visual system and are both included in the implementation.
- [x] AC2: The first signed-in viewport has clear workspace hierarchy, a useful new-chat state, and an immediately usable composer.
- [x] AC3: Existing chat, model, attachment, send/stop, branching, edit/resend/regenerate, feedback, settings, memory, export, sidebar, and sync behaviors remain intact.
- [x] AC4: Message actions use accessible Lucide icon controls and remain visibly discoverable on touch layouts without requiring hover.
- [x] AC5: Desktop and 390 px mobile browser checks show no horizontal overflow, clipped controls, incoherent overlap, or illegible text in empty and active conversations.
- [x] AC6: Dark mode, keyboard focus, model-picker navigation, reduced motion, and offline/busy states remain usable.
- [x] AC7: `npm run check:frontend`, `npm test`, `npm run typecheck`, `npx wrangler deploy --dry-run`, and `git diff --check` pass.
- [x] AC8: Changed frontend contracts have focused structural regression assertions, and the Lucide sprite remains release-versioned and service-worker cached.
- [x] AC9: The admin model chooser opens with the complete fetched model list, supports independent search, and preserves manual model entry.
- [x] AC10: Multiple selected models can be saved as unique routes from one provider configuration without duplicating secrets or changing explicit user permissions.
- [x] AC11: The signed-in model picker groups models by provider label, and the conversation reading column plus composer remain comfortably narrower than the full workspace.
