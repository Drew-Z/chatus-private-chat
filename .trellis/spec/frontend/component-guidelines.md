# Component Guidelines

## Overview

The default teammate frontend uses typed React components under `client/`. The legacy chat and administration surfaces still use HTML regions plus page-controller functions under `public/`.

## Component Structure

- Keep the React composition root small: session gating belongs in `App.tsx`; daily workspace, conversation navigation, message rendering, and memory controls belong in focused components.
- Pass stable owning IDs and server projections explicitly. Async results must update the conversation or editor that initiated them, not whichever view is active later.
- Prefer native controls and semantic dialog roles. Modal drawers must receive initial focus, contain Tab navigation, support Escape, and restore focus to the opener.
- In legacy pages, define stable markup in `public/index.html` or `public/admin.html`, resolve nodes near the top of the paired script, and attach listeners once.

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
- Batch setup merges an offering into an existing logical model when appropriate or creates a new logical model, then saves through `/api/admin/config` with `expectedRevision`. It must not modify `defaults.allowedRoutes` or user `allowedRoutes` implicitly.
- Batch setup must never read `providerSecretInput`, copy a legacy plaintext `apiKey`, or overwrite an existing provider/logical-model ID. Provider credentials are entered through the write-only secret action.
- The signed-in model picker exposes logical routes, not physical provider offerings. Keep every selectable button discoverable through the shared `.model-option` query so Arrow, Home, End, Escape, and Tab behavior continues to work across groups.
- Legacy routes with `type`, `baseUrl`, and `model` remain readable and require an explicit migration action before their endpoint fields are removed; migration must preserve fallback and permission references.

## Scenario: Logical Model And Provider Pool Administration

### 1. Scope / Trigger

- Trigger: changing provider inventory, model discovery, logical routes, offerings, provider capacity, credential references, route IDs, or legacy route migration in the administration UI or Worker API.

### 2. Signatures

```text
PUT  /api/admin/config       { config, expectedRevision }
POST /api/admin/route-models { providerId } | { routeId } // saved legacy route only
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
- Legacy inline endpoint routes remain readable. Explicit migration requires the referenced credential to already resolve from managed storage or a same-name Worker Secret, creates one provider plus one offering, preserves fallback/capability/permission fields, and removes inline endpoint fields and the legacy plaintext key only in the saved migrated route.

### 4. Validation & Error Matrix

- `providers`/`routes`/registry value is an array or non-object -> reject as `invalid_config`; never reinterpret array indexes as IDs.
- Provider protocol or Base URL invalid -> `400 invalid_config` with the provider ID.
- `bounded` without integer `maxConcurrent` in `1..100` -> `400 invalid_config`.
- `queueTimeoutMs` outside `0..10000` -> `400 invalid_config`.
- Offering omits `providerId`/`model`, references a missing provider, or duplicates a provider in one route -> `400 invalid_config`.
- Renamed provider/logical-model ID already exists -> block in the editor before mutation.
- Stale `expectedRevision` -> `409 config_conflict`; restore the local pre-mutation config and keep the user's draft visible.
- Every eligible provider occupied until the shared deadline -> stable `provider_busy` response; do not interrupt the active lease holder.

### 5. Good / Base / Bad Cases

- Good: one saved provider supplies several logical models; importing a second provider merges offerings without copying endpoint/key data or expanding member permissions.
- Base: an old route with inline endpoint fields remains callable and can be explicitly migrated later.
- Bad: route `alpha` is renamed to `beta` by deleting `alpha` without rewriting user and fallback references; the server rejects the draft and the browser must not retain the broken mutation.
- Bad: the Worker normalizes providers into `Object.create(null)` to avoid inherited properties, then capability execution fails with `DataCloneError` when the configuration crosses Durable Object RPC.

### 6. Tests Required

- Assert provider-pool raw validation rejects arrays, missing providers, duplicate offerings, invalid bounded capacity, and waits above 10 seconds.
- Assert provider IDs with invalid characters or inherited names are rejected server-side, and browser validation uses the same grammar.
- Assert model discovery rejects unsaved endpoints and unknown provider IDs while retaining saved legacy-route discovery.
- Assert candidate ordering uses administrator priority before passive quality and keys quality by logical route plus provider ID.
- Assert exclusive/bounded leases coordinate across models/users and release on success, failure, cancellation, disconnect, and expiry.
- Assert frontend structure keeps discovery provider-scoped, batch offerings credential-free, logical-route renames reference-safe, and failed model/provider saves rollback local state.
- Assert legacy projection/migration remains deterministic and no test contacts a live model endpoint.

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
- MCP plaintext may be read only by the dedicated secret save action. Clear the password input on save success/failure, auth-type changes, editor/tab/section switches, refresh, login transitions, and discarded edits.
- Discovery sends only `serverId`, endpoint metadata, auth type, and a saved `secretRef`. New tools and tools whose `schemaFingerprint` changes must be saved with `enabled: false`; unchanged tools preserve their existing enabled state and confirmation policy.
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

## Styling Patterns

- Put React visual rules in `client/src/styles.css` and legacy/admin rules in `public/styles.css`; CSP checks forbid `.style.*` mutations in legacy scripts.
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
- Pointing a typed-admin link at `/admin` when the deployed legacy document is `/admin.html`; keep the two shells' paths explicit.
- Hiding message actions at zero opacity or disabling their pointer events until hover. Desktop may use a low-contrast visible state, while touch layouts keep the toolbar fully visible.
