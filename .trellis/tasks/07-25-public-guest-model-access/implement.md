# Public Guest Access and Member Model Gate - Implementation Plan

## Preconditions

- [x] Keep administrator-issued member access codes; public self-registration is a separate future task.
- [ ] Revoke the credential exposed in chat and create a replacement through managed provider-secret storage. Never send the replacement credential through chat or a logged command.
- [ ] Use the existing administrator-authorized saved-provider model discovery to determine the exact upstream model ID without a completion request, then configure an ordinary provider offering/logical route and its explicit image capability.
- [x] Use the approved defaults: 24-hour session, 20/day, 6/minute, one concurrent turn, and no guest-history migration.

## Execution

1. [x] Add exact session actor and public-access contracts; invalidate old development/test sessions without an actor kind and cover fresh member login.
2. [x] Add revisioned typed admin configuration for public access and a single logical guest route; keep credentials in the existing write-only secret path.
3. [x] Add same-origin guest bootstrap, opaque short-lived cookies, expiry validation, identity rotation on login/logout, and cleanup scheduling.
4. [x] Centralize actor policy so `/api/session`, `/api/chat`, `/agent`, conversation APIs, memory, feedback, branch actions, export, and account actions enforce the same guest/member decision.
5. [x] Add atomic per-guest and source-abuse quotas plus one-turn concurrency enforcement without raw IP logging.
6. [x] Extend exact client decoding with access kind and explicit capabilities; bootstrap guests after a 401 and remount on member transition.
7. [x] Render one fixed guest model, a clear member-login/access entry, and hide disabled capabilities on desktop and touch layouts.
8. [x] Add deterministic cleanup/expiry tests and ensure stale guest Agent reconnects cannot recreate expired state.
9. [x] Add Worker, client, structural, and Playwright regression coverage for isolation, forged routes, unavailable routes, quota bypass, login transition, and secret-free responses.
10. [x] Update operations, authentication, provider-pool, and frontend capability specs.

## Validation

```powershell
npm.cmd run check:frontend
npm.cmd test
npm.cmd run test:browser:workspace
npm.cmd run typecheck
npx.cmd wrangler deploy --dry-run
git diff --check
python ./.trellis/scripts/task.py validate .trellis/tasks/07-25-public-guest-model-access
```

No validation command may contact a real model or perform a liveness probe.

## Rollback Points

- After contract/storage changes: old development/test sessions must fail closed while member access/configuration still permits a fresh login.
- After bootstrap/policy changes: `publicAccess.enabled = false` must restore the current invitation-only product without changing member data.
- After UI changes: `/api/session` 401 must still leave a usable member login path when public access is disabled.
- Before release: verify the exact committed revision through GitHub Actions only.
