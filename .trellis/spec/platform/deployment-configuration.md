# Instance Deployment Configuration

## 1. Scope / Trigger

Use this contract whenever GitHub Actions deployment, Wrangler bindings/routes, production instance identity, Worker Secrets, first-party smoke, or third-party installation changes.

It also applies when code reads or writes encrypted route/MCP credentials. Runtime secret resolution is an infrastructure boundary even when the HTTP API and deployment files do not change.

Production deployment is GitHub-Actions-only. The checked-in Wrangler file is a local and dry-run baseline; it must not contain a production Worker name, KV namespace ID, account ID, route, or maintainer domain.

## 2. Signatures

- Prepare command: `npm run prepare:deployment`
- Base config: `wrangler.jsonc`
- Generated config: `.wrangler.deploy.jsonc`
- Generated Worker Secret file: `.prod.secrets.json`
- Production deploy: `npx wrangler deploy --config .wrangler.deploy.jsonc --secrets-file .prod.secrets.json`
- Default local verification: `npm run deploy:dry-run`
- Post-deploy verification: `npm run smoke:production -- "$PRODUCTION_URL" "$GITHUB_SHA"`
- Managed-secret factory: `createManagedSecretService(dependencies)` in `src/services/managed-secrets.ts`
- Runtime reads: `load(namespace, ref)` for managed-only reads and `resolve(namespace, ref)` for managed-then-Worker resolution
- Administration operations: `inspect`, `revision`, `write`, and `delete`

Both generated files are ignored by Git. The config stays at the repository root because Wrangler resolves `main`, assets, and schema paths relative to the config file location.

## 3. Contracts

Required GitHub Repository Variables:

| Name | Contract |
| --- | --- |
| `CHATUS_WORKER_NAME` | Stable 1-63 character lowercase Worker name using letters, numbers, and hyphens |
| `CHATUS_KV_NAMESPACE_ID` | Stable 32-character hexadecimal KV namespace ID |
| `CHATUS_PRODUCTION_URL` | HTTPS origin without credentials, port, path, query, or fragment |

If the production host is `<worker>.<account-subdomain>.workers.dev`, generated config uses `workers_dev: true` and no routes. Other hosts use `workers_dev: false` with one exact `custom_domain` route. A workers.dev hostname must match `CHATUS_WORKER_NAME`.

Required GitHub Secrets:

- `CLOUDFLARE_API_TOKEN` and 32-character `CLOUDFLARE_ACCOUNT_ID` for Wrangler only; they never enter the Worker Secret file.
- `ADMIN_TOKEN` with at least 24 characters.
- A structurally valid `ROUTES_CONFIG` with at least one enabled route, or legacy `UPSTREAM_API_KEY`.

`ACCESS_CODES` is no longer a required production Secret. The generated deployment config sets
`ACCESS_CODES_MODE="managed"`, so production access codes are created and rotated in KV through
the authenticated administrator surface. A local `ACCESS_CODES` value remains supported only for
legacy/local development mode; it is never read by the managed production deployment.

Local `.dev.vars` examples must survive Wrangler's dotenv quote removal. Write `ROUTES_CONFIG` as
single-quoted, unescaped, single-line JSON (or an equivalent raw single line) so the Worker receives
a value that can be passed directly to `JSON.parse`; do not wrap backslash-escaped JSON in double quotes.

Optional Worker Secrets are `SYSTEM_PROMPT`, `BLOCKED_PROMPTS`, `ROUTE_KEYS_MASTER_KEY`, and extra uppercase string entries from `WORKER_SECRETS_JSON`. The master key must be canonical Base64 for exactly 32 bytes. Extra entries cannot override core Worker Secrets, Cloudflare credentials, or instance Variables.

Encrypted route and MCP records use separate KV prefixes and AES-GCM AAD namespaces. `KVNamespace.get()` returning the literal `null` is the only condition that permits a same-name Worker Secret fallback. Any other stored value, including `""`, malformed JSON, invalid Base64, an unavailable master key, or failed decryption, represents an existing managed record and must not fall back. Runtime resolution throws the stable managed-secret error; administration inspection reports `source="managed"`, `status="unavailable"`, and never returns plaintext or ciphertext. Worker fallback values are trimmed and blank values are treated as missing.

Provider credential precedence remains `user BYOK > requiresUserKey > legacy apiKey > managed record > Worker Secret > missing`. The legacy `apiKey` branch belongs to provider routing and must not be folded into the generic managed-secret service.

Wrangler `--secrets-file` is additive. Omitting a previously uploaded name does not delete the remote Worker Secret. Revocation requires stopping references, explicitly deleting the remote Secret in Cloudflare, and re-running deployment/smoke.

New Durable Object namespaces must use `new_sqlite_classes`; `new_classes` selects the key-value storage backend, which Workers Free cannot create. Never edit a migration tag that reached a successful deployment. If Cloudflare rejects a new tag before applying it, correct that unapplied tag before retrying rather than inventing a follow-up migration for a namespace that does not exist.

