# Implementation Plan: Background Cleanup and Deletion Reliability

## Ordered Checklist

- [x] Load `trellis-before-dev`, cleanup-related frontend/platform specs, and cross-layer/reuse guides.
- [x] Add shared cleanup retry constants/types and additive Root SQLite migrations for due, stable error, and terminal metadata.
- [x] Add Root TeamAgent alarm registration, earliest-due recomputation, bounded alarm execution, guest-ticket storage, and aggregate inspection.
- [x] Make conversation cleanup own both conversation TeamAgent and UserState deletion; remove swallowed UserState failure and make request/alarm drains share one implementation.
- [x] Make Workspace delete/account-purge queries due-aware; preserve operation/generation locks, apply capped backoff, and retain terminal failures.
- [x] Refactor owner purge so Root identity/account-purge lock survive partial external failure; reuse it for guest cleanup and delete the guest KV marker last.
- [x] Adopt legacy expired guest markers into the owner alarm and stop applying an expiration that can erase retry ownership.
- [x] Add deterministic tests for partial failure, recovery, idempotent replay, due filtering, backoff cap, terminal retention, batch limits, eviction/resume, and privacy-safe aggregates.
- [x] Run focused Vitest while iterating, then load and execute `trellis-check`.
- [x] Run full frontend, Vitest, Workspace browser, Agent fake-Provider browser, typecheck, Wrangler dry-run, diff, Trellis consistency, and Trellis unit-test gates.
- [ ] Update the applicable specs with durable cleanup/alarm contracts, record validation evidence, create scoped work/spec commits, push a draft PR, and retain CI artifacts.

## Expected Files

- `src/agent/team-agent.ts`
- `src/worker.ts`
- `src/contracts/agent.ts`
- `src/contracts/workspace-file.ts`
- `tests/worker-api.test.ts`
- `tests/workspace-file.test.ts`
- focused TeamAgent/alarm fixtures if existing test boundaries require them
- `.trellis/spec/frontend/workspace-files.md`
- `.trellis/spec/frontend/public-guest-access.md`
- `.trellis/spec/platform/backup-restore.md`

## Validation Commands

```text
npx vitest run tests/worker-api.test.ts tests/workspace-file.test.ts
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

## Review Gates

- Ownership gate: no marker/outbox/lock is removed before all owned side effects succeed.
- Autonomy gate: a deterministic alarm retry converges after request traffic stops and after simulated actor eviction.
- Idempotency gate: replay cannot resurrect rows, delete a newer generation, or duplicate cleanup state.
- Retention gate: exhausted work remains terminal and inspectable; list/read failures cannot masquerade as an empty queue.
- Privacy gate: aggregate status and logs omit labels, IDs, object keys, content, secrets, and raw exceptions.
- Compatibility gate: legacy rows/markers become eligible without destructive migration.

## Rollback Points

- Commit schema/scheduler primitives before behavior rewiring when practical.
- Keep storage migrations additive; do not rename operation kinds or object keys.
- Preserve immediate request attempts so reverting the alarm layer does not remove current user-visible behavior.
- Never run a local production deployment; production changes flow through GitHub Actions only.
