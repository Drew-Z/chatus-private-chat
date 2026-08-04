# Component Guidelines

## Overview

The default teammate frontend uses typed React components under `client/`. The legacy chat remains an independent HTML rollback surface under `/legacy/`; administration is fully owned by typed React under `/react-chat/admin`. The exact `/admin.html` path only redirects to that React entry.

## Component Structure

- Keep the React composition root small: session gating belongs in `App.tsx`; daily workspace, conversation navigation, message rendering, and memory controls belong in focused components.
- Pass stable owning IDs and server projections explicitly. Async results must update the conversation or editor that initiated them, not whichever view is active later.
- Prefer native controls and semantic dialog roles. Modal drawers must receive initial focus, contain Tab navigation, support Escape, and restore focus to the opener.
- In the legacy chat, define stable markup in `public/index.html`, resolve nodes near the top of `public/app.js`, and attach listeners once. Administrator markup belongs in typed React components.

Examples in `public/app.js` include the session list, model picker, settings dialog, message list, and shared application dialog.

## Data and Parameter Conventions

- React components use typed props and local state; shared asynchronous/browser contracts stay in `client/src/lib/` rather than being redefined inside components.
- Legacy page modules use module-scoped state. Reusable helpers accept explicit values and return data or DOM-safe output.
- Pass the owning entity explicitly for asynchronous work. Cloud saves and summaries retain the chat/session ID so results do not update whichever chat happens to be active later.

## Admin Provider Discovery And Logical Model Offerings

- Keep `routeModelInput` as an ordinary manual text input. A native `datalist` is not an acceptable full-list browser because the browser filters options using the current input value.
- Store fetched provider models in module-scoped ephemeral state. Opening the model dialog clears only its dedicated search field and renders the complete fetched list; it must not clear or filter from `routeModelInput`.
- Invalidate fetched models when the selected provider, protocol, Base URL, or API Key Ref changes. Do not persist or log upstream model responses.
- Keep the provider registry separate from logical routes. A provider owns protocol, endpoint, credential reference, concurrency, and default priority; a logical route owns the user-visible model identity, fallback logical models, capabilities, and permissions.
- An offering stores only `providerId`, upstream `model`, enabled state, and optional priority/capability overrides. Never copy provider endpoint, headers, credential references, or plaintext keys into an offering.
- In typed administration, label each identifier by entity: `logical model ID`, `Provider ID`, and upstream model must not appear as interchangeable bare IDs. Count route mappings as Provider exits/offerings, keep the selected Provider ID visible even when a native select truncates its label, and render Provider references with both the logical-model label and ID.
- Batch setup merges an offering into an existing logical model when appropriate or creates a new logical model, then saves through `/api/admin/config` with `expectedRevision`. It must not modify `defaults.allowedRoutes` or user `allowedRoutes` implicitly.
- Batch setup must never read `providerSecretInput`, copy a legacy plaintext `apiKey`, or overwrite an existing provider/logical-model ID. Provider credentials are entered through the write-only secret action.
- The signed-in model picker exposes logical routes, not physical provider offerings. Keep every selectable button discoverable through the shared `.model-option` query so Arrow, Home, End, Escape, and Tab behavior continues to work across groups.
- Legacy routes with `type`, `baseUrl`, and `model` remain readable and require an explicit migration action before their endpoint fields are removed; migration must preserve fallback and permission references.

### Typed Admin Draft Preservation And Conflict Recovery

- Exact provider/logical-model projections use a locale-independent code-unit comparator for IDs, labels, and reference lists. Do not use the runtime's default `localeCompare` for persisted or test-asserted order because Node/browser ICU defaults differ across Windows and Linux.
- Build provider and logical-model drafts through shared helpers that spread the sanitized server projection before applying visible defaults. This preserves safe fields that are intentionally not rendered as controls, such as provider auth metadata and legacy route limits or user-key policy.
- A pool editor is local component state. Switching away from the provider or logical-model view unmounts that editor, so the navigation guard must say that the unsaved pool draft will be discarded and clear the shared pool-dirty flag after confirmation. Do not claim that an unmounted pool draft is retained.
- On `config_conflict`, refresh the authoritative snapshot, keep the local entity draft dirty for retry, and expose an explicit "use server version" action that resets the selected draft and clears the conflict state.
- A passive reliability projection must pass each stored provider-route record through the shared recent-record predicate. Expired or future observations render as unknown/no-data rather than as a current unhealthy or healthy result.
- Provider secret inputs are scoped to the saved provider and its current `apiKeyRef`. Changing provider, changing the ref, opening a new provider, refreshing, or leaving the editor clears the password value; a ref cannot be written before its provider projection is saved.
- Provider and logical-model renames must check the current registry for an existing target ID before applying the draft. A collision is an inline validation error, not a delete-and-overwrite operation.
- Offering capability overrides are three-state controls: unset inherits the provider/logical-model capability, while explicit true/false values are persisted on the offering.

### Typed Admin Operations Projection

