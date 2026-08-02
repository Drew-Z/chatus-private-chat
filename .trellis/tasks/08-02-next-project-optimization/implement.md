# Implementation Plan: Member Logout Fail-Closed Recovery

## Ordered Checklist

- [x] Load `trellis-before-dev` and the frontend component, type-safety, quality, and delivery specs.
- [x] Add focused member `logout()` exact-response tests, then implement the shared `requestJson()` decoder path.
- [x] Add Worker integration coverage for member session-delete failure, preserved cookie/session, and successful retry.
- [x] Add the closed logout state to `ChatWorkspace`; move draft cleanup after successful `onLogout()` resolution.
- [x] Extend `WorkspaceHeader` with explicit pending semantics and add the dedicated accessible error/retry row.
- [x] Add deterministic Workspace fixture coverage for idle/pending/error/retry at desktop and touch 390px.
- [x] Add a local fake-Provider Agent browser scenario covering failed logout, draft preservation, successful retry, cleanup, and zero Provider calls.
- [x] Run focused client/API/Worker/browser tests and fix findings through `trellis-check`.
- [x] Run the full shipping gate sequentially: frontend check, Vitest, Workspace Playwright, Agent Playwright, typecheck, Wrangler dry-run, diff check, and Trellis consistency.
- [x] Extend the frontend component code-spec from admin-only logout to ordinary member fail-closed logout.
- [x] Commit on a `codex/` branch, open a PR, verify exact-SHA CI/artifacts, merge through GitHub, verify main deployment/acceptance evidence, then archive and journal the task.

## Focused Validation

```text
npx vitest run tests/client-api.test.ts tests/worker-api.test.ts
npm run test:browser:workspace
npm run test:browser:agent
```

## Full Validation

```text
npm run check:frontend
npm test
npm run test:browser:workspace
npm run test:browser:agent
npm run typecheck
npx wrangler deploy --dry-run
git diff --check
python ./.trellis/scripts/task.py validate-all
```

## Review Gates

- API gate: only exact `{ ok: true }` is success; all other outcomes remain typed failures.
- Ordering gate: no member draft key is deleted before server revocation succeeds.
- State gate: one pending request, visible failure, explicit retry, no authenticated-workspace transition on failure.
- Worker gate: failed KV delete has no clearing cookie or session loss; retry is authoritative.
- Browser gate: no live Provider/MCP/OAuth, no production call, zero Provider calls during logout, and 390px containment is proven.
- Compatibility gate: admin logout, revoke-all, permanent-delete, guest/login, and OAuth MCP tests remain green.

## Rollback Points

- Client API decoder and tests are one coherent rollback boundary.
- Workspace state/header/presentation and browser evidence form the UI rollback boundary.
- Worker behavior is unchanged; only its regression coverage is added.
- No migration, object cleanup, Queue drain, credential rotation, or production-side manual action is required for rollback.
