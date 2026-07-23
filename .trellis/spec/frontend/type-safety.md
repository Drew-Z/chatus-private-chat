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
- Keep the session decoder synchronized with the Worker projection. Policy flags such as `allowBringYourOwnKey` and `hasUserSystemPrompt` are required booleans, not optional component guesses.
- Treat member lifecycle payloads as exact shapes. Member objects, list envelopes, session-revocation metadata, credential responses, and revoke responses reject unknown keys so a server regression cannot silently smuggle a code or token into long-lived client state.
- Access codes belong only to the create/rotate mutation response type. They must not be added to `AdminMemberProjection`, member-list snapshots, revoke responses, configuration snapshots, or error details.
- Member configuration-removal and standalone session-revocation responses also use exact envelopes. The former validates the full sanitized config projection; the latter requires `{ ok, label, revoked, complete }` and accepts no token or credential fields.
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
- Legacy route migration is allowed only after the referenced `apiKeyRef` resolves to managed storage or a same-name Worker Secret. Migration stores the reference and removes the inline key without reading it into browser state or copying it into the provider registry.

### 4. Validation & Error Matrix

- Invalid reference -> `400 invalid_api_key_ref`.
- Empty or oversized key -> `400 api_key_required` / `400 api_key_too_long`.
- Stale revision -> `409 route_secret_conflict`; preserve the newer KV value.
- Missing or invalid master key on write -> `503 master_key_unavailable`.
- Invalid stored record -> `503 invalid_record` for admin consumers.
- Wrong master key or AAD/authentication failure -> `503 decrypt_failed` for admin consumers.
- No managed record -> continue to the same-name Worker binding for compatibility.

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
