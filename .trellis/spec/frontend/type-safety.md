# Type Safety

## Overview

The Worker, tests, and default React client use strict TypeScript. Legacy modules under `public/` remain plain ES modules and rely on focused tests plus structural checks.

## Type Organization

- Define cross-runtime contracts under `src/contracts/` once more than one runtime or service consumes them. Keep handler-local request shapes near the owning endpoint.
- Use literal unions for closed domains such as message roles, route types, and reset reasons.
- Reuse shared shapes across Worker handlers and Durable Object methods instead of recreating incompatible variants.
- Keep provider credential values inside server-side services. Contracts may expose credential source metadata, but browser and Agent state must never receive the secret value.
- Tests may use `as const` to preserve literal values, as in `tests/user-state.test.ts`.
- Keep browser HTTP response decoders and validators in `client/src/lib/api.ts`; components consume validated projections instead of casting raw JSON.
- Keep pure draft/conflict recovery helpers in `client/src/lib/` so they can be tested without a DOM runtime.
- Decode Skill, tool, MCP-server, MCP-secret, and discovery projections as exact semantic shapes. Labels are non-blank; tool executors are exact builtin/MCP unions; `authType: "none"` forbids `secretRef`; MCP remote names match `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`; and schema fingerprints are lowercase 64-character hex values.
- Legacy MCP tools may omit one or more governance fields only when the Worker has projected them as exactly `enabled: false` and `reviewRequired: true`. Every present governance field and the executor remain strictly validated; incomplete enabled or non-review tools reject the entire admin snapshot.
- MCP governance fields are executor-specific. Builtin tools must omit `reviewRequired`, fingerprints, side-effect, and review revision entirely; do not serialize boolean defaults for fields owned only by the MCP union.
- Characterize admin projection compatibility with the exact serialized Worker GET object passed to `isAdminConfigSnapshot`. Separate Worker/client fixtures are supporting tests, not proof that the cross-layer payload matches.
- Match browser bounds to the Worker projection: Skill/MCP/tool labels are at most 80 characters, Skill descriptions 500, tool descriptions 1000, Skill instructions 8000, MCP endpoints 2048, and managed secret references match `^[A-Z][A-Z0-9_]{1,63}$`.
- Keep the session decoder synchronized with the Worker projection. Policy flags such as `allowBringYourOwnKey` and `hasUserSystemPrompt` are required booleans, not optional component guesses.
- Treat member lifecycle payloads as exact shapes. Member objects, list envelopes, session-revocation metadata, credential responses, and revoke responses reject unknown keys so a server regression cannot silently smuggle a code or token into long-lived client state.
- Access codes belong only to the create/rotate mutation response type. They must not be added to `AdminMemberProjection`, member-list snapshots, revoke responses, configuration snapshots, or error details.
- Member configuration-removal and standalone session-revocation responses also use exact envelopes. The former validates the full sanitized config projection; the latter requires `{ ok, label, revoked, complete }` and accepts no token or credential fields.
- Current-day usage reset uses the exact `{ ok: true, label, day }` envelope. Reject unknown fields, blank labels, non-true `ok`, and non-canonical or nonexistent `YYYY-MM-DD` UTC dates before the component reports success.
- Setup status and setup smoke use the same exact `AdminSetupStatus` decoder. Accept only `ready`, `configSource`, and the fixed six-step object; each step accepts only `ready`, `status`, and a non-negative safe-integer `count`. Reject unknown keys, invalid finite enums, or any `ready`/`status` inconsistency so a server regression cannot smuggle a credential reference, endpoint, model name, member label, or access code into browser state.
- User-data export responses use an exact `chatus-user-data` v1 envelope with bounded conversation/message/file metadata and explicit truncation flags. Parse and validate the JSON body before creating a browser download; do not treat a MIME type or a Blob size alone as proof of the contract.

## Validation

- Treat request JSON, storage values, environment configuration, imports, and upstream model responses as runtime data requiring validation/normalization.
- Return stable machine-readable error codes and appropriate HTTP statuses.
- Reject unsupported backup versions and invalid routes rather than coercing them into partial state.
- Validate URLs and markdown protocols before rendering; `sanitizeMarkdownUrl` blocks executable schemes and unsupported data images.

## Common Patterns

- Narrow `unknown` values before field access.
- Normalize optional arrays/objects at the boundary.
- Include optimistic-concurrency revisions in response and mutation contracts.
- Use generic KV reads only when the expected stored shape is known and immediately checked.

## Forbidden Patterns

- Do not add `@ts-ignore`, `@ts-nocheck`, or broad type assertions to bypass a failing contract.
- Do not use `any` in production code when a concrete interface or `unknown` plus narrowing is possible.
- Do not cast raw request/storage data directly into a trusted domain type.
- Do not weaken `strict`, `noEmit`, or `isolatedModules` in `tsconfig.json` to make a change pass.

