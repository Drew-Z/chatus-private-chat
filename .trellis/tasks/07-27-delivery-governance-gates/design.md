# Design: PR, CI, and Trellis Delivery Gates

## PR CI

Add `.github/workflows/ci.yml`. A `changes` job produces stable path flags. A `quality` job always exists and runs the five baseline checks. Workspace and Agent browser jobs keep stable check identities and either run their suites or publish an explicit not-affected summary. Failures retain Playwright traces/screenshots and redacted logs; successful runs retain a SHA manifest.

## Deployment

Extend the main workflow with path classification. Runtime, lockfile, Wrangler, or delivery-script changes deploy; docs/Trellis-only changes publish a skip summary. The deployment manifest records `GITHUB_SHA`, lockfile hash, static bundle digest, and build time. Production acceptance verifies the deployed `release.json.commit` and publishes a non-sensitive JSON summary artifact.

## Browser Artifacts

Browser runners accept a caller-owned artifact/output directory. Caller-owned directories survive `finally`; runtime credentials, env files, Wrangler state, and raw user/provider content stay outside them. Existing redaction remains authoritative for logs.

## Trellis Validation

Add one read-only validation module plus a CLI entry that scans active and archived `task.json` files and workspace indexes. Archive invokes the same validator before any state or directory mutation. Task metadata gains structured waivers and validation/work-commit evidence while remaining backward compatible with legacy task files.

## Archive Ordering

1. Resolve the task and its tree.
2. Validate acceptance criteria, validation evidence, work commit, children, waivers, and repository-wide consistency.
3. Preflight git state and the archive destination.
4. Write completed state and move the task.
5. Create the archive commit. If a post-move operation fails, restore the original directory and metadata.

## Compatibility

Missing new fields decode as empty legacy values. Historical archived tasks remain readable; validation may use an explicit structured legacy waiver or migration policy so the new gate does not permanently lock the repository.

## Rollback

The PR workflow can be reverted as an isolated commit. Archive validation rejects before mutation. Any mutation-phase failure restores the original task path and metadata. Production deployment remains unavailable as a local command.

