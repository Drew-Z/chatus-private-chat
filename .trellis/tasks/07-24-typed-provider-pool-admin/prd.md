# Typed Provider Pool Administration

## Goal

Make the typed React administrator the primary workflow for the existing provider pool. An administrator must be able to manage provider instances, logical models, ordered offerings, model discovery, credentials, and passive reliability without copying credentials between model rows or exposing secret material to the browser.

## Confirmed Repository Facts

- `src/contracts/provider.ts` already separates `ProviderConfig`, `RouteConfig`, and `ModelOffering`; one provider can serve many logical routes and one route can have multiple providers.
- `PUT /api/admin/config` already has a revision fence and returns a sanitized configuration projection. It preserves hidden legacy keys only when the submitted projection explicitly retains the corresponding shadow.
- `GET/PUT/DELETE /api/admin/route-secrets` exposes only credential metadata and write/delete operations; plaintext values are never returned.
- `POST /api/admin/route-models` performs provider-scoped model discovery through a saved provider credential and returns normalized model IDs.
- `GET /api/admin/route-health` is model-free and currently exposes route-level readiness plus recent real-task reliability. Provider-route reliability is already stored by `src/services/route-reliability.ts`, but it is not yet projected to typed administration.
- `client/src/components/AdminWorkspace.tsx` currently owns member access, route assignment, Skills, tools, revisions, conflicts, and responsive navigation. `/admin.html` remains the complete legacy rollback surface.

## Requirements

### R1. Typed administrator navigation

- Add explicit `Member Access`, `Providers`, `Logical Models`, and `Reliability` views inside `/react-chat/admin`.
- Keep `/admin.html` linked as a rollback surface until this task's browser acceptance passes.
- Preserve the current admin session, logout, refresh, dirty-draft warning, and mobile layout behavior.

### R2. Provider inventory

- List and edit provider ID, label, protocol, Base URL, enabled state, direct-endpoint mode, image/tool capability flags, user-key policy, concurrency mode, bounded capacity, all-busy timeout, and administrator priority.
- Show API Key Ref and credential readiness/status only. Credential entry is write-only; a saved key can never be read back into React state, logs, exports, or response bodies.
- Use the existing revisioned configuration boundary. A stale revision retains the local draft and offers an explicit server-version reset/rebase path.
- Prevent deletion while a provider is referenced by a logical model, with a clear reference list.

### R3. Logical model catalog

- List and edit logical model ID, teammate-facing label, enabled state, fallback logical model IDs, image/tool capability flags, and ordered provider offerings.
- Each offering contains one existing provider ID, one upstream model ID, enabled state, and optional offering priority/capability overrides.
- Reject duplicate providers in one logical model and reject references to missing providers before save.
- Keep member route assignment expressed in logical model IDs; provider IDs and upstream model IDs remain administrator-only.
- Provide an explicit legacy-route migration action that creates a provider and offering without deleting the legacy source until the administrator saves and accepts the result.

### R4. Provider-scoped discovery

- Allow discovery only for a selected, saved provider; never send a credential from the browser.
- Present normalized model IDs with search and multi-select, then explicitly add selected IDs as offerings to a chosen logical model.
- Discovery must not change member permissions, silently overwrite existing offerings, or persist a model that the administrator did not select.
- Return actionable, redacted upstream errors and never render response bodies containing credential material.

### R5. Passive reliability

- Show configuration readiness, provider credential status, capacity policy, recent outcome, attempts, success count, average latency, last observed time, fallback evidence, and unknown/no-data state for each logical-model/provider pair.
- Reliability reads must use stored real-task records only. No button or page load may send a synthetic model request.
- Distinguish provider capacity/configuration state from recent upstream outcome; unknown is not unhealthy.
- Do not display prompts, completions, raw upstream payloads, API keys, or internal secret references beyond the configured reference label.

### R6. Contracts and privacy

- Add exact client decoders for provider, logical-model, discovery, secret metadata, and reliability projections. Reject extra secret-bearing fields.
- Keep config revision and secret revision separate. A config conflict must not overwrite a local draft; a secret conflict must not echo the submitted secret.
- Preserve existing origin checks, admin session checks, audit entries, and legacy config migration behavior.

## Acceptance Criteria

- [x] `/react-chat/admin` has working typed navigation for member access, providers, logical models, and reliability at desktop and 390px widths.
- [x] An administrator can update one provider and reuse it across at least two logical models without duplicating credentials or changing member assignments.
- [x] An administrator can order multiple offerings for one logical model, disable one offering, and save/rebase through a revision conflict without losing local intent.
- [x] Model discovery is provider-scoped, selection-based, repeatable, and secret-free; an existing offering is not duplicated.
- [x] Reliability shows provider-route passive records and capacity/readiness without making a model call; no-data is rendered as unknown.
- [x] Secret-bearing response fields, malformed provider IDs, invalid URLs, invalid capacity, duplicate offerings, missing providers, and stale revisions are rejected by server and client tests.
- [x] Legacy `/admin.html` remains available and its existing route/provider workflows continue to pass their tests.
- [x] Browser acceptance confirms keyboard access, focus-visible controls, no horizontal overflow, stable mobile scrolling, and no disclosure of credentials or raw provider responses.
- [x] `npm run check:frontend`, `npm test`, `npm run typecheck`, `npx wrangler deploy --dry-run`, and `git diff --check` pass without live model calls.

## Out Of Scope

- Replacing or deleting the legacy administrator in this slice.
- Changing provider routing order, lease semantics, quota behavior, or fallback-after-output rules.
- Active health probes, arbitrary completion prompts, or tests against live providers.
- Exposing raw custom headers, encrypted records, provider credentials, prompts, completions, or another user's assignments.
- BIAU MCP integration and general documentation rewrite.

## Planning Decisions

- Reuse the existing atomic `/api/admin/config` revision boundary for provider and logical-model mutations instead of introducing competing persistence formats.
- Add narrow read/write wrappers for secret metadata, model discovery, and provider-route reliability; keep the legacy endpoints as compatibility contracts.
- Keep the typed provider editor split into focused components and pure draft helpers rather than expanding `AdminWorkspace.tsx` into another monolith.
