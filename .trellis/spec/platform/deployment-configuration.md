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
- MCP runtime factory: `createMcpRuntime({ resolveSecret, fingerprint, fetch? })` in `src/services/mcp-runtime.ts`
- MCP execution scope: `createExecution()` returns `executeTool(definition, value, server, signal)` plus idempotent `close()`

Both generated files are ignored by Git. The config stays at the repository root because Wrangler resolves `main`, assets, and schema paths relative to the config file location.

## 3. Contracts

Required GitHub Repository Variables:

| Name | Contract |
| --- | --- |
| `CHATUS_WORKER_NAME` | Stable 1-63 character lowercase Worker name using letters, numbers, and hyphens |
| `CHATUS_KV_NAMESPACE_ID` | Stable 32-character hexadecimal KV namespace ID |
| `CHATUS_PRODUCTION_URL` | HTTPS origin without credentials, port, path, query, or fragment |
| `CHATUS_R2_BUCKET_NAME` | Stable 3-63 character lowercase R2 bucket name using letters, numbers, and hyphens |
| `CHATUS_DOCUMENT_INGEST_QUEUE_NAME` | 1-63 letter/number/hyphen main Queue name with alphanumeric ends |
| `CHATUS_DOCUMENT_INGEST_DLQ_NAME` | Distinct 1-63 letter/number/hyphen dead-letter Queue name with alphanumeric ends |

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

The MCP runtime never reads KV or Worker bindings directly. The Worker injects
`secretRef => managedSecretService(env).resolve("mcp", secretRef)`, so MCP discovery and execution share the exact managed-record failure and fallback contract. The runtime owns MCP session creation, same-origin HTTPS enforcement, private literal-address rejection, manual redirect rejection, the 256 KB protocol-response bound, discovery filtering, stable schema fingerprints, per-run session reuse, tool-result normalization, and session cleanup. The Worker continues to own HTTP validation, configuration loading, audit, capability allow-lists, general tool-call/time/result budgets, and response mapping.

Each legacy or Agent capability run creates one `McpRuntimeExecution` and closes it in `finally` or the Agent runtime's `close()`. Runtime tool execution re-lists the saved server's tools before first use, requires the current annotations to retain `readOnlyHint === true` and `destructiveHint !== true`, compares the current stable schema fingerprint with the administrator-reviewed fingerprint, and rejects missing, changed, unsafe, or Task-required tools before `tools/call`. A cached session is scoped to one run and is never reused across users or conversations.

Wrangler `--secrets-file` is additive. Omitting a previously uploaded name does not delete the remote Worker Secret. Revocation requires stopping references, explicitly deleting the remote Secret in Cloudflare, and re-running deployment/smoke.

New Durable Object namespaces must use `new_sqlite_classes`; `new_classes` selects the key-value storage backend, which Workers Free cannot create. Never edit a migration tag that reached a successful deployment. If Cloudflare rejects a new tag before applying it, correct that unapplied tag before retrying rather than inventing a follow-up migration for a namespace that does not exist.

The checked-in Wrangler baseline defines exactly one ID-free `WORKSPACE_FILES` R2 binding so local Vitest, Playwright, Wrangler dev, and default dry-run do not need a production account. `prepare:deployment` requires `CHATUS_R2_BUCKET_NAME` and injects it as that binding's `bucket_name` in `.wrangler.deploy.jsonc`; it must reject a missing, duplicate, or malformed binding/name. Before preparing or validating the production config, GitHub Actions runs `scripts/provision-r2-bucket.mjs`: it performs an exact Cloudflare R2 bucket GET, creates only after `404` plus error code `10006`, then repeats the exact GET. Authentication, rate-limit, network, invalid-envelope, and every other API failure stop deployment without attempting creation. The generated production config used for dry-run must be the same file uploaded by GitHub Actions. R2 credentials and arbitrary object keys are never Worker Secrets, Repository Variables, or browser configuration.

