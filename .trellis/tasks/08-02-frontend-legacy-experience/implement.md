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
- [x] Measure the admin bundle and record the decision. Current output is 895.86 KB minified / 249.09 KB gzip JS and 70.90 KB / 12.54 KB gzip CSS; no reviewed transfer or startup CPU threshold proves an admin split would improve this release, so no speculative split is added.
- [x] Run focused tests, then the full shipping gate and Trellis consistency checks.
- [x] Update frontend/platform specs for migration, provider-plan, redirect, accessibility, and delivery contracts.
- [x] Commit in reviewable batches, open a PR, retain CI artifacts, merge and deploy only through GitHub Actions.
- [x] Clarify logical-model, Provider, and Offering identity labels after migration; cover the production-reported display with Playwright and deliver through PR/GitHub Actions.
- [ ] Record exact main SHA deployment and user acceptance of both React admin access and production legacy-route migration before archive.

## Local Validation Evidence (2026-08-04)

- `npm run check:frontend`: passed; Vite bundle measured above and frontend structural contracts passed.
- `npm test`: 39 files / 527 tests passed using local fixtures only.
- `npm run test:browser:workspace`: 81 passed, 39 viewport-scoped skips, 0 failed.
- `npm run test:browser:agent`: 3 passed against the local fake Provider after waiting for the legacy login initializer's final `#promptInput` focus signal before testing the image picker; streaming scroll, direct-entry keyboard coverage, and logout recovery remain covered.
- `npm run typecheck`: Worker, React client, and browser TypeScript passed.
- `npx wrangler deploy --dry-run`: Wrangler 4.110.0 completed locally; no deployment occurred.
- `git diff --check`: passed.
- `python ./.trellis/scripts/task.py validate-all`: repository consistency passed.
- `python -m unittest discover -s .trellis/tests -p test_*.py -v`: 7 passed.
- No live Provider/MCP request, production probe, local production deployment, production configuration read, or production configuration mutation was used.

## PR And Deployment Evidence (2026-08-04)

- Work commit `ad64dce1196c2a9378ccb63d03631ede29e911af`; PR head `93cab7f5b76896c15ff68a75de7c30d678dea8cb`.
- PR [#37](https://github.com/Drew-Z/chatus-private-chat/pull/37) merged by squash into exact main SHA `b508f3d0819a93c2bafc92c93b634b9d10f7ed13`.
- PR CI run `30840081929` passed `changes`, `quality`, `agent-browser`, and `workspace-browser`. The retained artifacts are `pr-path-classification-556ac518ea861f814b3311286effa25f83cfcae3` (ID `8866397393`), `agent-playwright-556ac518ea861f814b3311286effa25f83cfcae3` (ID `8866433579`), `pr-quality-556ac518ea861f814b3311286effa25f83cfcae3` (ID `8866474577`), and `workspace-playwright-556ac518ea861f814b3311286effa25f83cfcae3` (ID `8866552599`); all expire 2026-08-17.
- GitHub Actions deployment run `30840604819` passed against that exact main SHA, including the real deploy and production verification steps. The retained artifacts are `production-deployment-b508f3d0819a93c2bafc92c93b634b9d10f7ed13` (ID `8866683762`, expires 2026-11-01) and `deployment-paths-b508f3d0819a93c2bafc92c93b634b9d10f7ed13` (ID `8866593925`, expires 2026-09-02).
- The authenticated administrator executed the production legacy-route migration in `/react-chat/admin`; CI and local scripts did not perform it. Final acceptance remains pending the clarified entity-ID display described below.

## Identity Clarification Delivery Evidence (2026-08-04)

- Work commit `baa08536a67d71ded163c0440024dde5208792fb`; PR [#44](https://github.com/Drew-Z/chatus-private-chat/pull/44) head `92c94361d888199c6a89d6fb511151ea1ead4ea8` merged by squash into exact main SHA `6fb3594843cc38b45484a91c8335dc489456b634`.
- PR CI run `30892957232` passed `changes`, `quality`, `agent-browser`, and `workspace-browser`. Retained artifacts are `pr-path-classification-ef359bf6a6a87b31b10ae1e3ede60b63e6026f36` (ID `8885806893`), `agent-playwright-ef359bf6a6a87b31b10ae1e3ede60b63e6026f36` (ID `8885848634`), `pr-quality-ef359bf6a6a87b31b10ae1e3ede60b63e6026f36` (ID `8885878541`), and `workspace-playwright-ef359bf6a6a87b31b10ae1e3ede60b63e6026f36` (ID `8886000358`); all expire 2026-08-18.
- GitHub Actions deployment run `30893500458` passed against exact main SHA `6fb3594843cc38b45484a91c8335dc489456b634`, including production verification and deployment manifest generation. Retained artifacts are `production-deployment-6fb3594843cc38b45484a91c8335dc489456b634` (ID `8886116637`, expires 2026-11-02) and `deployment-paths-6fb3594843cc38b45484a91c8335dc489456b634` (ID `8886018520`, expires 2026-09-03).
- Final user acceptance of the clarified production labels remains pending; no local production probe or configuration mutation was used to substitute for that gate.

## Pending Manual Review (2026-08-04)

- The authenticated administrator completed the production legacy-route migration and confirmed that React admin, migrated Providers, and their Offerings are accessible.
- The migrated records preserve the intended identifiers (`<routeId>` and `<routeId>-provider`), but the current labels do not clearly distinguish logical-model IDs, Provider IDs, and Offering counts.
- AC10 remains open until a follow-up UI clarification is delivered through PR/GitHub Actions and the administrator confirms the clarified production display. This manual gate is parked and does not block work on the next independent parent-task child.

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