- The typed Operations view reads the existing model-free `/api/admin/stats`, `/api/admin/audit`, and `/api/admin/feedback` endpoints through one browser API helper. Each response has an exact runtime decoder; components never cast raw JSON.
- Statistics validation preserves the server projection, not only its field types: the current day is first, trend/route/user day arrays retain the same order, totals equal their daily sums, rates match their counts, route statistics match the configured route list, and current member usage matches the first daily bucket.
- Render only aggregate counts, member labels/display names, logical-route metadata, feedback rating/reason/time, and bounded audit action/target/time. Never render prompts, completions, message text, stored memory, plaintext credentials, custom headers, or raw provider payloads. Conversation/message identifiers used by the feedback repository are not visible UI content.
- Keep the view passive. Refreshing Operations may read Durable Object, KV, session, and real-task metric state, but it must not call model discovery, provider validation, route-health completions, or any other model endpoint.
- Use an unframed, scannable operations layout. Summary metrics form one full-width band; sections use restrained separators rather than nested cards. The eight-column member table scrolls inside its own wrapper on narrow screens and must never widen the admin page.
- Desktop and 390px browser fixtures use synthetic `AdminOperationsSnapshot` data and render `AdminOperationsContent` directly so visual tests cannot authenticate, call `/api`, or contact a model.

## Scenario: Recoverable React Admin Safety

### 1. Scope / Trigger

- Trigger: changing administrator logout, initial admin data loading, Operations list reachability, or destructive confirmation behavior in the composed React admin workspace.

### 2. Signatures

```text
POST /api/admin/logout -> { ok: true }
```

```typescript
type AdminViewState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T; refreshing: boolean }
  | { status: "error"; message: string };

type ConfirmDialogProps = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  fallbackFocus?: () => HTMLElement | null;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

paginateOperations<T>(items: T[], requestedPage: number, pageSize = 20)
```

### 3. Contracts

- Admin logout is fail-closed. The Worker awaits deletion of `admin:<token>` before returning `200`, `{ ok: true }`, and the clearing cookie. A deletion failure returns a non-2xx response without `Set-Cookie`; the existing session remains usable for retry.
- The browser accepts only the exact logout envelope `{ ok: true }`. Network errors, non-2xx responses, empty bodies, non-JSON bodies, `ok !== true`, and unknown keys reject. `AdminWorkspace` calls `onLogout()` only after this decoder succeeds; otherwise it keeps the workspace mounted and exposes a retry action.
- AdminWorkspace and Operations initial loads use mutually exclusive `loading | ready | error` states. An initial failure shows an error and retry instead of ready content or an indefinite spinner. A refresh may retain the last ready snapshot with `refreshing: true`.
- Each load owns a monotonically increasing generation. Success and failure may update state only when their generation is still current, so an older request cannot overwrite a newer snapshot or error.
- Operations routes, feedback, audit, and member usage filter before pagination, use a stable page size of 20, and display `current page item count / filtered total`. Previous/next controls expose item 21 and later to keyboard and touch users.
- The shared React `ConfirmDialog` owns pending and error state for one confirmation attempt. While pending, confirmation cannot repeat and Escape/backdrop/cancel cannot close the dialog. Rejection keeps the dialog open with an inline alert; success closes it.
- The dialog receives initial focus, contains forward and reverse Tab navigation, closes on Escape when idle, and restores the connected opener. A destructive mutation that removes its opener supplies a connected fallback target, normally the next active entity or the add button.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Admin-session KV deletion rejects | Logout returns non-2xx, sends no clearing cookie, and preserves the session |
| Logout response is not exact `{ ok: true }` | Browser rejects it and keeps the authenticated workspace |
| Initial admin request fails | Render only the error/retry state |
| Older admin request completes last | Ignore both its success and its failure |
| Filter leaves 21 Operations items | Show 20 / 21 on page one and expose item 21 on page two |
| Confirmation mutation rejects | Keep the dialog open, clear pending, and render an alert |
| Confirmation is pending | Ignore repeat confirmation, Escape, backdrop, and cancel |
| Successful deletion removes the opener | Restore focus to the supplied connected fallback |

### 5. Good / Base / Bad Cases

- Good: logout KV deletion succeeds, the exact response validates, and only then does the React session gate return to login.
- Base: an Operations refresh fails after a ready snapshot; the snapshot remains visible, refreshing ends, and a retryable notice explains the failure.
- Bad: the client swallows a logout `500`, clears its local session, or accepts `{ ok: true, token: "..." }` as success.
- Bad: a long Operations list uses `slice(0, 20)` without navigation, or a dialog closes on mutation rejection and drops the only retry context.

### 6. Tests Required

- Worker tests assert successful logout deletes KV and clears the cookie, deletion failure returns `500` with no `Set-Cookie` and preserves the session, and cross-origin logout has no session or cookie side effect.
- Browser API tests assert network, HTTP, empty/non-JSON, false, and unknown-key logout responses reject; exact `{ ok: true }` succeeds.
- Workspace browser tests assert loading, ready, initial error, successful retry, fail-closed logout, dialog focus/Tab/Escape/pending/error/retry/fallback focus, and the 20/21 boundary for all four Operations lists.
- Pagination helper tests assert empty, 20, 21, and stale-page clamping behavior. Fixtures remain synthetic and must not authenticate, call a model, or contact production.