## Scenario: Encrypted Route-Key Management

### 1. Scope / Trigger

- Trigger: adding or changing admin-managed provider credentials, their storage format, resolver precedence, or deployment secret wiring.
- The browser is write-only for provider keys. Plaintext may cross the authenticated write request boundary, but it must never enter provider/logical-route configuration, offerings, read responses, diagnostics, audit targets, or exports.

### 2. Signatures

```text
GET    /api/admin/route-secrets
PUT    /api/admin/route-secrets/:apiKeyRef
DELETE /api/admin/route-secrets/:apiKeyRef
```

```typescript
async function resolveRouteKey(route: RouteConfig | ResolvedProviderRoute, env: Env, userApiKey: string): Promise<string>
```

KV records use `route-secret:<url-encoded apiKeyRef>` and the following stored shape:

```typescript
type EncryptedRouteSecret = {
  version: 1;
  algorithm: "AES-GCM";
  iv: string;
  ciphertext: string;
  updatedAt: string;
};
```

### 3. Contracts

- `apiKeyRef` must match `^[A-Z][A-Z0-9_]{1,63}$` for managed storage.
- `ROUTE_KEYS_MASTER_KEY` is optional for legacy compatibility, but managed writes require Base64-encoded 32 random bytes.
- AES-GCM uses a fresh 12-byte IV for every write and AAD `chatus:route-secret:v1:<apiKeyRef>`.
- `PUT` accepts `{ apiKey: string, expectedRevision?: string }`; `DELETE` accepts `{ expectedRevision?: string }`.
- Read and mutation responses expose only reference, source/status, timestamps, and revision metadata. They never expose plaintext, IV, or ciphertext.
- Runtime resolution receives `ResolvedProviderRoute`, whose provider-level credential reference is authoritative. Resolver precedence is user BYOK when allowed, `requiresUserKey` blocking server keys, legacy route/provider `apiKey` compatibility, managed encrypted key, same-name Worker binding, then missing.
- If a managed record exists but cannot be parsed or decrypted, do not silently fall back to a same-name Worker binding.
- Admin config projections use `hasLegacyKey` and `hasCustomHeaders` as non-sensitive markers. Ordinary config round-trips preserve the server-side legacy key or custom headers only while the corresponding marker remains explicit; deleting a marker is the only way to remove that hidden compatibility value. Marker values and any temporary migration reference are not credentials and must not be treated as secret material.
- Legacy route migration is allowed only when the credential remains valid after removing the inline `apiKey`: the referenced `apiKeyRef` resolves to managed storage or a same-name Worker Secret, or the route has an explicit valid `requiresUserKey` BYOK contract. The revision-checked API preflights every normalized route ID before one write, stores only the reference/contract, and removes the compatibility shadow without reading plaintext into browser state or copying it into the provider registry.
- The migration success decoder accepts exactly `{ revision, migrated, alreadyMigrated, statuses }`. It rejects a nested `config`, `source`, endpoint, credential, header, or any other extra field; React obtains the new sanitized snapshot through a separate `GET /api/admin/config` after success.
- A route with existing offerings and a stale legacy shadow is already provider-backed. Migration keeps its offerings and strips only the shadow, so neither the browser nor Worker may require the stale credential to remain resolvable.

### 4. Validation & Error Matrix

- Invalid reference -> `400 invalid_api_key_ref`.
- Empty or oversized key -> `400 api_key_required` / `400 api_key_too_long`.
- Stale revision -> `409 route_secret_conflict`; preserve the newer KV value.
- Missing or invalid master key on write -> `503 master_key_unavailable`.
- Invalid stored record -> `503 invalid_record` for admin consumers.
- Wrong master key or AAD/authentication failure -> `503 decrypt_failed` for admin consumers.
- No managed record -> continue to the same-name Worker binding for compatibility.
- Missing/stale config revision, invalid route IDs, missing/non-legacy routes, invalid BYOK policy, or inline-only credentials -> reject the migration without writing any route in the batch; response details contain only route IDs and allowlisted status/reason codes.
- Migration success containing `config`, `source`, endpoint, or any unknown key -> client rejects as `invalid_legacy_route_migration_response`.

### 5. Good/Base/Bad Cases

- Good: an admin saves a key, receives metadata only, and model listing/chat/manual health checks resolve it without redeployment.
- Base: no managed record exists, so an existing Worker Secret reference continues to work.
- Bad: ciphertext is moved to another reference or the master key changes; decryption fails and no alternate server key is selected silently.

### 6. Tests Required

