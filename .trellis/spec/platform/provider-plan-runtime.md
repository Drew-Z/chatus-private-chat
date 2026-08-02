# Provider Plan Runtime

## 1. Scope / Trigger

Use this contract when changing runtime provider candidate planning, passive quality ordering, access/capability filtering, BYOK eligibility, credential preparation, or pre-attempt fallback indexes.

The module composes the pure provider router with injected reliability and credential dependencies. Session authorization, logical-route permission calculation, quotas, provider leases, protocol requests, response lifecycle, telemetry writes, and user-facing error responses remain outside it.

## 2. Signatures

- Module: `src/services/provider-plan-runtime.ts`
- Factory: `createProviderPlanRuntime({ routes, providers, resolveCredential, loadQuality, credentialErrorMessage? })`
- Ordered plan: `buildPlan(routeIds)`
- Prepared plan: `preparePlan({ routeIds, accessRoutes, userApiKey, accepts? })`
- Prepared candidate: `ResolvedProviderRoute & { credential, planIndex }`

Dependencies are injected so deterministic tests never read KV, resolve a real secret, acquire a provider lease, or call a model.

## 3. Contracts

- `routeIds` are logical route IDs already selected through the authenticated allow-list and fallback chain. Unknown, disabled, or provider-less routes produce no executable candidate.
- Callers choose the logical fallback boundary. Normal chat may pass its authenticated fallback chain; the Automatic Skill selector must pass exactly `[selectedRouteId]` so only offerings inside the main answer's logical model are eligible.
- Candidate expansion and ordering continue to use `provider-router.ts`. Administrator priority is authoritative; injected recent passive quality only breaks equal-priority ties for the exact logical-route/provider pair.
- `loadQuality` reads existing real-task evidence only. Planning must never send a model request or create synthetic reliability data.
- `accessRoutes` are the current server-derived member or guest projection. A physical candidate whose logical route is absent from that projection is discarded.
- The optional `accepts` predicate runs before credential resolution. Image/tool-incompatible and otherwise unusable candidates must not read managed secrets or receive a user key.
- A user key is passed to `resolveCredential` only when the matching access route has `allowUserKey=true`; otherwise the runtime passes an empty string.
- Credential precedence and managed-record authority remain owned by `resolveProviderCredential` through the injected resolver. A managed decrypt/record failure must not fall back to a Worker binding.
- `planIndex` is assigned after access and capability filtering but before credential availability filtering. It therefore preserves whether a later usable candidate represents pre-output fallback even when earlier credentials are unavailable.
- A missing credential records `route key is not configured` and allows the next eligible candidate unless the access projection requires a user key.
- When `requiresUserKey=true` and no credential resolves, preparation stops with `userKeyRequiredRouteId`; callers translate that stable condition for their own transport.
- Credential exceptions are bounded through `credentialErrorMessage`; arbitrary exception details are not exposed by default.
- Administrator legacy-route migration changes only the physical representation. It preserves each logical route ID and external references; routes without offerings receive one persisted Provider plus Offering, while already Provider-backed routes only lose stale compatibility fields. After migration, plan construction must resolve the persisted offering and must not recreate or prefer a `legacy:<routeId>` shadow.

## 4. Ownership Boundary

The Worker creates one plan runtime from its current immutable configuration snapshot. It injects recent provider-route reliability reads and the managed-secret-aware credential resolver.

Legacy chat streaming, Team Agent turns, small completion tasks, and legacy capability tool loops consume the same prepared-plan contract. Each caller may apply its own image/tool predicate, then owns capacity acquisition, attempt execution, pre-output fallback decisions, telemetry, quota release, and response formatting.

The plan runtime never retries an attempted provider and never observes visible stream output. The rule that fallback cannot cross the first-visible-output boundary remains in the protocol and response lifecycle layers.

`preparePlan()` has no abort/deadline contract and may await passive-quality or credential dependencies. A bounded auxiliary caller such as Automatic Skill selection must race the entire pipeline, including `preparePlan()`, leases, Provider I/O, telemetry, and release, against its own hard deadline. Passing an abort signal only to the later Provider request is insufficient.

## 5. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Equal priority with recent passive quality | Order by quality for the exact route/provider pair |
| Higher administrator priority with worse quality | Keep the higher-priority candidate first |
| Logical route is absent from `accessRoutes` | Drop it before credential resolution |
| `accepts` rejects a candidate | Drop it before credential resolution |
| Access route disallows BYOK | Pass an empty user key to the resolver |
| Credential resolver throws | Record the bounded projected error and continue |
| Credential is missing and user key is optional | Record the missing-key error and continue |
| Credential is missing and user key is required | Stop with `userKeyRequiredRouteId` |
| Earlier candidate is unusable | Preserve the later candidate's filtered-plan index |
| Automatic Skill selector requests a plan | Pass only the selected logical route; offering fallback is allowed, logical-route fallback is forbidden |
| Bounded caller dependency ignores abort | Caller hard deadline returns its fallback and rejects any late result |
| Persisted route has offerings after legacy migration | Build candidates only from those offerings; no compatibility shadow candidate |

## 6. Tests Required

- Unit-test exact route/provider quality loads and administrator-priority ordering.
- Unit-test access and capability filtering before credential resolution.
- Unit-test allowed and disallowed BYOK propagation.
- Unit-test credential exceptions, missing credentials, fallback indexes, and required-user-key termination.
- Keep Worker and Team Agent integration tests for streaming, tool loops, fallback, leases, quotas, telemetry, and cancellation.
- Assert a migrated route preserves its logical ID and produces the same executable route behavior through the persisted Provider + Offering; assert a Provider-backed shadow cleanup creates no duplicate Provider.
- For Automatic Skill selection, assert offering fallback works, no configured logical fallback is contacted, and a late successful Provider result is ignored after five seconds.
- Run `npm run check:frontend`, `npm test`, `npm run typecheck`, `npx wrangler deploy --dry-run`, and `git diff --check`.

## 7. Wrong vs Correct

### Wrong

```typescript
for (const route of providerPlan) {
  const credential = await resolveCredential(route, userApiKey);
  if (!route.supportsTools) continue;
}
```

This reads secrets and forwards BYOK material before proving that the candidate is accessible and usable.

### Correct

```typescript
const prepared = await runtime.preparePlan({
  routeIds,
  accessRoutes,
  userApiKey,
  accepts: (route) => route.supportsTools,
});
```

One runtime contract now owns passive ordering, filtering, BYOK gating, and credential preparation for every provider execution path.
