# Design: React Admin Migration and Legacy Admin Retirement

## Boundary

This task retires only the static administrator shell and migrates inline route configuration into the existing Provider + Offering schema. The legacy chat shell and runtime compatibility reader remain separate rollback surfaces.

## Migration Contract

Add `POST /api/admin/legacy-routes/migrate`:

```json
{
  "routeIds": ["logical-model-id"],
  "expectedRevision": "sha256"
}
```

The response is the normal sanitized admin config snapshot plus `migrated`, `alreadyMigrated`, and bounded per-route status metadata. It never includes endpoint values, credential values, custom header names/values, or raw exceptions.

The Worker performs an all-or-nothing preflight against `loadEditableConfig`:

1. Reject a stale revision before inspecting requested routes.
2. Normalize and deduplicate route IDs with the same grammar/limits as config IDs.
3. Classify every requested route as legacy, already migrated, missing, or blocked.
4. For a legacy route that does not require BYOK, resolve a credential from a copy with the inline `apiKey` removed. This allows managed storage or a same-name Worker binding but deliberately excludes the old plaintext shadow.
5. Abort the whole batch if any requested legacy route is unsafe.
6. Build one new Provider per route using a deterministic `<routeId>-provider` base and the existing collision-safe ID rule. Copy custom headers only inside the Worker process; never project them to the browser.
7. Replace the route transport shadow with one Offering while preserving route-owned policy fields and every external route reference.
8. Validate the resulting app config, write once to `ROUTES_CONFIG_KEY`, append one bounded audit event, and return the sanitized snapshot.

A repeat call against the current revision treats routes that already have offerings and no transport shadow as `alreadyMigrated`; it creates no Provider and performs no write.

## React Flow

The Provider panel derives legacy candidates from the sanitized snapshot. A compact migration band shows candidate count and safe/blocked status obtained without exposing secrets. The administrator opens one React `ConfirmDialog`, sees the route IDs and blocking remediation, and submits one migration request. A successful response replaces the shared snapshot so Provider and Logical Model panels update together.

The existing client-only `migrateLegacyLogicalModel` path is removed after the server flow lands; there must be a single migration authority.

## Credential Safety

- Inline legacy `apiKey` is never copied into the Provider.
- A configured managed secret or same-name Worker Secret remains referenced by `apiKeyRef`.
- `requiresUserKey: true` is a valid credential contract without a server key.
- Hidden custom headers may move route-to-provider only inside the server transaction and remain represented to React by `hasCustomHeaders`.
- Error and audit metadata use route IDs and stable reason codes only.

## Static Admin Retirement

Delete the three static admin artifacts and remove their offline cache/fingerprint/checker wiring. Intercept exact `/admin.html` before asset lookup and return a permanent same-origin redirect to `/react-chat/admin`. Do not redirect arbitrary missing assets or `/legacy/`.

README, self-hosting, and operations docs name `/react-chat/admin` as the only administrator UI. Advanced JSON reset and CSV reporting are explicitly retired; member memory remains available in the member workspace.

## Compatibility And Rollback

- Config migration preserves route IDs, so sessions, member assignments, defaults, public access and fallbacks do not require data migration.
- Provider-router legacy support remains, allowing unselected or blocked routes to continue working until the administrator remediates them.
- Reverting the code commit restores the old asset route but is not used to mutate production config. Migrated configurations remain valid provider-pool configurations under both current and rollback code.
- Production mutation is an explicit authenticated UI action after deployment, never a deploy side effect.

## Frontend Experience

Streaming scroll tracks whether the viewport is still near the bottom; only that state follows new deltas. Legacy image controls receive native keyboard semantics and focus evidence. Browser tests cover `/`, `/legacy/`, `/react-chat/`, `/react-chat/admin`, and the `/admin.html` redirect at desktop and 390px widths.

Admin chunk splitting is gated by measured compressed bytes and startup CPU. No split is added solely for architectural neatness.
