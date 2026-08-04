# Production Acceptance Cleanup Recovery

## Goal

Make authenticated production acceptance recover safely from transient member-purge failures, always restore access configuration, and remove access entries leaked by an earlier failed acceptance run.

## Background

- Production acceptance run `30877713325` checked out and verified deployed SHA `1c1ae0b69a4e7e1f03a42f4e3319a02753e79a35`.
- Authentication, per-member Agent identity, conversation isolation, revision conflicts, memory isolation, and WebSocket identity passed.
- The first `DELETE /api/user-data` returned HTTP `503`; the `finally` cleanup used `Promise.all`, so one repeated `503` prevented `cleanupTemporaryMembers()`, administrator logout, and post-cleanup release verification from running.
- Temporary access labels use the strict generated shape `codex-accept-<24 lowercase hex>-<a|b>`. Access codes, cookies, member labels, response bodies, memory, and conversation content must remain absent from logs and task evidence.
- Account cleanup requests are persisted before purge work begins and use a five-second-class retry schedule. The acceptance runner may retry the public deletion request but must not change the production purge implementation in this task.

## Requirements

- R1. `DELETE /api/user-data` in acceptance must retry HTTP `503` with a bounded delay and attempt count aligned with the persisted cleanup window (eight attempts, five-second-class waits). HTTP `200` remains success. A `401` succeeds only for cleanup-only calls or after the same invocation already received `503`, because the persisted deletion may have revoked the cookie before a later cleanup stage failed. An initial strict `401` and other statuses fail immediately.
- R2. The `finally` path must attempt every member cleanup sequentially, then access-code restoration, administrator logout, and post-cleanup release verification even when an earlier cleanup step fails. It reports a bounded operation-name summary only after all steps have run.
- R3. Before recording the baseline access configuration or adding new temporary members, the runner must revision-safely remove entries whose labels exactly match the generated acceptance-label pattern. It must preserve every non-matching entry and delete the override rather than write an empty access list when no entries remain.
- R4. Cleanup conflict handling remains fail-closed: retry revision conflicts, preserve concurrent non-temporary edits, and fail if temporary labels cannot be proven absent.
- R5. Cleanup helpers must be deterministic and unit-testable without production, Provider, OAuth, or MCP access. The executable script must remain syntactically valid and the workflow stays `main`-only in the shared non-cancelling production mutation group.
- R6. Logs, test fixtures, task records, and artifacts must not contain real or generated access codes, cookies, administrator tokens, conversation content, memory content, raw response bodies, or member identifiers.
- R7. Deployment and production acceptance run only through GitHub Actions at the exact remote `main` SHA. No local production deployment, local production probe, live model, or synthetic completion is allowed.

## Acceptance Criteria

- [x] AC1. Unit tests prove a `503` member purge is retried after the injected wait, `200` and post-`503` `401` succeed, cleanup-only initial `401` succeeds, strict initial `401` fails, and other statuses or exhausted retries fail.
- [x] AC2. Unit tests prove member purge failure does not skip later member purge, access restoration, administrator logout, or release verification; the final error contains only bounded operation names.
- [x] AC3. Tests prove only exact `codex-accept-<24 hex>-a|b` labels are identified as stale; similarly prefixed legitimate labels are preserved.
- [x] AC4. Structural tests prove stale cleanup runs before the baseline snapshot, revision-checked access restoration remains present, member cleanup is sequential, and the workflow stays exact-SHA/main-only with retained manifests.
- [x] AC5. `node --check scripts/acceptance-production.mjs`, focused tests, `npm run check:frontend`, `npm test`, `npm run test:browser:workspace`, local fake Provider `npm run test:browser:agent`, `npm run typecheck`, `npx wrangler deploy --dry-run`, `git diff --check`, and Trellis repository validation pass.
- [ ] AC6. A GitHub Actions deployment and `Production member acceptance` run succeed at the same exact merged `main` SHA; the successful run proves temporary labels are absent, admin logout completed, and post-cleanup SHA verification passed.

## Out Of Scope

- Changing Worker/Agent user-data purge semantics, retry scheduling, R2 cleanup ownership, or public API responses.
- Logging or exporting acceptance credentials to diagnose cleanup.
- Running any model request, production probe from the local machine, or local production deployment.
