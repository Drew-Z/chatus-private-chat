# Implementation Plan: CI And Delivery Governance Hardening

## Ordered Checklist

- [ ] Add the declared `yaml` development dependency and replace permissive workflow string checks with parsed, duplicate-key-rejecting structural helpers.
- [ ] Add exact job/step/dependency/condition/timeout assertions for PR CI, main deploy, and production acceptance.
- [ ] Narrow docs/Trellis-only classification to approved record/document extensions and add deterministic boundary, normalization, empty, mixed, executable, and unknown-path tests.
- [ ] Mark workflow/classifier/governance-test changes as shared browser impact so both conditional Playwright jobs run when the gate itself changes.
- [ ] Add a deterministic `assert-main-tip` helper and replace both inline deploy guards while preserving pre-mutation and immediate-pre-deploy ordering.
- [ ] Add explicit timeout budgets to every CI/deploy job and preserve the existing production acceptance budget.
- [ ] Upgrade official workflow actions to the approved Node 24 majors and add a structural no-downgrade allowlist assertion.
- [ ] Harden path-classification artifact uploads and structurally validate all artifact names, paths, missing-file behavior, `always()` conditions, and retention periods.
- [ ] Run `trellis-check`, affected delivery tests, the full shipping gate, both Playwright suites, Trellis consistency, and secret/artifact boundary review.
- [ ] Update the delivery-governance spec, commit, push, open a PR, retain exact-head CI artifacts, record exact main deployment evidence, prove docs/Trellis-only skip, and archive.

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