- Assert KV never contains the submitted plaintext and API/audit responses omit plaintext and ciphertext fields.
- Assert replacing the same value creates a different IV and ciphertext.
- Assert wrong master keys and wrong AAD fail authentication.
- Assert authorization, revision conflicts, create/replace/delete, and invalid master-key errors.
- Assert precedence for BYOK, `requiresUserKey`, legacy `apiKey`, managed storage, and Worker Secret fallback.
- Assert managed keys are used by model listing, public route access, chat, and manual health checks.
- Assert admin config GET/PUT never returns legacy plaintext keys or custom header values, preserves hidden compatibility values only with `hasLegacyKey`/`hasCustomHeaders`, and removes them when the marker is explicitly deleted.
- Assert the Worker export and `wrangler.jsonc` do not register scheduled model-health checks.
- Assert the password input clears on save, route changes, refresh/login transitions, and failure paths.
- Assert the Worker migration response passes the exact client decoder, rejects injected config/source/endpoint fields, and the React flow reloads the authoritative config separately.

### 7. Wrong vs Correct

#### Wrong

```typescript
config.routes[id].apiKey = routeSecretInput.value;
return jsonResponse({ apiKey, ciphertext });
```

#### Correct

```typescript
await api(`/api/admin/route-secrets/${encodeURIComponent(apiKeyRef)}`, {
  method: "PUT",
  body: JSON.stringify({ apiKey, expectedRevision }),
});
clearRouteSecretInput();
```

Keep new `apiKeyRef` values in the provider registry; offerings never contain credentials. Legacy route-level `apiKeyRef` is read only for migration compatibility, while the Worker owns encryption, storage, and resolution.

## Scenario: Provider Finance Budget Projection

### 1. Scope / Trigger

Use this contract when changing the Provider finance snapshot, budget policy or
hold mutation, Operations rendering, or the Worker/client finance boundary.

### 2. Signatures

```text
GET  /api/admin/provider-finance?providerId=<id>&periodStart=<ms>&limit=<1..100>
POST /api/admin/provider-finance/budgets
POST /api/admin/provider-finance/budget-reservations/:reservationId/reconcile
```

```typescript
isProviderFinanceSnapshot(value: unknown): value is ProviderFinanceSnapshot
createProviderBudgetPolicy(input): Promise<ProviderBudgetPolicyResult>
reconcileProviderBudgetReservation(id, input): Promise<ProviderBudgetOperatorActionResult>
```

### 3. Contracts

- The top-level snapshot and every provider/policy/balance/reservation object use
  exact-key decoders. `hardBudgetEnforcement` must equal
  `instance_provider_v1`; it is not an optional feature hint.
- Budget modes, decision reasons, and reservation statuses are closed unions.
  Every micro-unit/count/version is a non-negative safe integer; timestamps are
  finite non-negative integers and fixed windows end after they start.
- `budgetPolicies`, `budgetBalances`, and `budgetReservations` are each bounded
  to 100 items. Unknown keys or one invalid nested row reject the complete
  finance snapshot instead of producing a partial trusted view.
- Mutation results are exact. Browser requests contain only the documented
  provider/currency/mode/window/integer/version or reservation/action/reason
  fields. Policy IDs, idempotency keys, approvers, hold duration, and event IDs
  are generated by the server and are not browser attribution.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Enforcement marker is absent or not `instance_provider_v1` | Reject the complete snapshot |
| Array exceeds 100 or nested object has an extra/invalid field | Reject the complete snapshot |
| Micros/count/version is negative, fractional, unsafe, or non-finite | Reject the complete snapshot or mutation response |
| Mode/status/reason is outside its closed union | Reject; do not coerce to an unknown UI state |
| Mutation response includes a credential, raw invoice, content, or unknown key | Reject before clearing the local dirty draft |

### 5. Good / Base / Bad Cases

- Good: a v3 Worker snapshot with bounded policies, aggregate denials/alerts,
  balances, and review holds passes once and renders without component casts.
- Base: a configured Provider with no policy returns empty budget arrays and the
  exact enforcement marker.
- Bad: accept `{ ...snapshot, budgetPolicies: rows as any }` or ignore an
  unknown server field that could carry sensitive finance evidence.

### 6. Tests Required

- Characterize the exact serialized Worker GET payload through the browser
  decoder, including empty and 100-item arrays.
- Reject unknown keys, 101 items, invalid safe integers, invalid modes/statuses,
  incorrect enforcement markers, and secret-like injected fields.
- Assert policy/action success decoders accept only exact envelopes and failed
  mutations retain dirty drafts until an authoritative refresh succeeds.

### 7. Wrong vs Correct

#### Wrong

```typescript
const finance = await response.json() as ProviderFinanceSnapshot;
```

#### Correct

```typescript
const value: unknown = await response.json();
if (!isProviderFinanceSnapshot(value)) throw new Error("invalid_provider_finance_response");
```

The component receives one fully validated bounded projection and never casts
raw Provider finance JSON.