### 7. Wrong vs Correct

#### Wrong

```typescript
await fetch("/api/admin/logout", { method: "POST" }).catch(() => undefined);
onLogout();
const visible = filtered.slice(0, 20);
```

#### Correct

```typescript
await adminLogout(); // exact response decoder; throws on every failure
onLogout();

const page = paginateOperations(filtered, requestedPage, 20);
```

## Scenario: Recoverable React Member Logout

### 1. Scope / Trigger

- Trigger: changing ordinary member logout, authenticated workspace account locks, or user-scoped draft cleanup.

### 2. Signatures

```text
POST /api/logout -> { ok: true }
```

```typescript
type LogoutState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "error"; message: string };
```

### 3. Contracts

- The browser sends member logout through the shared JSON request boundary and accepts only the exact envelope `{ ok: true }`. Network failures, non-2xx responses, empty or non-JSON bodies, `ok !== true`, and unknown keys reject as typed errors.
- `ChatWorkspace` owns `idle | pending | error`. One in-flight guard prevents duplicate requests; pending joins the account-operation lock so conflicting account, MCP, conversation, message, and Composer actions cannot start.
- `WorkspaceHeader` receives an explicit `logoutPending` projection. The icon-only logout control is disabled while pending and exposes `正在退出登录` through both its accessible label and title.
- A failed request keeps the authenticated workspace, active conversation, Composer value, and every current-member draft key. A dedicated `role="alert"` renders the failure plus a `重试退出` command that invokes the same revocation path.
- The current member's draft keys are cleared only after `onLogout()` resolves. Revoke-all and permanent-delete retain their separate server-mutation-first flows.
- The Worker deletes `session:<token>` before returning the exact success envelope and clearing cookie. A KV deletion failure returns non-2xx without `Set-Cookie`; the original session remains valid for retry.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Network, HTTP, empty, non-JSON, false, or unknown-key response | Reject; keep workspace and drafts; show retry alert |
| Logout is pending | Keep at most one request; disable the logout control and conflicting operations |
| Session KV deletion rejects | Return `500`, send no clearing cookie, and preserve the member session |
| Retry returns exact `{ ok: true }` | Leave the old member session and then clear its draft keys |
| Logout flow runs | Make zero Provider, model-selection, MCP, or OAuth calls |

### 5. Good / Base / Bad Cases

- Good: the first revocation attempt fails, the draft and workspace remain usable, and explicit retry succeeds before local cleanup.
- Base: the first request returns exact success, session refresh reaches the configured guest/login surface, and only the old member's drafts are removed.
- Bad: clear drafts before awaiting the API, swallow a rejected fetch, accept `{ ok: true, extra: true }`, or reuse a conversation-refresh action as the logout retry.

### 6. Tests Required

- Browser API tests accept only exact `{ ok: true }` and reject network, HTTP, empty/non-JSON, false, and unknown-key outcomes.
- Worker integration injects target member-session KV deletion failure and asserts `500`, no clearing cookie, preserved session access, exact successful retry, and final unauthorized access with the old cookie.
- Workspace fixtures render real presentational components for idle, pending, error, and retry at desktop and touch-enabled 390px; assert labels, disabled conflicts, keyboard retry, containment, and no horizontal overflow without `/api` or Agent calls.
- Local fake-Provider Agent acceptance fills a draft, fails the first logout, compares workspace/session/storage fingerprints and Provider counters, retries against the local Worker, and asserts draft cleanup plus return to login.

### 7. Wrong vs Correct

#### Wrong

```typescript
clearUserDrafts(session.user);
await fetch("/api/logout", { method: "POST" }).catch(() => undefined);
```

#### Correct

```typescript
setLogoutState({ status: "pending" });
await logout(); // exact decoder; throws on every failure
clearUserDrafts(session.user);
```

## Scenario: Model-Free First Setup Closure

### 1. Scope / Trigger

- Trigger: changing the authenticated setup projection, local setup smoke, first-use React admin routing, or the typed/legacy administration navigation boundary.

### 2. Signatures

```text
GET  /api/admin/setup-status -> AdminSetupStatus
POST /api/admin/setup-smoke  -> AdminSetupStatus | 409 setup_incomplete
```

```typescript
type AdminSetupStepStatus = "ready" | "incomplete" | "blocked" | "not_run" | "stale";

type AdminSetupStatus = {
  ready: boolean;
  configSource: "kv" | "secret" | "default";
  steps: {
    health: AdminSetupStep;
    provider: AdminSetupStep;
    model: AdminSetupStep;
    member: AdminSetupStep;
    permission: AdminSetupStep;
    smoke: AdminSetupStep;
  };
};

type AdminSetupStep = {
  ready: boolean;
  status: AdminSetupStepStatus;
  count: number;
};
```

### 3. Contracts

