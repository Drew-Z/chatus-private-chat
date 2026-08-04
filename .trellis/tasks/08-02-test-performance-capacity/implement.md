# Implementation Plan: Test Performance And Capacity Observability

## Ordered Checklist

- [x] Add compatible Istanbul coverage dependency and root coverage configuration with text, JSON summary, HTML output, and explicit four-metric thresholds derived from the measured baseline.
- [x] Evaluate named Node/Workers projects with the eight direct and one transitive Cloudflare-dependent files in Workers; after the final benchmark missed the approved bound, restore the full serial Workers pool.
- [x] Add configuration-governance tests for the experiment, then update the final contract to lock one `cloudflareTest` pool, `maxWorkers: 1`, Istanbul, and explicit thresholds.
- [x] Keep local `npm test` uninstrumented, add `npm run test:coverage`, and make PR CI use one coverage-enabled complete Vitest run without duplicating the suite.
- [x] Add deterministic quota-admission coverage that locks the approved member `unlimited` concurrency behavior and proves guest lease acquisition is not used for members.
- [x] Add the shared Workspace tracked-usage contract and compute all five fields from Root TeamAgent SQLite metadata in the same listing boundary.
- [x] Project additive Workspace `usage` through the member API without object keys, checksums, internal operation data, or bucket-actual claims.
- [x] Render an accessible React usage summary for quota bytes, extracted bytes, and non-zero pending cleanup bytes while preserving all existing file workspace states and actions.
- [x] Add state, API, component/config, and Workspace Playwright coverage for exact usage arithmetic, labels, responsive layout, error recovery, and privacy boundaries.
- [x] Run three post-change uninstrumented `npm test` samples; retain the project split only if all 40 baseline files, at least 581 baseline tests, and every new regression pass with a median at most 91.564 seconds.
- [x] Run `trellis-check`, focused capacity/Workspace/Provider suites, coverage enforcement, the full shipping gate, Workspace Playwright, Trellis consistency, and secret-boundary review.
- [ ] Update the relevant frontend specs, commit, push, open a PR, retain exact-head CI evidence, verify exact-main GitHub Actions deployment, record evidence, and archive the child task.

## Validation Commands

```text
npx vitest run tests/delivery-governance.test.ts tests/quota-admission.test.ts tests/provider-stream-runtime.test.ts tests/fallback-language-model.test.ts
npx vitest run tests/document-ingest-state.test.ts tests/workspace-file.test.ts tests/worker-api.test.ts
npm run check:frontend
npm test
npm test
npm test
npm run test:coverage
npm run test:browser:workspace
npm run typecheck
npx wrangler deploy --dry-run
git diff --check
python ./.trellis/scripts/task.py validate-all
python -m unittest discover -s .trellis/tests -p test_*.py -v
```

The three `npm test` runs are timed independently on the same machine. Record raw elapsed seconds, sort the three samples, and use the middle value as the median. Do not discard a slow sample unless the entire benchmark is restarted and the reason is recorded.

## Risky Files And Rollback Points

- `vitest.config.ts`: the final configuration must retain one `cloudflareTest` pool and `maxWorkers: 1`; restoring the rejected project split without a new approved benchmark is a regression.
- `package.json` / lockfile: `@vitest/coverage-istanbul` must stay compatible with Vitest 4 and the package must remain on the 0.x line.
- `.github/workflows/ci.yml`: retain all non-Vitest gates, job timeouts, browser path classification, exact-head artifacts, and local-only Provider behavior; change only the single Vitest command needed for coverage.
- `src/agent/team-agent.ts`: aggregate only numeric metadata inside the owning DO; do not list R2 or change quota admission, deletion, purge, or ingest state transitions.
- `src/contracts/workspace-file.ts` and `src/worker.ts`: the response is additive and must never expose object keys or call the metric bucket-actual usage.
- React workspace components: use `quotaBytes`, not `trackedBytes`, for the quota ratio; pending cleanup must not imply that deletion has failed permanently.
- If post-change median exceeds 91.564 seconds, revert the project split configs and keep the original serial Workers pool before continuing with the remaining deliverables.

## Review Gates

- All 40 baseline test files and at least 581 baseline tests run once through the serial Workers pool, together with every new regression.
- The measured post-change median improves at least 15%, or the split is absent from the final work commit.
- Coverage uses Istanbul, has explicit global floors for all four metrics, and fails closed when a metric is below its floor.
- Members remain unlimited and Provider first-visible behavior remains 60 seconds; neither decision introduces a new public error or telemetry claim.
- Workspace usage arithmetic matches the SQLite states exactly and is consistently named metadata-tracked occupancy in contract, API, tests, UI, and specs.
- No R2 listing/head, object key, checksum, token, access code, member identifier, conversation, or stored memory appears in usage responses, logs, screenshots, or artifacts.
- PR CI, production deployment, and production acceptance remain exact-SHA GitHub Actions flows; no local production deployment or live Provider/MCP test is used.

## Follow-Up Risk Register

- A stream that emits visible output and then stalls indefinitely still relies on downstream cancellation to release capacity. A future idle-timeout task must define partial-response UX and cleanup semantics before implementation.
- Metadata-tracked occupancy cannot discover orphan R2 objects or prove referenced objects exist. Bucket-actual accounting requires a separate inventory/reconciliation design.
- Member concurrency remains unlimited until measured saturation and a product-level multi-tab/concurrency budget justify a lease design.
