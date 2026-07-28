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
- Typed member policy saves require positive safe-integer quotas, preserve field-level dirty/inheritance intent through revision conflicts, and must not materialize untouched environment defaults. Current-day usage reset clears both legacy KV and Durable Object counters, emits a bounded audit entry, and remains separate from configuration reset.
- The typed member client must never read the legacy raw access-code endpoint. One-time credential screenshots, notices, diagnostics, audit records, and persistent browser state must remain secret-free.
- When rewriting the typed admin shell through Cloudflare Assets, fetch `/react-chat/` rather than `/react-chat/index.html`; the latter may canonicalize with a redirect that loses `/react-chat/admin`.
- A conversation cleanup must remove the pinned AIChat SDK message, resumable-stream, request-context, tool-run, and capability-trust persistence; `persistMessages([])` is not a destructive clear operation.
- GitHub Actions must run `npx wrangler deploy --dry-run --config .wrangler.deploy.jsonc` after tests and before the real deploy. Generated deployment config and secret files must stay ignored, use the same config for dry-run and upload, and be removed in ordinary success/failure cleanup.
- `/healthz` and route status endpoints may inspect bindings, SQLite, KV configuration, and passive real-task telemetry only. They must never send a completion prompt.

## Testing Requirements

- Pure reusable browser helpers receive focused Vitest tests.
- Worker/API behavior receives integration tests using `cloudflare:test`.
- Bug fixes include a regression test or a structural assertion in `scripts/check-frontend.mjs` when browser DOM behavior is impractical to unit test.
- Keep the Cloudflare Vitest pool serial (`maxWorkers: 1`) on Windows. Parallel pool workers can fall back to random Miniflare ports, and Node/undici rejects some random port values as forbidden ports after the test assertions have already passed.
- Browser geometry, focus, overflow, and touch contracts use the Playwright component fixture under `tests/browser/`. Keep that directory excluded from the Cloudflare Vitest pool with `configDefaults.exclude`, and type-check its Node/DOM boundary separately.
- The workspace fixture may import real presentational React components with deterministic synthetic data, but it must not mount Agent hooks, authenticate, call `/api`, open `/agent`, or contact a model. Abort unexpected requests and assert the blocked-request list again in `afterEach` so interactions cannot bypass the guard.
- Real Agent browser acceptance uses its separate `tests/browser/agent-e2e/` config and a local fake provider. Its runner must generate runtime-only credentials, use isolated Wrangler persistence and Playwright output directories, redact credentials from errors, remove temporary state, and expose only bounded non-sensitive provider counters.
- Successful viewport screenshots must be written through `testInfo.outputPath(...)`, attached by path, and retained with `preserveOutput: "always"`. Keep `test-results/` ignored by Git; in-memory attachments alone are not retained by the line reporter for passing tests.
- Before shipping run:

```bash
npm run check:frontend
npm test
npm run test:browser:workspace
npm run test:browser:agent
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
- For Agent-proposed memory writes, prove approval is unconditional, rejection performs no execution, stale revisions preserve the current memory, guest/non-tool routes cannot expose the tool, and the approval trace shows the candidate without revealing provider or MCP credentials.
- For Agent streaming work, prove fallback happens only before visible output, cancellation is forwarded, AI SDK retries are disabled, and integration tests use local fake provider responses only.
- For typed provider-pool administration, verify provider/model drafts preserve sanitized non-UI fields, conflict reset is visible, reliability data is passive and recent-only, secret inputs are empty write-only password fields, and the admin root has no horizontal overflow at 390px, 480px, 780px, and desktop widths.
- For typed member policy administration, verify atomic policy/route/Skill/tool saves, independent inheritance, conflict rebasing, exact usage-reset decoding, dual-store reset plus audit, field-specific accessible errors, and no horizontal overflow at desktop and touch-enabled 390px.
- For typed capability-registry administration, verify rename/delete reference repair, builtin-tool deletion denial, exact decoders, conflict-retained drafts/discovery, byte-exact write-only MCP secrets, changed-schema disablement, roving tabs, destructive focus restoration, and separate editor scrolling at desktop and touch-enabled 390px.
- For React admin safety, verify fail-closed logout, exact `{ ok: true }` decoding, mutually exclusive initial loading/error/ready states, stale-request rejection, retry success, four-list 20/21 pagination, and shared-dialog focus/pending/error/fallback behavior.
- For chat recovery, verify the failed-turn retry creates a resend branch, edit cancellation returns focus to its opener, and incremental output does not override manual transcript scrolling.
- For workspace visual changes, verify the five-view matrix at `1920x1080`, `1440x900`, `780x900`, `480x844`, and touch-enabled `390x844`; inspect retained screenshots in addition to geometry assertions.