The checked-in baseline also defines exactly one `DOCUMENT_INGEST` producer, one linked main consumer, and one linked DLQ consumer. The main consumer is fixed at `max_batch_size: 1`, `max_concurrency: 1`, `max_retries: 3`, and a distinct `dead_letter_queue`. `prepare:deployment` rewrites producer/consumer names to the two Queue Repository Variables, injects the same names as Worker vars for runtime event discrimination, and rejects missing, duplicate, unlinked, or drifted consumer settings.

Before generating the production config, GitHub Actions runs `scripts/provision-document-ingest-queues.mjs`. It lists Queue pages without relying on the undocumented `name` query parameter, performs client-side exact `queue_name` matching across every reported page, creates the DLQ before the main Queue only when absent, and repeats the exact lookup after creation. Cloudflare's Queue OpenAPI marks the success-envelope `success`, `errors`, and `messages` fields optional: a 2xx response may omit them, but any present `success` must be boolean and any present `errors` must be an array. The operation-specific `result` remains mandatory (`Queue[]` for list, with post-create exact lookup proving creation). A failed create is accepted only when a follow-up exact lookup proves a concurrent creator won; authorization, rate-limit, network, malformed-envelope/result/pagination, ambiguous-match, and non-exact verification failures stop deployment. Queue API credentials remain GitHub Actions secrets and never enter Worker vars or artifacts.

Production deploy and production member acceptance share the `chatus-production-mutation` concurrency group with `cancel-in-progress: false`. New production mutations wait instead of canceling an upload, smoke, generated-file cleanup, or temporary-member cleanup. Deploy checks that `GITHUB_SHA` is still the remote `main` tip early for fast failure and again immediately before the real Wrangler upload.

If Wrangler upload succeeds but the post-deploy smoke still observes an older release marker, the attempt remains failed and its manifest artifact remains authoritative evidence. Recovery may rerun the failed deploy job only through GitHub Actions and only while remote `main` is still the same `GITHUB_SHA`; the rerun must repeat provisioning, upload, exact-SHA smoke, and artifact retention. Task closure additionally requires a successful `Production member acceptance` run checked out at that exact SHA. A local production probe, a newer SHA, or the successful upload step alone cannot replace these gates.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Required Variable or Secret missing | Fail preflight before Wrangler upload; name the field, never its value |
| Worker name or KV/account ID malformed | Fail preflight |
| R2 bucket name is missing or malformed | Fail preflight before generating deployment files |
| Checked-in Wrangler config lacks exactly one `WORKSPACE_FILES` R2 binding | Fail preflight; do not invent a second binding |
| Queue names are missing, malformed, or equal | Fail preflight before provisioning or generated-file writes |
| Checked-in config lacks exactly one linked producer/main/DLQ consumer | Fail preflight; do not infer Queue topology |
| Main consumer batch/concurrency/retry values differ from `1/1/3` | Fail preflight; preserve the reviewed retry semantics |
| Exact Queue lookup proves absence | Create DLQ first, then main Queue, and verify each by exact name |
| Queue list returns 2xx with a valid `result` and omitted optional envelope fields | Accept the response and continue exact client-side matching |
| Queue envelope fields are present with invalid types, `success=false`, or list pagination is inconsistent | Fail closed; do not reinterpret the response as absence |
| Queue API returns auth, rate-limit, network, malformed, ambiguous, or non-exact data | Fail closed without treating it as successful provisioning |
| Exact R2 lookup returns `404` with code `10006` | Create the configured bucket through GitHub Actions, then verify it with another exact lookup |
| Exact R2 lookup returns auth, rate-limit, network, malformed, or any other error | Fail closed; do not reinterpret it as a missing bucket |
| Production URL uses HTTP or contains a path | Fail preflight |
| workers.dev hostname does not match Worker name | Fail preflight |
| `ROUTES_CONFIG` is not an object or has no valid enabled route | Fail preflight |
| Default/user/fallback references an unknown route | Fail preflight |
| Legacy-mode access code or admin token is below the minimum length | Fail preflight |
| Extra Secret tries to replace a reserved name | Fail preflight |
| Checked-out SHA is no longer the `main` tip | Fail before deployment, including the late pre-upload guard |
| Generated Wrangler config fails current Wrangler validation | Fail dry-run before deployment |
| Post-deploy SHA smoke fails | Fail the workflow; do not report release success |
| Upload succeeds but smoke temporarily observes an older release marker | Retain the failed manifest; rerun the failed deploy job through Actions only while `main` remains the same SHA, then require exact-SHA smoke and member acceptance to pass |
| Managed KV key is absent (`null`) | Allow a non-blank same-name Worker Secret fallback |
| Managed KV key exists but is empty or malformed | Return `invalid_record`; never read the Worker fallback |
| Managed record cannot decrypt or the master key is unavailable | Return `decrypt_failed` or `master_key_unavailable`; never read the Worker fallback |
| Managed record exists but administration cannot use it | Project `managed/unavailable`, preserve the record revision, and expose no secret material |
| Worker fallback contains only whitespace | Treat the credential as missing |
| MCP endpoint is non-HTTPS, credentialed, local, or a forbidden literal address | Return `mcp_endpoint_invalid` before connection |
| MCP transport requests another origin or receives a redirect | Return `mcp_endpoint_invalid` or `mcp_redirect_rejected`; never follow it |
| MCP response exceeds 256 KB by header or streamed bytes | Cancel the body and return `mcp_protocol_error` |
| Runtime schema fingerprint differs from the reviewed tool | Return `mcp_tool_changed`; do not invoke `tools/call` |
| Runtime tool is no longer explicitly read-only or becomes destructive | Return `mcp_tool_changed`; do not invoke `tools/call` even when its schema fingerprint is unchanged |
| MCP tool requires the Task protocol or returns non-text content | Return `mcp_tool_unsupported` |

