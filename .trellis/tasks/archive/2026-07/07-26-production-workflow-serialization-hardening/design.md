# Production Workflow Serialization Hardening - Design

## Concurrency Boundary

Use one workflow-level concurrency group for both production deploy and production member acceptance:

```yaml
concurrency:
  group: chatus-production-mutation
  cancel-in-progress: false
```

This treats both workflows as production mutations. A newer deploy or acceptance run waits for the current production mutation to finish, preserving upload, smoke, secret cleanup, temporary-member cleanup, and exact-SHA evidence.

## Revision Checks

Deploy keeps the early stale-SHA guard for fast feedback and adds a second guard immediately before the real Wrangler deploy. The late guard fetches `origin main` and fails if `github.sha` is no longer the remote `main` tip.

Production acceptance already performs a release smoke before mutating temporary members. Extend the script to run the same exact-SHA release check again after cleanup, so a concurrent or manual production change cannot be reported as acceptance for the original revision.

## Cleanup Semantics

`acceptance-production.mjs` currently calls admin logout without checking the response. Make logout explicit:

- send the existing logout request in `finally`;
- if it fails, mark cleanup incomplete;
- keep temporary-member cleanup as the primary safety path.

## Documentation

Docs must say the deploy/acceptance queue is serialized rather than canceled. Deployment retry wording should match the current simple retry loop: the workflow retries Wrangler deploy failures up to three times, then fails; operators should not assume retry means the error is transient.

## Rollback

Revert the workflow, script, test, and docs changes. No production state, migration tag, or runtime code path is changed.
