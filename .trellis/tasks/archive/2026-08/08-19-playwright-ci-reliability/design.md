# Playwright CI reliability design

## Boundary

This task changes only pull-request delivery governance. The Workspace and fake-Provider Agent suites keep separate stable jobs and their existing path classification, test commands, isolation, artifacts, and total time budgets.

## Installation Contract

Each browser job installs the package-locked Playwright Chromium revision with:

```yaml
- name: Install Chromium
  timeout-minutes: 5
  env:
    PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT: "120000"
  run: npx playwright install chromium
```

Omitting `--with-deps` is intentional. It prevents Playwright from invoking `apt-get update`, which is the repeated external hang. The hosted runner's image owns system libraries; launching the real browser in each unchanged suite proves those libraries are sufficient. Missing-library drift therefore fails quickly at browser launch rather than hanging in an unbounded apt transaction.

The Playwright-managed browser remains preferable to the preinstalled system Chrome channel because its revision is coupled to the locked `@playwright/test` package. No new third-party action, mutable container tag, or separately synchronized version is introduced.

## Failure Bounds

The step-level five-minute timeout leaves time within the existing 20-minute job budget for the suite and artifact retention. `PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=120000` bounds each Playwright browser-download connection while retaining Playwright's built-in mirror retry behavior. A browser CDN failure remains visible as an installation failure and never falls back to an unpinned browser.

## Governance And Compatibility

`tests/delivery-governance.test.ts` parses the YAML and verifies both browser jobs have the exact named step, command, environment value, timeout, no apt-triggering Playwright flags, and ordering before the suite. `.trellis/spec/platform/delivery-governance.md` records the executable contract.

This is compatible with current GitHub-hosted Ubuntu images and `@playwright/test@1.62.0`. Rollback restores the two prior commands, but doing so intentionally reintroduces apt mirror ownership and should be reserved for a confirmed runner image that lacks a required shared library.

## Operational Safety

The workflow remains pull-request-only for this path and uses local fixture/fake-Provider tests. No production environment, secret, live model, legacy rollout gate, or deployment path is involved.