Production deploy and production member acceptance share the `chatus-production-mutation` concurrency group with `cancel-in-progress: false`. New production mutations wait instead of canceling an upload, smoke, generated-file cleanup, or temporary-member cleanup. Deploy checks that `GITHUB_SHA` is still the remote `main` tip early for fast failure and again immediately before the real Wrangler upload.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Required Variable or Secret missing | Fail preflight before Wrangler upload; name the field, never its value |
| Worker name or KV/account ID malformed | Fail preflight |
| Production URL uses HTTP or contains a path | Fail preflight |
| workers.dev hostname does not match Worker name | Fail preflight |
| `ROUTES_CONFIG` is not an object or has no valid enabled route | Fail preflight |
| Default/user/fallback references an unknown route | Fail preflight |
| Legacy-mode access code or admin token is below the minimum length | Fail preflight |
| Extra Secret tries to replace a reserved name | Fail preflight |
| Checked-out SHA is no longer the `main` tip | Fail before deployment, including the late pre-upload guard |
| Generated Wrangler config fails current Wrangler validation | Fail dry-run before deployment |
| Post-deploy SHA smoke fails | Fail the workflow; do not report release success |
| Managed KV key is absent (`null`) | Allow a non-blank same-name Worker Secret fallback |
| Managed KV key exists but is empty or malformed | Return `invalid_record`; never read the Worker fallback |
| Managed record cannot decrypt or the master key is unavailable | Return `decrypt_failed` or `master_key_unavailable`; never read the Worker fallback |
| Managed record exists but administration cannot use it | Project `managed/unavailable`, preserve the record revision, and expose no secret material |
| Worker fallback contains only whitespace | Treat the credential as missing |

## 5. Good / Base / Bad Cases

- Good: an installer configures three non-secret Variables plus GitHub Secrets, Actions generates the target config, dry-run validates the exact bindings/routes, deploy uses the same config, and exact-SHA smoke passes.
- Base: `wrangler.jsonc` has a generic name and an ID-free `CHAT_STORE` binding, so Vitest, local dev, and default dry-run work without any production identifiers.
- Bad: commit an account/KV/domain value, interpolate shell text into JSONC, place a generated config under `.wrangler/` without rebasing relative paths, deploy without a stale-SHA guard, or assume removing a GitHub Secret deletes its remote Worker value.
- Good managed secret: the KV read returns `null`, so a trimmed Worker binding may satisfy the credential.
- Base managed secret: a valid encrypted record decrypts with its namespace/ref AAD and shadows any same-name Worker binding.
- Bad managed secret: an empty, malformed, moved, or undecryptable record silently falls through to an older Worker binding.

## 6. Tests Required

- Unit-test custom-domain and workers.dev projections, input immutability, KV binding injection, and removal of stale routes.
- Reject invalid names/IDs/URLs, mismatched workers.dev hosts, missing/disabled routes, bad references, weak legacy/admin credentials, malformed master keys, invalid access-code mode, and reserved Secret overrides.
- Assert every newly introduced Durable Object uses a SQLite-backed migration and reject `new_classes` in the checked-in Wrangler contract.
- Import workflow/config files as raw fixtures and assert Repository Variables, generated `--config`, shared non-canceling production concurrency, early and late stale-SHA checks, parameterized production URL, generic Wrangler baseline, and absence of a local `deploy` script.
- Parse the checked-in `.env.example` `ROUTES_CONFIG` after dotenv quote removal and require non-empty provider and route registries.
- Run `node --check` for both deployment scripts.
- Execute the generator with dummy values and run `npx wrangler deploy --dry-run --config .wrangler.deploy.jsonc`.
- Run `npm run check:frontend`, `npm test`, `npm run typecheck`, default `npx wrangler deploy --dry-run`, and `git diff --check`.
- Unit-test route and MCP namespaces symmetrically: valid encryption, exact-`null` fallback, empty/malformed records, master-key rotation, namespace/ref AAD isolation, blank Worker bindings, revision retention, and deletion.
- Keep provider-router tests for BYOK/legacy/managed/Worker precedence and assert Worker bindings are trimmed.
- Keep Worker API tests proving write-only responses, route/MCP namespace isolation, revision conflicts, deletion projection, model discovery, and MCP discovery/execution.

## 7. Wrong vs Correct

### Wrong

```yaml
- run: npx wrangler deploy --secrets-file .prod.secrets.json
- run: npm run smoke:production -- https://maintainer.example "$GITHUB_SHA"
```

This deploys the checked-in instance binding, hard-codes one operator's target, and cannot protect against stale workflow runs.

### Correct

```yaml
- run: npm run prepare:deployment
- run: npx wrangler deploy --dry-run --config .wrangler.deploy.jsonc
- run: npx wrangler deploy --config .wrangler.deploy.jsonc --secrets-file .prod.secrets.json
```

Generate one validated target config from Repository Variables, use it for both dry-run and upload, then smoke `vars.CHATUS_PRODUCTION_URL` at the exact deployed SHA.

### Managed Secret Fallback

Wrong:

```typescript
const raw = await store.get(key);
if (!raw) return workerSecret;
```

Correct:

```typescript
const raw = await store.get(key);
if (raw === null) return workerSecret.trim();
return decrypt(parseEncryptedRecord(raw));
```

The correct form distinguishes a missing KV key from a present but corrupted record and prevents accidental credential rollback.
