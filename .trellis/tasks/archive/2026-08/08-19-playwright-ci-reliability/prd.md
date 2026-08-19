# Harden Playwright CI installation

## Goal

Make the pull-request Workspace and fake-Provider Agent browser gates complete reliably when GitHub-hosted Ubuntu apt mirrors are degraded, without weakening the browser coverage or changing production behavior.

## Background

- Pull-request run `32230982560` completed `changes`, `quality`, and `agent-browser`, but `workspace-browser` was canceled three times after its Playwright dependency installation exhausted the job's 20-minute timeout.
- Jobs `96000549382`, `96006758212`, and `96013268376` each stalled in `npx playwright install --with-deps chromium` while apt ignored `azure.archive.ubuntu.com` indexes and then stopped after downloading fallback `archive.ubuntu.com` InRelease files. `npm run test:browser:workspace` never started.
- The same run proved the application-independent nature of the incident: another runner completed the identical installation command and the fake-Provider Agent suite passed. The complete Workspace suite also passed locally with 126 passing tests and 84 conditional skips.
- GitHub Status reported Actions operational during the incident. The runner-images issue `actions/runner-images#11347` documents the same intermittent apt hang on both Ubuntu 22.04 and 24.04, so changing the runner label alone is not a reliable fix.
- `@playwright/test@1.62.0` supports Ubuntu 24.04. GitHub-hosted Ubuntu images already contain the shared libraries required to launch Chromium; the browser suites themselves remain the executable dependency and launch check.

## Requirements

- Remove apt ownership from the Playwright browser installation path in both PR browser jobs.
- Install the Playwright-managed Chromium revision selected by `package-lock.json`; do not switch tests to an unpinned system Chrome channel.
- Bound each browser installation step independently so a browser CDN stall cannot consume the complete job budget.
- Preserve the stable `workspace-browser` and `agent-browser` job names, path-classifier conditions, browser commands, fake-Provider isolation, artifact paths, and 20-minute job timeouts.
- Add structured workflow assertions for the exact install command, timeout, download connection timeout, and install-before-test ordering in both jobs.
- Update the delivery-governance spec with the new no-apt browser installation contract.
- Do not deploy production, run production acceptance, contact a live Provider/model, modify any legacy rollout task/evidence, or alter PR #97's capability branch.

## Acceptance Criteria

- [x] Both PR browser jobs use `npx playwright install chromium` and contain no `--with-deps` or `install-deps` command.
- [x] Both install steps use `timeout-minutes: 5` and `PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT: "120000"` before their existing browser test step.
- [x] Delivery-governance tests structurally enforce the installation contract for both browser jobs.
- [x] Delivery-governance documentation explains that browser launch is the hosted-image dependency check and that installation must not invoke apt.
- [x] `npm run check:frontend`, `npm test`, `npm run test:browser:workspace`, `npm run test:browser:agent`, `npm run typecheck`, `npx wrangler deploy --dry-run`, `git diff --check`, and `python ./.trellis/scripts/task.py validate-all` pass without live Provider or production operations.
- [x] A dedicated pull request runs both GitHub browser jobs successfully, or any remaining failure is shown by job logs to occur after Chromium installation rather than in apt dependency resolution.

## Out Of Scope

- Changing application, Provider, model, capability, or browser-test behavior.
- Adding third-party caching actions, Docker-based remote browsers, self-hosted runners, or paid runner capacity.
- Modifying production workflows or increasing the existing browser-job timeout.
- Merging PR #97 or deploying any revision.
