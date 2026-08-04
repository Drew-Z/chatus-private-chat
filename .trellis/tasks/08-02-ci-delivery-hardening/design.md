# Design: CI And Delivery Governance Hardening

## Boundary

This task changes delivery-control files only: GitHub workflows, the shared path classifier, a reusable exact-main guard, delivery-governance tests, and the delivery spec. Application behavior, Cloudflare resource schemas, and production acceptance semantics remain unchanged.

## Parsed Workflow Contract

Add the `yaml` package as an explicit development dependency. Tests parse each raw workflow with duplicate-key rejection and convert only successful documents to plain objects. Small typed accessors validate mappings, arrays, jobs, and named steps so a malformed structure produces a focused assertion instead of a permissive string match.

The tests own exact contracts rather than a generic workflow linter:

- stable job names and dependencies;
- job-level timeout values;
- required commands and their order;
- browser output wiring;
- approved action references;
- exact-SHA artifact names, paths, missing-file behavior, retention, and `always()` where failure evidence is required;
- deploy guard ordering relative to mutation and deploy.

Raw-string assertions remain only for shell fragments whose byte-level content matters after the YAML structure has already been validated.

## Timeout Budget

Use explicit budgets based on observed runtime with cold-install margin:

| Workflow job | Timeout |
| --- | ---: |
| PR/deploy path classification | 5 minutes |
| PR quality | 20 minutes |
| Workspace browser | 20 minutes |
| fake-Provider Agent browser | 20 minutes |
| docs/Trellis deployment skip | 5 minutes |
| production deploy | 30 minutes |
| production acceptance | 15 minutes |

Tests assert both presence and maximum values so a nominal but ineffective timeout cannot silently replace the budget.

## Path Classification

Classification stays deterministic after normalization, deduplication, and sorting. A path is documentation-only only when one finite rule accepts it:

- Markdown anywhere;
- an approved documentation asset extension under `docs/`;
- `.md`, `.json`, or `.jsonl` under tracked Trellis task/spec/workspace record roots.

Anything else is code for deployment purposes. This includes executable Trellis content, unknown extensions, workflows, configs, and classifier/test changes. Governance-control paths are shared browser-impact paths so a PR that changes the conditional gate exercises both gated suites.

## Exact Main Guard

Create `scripts/assert-main-tip.mjs` with an injectable core and a CLI entrypoint. The core receives the expected SHA and a function that reads `git ls-remote origin refs/heads/main`; it validates normalized shape and exact equality. Errors are stable and contain no credentials or remote URL.

Both deploy guard steps invoke this script. The first remains before R2/Queue provisioning and secret preparation. The second is immediately before `Deploy Worker`. Non-canceling concurrency remains because a newer main push must queue, while the old queued/running revision fails its next SHA guard before further mutation.

## Action Runtime And Artifacts

Upgrade official JavaScript actions to the official Node 24 majors confirmed on 2026-08-04: checkout v7, setup-node v7, and upload-artifact v7. Tests enumerate every `uses` entry and reject older or unapproved refs.

Artifact uploads retain current privacy boundaries and durations: PR evidence 14 days, deployment path evidence 30 days, production deployment/acceptance manifests 90 days. Classification artifacts gain `if-no-files-found: error`; existing failure-evidence uploads retain `if: always()`.

## Compatibility And Rollback

- Job names, npm commands, path outputs, artifact names, production environment, concurrency group, retry count, and acceptance flow remain stable.
- Node 24 action majors preserve existing inputs used by these workflows.
- The stale-main helper replaces duplicated shell without changing the strict equality rule.
- Reverting the work commit restores the previous delivery controls and does not mutate user data. Any production rollout/rollback still occurs only through a main PR and GitHub Actions.

## Evidence Sources

Repository evidence and official action runtime sources are recorded in `research/current-delivery-audit.md`.
