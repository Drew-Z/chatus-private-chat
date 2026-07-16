# Implementation Plan

- [x] Fix the product positioning as an invitation-only general private work Agent, with programming/project collaboration as the first bundled capability pack.
- [x] Retrieve and pin current official Cloudflare Agents SDK, Durable Objects, Workers, MCP, and client guidance before implementation; record API/version decisions in `research/cloudflare-agents-sdk.md`.
- [x] Audit `src/worker.ts`, `public/`, tests, KV keys, Durable Object schema, secrets, and CI; record the capability disposition and migration risks in `research/current-runtime-audit.md`.
- [ ] Introduce module boundaries for gateway/auth, user Agent, provider routing, capability registry, tools/MCP, administration, persistence, telemetry, and shared contracts.
- [ ] Add the Cloudflare Agents SDK binding and per-user Agent identity with deterministic state and migration fixtures.
- [ ] Migrate conversations, structured long-term memory, quotas, feedback, and run metadata into the Agent-owned durable model without exposing secrets.
- [ ] Extract OpenAI-compatible and Anthropic-compatible adapters, route selection, retry classification, fallback, BYOK, and redacted provider diagnostics behind the provider router.
- [ ] Rebuild Skill selection, bounded tool loops, confirmations, built-in tools, and MCP execution around the Agent capability allow-list.
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
- [ ] Extract shared contracts, provider routing, secret resolution, fallback classification, telemetry, Skills, tools, and MCP into explicit modules.
- [ ] Execute normal Agent turns through AI SDK providers while preserving route assignment, BYOK, quota, bounded tool loops, and approval policy.
- [ ] Add idempotent legacy conversation and memory import fixtures without deleting legacy storage.

### Slice 3: Typed Product Client

- [ ] Add a Vite/React application using `useAgent` and `useAgentChat`.
- [ ] Implement chat, resumable streams, history, memory, approvals, traces, route state, offline/degraded states, and mobile/PWA behavior.
- [ ] Rebuild administration as typed components over the existing revisioned HTTP administration boundary.
- [ ] Update asset release fingerprinting and service-worker caching for Vite output.

### Slice 4: Removal And Product Closure

- [ ] Remove the custom chat SSE/tool-approval protocol after the Agent client passes migration acceptance.
- [ ] Remove legacy chat storage only after deterministic and production migration verification.
- [ ] Add optional read-only BIAU MCP integration, disabled by default, after standalone acceptance.
- [ ] Complete installation, operations, backup, migration, rollback, English README, and Chinese README documentation.
- [ ] Run the full release gate and record remaining production-only manual actions.

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
