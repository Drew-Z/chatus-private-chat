# Implementation Plan: Typed Provider Pool Administration

## Ordered Slices

### 1. Contract inventory and pure state helpers

- [x] Add typed provider, logical-model, secret-metadata, discovery, and reliability projections to `client/src/lib/api.ts`.
- [x] Add exact decoders and reject secret-bearing/unknown fields.
- [x] Add `client/src/lib/admin-provider.ts` for provider/model draft normalization, reference guards, offering merge, and conflict rebase.
- [x] Add focused client tests for ordering, duplicate providers, legacy projections, secret rejection, discovery envelopes, and reliability no-data states.

### 2. Server read/write boundary

- [x] Add typed-safe provider/reliability projection helpers without changing runtime routing semantics.
- [x] Add `GET /api/admin/reliability` with bounded provider-route passive records and configuration readiness; keep `/api/admin/route-health` unchanged.
- [x] Preserve existing config revision behavior, route-secret revisions, audit events, and legacy endpoint compatibility.
- [x] Add Worker tests for admin auth/origin, no model calls, pair-level reliability, stale config/secret revisions, redaction, and malformed payloads.

### 3. Provider and logical-model panels

- [x] Extract provider inventory editing into `ProviderAdminPanel.tsx` with enabled/protocol/endpoint/capacity/priority/capability controls.
- [x] Add write-only credential controls using route-secret metadata and clear inputs after save/close.
- [x] Add provider-scoped discovery, bounded search, multi-select, and explicit offering creation.
- [x] Add `LogicalModelAdminPanel.tsx` with ordered offerings, fallback validation, duplicate/missing-provider errors, disable/delete guards, and legacy migration.
- [x] Keep member assignment view intact and route all mutations through shared revision/conflict helpers.

### 4. Reliability view and responsive polish

- [x] Add `ReliabilityAdminPanel.tsx` with passive status, credential readiness, capacity, outcome, latency, observed time, fallback evidence, and unknown state.
- [x] Add typed admin navigation and preserve the full legacy-admin rollback link.
- [x] Add CSS for dense scan-friendly tables/forms, focus-visible controls, stable buttons, discovery dialog, and 390px no-overflow behavior.
- [x] Run local browser acceptance with generated admin/member fixtures and no live model call.

### 5. Release verification

- [x] Run `npm run check:frontend`.
- [x] Run focused client/Worker tests, then `npm test`.
- [x] Run `npm run typecheck`.
- [x] Run `npx wrangler deploy --dry-run`.
- [x] Run `git diff --check`.
- [x] Review secret-free network payloads and legacy rollback navigation at desktop, 780px, 480px, and 390px widths.
- [x] Update frontend/admin specs and this checkpoint before the child commit.

## Risky Files And Boundaries

- `src/worker.ts`: admin routing and projections; preserve existing route health/discovery behavior and avoid model calls.
- `src/contracts/provider.ts`: runtime contract is shared; prefer additive client/admin projections over changing provider routing semantics.
- `client/src/components/AdminWorkspace.tsx`: extract rather than grow the existing member editor into a monolith.
- `client/src/lib/api.ts`: exact decoders are a security boundary; never weaken sanitized config checks.
- `client/src/styles.css`: keep mobile admin controls within the viewport and preserve existing chat styles.
- `tests/worker-api.test.ts`, `tests/client-api.test.ts`, `tests/client-admin-config.test.ts`: extend existing fixtures; do not add live credentials.

## Rollback

- Revert the child commit to restore the existing typed member admin and legacy `/admin.html` provider workflow.
- Do not delete or rewrite provider/config KV records. The new UI uses the existing schema and revision fence, so rollback is code-only.
- Keep model discovery and reliability endpoints additive; removing them must not affect chat routing.

## Start Gate

Before `task.py start`, verify that `prd.md`, `design.md`, and this file have been reviewed, that remaining open questions are not implementation blockers, and that the user explicitly approves entering implementation.

## Completion Checkpoint (2026-07-25)

- Shared draft helpers now preserve sanitized provider auth metadata and logical-route limits, temperature, and user-key policy during ordinary saves.
- Pool navigation explicitly discards unmounted local drafts after confirmation; config conflicts retain the local draft and expose a server-version reset.
- `/api/admin/reliability` ignores provider-route records outside the seven-day recent window, while `/api/admin/route-health` remains unchanged.
- Provider and logical-model ID collisions are blocked before rename, offering capability overrides support inherit/true/false states, and write-only secret inputs are cleared and disabled until the saved provider/ref boundary is current.
- Failed turns now expose a resend-branch retry action, transcript auto-scroll respects manual upward scrolling, and message edit cancellation restores focus to its originating control.
- Validation: `npm run check:frontend`, `npm test` (20 files / 246 tests), `npm run typecheck`, `npx wrangler deploy --dry-run`, and `git diff --check` all pass.
- Browser QA used a local Wrangler fixture only; 1440px, 780px, 480px, and 390px viewports had no document-level horizontal overflow, password inputs stayed empty, and Tab focus reached native controls.