- Both endpoints are behind the existing admin-session guard. `POST /api/admin/setup-smoke` also inherits the same-origin mutation guard. A missing `ADMIN_TOKEN` never creates an anonymous setup path.
- The response has exactly `ready`, `configSource`, and `steps`. Each step has exactly `ready`, `status`, and `count`; the order is `health`, `provider`, `model`, `member`, `permission`, then `smoke`.
- The projection must never contain a credential, credential reference, endpoint or URL, upstream model name, member label, access code, custom header, or other sensitive identifier.
- The generated default placeholder is not explicit setup. Provider readiness requires an enabled provider with a usable server credential; `user_key_required` is not ready. Model readiness requires an explicit enabled logical route with at least one resolvable enabled candidate. Member readiness counts valid access-code members. Permission readiness requires a persisted enabled user with an explicit allowed enabled route.
- Health and smoke may inspect KV, Durable Object storage, normalized configuration, route-candidate resolution, credential availability, access membership, and permission projection. They must not call provider discovery, a completion endpoint, a live model, or any other upstream service.
- A successful smoke stores only an internal version, fingerprint, and completion time. Configuration or access revision changes make it stale; a missing prerequisite blocks it. The browser never receives the fingerprint or completion time.
- `AdminWorkspace` loads setup status with config and members. An incomplete instance initially opens the setup view; a ready instance initially opens members. The setup view remains available for re-checking and reuses the existing provider, logical-model, member, and permission editors rather than duplicating forms.
- Successful provider/config/member/permission mutations refresh setup status. The React admin has no regular `/admin.html` link; the Worker preserves that exact path only as a same-origin 308 redirect to `/react-chat/admin`.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Setup endpoint has no valid admin session | `401 unauthorized`; no setup projection |
| Setup smoke has a present cross-origin `Origin` | `403 invalid_origin`; no storage mutation |
| Any prerequisite is incomplete | `POST /api/admin/setup-smoke` returns `409 setup_incomplete` and writes no smoke record |
| Default placeholder is the only config | Provider and model remain incomplete |
| Provider is BYOK-only or its credential is missing/unavailable | Provider remains incomplete without exposing the reason's identifier |
| Smoke fingerprint matches current local state | Smoke is `ready` with count `1` |
| A smoke record exists but current local state differs | Smoke is `stale` with count `0` |
| Browser response has an unknown key, invalid enum, inconsistent ready/status, or invalid count | Reject as an invalid setup response before rendering |

### 5. Good / Base / Bad Cases

- Good: an authenticated administrator configures a server credential, offering, first member, and explicit permission, runs the local smoke, and reaches a ready React admin without contacting a provider.
- Base: setup is ready and daily administration opens on members; the administrator can still open the setup view and re-check it.
- Bad: setup smoke sends a small completion prompt, returns `apiKeyRef` or an upstream model name, treats the generated default route as configured, or relies on `/admin.html` as ordinary React navigation.

### 6. Tests Required

- Worker tests cover unauthenticated access, default/Secret/KV config sources, missing credential/offering/member/permission, the ready transition, stale configuration/access revisions, exact keys, sensitive-string scans, and zero upstream `fetch` calls for both status and smoke.
- Browser API tests accept only the exact finite envelope and reject unknown top-level or step keys, invalid statuses, inconsistent readiness, and malformed counts.
- Workspace browser tests prove the six-step order, target-panel navigation, setup refresh after mutations, smoke execution, desktop and 390px containment, absence of a React `/admin.html` link, direct `/legacy/` access, and the exact `/admin.html` 308 redirect.
- Run the frontend structure check, full Vitest suite, Workspace Playwright, local fake-provider Agent Playwright, typecheck, Wrangler dry-run, and diff check. Tests must never use a live provider or production deployment.

### 7. Wrong vs Correct

#### Wrong

```typescript
return jsonResponse({
  ready: true,
  provider: { apiKeyRef: provider.apiKeyRef, baseUrl: provider.baseUrl },
  model: route.model,
});
await fetch(provider.baseUrl, { method: "POST", body: JSON.stringify({ prompt: "ping" }) });
```

#### Correct

```typescript
return jsonResponse({
  ready: prerequisitesReady && smokeReady,
  configSource,
  steps: {
    health: { ready: true, status: "ready", count: 3 },
    provider: { ready: true, status: "ready", count: 1 },
    model: { ready: true, status: "ready", count: 1 },
    member: { ready: true, status: "ready", count: 1 },
    permission: { ready: true, status: "ready", count: 1 },
    smoke: { ready: smokeReady, status: smokeReady ? "ready" : "not_run", count: smokeReady ? 1 : 0 },
  },
});
```

## Scenario: Logical Model And Provider Pool Administration

### 1. Scope / Trigger

- Trigger: changing provider inventory, model discovery, logical routes, offerings, provider capacity, credential references, route IDs, or legacy route migration in the administration UI or Worker API.

### 2. Signatures

```text
PUT  /api/admin/config       { config, expectedRevision }
POST /api/admin/route-models { providerId } | { routeId } // saved legacy route only
POST /api/admin/legacy-routes/migrate { routeIds, expectedRevision }
PUT  /api/admin/route-secrets/:apiKeyRef
```

