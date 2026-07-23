# Implementation Plan

- [x] Fix the product positioning as an invitation-only general private work Agent, with programming/project collaboration as the first bundled capability pack.
- [x] Retrieve and pin current official Cloudflare Agents SDK, Durable Objects, Workers, MCP, and client guidance before implementation; record API/version decisions in `research/cloudflare-agents-sdk.md`.
- [x] Audit `src/worker.ts`, `public/`, tests, KV keys, Durable Object schema, secrets, and CI; record the capability disposition and migration risks in `research/current-runtime-audit.md`.
- [ ] Introduce module boundaries for gateway/auth, user Agent, provider routing, capability registry, tools/MCP, administration, persistence, telemetry, and shared contracts.
- [x] Add the Cloudflare Agents SDK binding and per-user Agent identity with deterministic state and migration fixtures.
- [ ] Migrate conversations, structured long-term memory, quotas, feedback, and run metadata into the Agent-owned durable model without exposing secrets.
- [ ] Extract OpenAI-compatible and Anthropic-compatible adapters, route selection, retry classification, fallback, BYOK, and redacted provider diagnostics behind the provider router.
- [x] Rebuild Skill selection, bounded tool loops, confirmations, built-in tools, and MCP execution around the Agent capability allow-list.
- [x] Remove scheduled/automatic completion probes, remove the production cron dependency, keep model-free `/healthz`, and add passive real-task reliability aggregation.
- [ ] Rebuild teammate administration for access, assignments, routes, secret references, quotas, Skills, tools, MCP, audit, sessions, data export, and user deletion.
- [ ] Replace the handwritten static application/admin monolith with a typed Vite/React client using the supported Agents SDK client transport and resumable streaming pattern.
- [ ] Implement focused desktop/mobile/PWA states for sign-in, chat, history, memory, capability inspection, tool approval, traces, degraded/offline behavior, and actionable provider errors.
- [ ] Add optional read-only BIAU MCP integration only after the standalone Agent product passes; keep it disabled by default.
- [ ] Rewrite README, Chinese usage/deployment guidance, operations runbook, `.env.example`, secret setup, backup/migration, and rollback documentation for clean third-party installation.
- [x] Review the implementation direction and receive explicit user approval to modify Chatus under its independent Trellis task.

## Ordered Implementation Slices

### Slice 1: Runtime And Passive Reliability

- [x] Install the pinned compatible Agents SDK, AI Chat, AI SDK 6, provider, React, and Vite runtime set.
- [x] Add `TEAM_AGENT`, its SQLite migration, authenticated routing, and an opaque per-user instance projection.
- [x] Add a minimal `TeamAgent` runtime with persistence sanitization and model-free readiness methods.
- [x] Remove the production cron and active route completion checks.
- [x] Replace route health records with configuration readiness and redacted real-task telemetry.
- [x] Add deterministic tests proving Agent isolation and zero model calls from health/diagnostic paths.

### Slice 2: Provider And Capability Services

- [x] Extract Agent contracts and passive route reliability into focused modules with storage validation and classification tests.
- [x] Extract chat/session/provider contracts plus route planning, credential precedence, and fallback eligibility into a provider-router boundary.
- [x] Add tested OpenAI-compatible and Anthropic-compatible AI SDK model adapters and migrate non-streaming completion calls onto them.
- [x] Move normal TeamAgent text turns to `streamText().toUIMessageStreamResponse()` with resumable recovery and pre-output-only route fallback.
- [x] Extract shared capability contracts and the assignment/Skill/tool registry so legacy and Agent paths consume one visibility and approval-policy boundary.
- [x] Add revisioned per-member Skill allow-lists across administration, session projection, legacy chat, and Team Agent execution with backward-compatible defaults.
- [x] Execute assigned built-in and reviewed MCP tools through AI SDK `streamText`, with bounded calls, continuation-safe approval messages, Agent-owned trust, and quota-once continuation handling.
- [ ] Extract shared contracts, provider routing, secret resolution, fallback classification, telemetry, Skills, tools, and MCP into explicit modules.
- [x] Execute normal Agent turns through AI SDK providers while preserving route assignment, BYOK, quota, bounded tool loops, and approval policy.
- [x] Add idempotent legacy conversation and memory import fixtures without deleting legacy storage.
- [x] Add a per-member root Agent index plus server-derived per-`chatId` conversation Agents, with idempotent legacy transcript import and revision-safe Agent memory.
- [x] Separate logical models from provider instances while preserving legacy route configuration as an implicit one-provider model.
- [x] Add ordered model offerings with administrator priority and passive logical-model/provider quality tie-breaking.
- [x] Add a provider-scoped Durable Object coordinator for exclusive/bounded leases, a shared 10-second all-busy wait, cancellation, TTL recovery, and alarm cleanup.
- [x] Apply provider leases to Agent streaming, legacy streaming, capability/tool loops, and small model tasks without allowing post-output fallback.
- [x] Move provider credential entry and model discovery to provider-level administration so one encrypted key and endpoint can serve many selected models.
- [x] Add deterministic provider-pool, lease concurrency, cancellation, expiry, configuration migration, and browser contract tests.

