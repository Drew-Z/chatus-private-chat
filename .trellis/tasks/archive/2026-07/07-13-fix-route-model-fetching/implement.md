# Implementation Plan

1. Add the managed-secret storage types, reference validation, base64 helpers, AES-GCM import/encrypt/decrypt helpers, and KV CRUD helpers in `src/worker.ts`.
2. Add authenticated route-secret GET/PUT/DELETE endpoints with revision checks, safe responses, and audit actions.
3. Convert `resolveRouteKey` to an asynchronous resolver and update every caller: route access, chat execution, model fetching, manual health checks, scheduled health checks, and any fallback path.
4. Add admin UI status loading and write-only key controls. Clear key input after save, route change, logout, and failure-safe transitions.
5. Update `scripts/check-frontend.mjs` with structural assertions that raw keys are not added to route configuration and the key input is cleared.
6. Add Worker tests for crypto storage, CRUD security, resolver precedence, model fetching, health checks, and chat requests.
7. Update `.env.example`, GitHub Actions secret preparation, `README.md`, and `docs/operations.md` for the one-time `ROUTE_KEYS_MASTER_KEY` setup and rotation behavior.
8. Run `trellis-check`, review the full data flow, and execute all required project checks.

## Validation Commands

```bash
npm run check:frontend
npm test
npm run typecheck
npx wrangler deploy --dry-run
git diff --check
```

## Risk And Rollback Points

- Resolver migration has the largest blast radius; tests must prove every caller awaits the result.
- Never write actual key values into fixtures that could resemble production credentials.
- Rollback is safe by deleting managed KV entries and continuing with existing Worker Secrets.
- Do not deploy production locally; GitHub Actions remains the only production path.