```typescript
type ProviderConfig = {
  label: string;
  type: "openai-chat" | "anthropic-messages";
  baseUrl: string;
  apiKeyRef?: string;
  concurrency?: "unlimited" | "exclusive" | "bounded";
  maxConcurrent?: number;
  queueTimeoutMs?: number;
  priority?: number;
};

type ModelOffering = {
  providerId: string;
  model: string;
  enabled?: boolean;
  priority?: number;
  supportsImages?: boolean;
  supportsTools?: boolean;
};

type LegacyRouteMigrationResponse = {
  revision: string;
  migrated: string[];
  alreadyMigrated: string[];
  statuses: Array<{ routeId: string; status: "migrated" | "already_migrated" }>;
};
```

### 3. Contracts

- `config.providers` is the physical provider registry. `config.routes` is the logical model/permission registry; `routes[id].offerings` links the two without credentials.
- Provider IDs are validated at both browser and Worker boundaries: they start with an ASCII letter or digit, are at most 80 characters, and contain only ASCII letters, digits, `.`, `_`, or `-`. Server-side existence checks must use own properties, never inherited object members.
- Keep normalized registries as ordinary structured-cloneable objects because configuration crosses the Durable Object RPC boundary. Do not replace them with null-prototype objects; combine server-side ID validation with own-property checks instead.
- `POST /api/admin/route-models` identifies a previously saved provider by `providerId`. A saved legacy route may be identified by `routeId` during migration; missing/unknown IDs and request-body endpoint or credential overrides are rejected. The browser never sends plaintext keys or duplicates the provider endpoint into batch-created routes.
- Provider priority orders candidates first. Passive quality for the exact logical-route/provider pair is only a tie-breaker and never triggers an active probe.
- `exclusive` is provider-wide capacity one; `bounded` uses `maxConcurrent`; `unlimited` has no lease. `queueTimeoutMs` is an integer from 0 through 10000.
- Renaming a logical route replaces its ID in `defaults`, every user `defaultRoute`/`allowedRoutes`, and every route `fallbacks`. Deleting a route prunes those references and repairs user assignments.
- A provider or logical-route edit mutates browser state only provisionally. On revision, validation, or network failure, restore the pre-mutation config and selected IDs while leaving the visible form draft available for correction.
- Legacy inline endpoint routes remain readable. The Provider panel derives a migration inventory from the sanitized admin snapshot, but inventory, confirmation, errors, audit, and migration responses show only route IDs plus bounded status/reason codes. They never repeat endpoint, credential, or header data from that snapshot.
- `POST /api/admin/legacy-routes/migrate` requires an admin session and the current `expectedRevision`. It normalizes and deduplicates IDs, classifies the entire requested batch, and performs zero writes when any route is missing, non-legacy, or blocked.
- A route may migrate only when its credential still resolves after removing the inline `apiKey`: encrypted managed storage, a same-name Worker Secret, or an explicit `requiresUserKey` BYOK contract. An inline key as the only source is fail-closed.
- One deterministic collision-safe Provider and one Offering replace each accepted legacy-only route transport shadow. If a route already has offerings, those offerings are the runtime authority: preserve them byte-for-byte and remove only the stale compatibility shadow without credential preflight or Provider creation. Route IDs, policy fields, fallbacks, defaults, members, and public references stay unchanged. A repeat call is an `already_migrated` no-op.
- A successful migration response has exactly `revision`, `migrated`, `alreadyMigrated`, and `statuses`. It is not an admin config snapshot. The React panel must fetch `/api/admin/config` after success before replacing shared state; migration responses and audit entries never include endpoint values, credential references/values, header names/values, or raw exceptions.
- Every mutation of `config:routes_config` shares the reserved `$admin-config` `ProviderCoordinator` lease. Revision checks execute after acquisition, the 60-second lease renews while work is active, and wait/acquire failures return bounded retryable errors. Read paths may fall back from malformed stored configuration, but must not delete it because a read-side delete can erase a concurrent repair.

### 4. Validation & Error Matrix

- `providers`/`routes`/registry value is an array or non-object -> reject as `invalid_config`; never reinterpret array indexes as IDs.
- Provider protocol or Base URL invalid -> `400 invalid_config` with the provider ID.
- `bounded` without integer `maxConcurrent` in `1..100` -> `400 invalid_config`.
- `queueTimeoutMs` outside `0..10000` -> `400 invalid_config`.
- Offering omits `providerId`/`model`, references a missing provider, or duplicates a provider in one route -> `400 invalid_config`.
- Renamed provider/logical-model ID already exists -> block in the editor before mutation.
- Stale `expectedRevision` -> `409 config_conflict`; restore the local pre-mutation config and keep the user's draft visible.
- Missing `expectedRevision` -> `400 expected_config_revision_required`; perform no route classification or write.
- Mixed safe/blocked legacy-route batch -> stable bounded status metadata and zero writes.
- Legacy route with only an inline key -> `legacy_route_migration_blocked` with `inline_credential_only`; require a saved Key Ref before retry.
- Another config mutation holds the lease for the wait deadline -> `409 config_mutation_busy` with bounded `retryAfter`; do not evaluate a stale revision outside the lease.
- The config mutation coordinator is unavailable -> `503 config_mutation_unavailable`; perform no config write.
- Every eligible provider occupied until the shared deadline -> stable `provider_busy` response; do not interrupt the active lease holder.