### Slice 3: Typed Product Client

- [x] Add an isolated Vite/React application using authenticated `useAgent` and `useAgentChat`, with resumable text streaming, connection state, approvals, and explicit stop behavior at `/react-chat/`.
- [x] Implement chat, resumable streams, history, memory, approvals, traces, route state, offline/degraded states, and mobile/PWA behavior.
- [x] Add the authenticated typed administrator shell for default/member Skill and tool assignment, with strict response validation, revision-conflict draft retention, secret-free member/config projections, and an explicit link to the remaining legacy administration sections.
- [x] Add typed default/member route assignment with independent inheritance, all-versus-explicit route semantics, disabled-route cleanup, default-route invariants, and conflict-safe draft rebasing.
- [x] Add typed member create/issue/rotate/revoke access flows with mandatory access revisions, server-generated one-time credentials, session invalidation, last-entry protection, secret-exact client decoders, and responsive accessible dialogs.
- [x] Add separate typed member configuration reset and all-session revocation flows with configuration revisions, secret-safe responses, dirty-draft preservation, and explicit non-data-destructive confirmation copy.
- [x] Add typed teammate export, all-device session revocation, and personal-data deletion controls with authenticated bounded export envelopes, strict client validation, draft cleanup, and accessible mobile/account dialogs.
- [x] Remove the production `ACCESS_CODES` GitHub Secret dependency; use an explicit managed-access bootstrap mode with KV-created one-time credentials and model-free health readiness before the first member exists.
- [ ] Rebuild administration as typed components over the existing revisioned HTTP administration boundary.
- [x] Update asset release fingerprinting and service-worker caching for Vite output.

### Final Product Hardening

- [x] Make root Agent SQLite the authoritative memory source for Agent, legacy, and administrator APIs while retaining KV only as an import/rollback record.
- [x] Synchronize post-migration legacy chat writes through prefix-safe Agent import without allowing divergent snapshots to overwrite Agent transcripts.
- [x] Preserve deleted conversation tombstones, reject stale reconnect/recreate attempts, and persist bounded transcript-cleanup retries.
- [x] Clear pinned AIChat transcript, stream, request, and tool persistence on deletion, and rotate failed cleanup retries so later records are not starved.
- [x] Prevent logout during active resumable runs; preserve rejected send drafts and conflicted memory drafts.
- [x] Sanitize source URLs and implement memory-drawer initial focus, Tab containment, Escape handling, and focus restoration.
- [x] Fall back to isolated cached navigation shells on network failure and HTTP `404`/`5xx` without masking authentication or rate-limit responses.

### Slice 4: Removal And Product Closure

- [ ] Remove the custom chat SSE/tool-approval protocol after the Agent client passes migration acceptance.
- [ ] Remove legacy chat storage only after deterministic and production migration verification.
- [ ] Add optional read-only BIAU MCP integration, disabled by default, after standalone acceptance.
- [ ] Complete installation, operations, backup, migration, rollback, English README, and Chinese README documentation.
- [x] Add a manual GitHub Actions production-member acceptance workflow with revision-safe temporary access-code cleanup and no model calls.
- [x] Run the full release gate and record remaining production-only manual actions.
- [x] Parameterize third-party Worker/KV/domain identity through GitHub Variables, add deployment/Secret preflight, and remove maintainer production identifiers from the repository.

## Verification Record

