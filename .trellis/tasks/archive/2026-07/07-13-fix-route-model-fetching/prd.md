# Encrypted Route Key Management

## Goal

Allow administrators to add and rotate upstream route API keys from the Chatus admin UI after a one-time master-key setup, without storing plaintext keys in Git, GitHub configuration, route configuration, logs, or API responses.

## Background

- The current `API Key Ref` field stores only a binding name such as `LINE_D_KEY`.
- `resolveRouteKey` resolves that name from Worker environment bindings; entering a real key in the field fails with `missing_key` before the upstream `/models` endpoint is called.
- Production deployment currently supports route keys through individual Worker Secrets or one GitHub Actions secret, `WORKER_SECRETS_JSON`, but changing them requires another deployment.
- Route configuration is stored in KV and already uses admin authentication, audit records, and optimistic revision checks.
- Cloudflare Workers provides Web Crypto AES-GCM and KV is already bound as `CHAT_STORE`.

## Requirements

- Add a one-time environment secret named `ROUTE_KEYS_MASTER_KEY` for encrypting managed route keys.
- Store only versioned AES-GCM ciphertext, a unique random IV, and non-secret metadata in KV.
- Bind ciphertext authentication to the key reference name so ciphertext cannot be moved to another reference undetected.
- Add authenticated admin APIs to inspect configured status, set/replace a key, and delete a key.
- Never return stored key plaintext after write; responses expose only reference name, configured source/status, revision, and timestamps where useful.
- Add admin UI controls to enter, replace, and delete a route key while keeping `API Key Ref` as the stable logical identifier.
- Use managed encrypted keys for model listing, health checks, chat requests, scheduled checks, and route availability.
- Preserve existing `route.apiKey`, Worker Secret `apiKeyRef`, and user BYOK behavior for backward compatibility.
- Keep secret values out of route configuration, audit targets, logs, diagnostics, exports, tests, task files, and error messages.
- Document one-time setup, normal operation, fallback behavior, and master-key rotation limitations.

## Acceptance Criteria

- [ ] With `ROUTE_KEYS_MASTER_KEY` configured, an administrator can save a route key from `/admin.html` without redeploying.
- [ ] KV contains no plaintext copy of the saved key.
- [ ] Admin read APIs and page reloads show only that the reference is configured; they cannot recover the key.
- [ ] Model fetching succeeds immediately using the managed key.
- [ ] Chat requests, manual health checks, scheduled health checks, and public route availability use the same asynchronous resolver.
- [ ] Existing Worker Secret references continue to work when no managed key exists.
- [ ] User-provided BYOK still takes precedence where allowed, and `requiresUserKey` still blocks server-side keys.
- [ ] Missing or invalid master-key configuration produces an actionable admin-only error without breaking existing Worker Secret routes.
- [ ] Decryption/authentication failures do not leak ciphertext or key material and do not silently fall back to the wrong managed value.
- [ ] Setting, replacing, and deleting managed keys creates privacy-safe audit entries.
- [ ] Tests cover encryption round-trip, non-deterministic ciphertext, wrong master key/AAD failure, CRUD authorization, no-plaintext responses, resolver precedence, model fetching, health checks, and chat use.
- [ ] `npm run check:frontend`, `npm test`, `npm run typecheck`, `npx wrangler deploy --dry-run`, and `git diff --check` pass.

## Out of Scope

- Displaying or exporting existing plaintext route keys.
- Automatically creating Cloudflare or GitHub Secrets from the browser.
- Transparent master-key rotation; changing the master key requires re-entering managed route keys in this MVP.
- Moving unrelated access codes, administrator tokens, or user memory into the new vault.
- Local production deployment.

## Security Notes

- The screenshot contained credential-like material; it must not be copied into files, logs, tests, or responses.
- The master key must remain a GitHub/Cloudflare Secret and must not be stored in KV.