### 5. Good / Base / Bad Cases

- Good: one saved provider supplies several logical models; importing a second provider merges offerings without copying endpoint/key data or expanding member permissions.
- Base: an old route with inline endpoint fields remains callable and can be explicitly migrated later.
- Good: a provider-backed route still contains a complete stale legacy shadow; migration keeps its current offerings, removes only the shadow, and creates no Provider.
- Bad: two same-revision mutations check KV before acquiring a shared lease and then overwrite one another, or a malformed-config read deletes a newer repair.
- Bad: route `alpha` is renamed to `beta` by deleting `alpha` without rewriting user and fallback references; the server rejects the draft and the browser must not retain the broken mutation.
- Bad: the Worker normalizes providers into `Object.create(null)` to avoid inherited properties, then capability execution fails with `DataCloneError` when the configuration crosses Durable Object RPC.

### 6. Tests Required

- Assert provider-pool raw validation rejects arrays, missing providers, duplicate offerings, invalid bounded capacity, and waits above 10 seconds.
- Assert provider IDs with invalid characters or inherited names are rejected server-side, and browser validation uses the same grammar.
- Assert model discovery rejects unsaved endpoints and unknown provider IDs while retaining saved legacy-route discovery.
- Assert candidate ordering uses administrator priority before passive quality and keys quality by logical route plus provider ID.
- Assert exclusive/bounded leases coordinate across models/users and release on success, failure, cancellation, disconnect, and expiry.
- Assert frontend structure keeps discovery provider-scoped, batch offerings credential-free, logical-route renames reference-safe, and failed model/provider saves rollback local state.
- Assert legacy migration authorization, required/current revision, unknown and non-legacy IDs, duplicate normalization, mixed-batch atomicity, Provider ID collisions, managed/Worker/BYOK credential paths, inline-only blocking, hidden-header preservation, reference preservation, idempotence, exact four-field response decoding, post-success config refresh, and redaction. No test contacts a live model endpoint.
- Assert mixed offering/shadow routes preserve offerings without shadow credential checks, runtime candidate semantics remain equivalent for converted routes, concurrent same-revision config mutations yield one success plus one conflict/busy result, lease renewal retains ownership, and malformed-config reads do not delete storage.

### 7. Wrong vs Correct

#### Wrong

```json
{
  "routes": {
    "model-a": { "baseUrl": "https://provider.example/v1", "apiKey": "plaintext", "model": "upstream-a" },
    "model-b": { "baseUrl": "https://provider.example/v1", "apiKey": "plaintext", "model": "upstream-b" }
  }
}
```

#### Correct

```json
{
  "providers": {
    "shared": { "label": "Shared", "type": "openai-chat", "baseUrl": "https://provider.example/v1", "apiKeyRef": "SHARED_KEY" }
  },
  "routes": {
    "model-a": { "label": "Model A", "offerings": [{ "providerId": "shared", "model": "upstream-a" }] },
    "model-b": { "label": "Model B", "offerings": [{ "providerId": "shared", "model": "upstream-b" }] }
  }
}
```

## AI Capability Editors And Tool Timeline

- Keep Skills, tools, and MCP servers in one admin section with native tab, form, checkbox, and password controls. The revisioned config remains the only persisted browser draft.
- Use a roving-tabindex tablist with Arrow/Home/End navigation and one labelled `tabpanel`. Entity choices are ordinary pressed buttons, not an incomplete custom listbox. Confirmation dialogs receive initial focus and restore focus to the opener or the next valid entity/tab after deletion. If initial focus is deferred with `requestAnimationFrame`, cancel the pending frame in effect cleanup before closing the dialog. Queue post-confirmation focus separately and apply it only after the native dialog has closed and the next selection has committed; scheduling restoration from the same mutation stack can let dialog cleanup overwrite the target under full browser-matrix timing.
- MCP plaintext may be read only by the dedicated secret save action. Submit it byte-for-byte without trimming, intercept Enter inside the password input so it cannot submit the surrounding MCP configuration form, and clear it on save success/failure, auth-type changes, editor/tab/section switches, refresh, login transitions, and discarded edits.
- Discovery sends only `serverId`, endpoint metadata, auth type, and a saved `secretRef`. New tools and tools whose `schemaFingerprint` changes must be saved with `enabled: false`; unchanged tools preserve their existing enabled state and confirmation policy.
- At 780px and below, the capability sidebar owns a fixed bounded top region and only the editor scrolls. Do not make the complete sidebar sticky inside the same scrolling grid; browser `scrollIntoView()` can oscillate between overlapping header, sidebar, and editor boxes. Touch tabs remain at least 44px high.
- Capability chat responses are selected by `X-Chatus-Stream: capability-v1`. Tool approval writes must include `X-Chatus-Client: web` and `{ runId, callId, decision }`; disable or remove the visible approval controls after the first decision.
- Keep an active capability stream attached to its source chat. Do not allow chat switching, active-chat deletion, logout, or local-data clearing until the user stops the run.
- Render persisted tool summaries as compact unframed rows in the assistant message. Never reconstruct or persist raw arguments, raw results, remote endpoints, schemas, or credentials in the browser timeline or Markdown export.