## 5. Good / Base / Bad Cases

- Good: an installer configures the six non-secret instance/Queue Variables plus GitHub Secrets, Actions provisions R2 and both Queues, generates the target config, dry-run validates the exact bindings/routes/consumers, deploy uses the same config, and exact-SHA smoke passes.
- Good Queue lookup: a 2xx page omits optional `success/errors/messages`, exposes a valid Queue array and pagination, and the provisioner matches the configured name locally across all pages.
- Good recovery: the first post-upload smoke observes an older release marker, the failed manifest is retained, remote `main` is confirmed unchanged, the same Actions run is retried at the same SHA, and both exact-SHA smoke and production member acceptance pass with new artifacts.
- Base: `wrangler.jsonc` has generic local KV/R2 bindings and local Queue names, so Vitest, Playwright, Wrangler dev, and default dry-run work without production identifiers.
- Bad: commit an account/KV/domain/production Queue name, accept a main consumer with drifted retries or concurrency, create the main Queue before its DLQ, or reinterpret a Queue API authorization error as absence.
- Bad Queue lookup: require optional envelope fields, trust undocumented server-side name filtering, inspect only page 1, or create after an invalid/ambiguous list response.
- Good managed secret: the KV read returns `null`, so a trimmed Worker binding may satisfy the credential.
- Base managed secret: a valid encrypted record decrypts with its namespace/ref AAD and shadows any same-name Worker binding.
- Bad managed secret: an empty, malformed, moved, or undecryptable record silently falls through to an older Worker binding.
- Good MCP runtime: the Worker injects managed secret resolution, discovery records a stable reviewed fingerprint, execution revalidates both the fingerprint and read-only annotations, one capability run reuses its server session, and `close()` terminates it on every exit.
- Base MCP runtime: an unauthenticated read-only server needs no secret but still passes the same endpoint, response-size, schema, timeout, and cleanup checks.
- Bad MCP runtime: a service reads `env[secretRef]` itself, follows redirects, trusts discovery-time read-only annotations without checking them in the execution session, skips the runtime schema comparison, or leaves sessions open after cancellation.

## 6. Tests Required

