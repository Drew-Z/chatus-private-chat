# Authenticated Production Acceptance

## 1. Scope / Trigger

Use this contract when authentication, session projection, Agent identity, conversation storage, memory, WebSocket routing, optimistic concurrency, tombstones, or user-data deletion changes. Anonymous release smoke is necessary but does not cover these member-owned boundaries. This authenticated workflow is not full product acceptance when public guest access is enabled; guest access has a separate manual acceptance boundary.

## 2. Signatures

- Local or trusted-shell entry: `npm run acceptance:production`
- Required environment: `PRODUCTION_URL`, `ADMIN_TOKEN`
- Manual GitHub workflow: `.github/workflows/production-acceptance.yml`
- Production workflow ref: `refs/heads/main` only
- Production concurrency group: `chatus-production-mutation` with `cancel-in-progress: false`, shared with deployment

The script may use `http://localhost` or `http://127.0.0.1` for local verification. Every non-local target must use HTTPS.

## 3. Contracts

- Log in through `POST /api/admin/login`; keep the returned admin cookie in memory only.
- Read `GET /api/admin/access-codes` and retain `accessCodes`, `source`, and `revision` without logging them. `source` may be `kv`, `secret`, or `managed`; a managed empty source is the supported first-deployment bootstrap state.
- Generate two random labels and access codes before mutation, append them with `PUT /api/admin/access-codes`, and pass `expectedRevision`.
- Treat temporary access-code visibility as a bounded KV-propagation check. Space retries so the final attempt is at least 60 seconds after the first while keeping the maximum invalid attempts below the Worker's eight-failure per-source throttle.
- Run temporary-member login and delete-then-login checks sequentially. GitHub Actions requests share one source identity, so concurrent retries can consume the same login-failure budget and obscure which member has observed the KV update.
- Verify member login, `/api/session`, opaque per-member Agent identities, conversation and memory isolation, `409` stale writes, cookie-authenticated `/agent` WebSockets, tombstones, and `DELETE /api/user-data`.
- Do not send a chat turn, completion request, route probe, or any other model request.
- Always purge temporary member data and remove both access-code entries in `finally`.
- When `GITHUB_SHA` or `EXPECTED_RELEASE_SHA` is present, verify `/release.json` before mutating temporary members and again after cleanup. A mismatch fails the run instead of reporting acceptance for a different deployed revision.
- When no concurrent edit occurred, restore the exact original access-code text and its `kv`, `secret`, or `managed` source. If a concurrent edit occurred, remove only the temporary labels, preserve other entries, and fail the run for operator review.
- Logs may contain milestone names and HTTP status codes only. Never print tokens, access codes, cookies, raw access-code payloads, memory, or conversation content.
- Public guest acceptance is manual and model-probe-free: use a fresh private window, verify an isolated guest session, verify only the configured public route is visible, verify member-only controls are absent, verify the member login path remains available, then disable public access and verify new anonymous entry is closed.

## 4. Validation & Error Matrix

| Condition | Expected result |
| --- | --- |
| `PRODUCTION_URL` missing | Exit before authentication or mutation |
| Non-local HTTP target | Reject before authentication |
| `ADMIN_TOKEN` missing or invalid | Exit before access-code mutation |
| Access-code revision changed before write | Receive `409`; do not overwrite |
| Temporary code is not visible after the 60-second propagation window | Fail and enter cleanup without exhausting the eight-failure source throttle |
| Member Agent identity is shared or exposes a label | Fail and enter cleanup |
| Stale conversation or memory write does not return `409` | Fail and enter cleanup |
| WebSocket does not emit `cf_agent_identity` | Fail on timeout and enter cleanup |
| Access codes change concurrently during cleanup | Remove temporary labels, preserve remaining entries, then fail for review |
| Cleanup cannot prove temporary labels are gone | Fail the workflow; do not report acceptance success |
| Release SHA changes before or after acceptance cleanup | Fail the workflow; do not report acceptance success for the original SHA |

## 5. Good / Base / Bad Cases

- Good: the exact deployed `main` SHA passes anonymous smoke, two temporary members pass every authenticated check, data is purged, the original access-code value/source is restored, admin logout succeeds, and the release SHA still matches after cleanup.
- Good: public access is enabled only after a manual guest check proves a constrained anonymous session and disabled again to prove rollback of the guest entry.
- Base: local Wrangler verification passes with dummy credentials and a local KV/DO state before the workflow is shipped.
- Bad: a shell script writes random access codes directly to KV, loses the original source, logs generated credentials, or exits on the first assertion without a cleanup path.
- Bad: treating the member acceptance workflow as public-guest acceptance, or using a hidden completion prompt to prove guest availability.

## 6. Tests Required

- Run the acceptance script against local Wrangler with dummy `ADMIN_TOKEN`, both a legacy access-code fixture and an empty managed bootstrap fixture; assert every milestone completes and the original source is restored afterward.
- Parse the workflow YAML and assert the job is restricted to `refs/heads/main`, shares the production mutation concurrency group with deployment, and does not cancel in-progress cleanup.
- Statically assert the acceptance script checks release SHA before mutation and after cleanup, checks admin logout status, uses a 60-second-class propagation window with fewer than eight attempts, and runs temporary-member login/purge sequentially.
- Run `node --check scripts/acceptance-production.mjs`.
- Run `npm run check:frontend`, `npm test`, `npm run typecheck`, `npx wrangler deploy --dry-run`, and `git diff --check`.
- After deployment through GitHub Actions, manually run `Production member acceptance` and retain only the run URL/result, never generated credentials or response bodies.
- When public access is enabled, retain only the public guest manual acceptance result and target route label, never prompts, responses, cookies, access codes, or screenshots with secrets.

## 7. Wrong vs Correct

### Wrong

```js
await putTemporaryCodes();
await runChecks();
await restoreCodes();
```

An assertion or network failure skips restoration, and labels generated inside `putTemporaryCodes` may be unavailable if the write commits but its response is lost.

### Correct

```js
const members = makeTemporaryMembers();
try {
  await putTemporaryCodes(members, expectedRevision);
  await runChecks(members);
} finally {
  await purgeMemberData(members);
  await removeTemporaryCodes(members);
}
```

Generate cleanup identifiers before mutation, guard configuration writes with revisions, and make cleanup part of the success condition.
