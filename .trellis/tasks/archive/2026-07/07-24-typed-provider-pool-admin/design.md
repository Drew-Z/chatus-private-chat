# Design: Typed Provider Pool Administration

## Context And Boundaries

The provider pool runtime is already authoritative in `src/contracts/provider.ts`, `src/services/provider-router.ts`, and `src/services/route-reliability.ts`. This task changes the administrator experience and the secret-free projection boundary; it does not replace the router or coordinator.

The typed admin remains one authenticated React shell. `AdminWorkspace` keeps member access and capability assignment, while provider-specific editing moves into focused components and pure helpers. `/admin.html` remains a rollback path until acceptance is complete.

## Data Model

### Provider projection

The client receives a strict projection with:

```typescript
type AdminProvider = {
  id: string;
  label: string;
  type: "openai-chat" | "anthropic-messages";
  baseUrl: string;
  enabled: boolean;
  apiKeyRef?: string;
  credentialStatus: "configured" | "missing" | "unavailable" | "user_key_required";
  hasLegacyKey: boolean;
  hasCustomHeaders: boolean;
  directEndpoint: boolean;
  allowUserKey: boolean;
  requiresUserKey: boolean;
  supportsImages: boolean;
  supportsTools: boolean;
  concurrency: "unlimited" | "exclusive" | "bounded";
  maxConcurrent?: number;
  queueTimeoutMs: number;
  priority: number;
  referencedBy: string[];
};
```

The server may continue returning the existing sanitized `AdminConfig` shape for compatibility. The typed client maps it into this projection and joins credential metadata from `/api/admin/route-secrets` without retaining secret values.

### Logical model projection

```typescript
type AdminLogicalModel = {
  id: string;
  label: string;
  enabled: boolean;
  fallbacks: string[];
  supportsImages: boolean;
  supportsTools: boolean;
  offerings: Array<{
    providerId: string;
    model: string;
    enabled: boolean;
    priority: number;
    supportsImages?: boolean;
    supportsTools?: boolean;
  }>;
  referencedBy: string[];
};
```

Logical model assignments continue to use route IDs. Provider and upstream model IDs are never included in teammate session projections.

### Reliability projection

Add a read-only admin projection at `GET /api/admin/reliability`; keep legacy `/api/admin/route-health` response consumers unchanged:

```typescript
type AdminReliabilitySnapshot = {
  generatedAt: string;
  providers: Array<{
    providerId: string;
    enabled: boolean;
    credentialStatus: "configured" | "missing" | "unavailable" | "user_key_required";
    concurrency: "unlimited" | "exclusive" | "bounded";
    maxConcurrent?: number;
    queueTimeoutMs: number;
    routes: Array<{
      routeId: string;
      model: string;
      enabled: boolean;
      attempts: number;
      successes: number;
      averageLatencyMs: number;
      lastOutcome?: string;
      observedAt?: string;
      lastFallback?: boolean;
      fallbackCount?: number;
    }>;
  }>;
};
```

The server reads provider-route KV records and configuration readiness only. It must not call `inspectRouteStatus` in a way that probes an upstream; readiness checks may inspect encrypted-secret metadata as the existing route-health path does.

## HTTP Contracts

- `GET /api/admin/config` and `PUT /api/admin/config` remain the revisioned mutation boundary for provider/logical-model fields.
- `GET /api/admin/route-secrets` returns metadata only. Add typed client `fetchAdminRouteSecrets` and strict metadata decoding.
- `PUT/DELETE /api/admin/route-secrets/:ref` remain write/delete-only operations with the existing per-secret revision fence. The client clears the input after either success or close.
- `POST /api/admin/route-models` remains provider-scoped discovery. Add a typed wrapper that accepts `providerId` and validates a bounded `{models,count,endpoint}` response; the server must not return a key.
- Add `GET /api/admin/reliability` for pair-level passive records. Keep the existing route-health endpoint and response unchanged for legacy consumers.

All new response decoders use exact allowed-key checks for envelopes and reject `apiKey`, `headers`, ciphertext, raw upstream body, and unknown credential fields.

## State And Conflict Flow

1. Load config, secret metadata, and (when selected) reliability in parallel after admin authentication.
2. Build a provider/logical-model draft from sanitized config; never copy hidden fields into visible form inputs.
3. Save provider/logical-model mutations through `putAdminConfig(config, revision)`.
4. On `config_conflict`, fetch the latest snapshot, rebase only local provider/model fields, keep the draft dirty, and offer “use server version”.
5. Save a credential separately with its current secret revision. On conflict, clear the submitted value and ask the administrator to reload; never retry a secret automatically.
6. Discovery is read-only until the administrator selects models and presses “add offerings”; merge by `(routeId, providerId, model)` and preserve existing order/priority.

## Component Shape

- `AdminWorkspace.tsx`: top-level navigation, shared loading/error/dirty/session handling, and member access view.
- `ProviderAdminPanel.tsx`: provider list, provider editor, credential readiness, delete/reference guard, and discovery handoff.
- `LogicalModelAdminPanel.tsx`: logical-model list/editor, ordered offerings, fallback validation, and legacy migration affordance.
- `ReliabilityAdminPanel.tsx`: passive pair table, readiness/capacity badges, filters, and refresh.
- `client/src/lib/admin-provider.ts`: pure provider/model draft, normalization, reference calculation, offering merge, and conflict rebase helpers.
- `client/src/lib/api.ts`: typed HTTP wrappers and decoders.
- `client/src/styles.css`: compact admin navigation, tables/forms, status badges, discovery dialog, and mobile overflow rules.

## Legacy Compatibility And Migration

- Existing legacy route configs with `type/baseUrl/model/apiKeyRef` remain valid and appear as an implicit provider/offering projection.
- The typed migration action writes a new provider and offering into the same config revision, preserving the source route until the save succeeds.
- Legacy custom headers and hidden key shadows remain server-owned; typed UI can show readiness flags but cannot edit raw header values in this slice.
- `/admin.html` stays linked and deployable. Retire individual legacy panels only after typed browser acceptance proves equivalent behavior.

## Security And Operations

- Keep admin session and origin protections unchanged.
- Audit provider/config/secret mutations with existing audit helpers; read-only reliability/discovery events must be redacted.
- Discovery and reliability tests use fake `fetch`/KV fixtures only. No live provider call is permitted.
- Rollback is a single revert of the child commit plus the existing legacy admin link; no data migration is destructive.

## Risks And Trade-offs

- Reusing the broad config PUT keeps atomicity and migration compatibility but requires careful client draft rebasing and exact server validation. A new provider-specific write API would reduce payload size but create a second persistence contract and is deferred.
- Pair-level reliability reads can be numerous. Bound the projection to configured provider/route pairs and use parallel KV reads with stable ordering; do not list arbitrary KV keys into the response. Existing v1 records without fallback fields remain valid and render fallback as unknown.
- A single admin shell can grow dense. Keep the four views navigable and focused, with no permanent explanatory walls or nested cards.
