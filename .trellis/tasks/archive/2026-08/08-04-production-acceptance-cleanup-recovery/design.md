# Design: Production Acceptance Cleanup Recovery

## Boundaries

- `scripts/production-acceptance-cleanup.mjs` owns pure label classification, retry status policy, and cleanup-step orchestration.
- `scripts/acceptance-production.mjs` owns authenticated HTTP requests, revisioned access-code mutation, milestone assertions, and the exact-SHA workflow entry.
- Worker and Agent deletion implementations remain unchanged; a `503` is treated as an incomplete persisted cleanup request that the acceptance caller may retry.

## Retry Contract

`retryTemporaryMemberDeletion(run, { allowUnauthorized, wait, attempts })` calls an injected status-producing operation sequentially. Status `200` succeeds. An initial `401` succeeds only in cleanup mode; a `401` also succeeds after the same invocation already observed `503`, because the Worker persists cleanup and can revoke the cookie before a later stage returns `503`. Status `503` waits and retries while attempts remain. Every other status, an initial strict `401`, and an exhausted `503` produce a stable error containing the operation class and HTTP status, never a body or identifier.

The production script uses a five-second delay and eight attempts. This covers the Root Agent's eight-attempt persisted cleanup window without approaching the workflow timeout or login-failure throttle.

After deletion returns or recovers, `waitForTemporaryMemberSessionRevocation()` checks the old cookie up to five times across a 60-second window. A `200` can occur while Cloudflare KV `list` has not yet observed the recently-created session; after each delayed `200`, the runner reissues the idempotent deletion. Only `401` proves revocation. Other statuses, an exhausted `200`, or re-delete failure remain fatal.

## Cleanup Orchestration

`runProductionAcceptanceCleanup()` receives operation callbacks and attempts them in this order:

1. Purge each temporary member sequentially.
2. Restore/remove temporary access-code entries.
3. Log out the administrator.
4. Verify the deployed release SHA after cleanup.

Each operation is wrapped independently. Failures are collected as fixed operation labels; all remaining steps still run. At the end, any collected label causes one bounded failure. This prevents one user-data `503` from bypassing access revocation or release verification.

## Stale Access Recovery

Before capturing `originalAccess`, the executable reads the current revision and removes only labels matching `^codex-accept-[0-9a-f]{24}-(a|b)$`.

- With remaining entries, it writes their exact `label:code` pairs using `expectedRevision`.
- With no remaining entries, it deletes the override using `expectedRevision` so managed/secret bootstrap semantics can recover.
- A `409` reloads and retries up to four times.
- After mutation, it reloads and proves no exact stale label remains.

Persisted account-cleanup ownership from the failed run remains responsible for old member data. This task removes authentication reachability and does not invent an administrator-side data purge bypass.

## Privacy And Compatibility

- Helpers receive statuses and callbacks, not access codes or response bodies.
- Error aggregation uses fixed labels only.
- Existing concurrent-edit preservation and exact-source restoration for the current run remain intact.
- No workflow input, secret, API, or manifest schema changes are required.

## Rollback

The helper module and acceptance script changes form one isolated delivery slice. Reverting restores the old runner without changing application state or schemas. Production mutation remains serialized by the existing GitHub Actions concurrency group.
