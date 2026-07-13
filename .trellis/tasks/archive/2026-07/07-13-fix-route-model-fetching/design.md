# Design: Encrypted Route Key Management

## Boundaries

- `public/admin.html` and `public/admin.js`: write-only key management UI and configured-status display.
- `src/worker.ts`: authenticated APIs, encryption/decryption, KV persistence, resolver migration, and audit events.
- `tests/worker-api.test.ts`: API, crypto, resolver, and end-to-end regression coverage.
- `.github/workflows/deploy.yml`, `.env.example`, `README.md`, and `docs/operations.md`: one-time master-secret setup and operations.

## Storage Contract

Managed route keys use a namespaced KV key:

```text
route-secret:<url-encoded apiKeyRef>
```

The stored JSON contains no plaintext:

```ts
type EncryptedRouteSecret = {
  version: 1;
  algorithm: "AES-GCM";
  iv: string;          // base64
  ciphertext: string;  // base64, includes the GCM authentication tag
  updatedAt: string;
};
```

`apiKeyRef` is validated with `^[A-Z][A-Z0-9_]{1,63}$`. AES-GCM additional authenticated data is `chatus:route-secret:v1:<apiKeyRef>`.

## Master-Key Contract

`ROUTE_KEYS_MASTER_KEY` is a base64-encoded 32-byte random value. The Worker decodes it and imports it as a non-extractable AES-GCM key. Invalid/missing values disable managed-key writes and return an admin-only configuration error; existing environment Secret routes continue to resolve.

## Admin API

All endpoints use the existing admin session guard.

```text
GET    /api/admin/route-secrets
PUT    /api/admin/route-secrets/:ref
DELETE /api/admin/route-secrets/:ref
```

- `GET` returns master-key readiness plus managed reference metadata; never plaintext/ciphertext.
- `PUT` accepts `{ apiKey, expectedRevision? }`, encrypts it, stores it, and returns metadata/revision.
- `DELETE` accepts an optional expected revision, deletes the managed key, and returns success.
- Audit actions are `route-secret.update` and `route-secret.delete`; targets contain only the reference name.

## Resolver Contract

Convert route-key resolution to asynchronous behavior:

```text
user BYOK (when allowed)
  -> requiresUserKey blocks server keys
  -> legacy route.apiKey
  -> managed encrypted key for apiKeyRef
  -> Worker environment binding for apiKeyRef
  -> missing key
```

Managed-key decryption failure is treated as unavailable and surfaced to admin operations. It must not expose secret material. Existing environment bindings remain a compatibility fallback.

## UI Flow

- Keep `API Key Ref` as the stable identifier.
- Add a password input labelled as a new/replacement route key.
- Show status such as `后台密钥已配置`, `使用 Worker Secret`, or `未配置`.
- A save/replace command sends the key directly to the authenticated vault endpoint, then clears the password field.
- A delete command removes only the managed KV key; an environment Secret with the same reference may still be used and the UI must reflect that fallback.
- Model fetching uses the reference after key save, avoiding plaintext in the model-list request.

## Compatibility And Rollback

- No migration is required for existing Worker Secrets or `WORKER_SECRETS_JSON`.
- Removing managed KV entries restores environment-binding behavior.
- If the feature is rolled back, encrypted KV entries are inert and contain no usable plaintext without the master key.
- Changing `ROUTE_KEYS_MASTER_KEY` invalidates current managed entries; operations docs require re-entering them after rotation.

## Security Trade-offs

- KV and ciphertext reside in the same Cloudflare account, but the master key remains a separate Worker Secret. An attacker needs both to decrypt.
- The browser can submit a new key but cannot retrieve one, reducing accidental disclosure and XSS impact compared with read-back APIs.
- AES-GCM uses a fresh 96-bit IV for every write, so replacing a key produces different ciphertext even for identical plaintext.