- 2026-07-17: `npm run check:frontend` passed; Vite reported only the known oversized-chunk warning.
- 2026-07-17: `npm test` passed with 14 files and 127 tests.
- 2026-07-17: `npm run typecheck`, `npx wrangler deploy --dry-run`, and `git diff --check` passed.
- 2026-07-20: Local Wrangler acceptance passed with two generated members, per-member Agent/WebSocket isolation, conversation/memory conflicts, tombstones, user-data deletion, and exact access-code restoration. Production acceptance remains a manual post-deployment Actions step.
- 2026-07-21: GitHub Actions run `29799778848` passed authenticated production acceptance for commit `b3ecfc5`, including temporary-member cleanup and access-code configuration restoration.
- 2026-07-21: Per-member Skill assignment passed frontend checks, 14 test files / 129 tests, strict type-check, Wrangler deployment dry-run, and diff checks. Revoked persisted Skill selections are filtered again by both chat execution paths.
- 2026-07-21: Third-party instance generation and deployment preflight passed 15 test files / 155 tests, strict type-check, frontend checks, generic and generated-config Wrangler dry-runs, and diff checks. Production identifiers are supplied only by GitHub Variables; no production deployment was run.
- 2026-07-23: Logical model/provider pool routing, provider-wide leases, passive pair-level quality ordering, provider administration/model discovery, legacy migration, and documentation passed frontend checks, 17 test files / 178 tests, strict type-check, Wrangler deployment dry-run, and diff checks. The known Vite oversized-chunk warning remains non-fatal.
- 2026-07-23: Admin configuration no longer echoes legacy plaintext keys; safe legacy credential migration, legacy SSE preflight/error lifecycle, provider-ID hardening, and saved-provider-only model discovery passed frontend checks, 17 test files / 185 tests, strict type-check, Wrangler deployment dry-run, and diff checks. The known Vite oversized-chunk and dependency sourcemap warnings remain non-fatal.
- 2026-07-23 (continuation): Provider coordinator restart normalization now removes malformed/expired and duplicate lease records before rewriting storage, and duplicate queued request IDs share one waiter; authenticated state-changing API requests reject mismatched Origin headers; the typed React session contract and settings sidebar expose only assigned tools with current Skill/route activation state. Full release gates passed with 17 test files / 191 tests, frontend structure checks, strict type-check, Wrangler deployment dry-run, and diff checks. Known Vite oversized-chunk and dependency sourcemap warnings remain non-fatal.
- 2026-07-23 (typed admin): `/react-chat/admin` now provides authenticated, revision-checked default/member Skill and tool assignment while `/admin.html` remains the full legacy administration surface. Admin config responses strip legacy keys and custom header values while preserving explicit shadows for safe round-trips. `npm run check:frontend`, 18 test files / 198 tests, strict type-check, Wrangler deployment dry-run, and `git diff --check` passed. Known Vite oversized-chunk and dependency sourcemap warnings remain non-fatal.
- 2026-07-23 (provider fallback correction): Fallback planning now retains distinct logical-route/provider pairs, allowing a different upstream model on the same provider after a pre-output failure; lease selection deduplicates provider waiters only within one availability round. Full gates passed with 18 test files / 200 tests, frontend structure checks, strict type-check, Wrangler deployment dry-run, and diff checks. Known Vite oversized-chunk and dependency sourcemap warnings remain non-fatal.
- 2026-07-23 (typed member routes): `/react-chat/admin` now edits member/default `defaultRoute` and `allowedRoutes` beside Skills/tools in one revisioned draft. Empty route arrays retain their backend all-routes meaning, explicit full lists remain closed to future routes, disabled references can be removed, and conflict rebasing preserves local intent over the latest unrelated fields. Desktop 1440x900 and mobile 390x844 browser checks had no horizontal overflow. Full gates passed with 18 test files / 209 tests, frontend structure checks, strict type-check, Wrangler deployment dry-run, and diff checks. Known Vite oversized-chunk and dependency sourcemap warnings remain non-fatal.
- 2026-07-23 (typed member lifecycle): `/react-chat/admin` now creates invitations, issues or rotates a member access code, and revokes login access without deleting configuration or user data. Mutations require the current access revision, credentials are generated and returned once by the Worker, rotate/revoke invalidate sessions, and the final access entry is protected from Secret fallback. Exact client decoders reject secret-bearing list/revoke payloads. Real local-Worker browser acceptance at 1440x900 and 390x844 found no horizontal overflow, confirmed credential DOM cleanup after close, and exposed/fixed the Cloudflare Assets `index.html` canonical redirect that dropped the admin path. Full gates passed with 19 test files / 216 tests, strict type-check, Wrangler deployment dry-run, and diff checks; final frontend structure verification followed the spec update. Known Vite oversized-chunk and dependency sourcemap warnings remain non-fatal.
- 2026-07-23 (typed member config/session closure): Full release gates passed after the separate member configuration reset and all-session revocation slice: frontend structure checks, 19 test files / 218 tests, strict type-check, Wrangler deployment dry-run, and `git diff --check`. A Playwright acceptance using strict same-origin admin API fixtures passed at 1440x900 and 390x844: action rows and both confirmation dialogs stayed within the viewport with no horizontal overflow; Escape closed the session dialog and restored focus; config reset and session revocation notices rendered independently. Known Vite oversized-chunk and dependency sourcemap warnings remain non-fatal. No live model call or production deployment was used.
- 2026-07-23 (typed user data closure): User settings now expose bounded personal-data export, all-device session revocation, and destructive data clearing. Export reads conversations sequentially, caps the attachment at 5 MB and each conversation at 512 KB, omits credentials/raw tool payloads/file URLs, and marks truncation explicitly; the typed client rejects malformed or secret-bearing envelopes before download. Account locks cover the header, composer, memory entry, and sidebar while mutations run. Playwright fixture acceptance passed at 1440x900 and 390x844 with no horizontal overflow, mobile drawer focus trapping/Escape restoration, account-dialog focus restoration, and a correctly named JSON download. Final gates passed: `npm run check:frontend`, 19 test files / 224 tests, `npm run typecheck`, `npx wrangler deploy --dry-run`, and `git diff --check`; only the known Vite oversized-chunk, plugin timing, and dependency sourcemap warnings remain non-fatal.
- 2026-07-23 (managed access bootstrap): Production deployment no longer consumes the GitHub `ACCESS_CODES` Secret. Generated configs set `ACCESS_CODES_MODE=managed`, the Worker ignores legacy environment access codes in that mode, `/healthz` remains ready while member access is empty and reports `memberAccessConfigured=false`, and the first member can be created through the revisioned typed admin endpoint. Deployment, Worker, client-decoder, and production-acceptance contracts were updated for the `managed` source. Final gates passed with frontend structure checks, 19 test files / 228 tests, strict type-check, default and generated-config Wrangler deployment dry-runs, and `git diff --check`; the generated Secret file contained no `ACCESS_CODES`. A fresh local managed-mode Worker also passed the full no-model production-member acceptance and restored the empty `managed` source during cleanup. Known Vite chunk/plugin timing and dependency sourcemap warnings remain non-fatal.
- No local production deployment was run. Production remains gated by commit/push, GitHub Actions deployment, and the production smoke step.

