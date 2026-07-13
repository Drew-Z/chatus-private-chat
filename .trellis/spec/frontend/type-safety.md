# Type Safety

## Overview

The Worker and tests use strict TypeScript. Browser modules are plain ES modules and rely on careful runtime checks plus focused tests/static checks.

## Type Organization

- Define Worker domain interfaces and unions close to their use in `src/worker.ts` while the backend remains a single module.
- Use literal unions for closed domains such as message roles, route types, and reset reasons.
- Reuse shared shapes across Worker handlers and Durable Object methods instead of recreating incompatible variants.
- Tests may use `as const` to preserve literal values, as in `tests/user-state.test.ts`.

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

- Trigger: adding or changing admin-managed upstream route credentials, their storage format, resolver precedence, or deployment secret wiring.
- The browser is write-only for route keys. Plaintext may cross the authenticated write request boundary, but it must never enter route configuration, read responses, diagnostics, audit targets, or exports.

### 2. Signatures

```text
GET    /api/admin/route-secrets
PUT    /api/admin/route-secrets/:apiKeyRef
DELETE /api/admin/route-secrets/:apiKeyRef
```

```typescript
async function resolveRouteKey(route: RouteConfig, env: Env, userApiKey: string): Promise<string>
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
- Resolver precedence is user BYOK when allowed, `requiresUserKey` blocking server keys, legacy `route.apiKey`, managed encrypted key, same-name Worker binding, then missing.
- If a managed record exists but cannot be parsed or decrypted, do not silently fall back to a same-name Worker binding.

### 4. Validation & Error Matrix

- Invalid reference -> `400 invalid_api_key_ref`.
- Empty or oversized key -> `400 api_key_required` / `400 api_key_too_long`.
- Stale revision -> `409 route_secret_conflict`; preserve the newer KV value.
- Missing or invalid master key on write -> `503 master_key_unavailable`.
- Invalid stored record -> `503 invalid_record` for admin consumers.
- Wrong master key or AAD/authentication failure -> `503 decrypt_failed` for admin consumers.
- No managed record -> continue to the same-name Worker binding for compatibility.

### 5. Good/Base/Bad Cases

- Good: an admin saves a key, receives metadata only, and model listing/chat/health checks resolve it without redeployment.
- Base: no managed record exists, so an existing Worker Secret reference continues to work.
- Bad: ciphertext is moved to another reference or the master key changes; decryption fails and no alternate server key is selected silently.

### 6. Tests Required

- Assert KV never contains the submitted plaintext and API/audit responses omit plaintext and ciphertext fields.
- Assert replacing the same value creates a different IV and ciphertext.
- Assert wrong master keys and wrong AAD fail authentication.
- Assert authorization, revision conflicts, create/replace/delete, and invalid master-key errors.
- Assert precedence for BYOK, `requiresUserKey`, legacy `apiKey`, managed storage, and Worker Secret fallback.
- Assert managed keys are used by model listing, public route access, chat, manual health checks, and scheduled checks.
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

Keep route configuration limited to `apiKeyRef`; the Worker owns encryption, storage, and resolution.
