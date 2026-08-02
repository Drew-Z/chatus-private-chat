# Implementation Plan: React Admin Migration and Legacy Admin Retirement

## Ordered Checklist

- [x] Add pure legacy-route classification and migration helpers with deterministic Provider ID allocation and all-or-nothing result types.
- [x] Add credential preflight that excludes inline route keys while accepting managed/Worker references and explicit BYOK; keep diagnostics bounded and redacted.
- [x] Add authenticated, revision-checked `POST /api/admin/legacy-routes/migrate`, config validation, one-write persistence and bounded audit evidence.
- [x] Add Worker tests for authorization, conflict, atomic failure, collision, idempotence, secret/header redaction and cross-reference preservation.
- [x] Add typed client API decoding and Provider-panel migration inventory/action with `ConfirmDialog`, shared snapshot refresh and conflict/session recovery.
- [x] Remove the client-only legacy migration draft path and add pure/client/browser tests for migrated and blocked states.
- [x] Verify provider-plan/chat fixtures resolve the migrated Provider + Offering with the same route ID and behavior.
- [x] Remove `public/admin.html`, `public/admin.js`, `public/admin-report.js`, their unit/structure assertions, service-worker cache entries and deployment fingerprint inputs.
- [x] Add exact `/admin.html` permanent redirect coverage and verify the old UI/assets are no longer served.
- [x] Update README, self-hosting and operations docs to the React admin path and safe migration recovery flow; record retirement of raw JSON reset and CSV export.
- [x] Fix streaming near-bottom auto-scroll and legacy image keyboard semantics; add desktop/390px/direct-entry Playwright coverage.
- [x] Measure the admin bundle compressed transfer; record that no startup-CPU budget or A/B evidence exists and do not split without that decision boundary.
- [x] Run focused tests, then the full shipping gate and Trellis consistency checks.
- [ ] Update frontend/platform specs, commit in reviewable batches, open a PR, retain CI artifacts, merge and deploy only through GitHub Actions.
- [ ] Record exact main SHA deployment and user acceptance of both React admin access and production legacy-route migration before archive.

## Validation Commands

```text
npx vitest run tests/client-provider-admin.test.ts tests/client-api.test.ts tests/worker-api.test.ts tests/provider-router.test.ts
npm run check:frontend
npm test
npm run test:browser:workspace
npm run test:browser:agent
npm run typecheck
npx wrangler deploy --dry-run
git diff --check
python ./.trellis/scripts/task.py validate-all
python -m unittest discover -s .trellis/tests -p test_*.py -v
```

## Risky Files And Rollback Points

- `src/worker.ts`: migration must preflight every route before the single KV write; no partial write or secret-bearing audit.
- `client/src/lib/admin-provider.ts`: remove the browser-only migration authority only after the server API and tests exist.
- `public/admin.*`, `public/sw.js`, `scripts/check-frontend.mjs`, `.github/workflows/deploy.yml`: retire atomically so build/deploy checks do not reference deleted assets.
- `src/services/provider-router.ts`: retain compatibility code in this task; removal requires a later zero-legacy production census.
- Production config migration is irreversible as a route-shadow deletion but remains representable by Provider + Offering. Block rather than guess when credential safety cannot be proven.

## Review Gates

- No plaintext credential or custom header crosses the Worker/browser boundary.
- Mixed-safe/unsafe migration batches perform zero writes.
- Route IDs and all permission/fallback/default/public references remain byte-for-byte stable.
- `/admin.html` cannot render the old UI, while `/legacy/` chat remains available.
- No live Provider/MCP request or local production deployment is used for validation.
