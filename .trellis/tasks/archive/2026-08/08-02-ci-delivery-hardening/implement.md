# Implementation Plan: CI And Delivery Governance Hardening

## Ordered Checklist

- [x] Add the declared `yaml` development dependency and replace permissive workflow string checks with parsed, duplicate-key-rejecting structural helpers.
- [x] Add exact job/step/dependency/condition/timeout assertions for PR CI, main deploy, and production acceptance.
- [x] Narrow docs/Trellis-only classification to approved record/document extensions and add deterministic boundary, normalization, empty, mixed, executable, and unknown-path tests.
- [x] Mark workflow/classifier/governance-test changes as shared browser impact so both conditional Playwright jobs run when the gate itself changes.
- [x] Add a deterministic `assert-main-tip` helper and replace both inline deploy guards while preserving pre-mutation and immediate-pre-deploy ordering.
- [x] Add explicit timeout budgets to every CI/deploy job and preserve the existing production acceptance budget.
- [x] Upgrade official workflow actions to the approved Node 24 majors and add a structural no-downgrade allowlist assertion.
- [x] Harden path-classification artifact uploads and structurally validate all artifact names, paths, missing-file behavior, `always()` conditions, and retention periods.
- [x] Run `trellis-check`, affected delivery tests, the full shipping gate, both Playwright suites, Trellis consistency, and secret/artifact boundary review.
- [x] Update the delivery-governance spec, commit, push, open a PR, retain exact-head CI artifacts, record exact main deployment evidence, prove docs/Trellis-only skip, and archive.

## Validation Commands

```text
npx vitest run tests/delivery-governance.test.ts
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

- `.github/workflows/ci.yml`: preserve the five mandatory quality commands and conditional browser job names/outputs.
- `.github/workflows/deploy.yml`: guard ordering is safety-critical; no provisioning, secret preparation, or deploy may precede the appropriate exact-main check.
- `.github/workflows/production-acceptance.yml`: only action runtime assertions apply; do not change temporary-member semantics.
- `scripts/classify-ci-paths.mjs`: false docs-only is more dangerous than extra CI, so unknown paths fail closed to deploy.
- `scripts/assert-main-tip.mjs`: error handling must be deterministic and must not print authenticated remote configuration.
- `tests/delivery-governance.test.ts`: parsed assertions must remain readable and specific; avoid rebuilding a general-purpose workflow engine.

## Review Gates

- Every workflow parses without duplicate keys and every executable job has an enforced budget.
- Gate-control changes cannot skip the browser jobs they govern.
- Only finite document/Trellis record types skip deploy; executable or unknown files fail closed.
- Two strict exact-main checks remain, with the first before all production mutation and the second directly before deploy.
- PR CI contains no production smoke/acceptance and all browser/provider tests remain local-fixture-only.
- Artifacts are exact-SHA, bounded, non-sensitive, retained for the documented duration, and fail when expected files are absent.
- Official action refs are approved Node 24 majors and the package remains on the 0.x line.

## Local Validation Evidence (2026-08-04)

- Affected delivery suites: `tests/delivery-governance.test.ts` and `tests/deployment-config.test.ts`, 87 tests passed.
- Full Vitest: 40 files / 581 tests passed.
- Workspace Playwright: 83 passed / 42 viewport-conditional skips. Local fake-Provider Agent Playwright: 3 passed.
- `npm run check:frontend`, `npm run typecheck`, `npx wrangler deploy --dry-run`, `git diff --check`, Trellis repository consistency, and all 7 Trellis unit tests passed.
- Official action definitions were fetched directly from GitHub and confirmed Node 24 for checkout v7, setup-node v7, and upload-artifact v7.
- No live Provider/MCP request, production probe, production data read/mutation, or local production deployment was used.
- PR exact-head CI, main deployment, docs/Trellis-only skip, retained artifacts, and absence of the targeted Node 20 annotation were all verified under AC9.

## Remote Delivery Evidence (2026-08-04)

- PR #45 exact-head `518644eeef26828aab9b2f847737eed04ec6ac11` passed run `30909738649`: changes, quality, Workspace Playwright, and local fake-Provider Agent jobs all succeeded.
- PR artifacts were retained through 2026-08-18: path classification `8892525946`, Agent Playwright `8892569803`, quality manifest `8892612645`, and Workspace Playwright `8892744506`. All four check annotation lists were empty, including the targeted Node 20 action warning.
- Squash merge produced exact main `59b877d95b671b93d096b092714e596f55f859e0`. Deploy run `30910437079` passed both stale-main guards, deterministic quality gates, R2/Queue preparation, Worker deployment, production verification, and bounded cleanup.
- Deployment artifacts bind the exact main SHA: path classification `8892815181` retained through 2026-09-03 and production deployment manifest `8892913295` retained through 2026-11-02.
- Trellis-only evidence commit `8d0d7d38a7a156f1fd0f02afa48881842bd3e437` passed run `30911068336`: `deployment-skipped` succeeded and the real `deploy` job was skipped.