- Unit-test custom-domain and workers.dev projections, input immutability, KV/R2/Queue binding injection, R2 and Queue provision existing/missing/concurrent/error branches, omitted optional Queue envelope fields, empty and multi-page Queue lists, ambiguous exact matches, invalid pagination, and removal of stale routes.
- Reject invalid names/IDs/URLs, mismatched workers.dev hosts, missing/disabled routes, bad references, weak legacy/admin credentials, malformed master keys, invalid access-code mode, and reserved Secret overrides.
- Assert every newly introduced Durable Object uses a SQLite-backed migration and reject `new_classes` in the checked-in Wrangler contract.
- Import workflow/config files as raw fixtures and assert all six Repository Variables, generated `--config`, shared non-canceling production concurrency, early and late stale-SHA checks, parameterized production URL, one `WORKSPACE_FILES` binding, exact Queue topology/settings, provisioning before config generation, and absence of a local `deploy` script.
- Parse the checked-in `.env.example` `ROUTES_CONFIG` after dotenv quote removal and require non-empty provider and route registries.
- Run `node --check` for deployment preparation and every provisioning script.
- Run `node --check scripts/provision-document-ingest-queues.mjs` and assert its logs/errors contain Queue names or bounded status/codes only, never tokens.
- Execute the generator with dummy values and run `npx wrangler deploy --dry-run --config .wrangler.deploy.jsonc`.
- Run `npm run check:frontend`, `npm test`, `npm run typecheck`, default `npx wrangler deploy --dry-run`, and `git diff --check`.
- For a post-upload release-visibility failure, retain both the failed and successful same-SHA deployment manifests and require the production-acceptance manifest to report `release=success,acceptance=success` for that SHA.
- Unit-test route and MCP namespaces symmetrically: valid encryption, exact-`null` fallback, empty/malformed records, master-key rotation, namespace/ref AAD isolation, blank Worker bindings, revision retention, and deletion.
- Keep provider-router tests for BYOK/legacy/managed/Worker precedence and assert Worker bindings are trimmed.
- Keep Worker API tests proving write-only responses, route/MCP namespace isolation, revision conflicts, deletion projection, model discovery, and MCP discovery/execution.
- Unit-test the MCP runtime with an injected JSON-RPC fetcher: secret resolver use, read-only discovery filtering, stable fingerprints, session reuse/close, schema-change rejection, unchanged-schema annotation-drift rejection with zero `tools/call` requests, unsafe destinations, redirects, and oversized responses.

## 7. Wrong vs Correct

### Wrong

```yaml
- run: npx wrangler deploy --secrets-file .prod.secrets.json
- run: npm run smoke:production -- https://maintainer.example "$GITHUB_SHA"
```

This deploys the checked-in instance binding, hard-codes one operator's target, and cannot protect against stale workflow runs.

### Correct

```yaml
- run: node scripts/provision-document-ingest-queues.mjs
- run: npm run prepare:deployment
- run: npx wrangler deploy --dry-run --config .wrangler.deploy.jsonc
- run: npx wrangler deploy --config .wrangler.deploy.jsonc --secrets-file .prod.secrets.json
```

Generate one validated target config from Repository Variables, use it for both dry-run and upload, then smoke `vars.CHATUS_PRODUCTION_URL` at the exact deployed SHA.

### Queue Envelope Decoding

Wrong:

```js
if (typeof payload.success !== "boolean") throw new Error("invalid envelope");
const queue = payload.result[0];
```

Correct:

```js
if (payload.success !== undefined && typeof payload.success !== "boolean") {
  throw new Error("invalid envelope");
}
for (const page of await listAllQueuePages()) {
  exactMatches.push(...page.result.filter((queue) => queue.queue_name === configuredName));
}
```

The Queue OpenAPI makes the generic success fields optional, while exact identity is an operation-level contract. Decode optional fields by type, then require and verify the list result across every page rather than treating missing metadata or a first-page miss as absence.

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

### MCP Runtime Composition

Wrong:

```typescript
const secret = String(env[server.secretRef] || "");
return executeMcp(server, secret, input);
```

Correct:

```typescript
const secrets = managedSecretService(env);
const runtime = createMcpRuntime({
  resolveSecret: (ref) => secrets.resolve("mcp", ref),
  fingerprint: secretFingerprint,
});
const execution = runtime.createExecution();
try {
  return await execution.executeTool(definition, input, server, signal);
} finally {
  await execution.close();
}
```

The correct composition keeps secret storage policy outside the protocol runtime while making session ownership and cleanup explicit.