## Typed Member Route Assignment

- Keep member routes, Skills, and tools in one atomic typed-admin draft and one revision-checked save. Do not add per-section saves that can split conflict or dirty-state ownership.
- Use a native `<select>` for the default route and `<fieldset><legend>` plus checkbox labels for allowed routes. Capability sections receive stable ASCII IDs rather than deriving `aria-labelledby` targets from display text.
- Keep allowed-route and default-route inheritance independent. Disabled inherited controls reference a concise description through `aria-describedby`.
- Show disabled routes so existing references can be inspected and removed. Disable an unchecked retired route and the last selected enabled route; do not rely on color alone to communicate state.
- Preserve the existing 280px desktop member sidebar and mobile member `<select>`. Route controls stay inside the scrollable editor and must not expand the mobile editor header or create horizontal page scrolling.
- Keep member create in an always-visible header action. Put issue/rotate/revoke actions beside the selected member editor, hidden for defaults, and stack them at narrow widths.
- Use a native modal dialog for create, destructive confirmation, and one-time credential display. Initial focus, Escape, focus return, a labelled readonly credential input, and an explicit copy button are required; close/unmount clears the credential.
- State clearly in the revoke confirmation that access and sessions are removed while chats, memory, and assignments remain. Full user-data deletion is a separate destructive workflow.
- Keep "恢复默认配置" and "注销会话" as separate member operations. The former is revision-checked and resets only `config.users[label]`; the latter reports session cleanup completeness and never mutates capability assignments.

## Typed Member Policy Controls

- Keep account enablement, daily quota, and minute quota in the same atomic member/default draft as routes, Skills, and tools. Each policy field has an independent inheritance control and field-level dirty state.
- Use native checkbox and number inputs. Explicit limits require positive safe integers; invalid inputs keep their entered state, disable the shared save, set `aria-invalid`, and reference a field-specific error through `aria-describedby`.
- Keep the enablement control available for default policy and selected members. Hide inheritance controls for defaults rather than rendering a meaningless disabled inheritance choice.
- Treat "重置今日用量" as a separate confirmed member operation. It must not mark the assignment draft clean or dirty, replace the config snapshot, or share the configuration reset action.
- At 390px, policy copy, inheritance labels, and numeric inputs wrap or stack within the editor. The inputs must not impose a minimum width that creates horizontal page overflow.

## React Message Action Bar

- `MessageView` owns a compact action bar immediately below the message. Copy is always available for non-empty text; user messages expose edit/resend/branch, and assistant messages expose regenerate/feedback/branch plus Continue only when the server-persisted metadata is exactly `{ finishReason: "length" }`.
- Derive one typed `TurnPhase` through the pure client-state helper: `idle`, `submitted`, `waiting-first-output`, `streaming`, `tool-running`, `recovering`, `completed`, `stopped`, or `failed`. Recovery wins over ordinary streaming; failures win over tool/visible-output state; active tool parts win over ordinary streaming; `submitted` stays distinct from a streaming request that has not produced visible output.
- Resolve every row through one pure action matrix that returns `hidden`, `enabled`, or `disabled` for copy/edit/resend/regenerate/continue/branch/feedback/tool approval/retry. Role, message position, phase, online state, account lock, route availability, capability assignment, truncation metadata, and pending approval are inputs; components do not reconstruct those rules from independent booleans.
- Copy stays enabled for non-empty text during active, failed, offline, and account-locked states. Active turns disable every other row action; pending tool approval alone remains enabled while `tool-running`, online, and unlocked. Offline or account-locked states disable approval too.
- A missing logical route disables generation, feedback, and failed-turn retry while leaving copy and branch enabled. Completed, stopped, and failed turns restore stable row actions; failed-turn retry is visible only for the latest source turn and must use the same matrix for its rendered disabled state and its handler guard.
- Action buttons must remain visible and keyboard reachable on touch layouts; opacity or hover must never be the only discoverability mechanism. Use `aria-label` and `title` on every icon button.
- The edit form is an accessible native form with an auto-focused textarea, Cancel, and branch-and-send submit. Its async result belongs to the source message and the workspace owns the actionable error banner.
- Edit Cancel and successful edit completion restore focus to the originating edit action. Failed turns expose a focused retry action that creates a resend branch from the latest user message; a full reload remains a separate reconnect fallback.
- Keep action busy state local to the owning message so two message rows cannot block or mutate one another. Disable the row while its branch request is in flight, then activate the server-returned conversation.
- Resolve Agent failures through the strict shared envelope parser and local canonical message registry. The failed-turn banner may show the normalized request reference and copy its full value, but it must never render serialized `message`, raw SDK errors, Provider/MCP text, or private diagnostics. Offline state keeps its local draft-recovery message while retaining a valid request reference for support correlation.
- Request-reference copy failure leaves the primary error visible. The copy control uses a Lucide icon with `title` and `aria-label`, provides bounded success feedback, and the banner wraps its summary/actions without horizontal overflow at 390px.
- The administrator reliability table displays a compact request reference from the latest passive real-task record and copies the exact full value. Missing or invalid references render as unavailable; the browser decoder rejects them rather than coercing arbitrary text.
- Unit-test every phase plus representative role/route/offline/account-lock/approval combinations. Browser fixtures at desktop and 390px must prove visible controls stay discoverable, transiently unavailable controls are disabled rather than removed, approval follows connectivity, and the page does not overflow.
- Streaming transcript scroll follows new output only while the reader is near the bottom; manual upward scrolling is preserved.
- The internal long-term-memory tool is rendered as a named memory update rather than an opaque provider tool. Before approval, show the complete proposed replacement in a bounded, wrapping, scrollable region beside explicit Approve and Reject controls. Do not expose the revision token as user-facing content, and do not imply that the memory changed until tool execution completes.

