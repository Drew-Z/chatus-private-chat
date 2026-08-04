# Current Delivery Audit

Date: 2026-08-04

## Repository Findings

- `.github/workflows/ci.yml:13-150` defines four jobs without `timeout-minutes`; browser conditions depend on `changes` outputs but current tests do not structurally validate the dependency or expression.
- `.github/workflows/deploy.yml:17-214` defines three jobs without timeouts. Strict main-tip comparisons exist at lines 76-83 and 163-170, but are duplicated inline shell and are tested only by raw occurrence count.
- `.github/workflows/production-acceptance.yml:14-18` already limits the acceptance job to 15 minutes.
- `scripts/classify-ci-paths.mjs:60-65` accepts every file below the three Trellis record roots as documentation; the tracked record extensions currently present below those roots are `.md`, `.json`, and `.jsonl`.
- `tests/delivery-governance.test.ts:78-160` checks workflow source mostly with `toContain()` and one command-count assertion. It does not parse YAML, reject duplicate keys, validate job wiring/order, or inspect artifact structures.
- `.trellis/spec/platform/delivery-governance.md:84-92` already requires parsed workflow YAML, static job/command/artifact/SHA assertions, both browser suites, and full shipping checks; implementation has drifted below that written contract.

## Official Action Runtime Evidence

Fetched directly with `smart-search fetch` from official GitHub repositories on 2026-08-04 after the broad search provider returned 429:

- `https://raw.githubusercontent.com/actions/checkout/v7/action.yml` declares `runs.using: node24`.
- `https://raw.githubusercontent.com/actions/setup-node/v7/action.yml` declares `runs.using: node24`.
- `https://raw.githubusercontent.com/actions/upload-artifact/v7/action.yml` declares `runs.using: node24`.
- `https://raw.githubusercontent.com/actions/download-artifact/v8/action.yml` declares `runs.using: node24`; this repository does not currently use download-artifact.

The current Chatus workflows use checkout/setup-node v5 and upload-artifact v4. Recent GitHub runs emit a Node 20 deprecation annotation for upload-artifact v4, so the task upgrades the three used official actions to the confirmed Node 24 majors and adds a structural allowlist test.

## Decisions

- Use the `yaml` npm package rather than a hand-written parser or regex. Duplicate-key rejection and real mapping/sequence access are part of the acceptance contract.
- Extract only the stale-main comparison into a reusable Node helper; keep workflow ordering visible in YAML and assert it structurally.
- Prefer false-positive CI/deploy work over false docs-only skips. Unknown paths are code.
- Preserve major-tag action references for this task; immutable action SHA pinning is a separate supply-chain policy decision.