## Validation

```powershell
npm.cmd run check:frontend
npm.cmd test
npm.cmd run typecheck
npx.cmd wrangler deploy --dry-run
git diff --check
```

Additional focused tests must cover:

- access-code and admin authentication boundaries
- per-user Agent and data isolation
- state migration and rollback fixtures
- route assignment, fallback classification, BYOK, quotas, and passive telemetry
- memory proposal, edit, export, deletion, and session revocation
- Skill selection, tool schemas, approval, limits, and MCP security
- streaming interruption, reconnect/resume, duplicate submission, and idempotency
- responsive client states and frontend/backend contract drift
- proof that `/healthz`, test suites, builds, and diagnostics do not call a model

## Release Rules

- Do not run a local production `wrangler deploy`.
- Do not force-push or rewrite the four existing local commits.
- Do not print, copy into task files, or commit access codes, tokens, provider keys, MCP secrets, memories, or conversation content.
- Commit Chatus separately from BIAU; production release occurs only through its GitHub Actions workflow after the exact commit passes checks.
- Do not modify, format, generate, stage, or clean `D:\workspace4Cursor\learn\duoduo`.

## Rollback Points

- Keep the current Worker revision deployable until the new Agent runtime passes production acceptance.
- Keep pre-migration KV and Durable Object data untouched until imported records are verified.
- Make migrations idempotent and versioned; a failed migration must not partially switch a user's active runtime.
- Remove old routes, static assets, cron configuration, and storage records only after the replacement path is accepted.