### Tests Required

- Assert the role/state matrix for copy, edit, resend, regenerate, feedback, branch, and conditional Continue, including no-route, offline, active-run, and failed-turn states.
- Assert desktop and 390px action bars are visible, keyboard focusable, and free of horizontal overflow; assert the edit form restores focus to its originating control after cancel or completion.
- Assert Agent error banners render only canonical local text, copy a valid full request reference, preserve retry/reconnect behavior, and remain contained at desktop and touch widths. Assert the reliability table applies the same exact decoder and copy behavior.
- Assert memory proposals always request approval, stale revisions cannot write, guests do not receive the proposal tool, and the exact proposed memory remains readable without overflow at desktop and 390px widths.

## React Workspace Shell

- `ChatWorkspace` owns one `WorkspaceHeader` and the controlled history/settings sidebar view. `ConversationChat` may report its existing connecting/ready/error projection upward, but the header must not derive new Agent, provider, fallback, or telemetry semantics.
- Keep the message list as the chat column's vertical scroll owner. `MessageComposer` is the non-shrinking bottom child, reserves status height, applies safe-area padding, grows its textarea to a bounded cap, and keeps Send and Stop in the same action box.
- The transcript stays at or below 720px. Assistant content is unframed, user content uses a compact bubble, and code/tables scroll locally instead of widening the page.
- Render source URL/document parts after primary content in a named `<section>`. Sanitize URL protocols before creating links, retain the full accessible/title text, and visually contain long labels.
- At 520px and below, preserve measurable space for both the conversation title and logical route/model. Compact the product identity to its mark instead of hiding the active conversation title.
- A mobile drawer records its opener only on the closed-to-open transition. Move focus to the close control after the opening click/visibility transition settles only if the user has not moved focus, and restore the opener on an actual close or unmount rather than every effect cleanup.

### Tests Required

- Assert header regions do not overlap, the title and route retain visible width at 480px and 390px, the header is at most 60px, and the transcript stays at or below 720px.
- Assert the drawer receives initial focus, traps Tab, closes on Escape, restores its opener, and returns focus from the conversation-delete dialog.
- Assert textarea growth/capping, equal Send/Stop geometry, reserved status space, local code overflow, source containment, user-bubble contrast, and 44px touch actions.

## Styling Patterns

- Put React visual rules, including administrator styles, in `client/src/styles.css`; legacy chat rules remain in `public/styles.css`. CSP checks forbid `.style.*` mutations in legacy scripts.
- Toggle semantic classes and attributes such as `hidden`, `aria-expanded`, and status classes.
- Keep shared page styling in the single stylesheet instead of inline style attributes.

## Accessibility

- Preserve visible `:focus-visible` treatment for keyboard users.
- Keep keyboard behavior for menus and dialogs, including arrow navigation, Escape/Tab closure, and focus restoration.
- Respect `prefers-reduced-motion`; scrolling falls back to `auto` when reduced motion is requested.
- Use labels, native buttons, forms, and dialogs before custom clickable containers.
- For a selectable member/toggle button, expose state with `aria-pressed` (or a native checkbox/radio); reserve `aria-current="page"` for actual navigation destinations.

## Common Mistakes

- Adding a `querySelector("#id")` without adding the ID to the paired HTML; `npm run check:frontend` rejects this.
- Updating DOM from a stale async result without checking the source chat or current revision.
- Applying inline styles, which weakens the Content Security Policy.
- Replacing destructive actions without preserving undo, conflict, or confirmation behavior already present in the UI.
- Reintroducing a native `datalist` for remote model discovery. It couples the selected value to browser filtering and makes the fetched total differ from what administrators can inspect.
- Copying provider endpoint or credentials into logical routes when a persisted provider registry is available. Preserve the provider/logical-route boundary and use offerings for model links instead of duplicating physical configuration.
- Pointing a typed-admin link at `/admin` or an asset path; use `/react-chat/admin`, while exact `/admin.html` remains redirect-only.
- Hiding message actions at zero opacity or disabling their pointer events until hover. Desktop may use a low-contrast visible state, while touch layouts keep the toolbar fully visible.
