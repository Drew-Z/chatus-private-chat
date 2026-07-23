# Quality Guidelines

## Overview

Quality is enforced through executable frontend structure checks, Vitest Worker tests, strict TypeScript, deployment packaging validation, and security/privacy review.

## Forbidden Patterns

- Never print, commit, export, or include access codes, API keys, conversation content, or stored memories in diagnostics.
- Do not add inline style mutation to `app.js`, `admin.js`, or `theme.js`.
- Do not deploy production from a local Wrangler account; production uses GitHub Actions.
- Do not silently overwrite newer cloud/config/memory state.
- Do not render untrusted Markdown links or `source-url` parts without the shared protocol sanitizer.

## Required Patterns

- Preserve release placeholders in HTML and versioned ES module imports.
- Keep service-worker updates explicit: install does not immediately activate; the page sends `SKIP_WAITING` after user-visible release detection.
- Navigation responses with HTTP `404` or `5xx` may fall back to the matching cached shell. Missing caches preserve the original HTTP response, and `401`/`403`/`429` must never be hidden by an offline shell.
- Protect destructive and concurrent operations with confirmation, undo where available, and revision/version preconditions.
- Reject a present cross-origin `Origin` header on every state-changing API request before authentication dispatch, body parsing, or storage mutation; trusted non-browser callers may omit the header.
- Keep diagnostics operational and non-sensitive.
- Preserve keyboard focus indicators and reduced-motion behavior.
- Keep `nodejs_compat` enabled while the pinned Cloudflare Agents SDK dependency graph imports Node built-ins; `wrangler deploy --dry-run` is the executable guard for this contract.
- Do not rebuild a WebSocket upgrade `Response` to add ordinary headers. Return Agent upgrade responses unchanged so the Cloudflare `webSocket` handle survives.
- Keep deleted conversation tombstones authoritative, persist transcript-cleanup retries across requests, and rotate failed records behind unattempted cleanup work.
- Member access mutations require the current access revision, generate credentials server-side, revoke label sessions on rotate/revoke, and preserve a last-entry lockout guard. In legacy mode that guard also prevents an empty KV override from falling back to the deployment Secret; managed mode ignores the environment value and reports an empty `managed` source until the first member is created.
- Member configuration removal requires the current config revision and must leave access codes, sessions, conversations, memory, usage, and provider secrets untouched. Standalone session revocation reports incomplete cleanup instead of claiming success.
- The typed member client must never read the legacy raw access-code endpoint. One-time credential screenshots, notices, diagnostics, audit records, and persistent browser state must remain secret-free.
- When rewriting the typed admin shell through Cloudflare Assets, fetch `/react-chat/` rather than `/react-chat/index.html`; the latter may canonicalize with a redirect that loses `/react-chat/admin`.
- A conversation cleanup must remove the pinned AIChat SDK message, resumable-stream, request-context, tool-run, and capability-trust persistence; `persistMessages([])` is not a destructive clear operation.
- GitHub Actions must run `npx wrangler deploy --dry-run` after tests and before preparing production secrets or starting the real deploy.
- `/healthz` and route status endpoints may inspect bindings, SQLite, KV configuration, and passive real-task telemetry only. They must never send a completion prompt.

## Testing Requirements

- Pure reusable browser helpers receive focused Vitest tests.
- Worker/API behavior receives integration tests using `cloudflare:test`.
- Bug fixes include a regression test or a structural assertion in `scripts/check-frontend.mjs` when browser DOM behavior is impractical to unit test.
- Before shipping run:

```bash
npm run check:frontend
npm test
npm run typecheck
npx wrangler deploy --dry-run
git diff --check
```

- Run `npm run check:frontend` before `npm test`, not concurrently. The Vite build replaces generated files under `public/react-chat/` while Worker asset tests read that directory; parallel execution can create transient legacy-shell or missing-fingerprinted-asset failures.

## Code Review Checklist

- Does every queried ID exist in the paired HTML and remain unique?
- Are assets present, release-versioned, and included in the service-worker shell when required?
- Are async results associated with the correct user/session/chat?
- Are conflict, retry, cancellation, and rate-limit paths visible to the user?
- Does exported or diagnostic data exclude secrets and private content?
- Are writes protected against stale revisions?
- Are accessibility behavior and mobile/keyboard paths preserved?
- For capability work, test the legacy provider stream and `capability-v1` stream separately; verify completed, failed, pending-confirmation, and stale-confirmation states on desktop and 390px touch layouts.
- For Agent runtime work, prove the Wrangler binding/export package, per-member instance isolation, unauthenticated/cross-origin denial, and zero provider calls from infrastructure or route diagnostics.
- For Agent persistence work, prove legacy/Agent memory API consistency, post-migration legacy import, tombstone rejection, and persisted transcript-cleanup retry.
- For Agent streaming work, prove fallback happens only before visible output, cancellation is forwarded, AI SDK retries are disabled, and integration tests use local fake provider responses only.
