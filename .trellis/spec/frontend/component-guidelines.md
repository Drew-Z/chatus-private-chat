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
- Unit-test every phase plus representative role/route/offline/account-lock/approval combinations. Browser fixtures at desktop and 390px must prove visible controls stay discoverable, transiently unavailable controls are disabled rather than removed, approval follows connectivity, and the page does not overflow.
- Streaming transcript scroll follows new output only while the reader is near the bottom; manual upward scrolling is preserved.
- The internal long-term-memory tool is rendered as a named memory update rather than an opaque provider tool. Before approval, show the complete proposed replacement in a bounded, wrapping, scrollable region beside explicit Approve and Reject controls. Do not expose the revision token as user-facing content, and do not imply that the memory changed until tool execution completes.

### Tests Required

- Assert the role/state matrix for copy, edit, resend, regenerate, feedback, branch, and conditional Continue, including no-route, offline, active-run, and failed-turn states.
- Assert desktop and 390px action bars are visible, keyboard focusable, and free of horizontal overflow; assert the edit form restores focus to its originating control after cancel or completion.
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
