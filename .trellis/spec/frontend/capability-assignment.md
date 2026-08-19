# User Capability Assignment

## Scenario: Per-member Skill allow-lists

### 1. Scope / Trigger

- Trigger: adding or changing administrator-managed user capability fields, Skill selection, session capability projections, or either chat execution path.
- The contract spans stored configuration, Worker normalization and validation, the public session API, the legacy chat handler, the Cloudflare Agent turn, and the administration editor.

### 2. Signatures

```typescript
type CapabilityAssignment = {
  allowedSkills?: string[];
  allowedTools?: string[];
};

type ConversationSkillMode = "automatic" | "manual";

type AgentSkillSelectionMetadata = {
  mode: "automatic";
  source: "model" | "last_success" | "admin_default";
  skills: Array<{ id: string; label: string }>;
  reason?: "timeout" | "provider_busy" | "provider_error"
    | "empty_response" | "invalid_response" | "no_valid_skills";
};

getPublicCapabilities(config, assignment): { skills: PublicSkill[]; tools: PublicTool[] }
getSelectedSkills(config, value, assignment?): SelectedSkill[]
```

```text
PUT   /api/admin/config
GET   /api/session
POST  /api/chat
POST  /api/agent/conversations
PATCH /api/agent/conversations/:id
POST  /agent?chatId=:chatId

chatus_conversations.skill_mode TEXT NOT NULL DEFAULT 'manual'
```

### 3. Contracts

- `allowedSkills === undefined` is the legacy-compatible state: all enabled Skills are assigned.
- `allowedSkills: []` explicitly assigns no Skills. Do not collapse these two states during normalization or effective-user merging.
- Stored Skill IDs are normalized to at most 50 unique IDs of at most 80 characters. User values override defaults through the existing effective-user merge.
- `/api/session` exposes only enabled, assigned Skills. It never exposes Skill instructions.
- Schema migration v4 adds `skill_mode`. Existing rows and legacy imports are `manual`; new member conversations default to `automatic`; guests are always normalized to `manual` with `skillIds: []`. The upgrader must tolerate a pre-existing column when the v4 marker is missing.
- In `manual`, persisted `skillIds` are the exact selection. In `automatic`, the same column is only the last successful selector snapshot. Recording an automatic snapshot must not advance `updatedAt`, because it is not a user settings edit.
- Explicit `manual` create with omitted `skillIds` derives up to three assigned Skills in stable administrator order. Explicit `skillIds: []` remains a no-Skill manual selection. Branches preserve mode and repair the snapshot/selection against current access.
- The conversation Agent reads the authoritative mode and snapshot from the root Agent. Browser request fields cannot override them. PATCH omission preserves the current member mode; every guest PATCH repairs mode and Skills to `manual` and `[]`.
- For a member Automatic turn with at least one enabled, assigned Skill candidate, `prepareTeamAgentTurn()` performs the single turn admission before selector plan preparation, Provider lease acquisition, or Provider I/O. The same `TurnAdmission` is reused by the main answer; it is never charged a second time.
- Automatic selection sends only public candidate `id`, `label`, and `description` plus a bounded latest user message. It uses the selected logical route only, may try offerings within that route, emits at most 200 tokens, uses `maxRetries: 0`, has no tools, requires exact JSON `{ "skillIds": string[] }`, and accepts at most three unique assigned IDs.
- A hard five-second boundary covers plan preparation, lease acquisition, Provider completion, telemetry, and release. The caller races the entire attempt against this boundary so an operation that ignores abort cannot delay the main turn or promote a late result.
- A request already cancelled before admission consumes no quota. Parent cancellation during selection aborts selector work, releases its Provider lease, returns the canonical `request_cancelled` Agent envelope, and prevents main-model preparation; it is not selector fallback.
- After selection, reload configuration and re-run assignment/enabled filtering before prompt and tool construction. Failure falls back to the revalidated last-success snapshot, then the first three assigned Skills in administrator order.
- Only `source: "model"` updates the snapshot. The actual per-turn result, source, and finite fallback reason are stored in assistant message metadata so history and branches retain truthful evidence.
- Selector attempts use the separate `route-provider-skill-selection:` telemetry keyspace and never update chat reliability ordering. Turn preparation owns one reusable admission for selector plus answer; selector offerings and Automatic continuations do not consume another user message unit.
- Both `/api/chat` and `prepareTeamAgentTurn()` call `getSelectedSkills()` with the effective user assignment on every turn. Persisted or client-supplied old Skill IDs cannot restore a revoked Skill.
- An unassigned or disabled Skill contributes neither instructions nor referenced tools. Executable tools remain the intersection of selected assigned Skills, `allowedTools`, enabled tool definitions, and available executors.
- The admin user editor persists `allowedSkills` through the revision-checked configuration write. Skill rename and deletion update explicit user/default allow-lists before saving.

### 4. Validation & Error Matrix

- User `allowedSkills` references a missing Skill -> `400 invalid_config` with the user label and missing Skill ID.
- Default `allowedSkills` references a missing Skill -> `400 invalid_config` with the missing Skill ID.
- Conversation create/update requests an unassigned Skill -> `403 skill_not_allowed`.
- Member create omits mode -> persist `automatic` with an empty initial snapshot; do not manufacture a selection from a cached browser projection.
- Member create/PATCH sends an unknown mode -> `400 invalid_skill_mode`.
- Manual create omits `skillIds` -> derive the current server-authorized administrator default. Manual create/PATCH sends `skillIds: []` -> preserve the exact empty selection.
- Guest create/PATCH sends `automatic` or any Skill IDs -> normalize to `manual` and `[]`, including repair of an abnormal legacy row.
- Selector times out, is busy, fails, returns empty/malformed JSON, or returns no legal ID -> continue the main turn with `last_success` or `admin_default` metadata; never fail the turn solely because selection failed.
- Automatic admission is rate-limited -> return the canonical quota error before any selector or main Provider request.
- Parent signal is already aborted -> return `request_cancelled` without quota consumption or Provider work.
- Parent signal aborts during selection -> stop selection, release the Provider lease, return `request_cancelled`, and perform no main Provider preparation or fallback.
- Selector returns a now-disabled, unassigned, unknown, or duplicate ID -> discard it during final revalidation; no revoked instructions or tools may enter the turn.
- A stale chat turn includes a revoked Skill -> continue without that Skill, its instructions, or its tools.
- A Skill exists but is disabled -> omit it from session projection and turn selection.

### 5. Good/Base/Bad Cases

- Good: an automatic conversation is admitted once, selects `writing` on its current logical route, reuses the admission for the answer, records isolated selector telemetry, and displays the validated result in the assistant message.
- Base: a migrated conversation remains manual; a selector timeout uses the revalidated previous snapshot and the main answer continues while quota increments once.
- Bad: call the selector before quota admission, treat parent cancellation as selector timeout, or admit again before the main answer; these paths either spend Provider capacity for a rejected turn or double-charge one message.

### 6. Tests Required

- Registry unit tests assert assigned projection, missing-field compatibility, explicit empty denial, and selected-Skill filtering.
- Worker API tests assert admin persistence, per-member `/api/session` projection, legacy `/api/chat` prompt filtering, and missing-reference rejection.
- Worker API tests assert v4 idempotence, legacy/manual migration, automatic member defaults, guest repair, exact manual empty behavior, branch inheritance, export/import, PATCH omission, and unauthorized rejection.
- Team Agent tests assert single-logical-route planning, offering fallback, strict JSON, 200-token/tool-free requests, a hard five-second late-result boundary, last-success/admin fallback, revocation races, isolated telemetry, exhausted-quota zero Provider calls, pre-admission cancellation with no charge, selector cancellation with lease release and zero main calls, and one quota charge including continuations.
- Client decoder tests require exact `skillMode` and automatic metadata. Workspace Playwright asserts mode switching, disabled automatic checkboxes, guest-hidden controls, fallback labels, and local overflow bounds.
- The local fake Provider Agent must identify non-streaming selector prompts before scenario markers, return a standard JSON completion, and count selector requests independently. No test may contact a live model.
- Frontend structure checks assert Agent request bodies include mode and that hydration restores the server mode while guests remain manual.

### 7. Wrong vs Correct

#### Wrong

```typescript
const mode = body.skillMode;
const routeIds = buildProviderRoutePlan(selectedRoute, config.routes, access);
const selectedSkills = getSelectedSkills(config, body.skillIds, access.user);
```

This trusts browser settings and lets the selector cross logical-route boundaries. A late or revoked result can enter the prompt.

#### Correct

```typescript
const settings = await root.listConversations()
  .then((items) => items.find(({ id }) => id === chatId));
const admission = await admitOnce();
if (!admission.ok) return rejectAdmission(admission);
const prepared = await providerPlanRuntime(env, config).preparePlan({
  routeIds: [settings.routeId],
  accessRoutes: access.routes,
  userApiKey,
});
// Race the whole attempt against 5 seconds, stop on parent cancellation,
// then reload config, revalidate, and reuse admission for the main answer.
const selectedSkills = getSelectedSkills(reloadedConfig, attempt.skillIds, reloadedAccess.user);
```

The root conversation is authoritative, logical fallback is excluded, the hard boundary rejects late results, and current assignment is enforced immediately before execution.

## Scenario: Code-owned Capability Catalog And Safe Adoption

### 1. Scope / Trigger

- Trigger: changing built-in workflow Skills, capability activation/origin/disclosure,
  augmentation assignment, the administrator Catalog, or capability-pack adoption.
- This contract spans the code-owned catalog service, configuration defaults and
  normalization, revisioned Worker APIs, exact browser decoders, member projection,
  Skill selection, and the typed administrator workspace.

### 2. Signatures

```text
GET  /api/admin/capability-packs
  -> { version: 1, packs: AdminCapabilityPackV1[] }

POST /api/admin/capability-packs/install
  <- { packId: string, itemIds: string[], expectedRevision: string }
  -> { ok: true, config: SanitizedAdminConfig, source: "kv",
       revision: string, installed: string[], skipped: string[] }

GET /api/session
  -> { availableCapabilities: PublicCapabilityV1[], skills, tools, ... }
```

```typescript
type SkillActivation = "automatic" | "explicit_turn";
type CapabilityOrigin = "chatus" | "administrator";
type CapabilityAugmentation = "vision_assist";

type CapabilityAssignment = {
  allowedSkills?: string[];
  allowedTools?: string[];
  allowedAugmentations?: CapabilityAugmentation[];
};
```

### 3. Contracts

- Catalog version 1 owns exactly five instruction-only workflow Skills:
  `chatus:writing`, `chatus:summarize`, `chatus:translate`,
  `chatus:code_explanation`, and `chatus:structured_output`. Their canonical
  instructions live only in the server catalog; the browser receives labels,
  descriptions, status, activation, source, and disclosure.
- `getDefaultAppConfig()` seeds the five Skills and the explicit default
  `allowedSkills` list only for a truly unconfigured instance.
  `normalizeAppConfig()` never injects catalog items or assignments into KV or
  deployment-Secret configurations.
- Existing custom Skills keep omission-compatible automatic behavior.
  `activation: "explicit_turn"` Skills may be projected as capabilities, but
  ordinary/manual Skill lists, automatic selection, and selected prompt
  composition exclude them. The automatic selector still applies at most three
  workflow Skills.
- `allowedAugmentations === undefined` inherits through the effective-user merge;
  default omission grants none. An explicit empty array is deny-all. Guests always
  receive no Skills, tools, augmentations, or `availableCapabilities`.
- `availableCapabilities` is derived after assignment, enabled-state, and tool
  readiness filtering. Instructions and credentials are never projected. Until
  the auxiliary helper exists, assigned `vision_assist` projects exactly as
  `route_augmentation`, `requires_setup`, and `helper_unavailable`.
- Install accepts one known bounded pack and unique known workflow IDs, acquires
  the shared admin-config mutation lease, reloads the editable config, and checks
  `expectedRevision` before classification. A different definition at any chosen
  ID is a collision for the complete request.
- A successful install preserves unrelated configuration, appends new IDs to an
  existing explicit default allow-list, validates the merged config, performs one
  KV config write, and audits only `capability-pack.install` plus pack ID/item
  count. It never installs an endpoint, MCP server, credential, or auxiliary
  Provider helper.
- The React Catalog uses the server projection and exact decoders. A revision
  conflict refreshes the authoritative config while retaining the selected item
  IDs for retry; the explicit server-version action clears that local selection.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Missing/extra request fields or blank revision | `400 invalid_capability_pack_request` or `expected_config_revision_required`; zero writes |
| Unknown pack | `404 capability_pack_not_found`; zero writes |
| Empty, duplicate, unknown, over-bounded, or malformed item IDs | `400 invalid_capability_pack_items`; zero config/audit writes |
| Stale revision | `409 config_conflict` with current revision; retain browser selection |
| Any selected ID contains another definition | `409 capability_pack_collision` with bounded IDs; zero config/audit writes |
| Catalog/session/install payload has unknown fields, duplicate IDs, invalid enum/bounds, or inconsistent availability/reason | Exact browser decoder rejects the complete response |
| `web_search` role appears on a builtin tool | `400 invalid_config`; only reviewed MCP tools may own that role |
| Guest or explicit deny-all assignment | Project no available capability |

### 5. Good/Base/Bad Cases

- Good: an unconfigured instance exposes the five default workflows; a stored KV
  instance remains unchanged until an administrator previews and installs two
  selected IDs at the current revision.
- Base: an installed canonical workflow is reported as installed or disabled and
  remains an ordinary administrator-managed Skill; it is never silently replaced
  or deleted when the catalog changes.
- Bad: normalize every stored config through a default-seeding helper, copy
  canonical instructions into React, silently overwrite a same-ID custom Skill,
  or treat an explicit empty augmentation list as inheritance.

### 6. Tests Required

- Catalog service tests assert the exact five definitions, immutable clone
  behavior, stable status classification, setup-only references, and no endpoints
  or credentials.
- Registry tests assert custom-Skill compatibility, explicit-turn exclusion,
  assignment inheritance/deny-all, executable readiness, augmentation projection,
  and the three-Skill ceiling.
- Worker tests cover default versus Secret/KV injection, authenticated preview,
  unknown/duplicate IDs, stale revision, collision zero-write behavior, successful
  assignment/audit redaction, guest denial, and legacy MCP round-trip. No test may
  call a live Provider, OAuth issuer, discovery endpoint, or MCP server.
- Browser API tests accept only exact bounded catalog, install, public capability,
  and admin config projections and reject duplicate IDs, unknown keys, invalid
  enums, invalid reason combinations, and secret-like extras.
- Workspace Playwright uses synthetic data at desktop 1440 and touch 390px to
  prove source/status disclosure, conflict selection retention, retry install,
  keyboard-reachable controls, and no horizontal overflow.

### 7. Wrong vs Correct

#### Wrong

```typescript
const config = normalizeAppConfig(storedValue ?? getDefaultAppConfig(env));
config.skills[id] = catalogSkill; // overwrites a custom collision
```

#### Correct

```typescript
const editable = await loadEditableConfig(env); // no catalog injection
if (await configRevision(editable.config) !== expectedRevision) return conflict();
if (selectedIds.some((id) => isDifferentDefinition(editable.config.skills[id]))) {
  return collision(); // no config or audit write
}
const next = validateMergedCatalogInstall(editable.config, selectedIds);
await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(next));
```

Defaults and explicit adoption stay separate, collisions fail atomically, and the
browser never becomes a second source for built-in instructions.

## Scenario: Typed Admin Member Assignment Workspace

### 1. Scope / Trigger

- Trigger: changing the typed React administrator surface for member policy, route, Skill, or tool assignments; member discovery; or revisioned configuration editing.
- The typed workspace owns daily administration: route/provider definitions, quotas, MCP administration, audit, and other administrator sections. `/admin.html` is a compatibility redirect only; it does not expose a second editor.

### 2. Signatures

```text
GET /api/admin/members
  -> { members: Array<{ label, displayName, configured, hasAccessCode }> }

GET /api/admin/config
  -> { config: SanitizedAdminConfig, source: "kv" | "secret" | "default", revision: string }

PUT /api/admin/config
  <- { config: SanitizedAdminConfig, expectedRevision: string }
  -> { ok: true, config: SanitizedAdminConfig, source: "kv", revision: string }

GET /api/session
  -> { defaultRoute, routes, allowBringYourOwnKey: boolean, hasUserSystemPrompt: boolean, ... }
```

```typescript
type CapabilityAssignmentDraft = {
  inheritEnabled: boolean;
  enabled: boolean;
  enabledDirty: boolean;
  inheritDailyMessageLimit: boolean;
  dailyMessageLimit: number | null;
  dailyMessageLimitDirty: boolean;
  inheritMinuteMessageLimit: boolean;
  minuteMessageLimit: number | null;
  minuteMessageLimitDirty: boolean;
  inheritSkills: boolean;
  allowedSkills: string[];
  inheritTools: boolean;
  allowedTools: string[];
  inheritRoutes: boolean;
  allowedRoutes: string[];
  routeSelectionMode: "all" | "selected";
  inheritDefaultRoute: boolean;
  defaultRoute: string;
  routesDirty: boolean;
};
```

### 3. Contracts

- `/api/admin/members` returns trimmed, unique member labels and only display/configuration metadata. It never returns access codes, prompts, memory, routes, or secret values.
- The typed editor may change only `defaults` or one selected user's `enabled`, `dailyMessageLimit`, `minuteMessageLimit`, `defaultRoute`, `allowedRoutes`, `allowedSkills`, and `allowedTools`. It must preserve route definitions, providers, MCP servers, and unrelated user fields at the draft boundary.
- For member Skills and tools, `undefined` means inherit the corresponding default assignment, while an explicit empty array denies that capability. The editor must not collapse the two states.
- Route arrays use a different legacy contract: member `allowedRoutes === undefined` inherits defaults, while an effective `allowedRoutes === undefined` or `[]` means all configured routes. `routeSelectionMode` preserves the difference between all-routes intent and an explicit list that happens to contain every current route.
- `routesDirty === false` prevents Skill/tool-only saves from reserializing route fields. Once routes are edited, the draft keeps at least one enabled route and resolves `defaultRoute` to an enabled allowed route before saving.
- Disabled routes remain visible. An already selected disabled route may be removed, but a disabled route cannot be newly selected. The last enabled selected route cannot be removed.
- `inheritRoutes` and `inheritDefaultRoute` are independent. The default-route selector and allowed-route fieldset use native controls; inherited controls are disabled and described for assistive technology.
- After `409 config_conflict`, rebase the local draft onto the latest snapshot: inherited values follow the latest defaults, `routeSelectionMode: "all"` includes newly added routes, and explicit selected lists do not expand. The later save patches only assignment fields over the latest snapshot.
- The client `/api/session` decoder requires `allowBringYourOwnKey` and `hasUserSystemPrompt` as booleans because the Worker always projects both policy states.
- Admin config projections omit provider/legacy-route `apiKey` and custom `headers`. `hasLegacyKey` and `hasCustomHeaders` are non-sensitive shadows; the server preserves hidden values only while the submitted shadow remains explicit.
- Every save sends the snapshot `revision`. A successful save replaces the snapshot and resets the draft. A `409 config_conflict` loads the newest snapshot while retaining the local draft until the administrator chooses to use the server version or saves again.
- The daily administrator entry is `/react-chat/admin` (and its trailing-slash form). The exact `/admin.html` path is a same-origin 308 redirect retained for rollback compatibility.

### 4. Validation & Error Matrix

- Malformed member projection, duplicate labels, or a response containing secret fields -> client rejects the response as `invalid_admin_members_response` or `invalid_admin_config_response`.
- Missing route reference or a configuration with no enabled route -> client rejects the admin snapshot; the Worker rejects a submitted draft as `400 invalid_config`.
- Empty route selection in the UI -> keep the last enabled route selected; never serialize it as a deny-all list because the backend interprets `[]` as all routes.
- Missing/unknown Skill or tool reference -> `400 invalid_config`; do not send a partial capability update.
- Missing or stale `expectedRevision` when supplied -> `409 config_conflict`; preserve the local draft and expose an explicit server-version action.
- Expired admin session on any protected request -> `401`; return to the admin login without displaying the draft as saved.
- Login/network rejection -> clear the submitting state in `finally` so a transient failure cannot permanently disable retry.

### 5. Good / Base / Bad Cases

- Good: selecting a member, changing only `allowedTools`, and saving leaves that member's route and provider assignments unchanged; changing the default route preserves an explicit full route list.
- Base: an older member has no assignment fields; the editor displays inherited routes/Skills/tools and writes explicit fields only when the administrator changes them.
- Good: a conflict adds a new route while the local draft means all routes; rebasing includes the new route, while an explicit old route list stays unchanged.
- Bad: treating `allowedRoutes: []` as deny-all shows no routes in the editor but grants every route at runtime.
- Bad: two tabs save different revisions; the second tab keeps its unsaved choices visible instead of overwriting them with the first tab's response.
- Bad: a typed admin link points to `/admin` or an asset path; use `/react-chat/admin` so the route reaches the typed shell.

### 6. Tests Required

- Frontend structure checks assert the typed shell, semantic route fieldset, independent route inheritance, revisioned save, conflict draft retention, `beforeunload`, secret-free rendering, absence of a regular `/admin.html` link, and login `finally` recovery.
- Client validator tests assert unique trimmed member labels, route reference/enabled-state validation, complete session policy booleans, and rejection of `apiKey`/`headers` in sanitized config projections.
- Worker API tests assert member metadata contains no access codes, session policy flags match the client contract, both typed-admin paths serve the React shell, and exact `/admin.html` returns the typed-admin 308 redirect.
- Pure helper tests assert capability inheritance, route all/selected semantics, disabled/last-enabled guards, default-route repair, conflict rebasing, stable ordering, and preservation of unrelated newer configuration fields.

### 7. Wrong vs Correct

#### Wrong

```typescript
const allowedRoutes = user.allowedRoutes ?? [];
// Render [] as no access.
```

This collapses inherited and all-routes states, and the empty UI state grants every route at runtime.

#### Correct

```typescript
const draft = createCapabilityAssignmentDraft(config, memberLabel);
const rebased = rebaseCapabilityAssignmentDraft(latestConfig, draft);
const next = applyCapabilityAssignmentDraft(latestConfig, memberLabel, rebased);
```

The pure draft boundary owns inheritance, all/selected route intent, default-route repair, and revision-conflict rebasing. Login still clears submission state in `finally`; daily administration remains in the typed React workspace.

## Scenario: Typed Admin Member Access Lifecycle

### 1. Scope / Trigger

- Trigger: listing member access state, creating an invitation, issuing or rotating a member access code, revoking member access, or changing the typed admin shell path.
- Access revocation removes the login credential and sessions only. Member configuration, conversations, memory, Agent state, and user data remain separate lifecycle domains.

### 2. Signatures

```text
GET    /api/admin/members
  -> { members, accessRevision, accessSource: "kv" | "secret" | "managed" }

POST   /api/admin/members
  <- { label, expectedAccessRevision }
  -> { member, accessCode, accessRevision, sessionRevocation }

POST   /api/admin/members/:label/access-code
  <- { expectedAccessRevision }
  -> { member, accessCode, accessRevision, sessionRevocation }

DELETE /api/admin/members/:label/access-code
  <- { expectedAccessRevision }
  -> { member: AdminMemberProjection | null, accessRevision, sessionRevocation }
```

### 3. Contracts

- Member list projections expose only exact `{ label, displayName, configured, hasAccessCode }` objects plus the non-secret access revision/source. They never expose a code, raw access-code document, prompt, route assignment, memory, token, or provider secret.
- `expectedAccessRevision` is mandatory for every typed lifecycle mutation, including the empty revision used before the first credential exists. Stale mutations return `409 access_codes_conflict` before storage or session changes.
- The Worker generates access codes. Create and rotate return the new code only in that successful mutation response; later list/revoke responses and audit records never contain it.
- Create may issue access for an existing configured member without replacing configuration. A new access-only member inherits defaults until an assignment is saved.
- Rotate replaces every historical code for the label with one new code and revokes all sessions for the label. Revoke removes every code for the label and revokes sessions.
- Session cleanup is part of the server action. A response reports `{ revoked, complete }`; an incomplete cleanup must be shown as a warning rather than as full success. The typed warning retains the affected label and exposes an in-place retry through `POST /api/admin/sessions/revoke`; it must not redirect recovery to the legacy administrator shell.
- Revoking the last parsed access entry returns `409 last_access_code`. In legacy mode, writing or deleting an empty KV override could fall back to the deployment `ACCESS_CODES` Secret and revive an old credential; managed production mode deliberately has no environment fallback and uses the `managed` empty source until the first KV code is created.
- Revoke returns the configured member with `hasAccessCode: false`, or `member: null` when the label existed only through access data. It never deletes `config.users[label]` or user-owned data.
- The React client keeps a returned code only in the mounted one-time credential dialog. Closing the dialog, logging out, or unmounting clears it; `beforeunload` warns while it is visible. The code is never stored in member state, notices, browser storage, URLs, logs, or clipboard fallback elements.
- The typed client must not call `/api/admin/access-codes` or generate credentials in the browser. That raw-document endpoint remains legacy-only until the full administration surface is removed.
- The admin shell internally fetches `/react-chat/`, not `/react-chat/index.html`. Cloudflare Assets canonicalizes `index.html` to its directory URL; an internal redirect would otherwise replace `/react-chat/admin` with the chat path.

### 4. Validation & Error Matrix

- Missing/non-string access revision -> `400 expected_access_revision_required`; no mutation.
- Stale access revision -> `409 access_codes_conflict` with `currentRevision`; refresh member metadata and retain the open action dialog.
- Invalid new label -> `400 invalid_label`; labels are 1 to 80 safe ASCII identifier characters.
- Existing access on create -> `409 access_code_exists`; use rotate.
- Missing access on rotate/revoke -> `404 access_code_not_found`.
- Last remaining entry on revoke -> `409 last_access_code`; stored access and sessions remain unchanged.
- A response with extra secret-like keys, an access code in list/revoke, malformed session cleanup, duplicate labels, or non-exact member fields -> client rejects it as an invalid admin member response.

### 5. Tests Required

- Worker tests cover required/stale revisions, create/rotate/revoke, old-code denial, session revocation, other-member preservation, configured-member retention, last-entry protection, origin/auth rejection, one-time response secrecy, and audit secrecy.
- Client decoder tests use complete valid projections when proving that extra `code`, `accessCode`, `token`, or `secret` fields are rejected.
- Pure member-list tests cover add/update/remove without duplicates and stable label ordering.
- Frontend structure checks forbid raw access-code endpoints and browser credential generation, and require strict decoders plus a modal one-time credential dialog with focus restoration and selectable copy fallback.
- Browser acceptance covers 1440px and 390px layouts, no horizontal overflow, create and rotate dialogs, and removal of the credential input after close without capturing the code in screenshots.

## Scenario: Typed Member Configuration And Session Operations

### 1. Scope / Trigger

- Trigger: restoring one member to the default capability assignment or revoking all of that member's active sessions from the typed administrator workspace.
- These operations are deliberately separate from access-code revocation and from user-data deletion.

### 2. Signatures

```text
DELETE /api/admin/members/:label/config
  <- { expectedConfigRevision: string }
  -> { member, config, source: "kv", revision }

POST /api/admin/sessions/revoke
  <- { label: string }
  -> { ok: true, label, revoked: number, complete: boolean }
```

### 3. Contracts

- Configuration removal requires a non-empty current configuration revision. It deletes every stored `config.users` key whose trimmed label matches the target, writes the sanitized configuration as a KV override, and audits only the label and action.
- Configuration removal restores default routes, Skills, tools, limits, and other user policy fields. It does not change access codes, sessions, conversations, Agent memory, legacy memory, feedback, usage, or provider credentials.
- A configured member that still has access remains in the member projection with `configured: false`; an access-only member whose access has already been removed may return `member: null`.
- A stale or missing configuration revision fails before the write with `409 config_conflict` or `400 expected_config_revision_required`. The typed client keeps the current assignment draft and leaves the confirmation action retryable.
- Session revocation is idempotent and uses the existing label session scan. The response reports whether the scan completed; incomplete cleanup is a warning, not a success claim. The typed warning keeps a retry action for the same label until a complete response is received; retry failure remains visible and retryable. The endpoint does not revoke access codes or delete user data.
- The typed editor confirms configuration removal when the selected member has a dirty draft, and confirms both destructive operations in a native modal. Successful configuration removal updates the snapshot and selected member state without silently discarding unrelated dirty drafts.

### 4. Validation & Error Matrix

- Unknown configured member -> `404 member_config_not_found`; no configuration or session mutation.
- Invalid/oversized path label -> `400 invalid_member_label`.
- Session scan failure after retries -> `complete: false`; audit uses an incomplete action and the typed UI exposes a same-label retry button backed by the strict session-revocation decoder.
- Any response containing provider keys, custom headers, access codes, or extra envelope fields -> client decoder rejects it.

### 5. Tests Required

- Worker tests cover missing/stale/current configuration revisions, duplicate trimmed legacy labels, configured-member retention, access/session/data preservation, secret-free response and audit output, cross-origin rejection, and incomplete session cleanup reporting.
- Client decoder tests cover exact configuration-removal and session-revocation envelopes and reject secret-bearing extras.
- Frontend checks require the reset/session actions, confirmation text, revisioned reset helper, strict decoders, and in-place retry after incomplete access create/rotate/revoke cleanup.

## Scenario: Typed Member Policy And Current-day Usage Reset

### 1. Scope / Trigger

- Trigger: editing member/default account enablement, daily message limits, minute message limits, or resetting one member's current UTC-day usage from the typed administrator workspace.
- Policy edits belong to the revisioned capability draft. Usage reset is an independent operational mutation and must not rewrite configuration.

### 2. Signatures

```typescript
type CapabilityAssignmentDraft = {
  inheritEnabled: boolean;
  enabled: boolean;
  enabledDirty: boolean;
  inheritDailyMessageLimit: boolean;
  dailyMessageLimit: number | null;
  dailyMessageLimitDirty: boolean;
  inheritMinuteMessageLimit: boolean;
  minuteMessageLimit: number | null;
  minuteMessageLimitDirty: boolean;
  // route, Skill, and tool draft fields remain in the same object
};

type AdminUsageResetResponse = {
  ok: true;
  label: string;
  day: string; // exact YYYY-MM-DD UTC date
};
```

```text
PUT  /api/admin/config
  <- { config, expectedRevision }

POST /api/admin/usage
  <- { label: string }
  -> { ok: true, label: string, day: string }
```

### 3. Contracts

- `enabled`, `dailyMessageLimit`, and `minuteMessageLimit` each have independent inheritance and dirty state. A member field set to inherit is omitted from `config.users[label]`; default-policy controls never expose inheritance.
- A save remains atomic across policy, routes, Skills, and tools. Each policy field is written only after its own dirty flag becomes true, so saving another capability cannot freeze an environment-derived default into stored configuration.
- After `409 config_conflict`, dirty policy fields retain the administrator's intent. Untouched policy fields use the latest member snapshot. A dirty field whose intent is inheritance uses the latest default value and remains omitted on retry.
- Explicit quota values are positive safe integers. Empty, zero, negative, fractional, or unsafe values remain visible as invalid local drafts and block the complete save.
- Each invalid quota input references its own visible error through `aria-describedby`; simultaneous daily and minute errors remain distinguishable.
- `POST /api/admin/usage` trims and requires `label`, computes the current UTC day, clears both the legacy KV day counter and the member `UserState` Durable Object day counter, then appends only `usage.reset` plus the label to admin audit.
- Usage reset requires its own confirmation. It does not mutate the configuration revision or assignment draft. Success invalidates the typed Operations projection so the next displayed usage view refreshes.
- The browser accepts only the exact reset response keys `ok`, `label`, and `day`; the date must be a real canonical UTC calendar date. Unknown or secret-like keys are rejected.

### 4. Validation & Error Matrix

- Explicit policy limit is not a positive safe integer -> keep the field dirty, render its field-specific error, and disable save; the pure apply helper rejects direct invalid calls.
- Missing/blank reset label -> `400 label_required`; neither usage store nor audit changes.
- Missing/expired administrator session -> `401`; retain the current policy draft and return to admin authentication.
- Reset response has an extra field, `ok !== true`, a mismatched type, or an invalid date -> client rejects `invalid_admin_usage_reset_response` and does not claim success.
- Storage reset failure -> request fails; do not clear the dialog or show a successful Operations refresh.

### 5. Good / Base / Bad Cases

- Good: an administrator pauses a member and sets `250/day` plus `8/minute` in the same revisioned save while unrelated timezone, routes, providers, Skills, and tools remain unchanged.
- Good: a conflict changes the server's minute limit while the local draft changed only the daily limit; rebasing keeps the local daily value and adopts the latest server minute value.
- Base: an older member has no policy overrides; all three controls show inherited effective defaults, and saving only a Skill writes no policy fields.
- Bad: opening a member draft materializes current environment quota defaults and a later Skill-only save persists them as overrides.
- Bad: resetting usage by editing configuration or clearing only KV leaves the Durable Object counter active and the Operations projection stale.

### 6. Tests Required

- Pure draft tests cover independent inheritance, field-level dirty writes, atomic policy/capability saves, invalid limits, untouched-field conflict adoption, dirty-field intent retention, and latest-default inheritance after conflict.
- Client decoder tests accept the exact reset envelope and reject extra secret-like keys, invalid dates, non-true `ok`, and malformed labels.
- Worker API tests seed both the legacy KV counter and `UserState`, call the authenticated reset endpoint, assert both reach zero, assert the exact response, and assert a bounded `usage.reset` audit entry.
- Browser tests use the real `AdminWorkspace` with strict same-origin fixtures at 1440px and touch-enabled 390px. Assert the revisioned save payload, reset confirmation/result, invalid-field description, and no horizontal overflow.

### 7. Wrong vs Correct

#### Wrong

```typescript
next.dailyMessageLimit = draft.dailyMessageLimit ?? environmentDefault;
await resetAdminMemberUsage(label);
setConfigRevision("reset");
```

This freezes an implicit default during unrelated saves and treats an operational counter reset as configuration state.

#### Correct

```typescript
if (draft.dailyMessageLimitDirty) {
  if (draft.inheritDailyMessageLimit) delete next.dailyMessageLimit;
  else next.dailyMessageLimit = requirePositiveInteger(draft.dailyMessageLimit);
}

const result = await resetAdminMemberUsage(label);
setPanelResetKey((value) => value + 1);
```

Only explicit policy intent changes revisioned configuration; usage reset stays separate and refreshes its read projection.

## Scenario: Typed Capability Registry And OAuth MCP Governance

### 1. Scope / Trigger

- Trigger: changing Skill/tool/MCP administration, MCP authentication, member OAuth connections, remote discovery/review, runtime tool execution, or capability trust persistence.
- The contract spans the React admin/member clients, Worker APIs, `UserState` token storage, MCP runtime, and root/conversation Agent trust. Guests never receive MCP capabilities.

### 2. Signatures

```text
GET /api/admin/config
PUT /api/admin/config <- { config, expectedRevision }

POST /api/admin/mcp-discovery
  <- { serverId, label?, endpoint, auth } | { serverId, memberLabel }
  -> { serverId, tools, rejected }

POST /api/mcp/oauth/start     <- { serverId } -> { serverId, authorizationUrl }
GET  /api/mcp/oauth/callback  <- { state, code | error } -> 303 /react-chat/?mcpOAuth=<result>
GET  /api/mcp/oauth/status    -> { connections }
POST /api/mcp/oauth/discovery <- { serverId } -> { candidateId, serverId, createdAt, expiresAt, tools, rejected }
POST /api/mcp/oauth/revoke    <- { serverId } -> { ok: true, serverId }
```

```typescript
type McpAuthConfig =
  | { version: 1; type: "none" }
  | { version: 1; type: "bearer" | "x-api-key"; secretRef: string }
  | {
      version: 1; type: "oauth2"; issuer: string; clientId: string;
      scopes: string[]; callbackPath: "/api/mcp/oauth/callback";
      configRevision: string; clientSecretRef?: string;
    };

type McpToolReview = {
  schemaFingerprint: string;
  securityFingerprint: string;
  sideEffect: "read" | "write" | "destructive";
  reviewRevision: string;
  reviewRequired: boolean;
};

type AdminConfigSnapshot = {
  config: SanitizedAdminConfig;
  source: "kv" | "secret" | "default";
  revision: string;
};
```

```sql
mcp_oauth_owner(singleton, owner_label)
mcp_oauth_states(state_hash, session_fingerprint, server_id, config_revision,
  verifier, callback_url, expires_at, created_at)
mcp_oauth_tokens(server_id, encrypted_record, token_expires_at, config_revision,
  granted_scopes, review_required, revision, updated_at)
mcp_oauth_discovery_candidates(server_id, candidate_id, config_revision,
  discovery_json, created_at, expires_at)
capability_tool_trust(conversation_id, tool_id, review_revision, approved_at)
```

### 3. Contracts

- Config is dual-read/new-write: legacy `authType/secretRef` remains readable, while every new admin save writes the exact versioned `auth` union. OAuth `configRevision` is server-derived from server ID, endpoint, issuer, client ID, normalized scopes, fixed callback, and optional client-secret reference.
- Stored MCP tools from before four-dimensional governance remain readable only as recovery objects. Worker normalization forces an incomplete tool to `enabled: false` and `reviewRequired: true`; JSON may omit any missing `schemaFingerprint`, `securityFingerprint`, `sideEffect`, or `reviewRevision`. The React admin decoder accepts that incomplete shape only with both fail-closed flags exact, retains it for explicit deletion or same-ID rediscovery, and never synthesizes review data.
- MCP governance fields are executor-specific. `normalizeToolRegistry` must omit `reviewRequired`, fingerprints, side-effect, and review revision for builtin tools; serializing `reviewRequired: false` on the always-present `builtin:text_stats` violates the React builtin union and rejects the complete admin snapshot.
- `GET /api/admin/config` is a canonical cross-layer projection, not a raw storage dump. Worker normalization deduplicates route fallbacks, converts valid numeric strings to bounded safe integers, omits invalid optional integer values, trims blank optional credential metadata without truncating references, and preserves secret/header values only through `hasLegacyKey` / `hasCustomHeaders` shadows.
- Historical MCP servers with non-executable endpoint/auth/scope state remain visible only as disabled recovery objects. The Worker preserves bounded editable metadata, normalizes an unusable auth union to `none` when necessary, and forces `enabled: false`; React accepts the recovery shape only while disabled. PUT permits that disabled form so administrators can repair or delete it, while enabled servers retain the complete public-HTTPS, auth, scope, and server-derived revision contract.
- OAuth issuer, authorization endpoint, and token endpoint use public HTTPS URLs with no credentials, query, fragment, private literal address, redirect, or cross-origin metadata endpoint. The callback is derived from the current Chatus origin plus the fixed path; arbitrary redirect URIs are never accepted.
- Authorization Code + PKCE uses S256. Server-side state is TTL-bounded, one-time, and bound to member owner, session fingerprint, server ID, callback URL, and config revision. Authorization codes, state, and verifiers never enter the React state or callback result URL.
- Access and refresh tokens are encrypted with AES-GCM before `UserState` persistence. AAD binds `ownerLabel`, `serverId`, and token schema v1. `ROUTE_KEYS_MASTER_KEY` is the external 32-byte key; browser projections, audit, logs, user export, discovery candidates, and React persistence never contain token, IV, ciphertext, code, state, verifier, or client secret.
- Refresh is single-flight per member/server. Rotation uses a row revision compare-and-swap; revoke, purge, config/scope drift, invalid grant, or decrypt failure invalidates the in-flight result. Failure is closed: the runtime requires reconnection or review and never falls back to a shared static secret.
- `/api/session` and status expose only server ID/label, connected/review-required/expiry state, granted scope names, and optional expiry time. Guests receive an empty connection array and cannot call member OAuth endpoints.
- Member OAuth discovery stores a bounded, expiring candidate in that member's `UserState`; admin review retrieves it by `{ serverId, memberLabel }`. It does not grant execution by itself.
- Discovery and every remote call compare schema fingerprint, normalized security annotations, side-effect classification, and review revision. Any difference persistently disables the reviewed tool through the drift overlay and invalidates conversation trust until an administrator rediscovers, reviews, and explicitly enables it.
- `read` tools may use `first-per-conversation`. `write` and `destructive` tools always normalize to `confirmation: "always"`; each invocation accepts only `once` or `deny` and never creates conversation trust. Trust keys and Agent SQLite rows include `reviewRevision`.
- Conversation ACL is an additional execution boundary. Shared editor/viewer
  turns receive no tool definitions, no OAuth/static member credential, and no
  approval UI. Every resource `accessRevision` change clears conversation trust;
  shared-tool enablement remains unsupported.
- Skill/MCP rename or deletion repairs references as before. MCP secret input stays byte-exact, write-only, and ephemeral; server deletion does not implicitly delete a separately managed static or OAuth client-secret reference.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Invalid ID, endpoint, auth union, issuer, scope, callback, or secret ref | Reject locally; Worker returns `400 invalid_config` or the bounded OAuth config error |
| Stale admin config/secret revision | `409 config_conflict` / `409 mcp_secret_conflict`; retain the local draft or discovery candidate and clear plaintext input |
| State expired, replayed, swapped across session/member/server, or callback changed | Consume nothing else and redirect with `mcpOAuth=error` or `review_required`; no token row |
| OAuth config or granted scope drift | Mark the connection review-required before a remote tool call |
| Token cannot decrypt, is expired without refresh, or refresh returns `invalid_grant` | Delete the matching revision and require reconnection; never use static auth |
| Schema/security/side-effect/review revision differs | Persist drift disablement and return `mcp_tool_changed` before `tools/call` |
| Side-effect approval is `conversation`, denied, cancelled, or times out | Reject conversation trust; deny/cancel/timeout produces zero remote calls |
| Guest invokes any MCP OAuth endpoint | `403 capability_not_allowed`; no storage or remote call |
| Shared editor/viewer attempts tool approval or execution | Deny before runtime construction; clear stale trust on ACL revision and make zero `tools/call` requests |
| Browser response contains unknown or secret-like fields | Exact decoder rejects it instead of persisting the projection |
| MCP tool governance is incomplete | Accept the admin snapshot only when the tool is disabled and review-required; reject enabled, non-review, malformed-present-field, or invalid-executor variants |
| Builtin tool contains any MCP governance field | Reject the snapshot; fix Worker normalization to omit the field rather than weakening the builtin decoder |
| Historical fallback/limit/capacity is duplicated, numeric text, fractional, or out of bounds | GET emits a unique array and safe integer, or omits/falls back deterministically when no valid optional value exists |
| Historical MCP endpoint/auth/scope is not executable | Preserve the record as disabled recovery state; reject the same shape when enabled and perform zero discovery/runtime calls |

### 5. Good / Base / Bad Cases

- Good: one member completes PKCE, receives a secret-free connected projection, and a reviewed write tool asks for `once` confirmation on every call.
- Good: security annotations change while the JSON schema stays stable; the runtime records drift and blocks the call until administrator review creates a new revision.
- Base: an old bearer config round-trips through dual-read, and a stable read-only rediscovery retains explicit enablement and first-per-conversation policy.
- Base: a pre-governance MCP tool loads disabled and review-required, survives an unrelated revisioned config save, and can be deleted or upgraded through same-ID rediscovery.
- Base: a persisted mixed-era config with duplicate fallbacks, numeric-string quotas, fractional capacity, hidden credential values, and an incomplete MCP tool produces one canonical secret-free snapshot that the production React decoder accepts before and after PUT.
- Base: an HTTP or empty-scope OAuth MCP server remains visible and removable while disabled; correcting its complete executable fields is required before enablement.
- Bad: treat OAuth as X-API-Key, store tokens in browser state, accept provider redirects, reuse a token for another member, or keep trust after any review dimension changes.
- Bad: require governance fields unconditionally and make one legacy tool block the whole admin workspace, or accept an incomplete tool while it is runnable.
- Bad: attach `reviewRequired: false` to a builtin tool because a boolean MCP expression was reused for every executor, or truncate an overlong credential reference into a different binding name.

### 6. Tests Required

- Pure OAuth tests assert S256, fixed callback, bounded token responses, issuer/endpoint/redirect/private-address rejection, scope normalization, AES-GCM AAD isolation, and wrong-key failure.
- `UserState` tests assert state TTL/one-time/session/member binding, encrypted-only storage, concurrent refresh single-flight, CAS rotation, revoke/purge races, discovery candidate expiry, and exact member/server isolation.
- Worker tests use only local fake OAuth/MCP and cover start/callback replay/swap/exchange failure, exact status/revoke projections, no token/audit/export/log leak, config/scope drift, member candidate review, and permanent deletion.
- MCP runtime and Agent tests assert all four review dimensions before `tools/call`, persistent drift overlay, review-revision trust isolation, consecutive side-effect confirmations, invalid `conversation` decisions, and zero calls on deny/cancel/timeout.
- ACL isolation tests additionally assert editor/viewer turns expose no tools or
  OAuth tokens, grant/role/revoke revisions clear trust, and revoke races keep the
  fake MCP remote-call count at zero.
- Client tests assert exact versioned auth and connection decoders, OAuth admin round-trip, callback query consumption, busy deduplication boundaries, and guest denial. Workspace Playwright covers the five-view matrix; fake-Provider Agent Playwright remains separate.
- Compatibility tests persist a governance-incomplete MCP tool, assert the Worker omits rather than fabricates missing fields, exercise GET/PUT/GET preservation, reject runnable incomplete client shapes, and prove the React admin recovery/delete/rediscovery path with local fixtures.
- At least one Worker integration test must pass the exact serialized `GET /api/admin/config` JSON into the exported React `isAdminConfigSnapshot` decoder. The fixture includes the builtin tool plus multiple historical defects, asserts builtin MCP fields are absent, asserts credentials/headers are absent, and repeats the decoder assertion after PUT/GET.
- Disabled MCP recovery tests prove invalid endpoint/empty OAuth scopes are readable and round-trippable only while disabled; enabled variants fail validation. Existing OAuth PKCE tests must stay green so revision generation is not disabled before `applyMcpOAuthConfigRevisions` runs.
- Run the complete project gate. No test may contact a live Provider, OAuth issuer, or MCP server.

### 7. Wrong vs Correct

#### Wrong

```typescript
headers.set("X-API-Key", oauthToken);
tools[id] = { ...candidate, enabled: existing?.enabled ?? true };
trust.add(`${conversationId}:${toolId}`);
```

This crosses authentication types, ignores security and review drift, and lets side-effect approval outlive the reviewed definition.

#### Correct

```typescript
const accessToken = await resolveOAuthAccessToken(memberLabel, serverId, auth);
headers.set("Authorization", `Bearer ${accessToken}`);

const sameReview = sameSchema && sameSecurity && sameSideEffect && sameRevision;
tools[id] = { ...candidate, enabled: sameReview ? existing.enabled : false,
  reviewRequired: sameReview ? existing.reviewRequired === true : true };
const trustKey = `${toolId}:${reviewRevision}`;
```

Member OAuth stays isolated, every governance dimension participates in review, and old trust cannot authorize a changed tool.

For legacy admin projection compatibility, do not weaken the MCP decoder globally:

```typescript
// Wrong: one old fail-closed record rejects the complete admin snapshot.
return hasAllGovernanceFields(tool);

// Correct: complete tools use the full contract; incomplete tools are recovery-only.
return hasAllGovernanceFields(tool)
  || (allPresentGovernanceFieldsAreValid(tool)
    && tool.enabled === false
    && tool.reviewRequired === true);
```

This exception is read compatibility, not review. Missing fingerprints or revisions are never evidence that a tool is safe to execute.

Keep executor-specific governance and the real cross-layer decoder in the regression path:

```typescript
// Wrong: builtin tools serialize an MCP-only field and break the whole snapshot.
const reviewRequired = executor.type === "mcp" && needsReview;
tools[id] = { ...tool, reviewRequired };

// Correct: builtin JSON omits MCP-only governance fields.
const reviewRequired = executor.type === "mcp" ? needsReview : undefined;
tools[id] = { ...tool, reviewRequired };

// Required cross-layer assertion: do not duplicate the React shape by hand.
const projected = await getAdminConfigThroughWorker();
expect(isAdminConfigSnapshot(projected)).toBe(true);
```

## Scenario: Vision Assist Assignment And Administrator Readiness

### 1. Scope / Trigger

Use this contract when an administrator installs, enables, disables, or repairs the optional `vision_assist` augmentation.

### 2. Signatures

```typescript
type VisionAssistConfig = {
  enabled?: boolean;
  routeId: string;
  maxOutputChars?: number;
};

type CapabilityAugmentation = "vision_assist";
```

```text
PUT /api/admin/config
  <- { config, expectedRevision }
  -> { ok: true, config, source: "kv", revision }
```

### 3. Contracts

- `allowedAugmentations` preserves omission as inheritance and `[]` as explicit deny-all. Guests always receive no augmentation.
- A helper is executable only when the assignment includes `vision_assist`, the admin config is enabled, its route is selected, credentials are ready, and the selected route has a native-image offering. The helper route itself cannot be assisted.
- Helper execution captures the admitted config revision and selected route image mode. After Provider-capacity wait and before ledger admission/I/O, it reloads config/access and requires both values to match; revocation or any config drift fails with `vision_assist_unavailable`, releases capacity, and creates zero helper attempts or fallback calls.
- The admin Catalog/Setup projection derives `installed`, `disabled`, or `requires_setup` from the real local readiness helper without sending a model request. It never projects credentials or Provider payloads.
- Vision config saves are revisioned and atomic with unrelated admin config. On `409 config_conflict`, the authoritative snapshot refreshes while the local vision draft remains editable for retry.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Missing/invalid route or output bound | `400 invalid_config`; zero writes |
| Assigned augmentation with helper not ready | `requires_setup`; image mode is `none` |
| Explicit empty augmentation assignment | No helper and no assisted mode |
| Assignment/config changes while the helper waits for capacity | `vision_assist_unavailable`; zero helper ledger rows, Provider calls, and fallback |
| Stale revision | `409 config_conflict`; preserve the local draft |
| Guest projection | Omit augmentation and helper controls |

### 5. Good / Base / Bad Cases

- Good: an administrator chooses a native-image helper route, enables the augmentation, saves at the current revision, and sees installed readiness without a probe request.
- Base: a stored assignment remains visible as setup-required until credentials or a valid native offering are configured.
- Bad: enable helper mode merely because a route exists, silently overwrite a concurrent draft, or expose the helper credential reference to the browser.

### 6. Tests Required

- Test inheritance/deny-all assignment, readiness state transitions, route validation, exact config decoding, conflict draft retention, retry success, guest denial, and no model calls.
- `tests/vision-assist-turn.test.ts` holds helper capacity, revokes `allowedAugmentations`, releases capacity, and asserts terminal denial with zero helper attempts/Provider calls.
- Exercise desktop and touch-admin layouts with keyboard-reachable controls and no horizontal overflow.

### 7. Wrong vs Correct

#### Wrong

```typescript
const ready = Boolean(config.visionAssist?.routeId);
return { enabled: ready, imageMode: ready ? "native" : "none" };
```

#### Correct

```typescript
const ready = assignmentAllowsVision && helperConfig.enabled
  && hasManagedCredential && nativeImageOfferingAvailable;
return { imageMode: route.supportsImages ? "native" : ready ? "assisted_preanswer" : "none" };
```

Readiness is derived from executable server state and never changes the route's native capability truth.

## Scenario: Explicit Per-turn Web Research

### 1. Scope / Trigger

Use this contract when a member explicitly enables `chatus:web_research` for one
turn, when an administrator binds the capability to an MCP tool, or when the
client renders the resulting public citations.

### 2. Signatures

```typescript
type WebResearchRequest = {
  capabilityIds?: ["chatus:web_research"];
  webResearchQuery?: string;
};

type WebResearchEvidenceV1 = {
  version: 1;
  sources: Array<{ url: string; title: string; snippet: string }>;
};

prepareTeamAgentTurn(input: TeamAgentTurnInput): Promise<PreparedTeamAgentTurn>;
executeWebResearch(
  execution: McpRuntimeExecution,
  binding: WebResearchBinding,
  query: unknown,
  signal?: AbortSignal,
): Promise<WebResearchEvidenceV1>;
```

The reviewed MCP input schema is exactly one required bounded `query` string;
there is no browser-controlled URL or secret field.

### 3. Contracts

- `chatus:web_research` is explicit-turn only. It is absent from ordinary tools,
  automatic Skill candidates, and persisted regular Skill definitions. It may be
  projected only when exactly one assigned MCP tool owns the `web_search` role.
- The bound tool must be enabled, MCP-backed, `sideEffect: "read"`,
  `reviewRequired: false`, fingerprint-complete, attached to an enabled MCP
  server, and use the exact one-query schema. A tool can never be both a regular
  Skill dependency and the explicit web-research binding.
- A member turn spends the existing shared three-Skill budget. Manual selection
  leaves one slot for research; automatic selection is capped at two ordinary
  Skills. A full manual selection fails before MCP I/O. Admission is created once
  and reused by research and the main answer.
- The MCP call occurs before main Provider construction for both tool-capable and
  text-only routes. The latest user text is the disclosed query; no hidden query
  model is introduced. Continuations do not start a new search.
- MCP output is accepted only as exact JSON text `{ version: 1, sources }`.
  Results are bounded, normalized to at most ten public HTTPS URLs, canonicalized,
  deduplicated in server order, and inserted into a numbered Provider system
  block. Raw MCP bodies, credentials, endpoints, and model-generated Markdown
  citations never cross the Agent/UI boundary.
- The normalized evidence is the only persisted assistant `webResearch` metadata.
  The user activation metadata contains only the capability ID, allowing resend
  and branch recovery without restoring arbitrary request fields. React links use
  the shared URL sanitizer and show the exact same normalized titles/snippets.
- Execution owns a timeout/cancellation race and always closes the MCP execution.
  Denial, review drift, disconnected OAuth, timeout, cancellation, malformed or
  empty results return stable recoverable errors and never continue with a false
  fresh-search claim.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Guest, continuation, disabled tools, unknown capability ID, or no reviewed binding | `web_research_not_available`; zero MCP calls |
| Three manual Skills already selected | `web_research_slot_limit`; reject before MCP I/O |
| Tool is unassigned, write-capable, drifted, incomplete, or duplicated | Deny with stable availability/review error; no `tools/call` |
| OAuth/static connection is not ready | `web_research_connection_required`; no main Provider request |
| Blank or overlong disclosed query | `web_research_query_invalid`; close without external I/O |
| MCP exceeds the bounded deadline | `web_research_timeout`; close and do not claim fresh evidence |
| Parent cancellation | `request_cancelled`; close, release admission, and do not fall back |
| Non-text, malformed, oversized, empty, duplicate-only, or unsafe URL result | `web_research_invalid_response` or `web_research_no_sources`; raw body is discarded |

### 5. Good / Base / Bad Cases

- Good: a member enables research, one reviewed read-only MCP call returns ten
  sanitized sources, both route types receive the same numbered evidence, and the
  assistant history renders the exact safe links.
- Base: a failed search leaves the draft and activation recoverable for retry;
  no response says it used current web results.
- Bad: expose the MCP tool in ordinary tool lists, let the model choose the URL,
  charge quota once for research and again for the answer, or render raw source
  URLs/snippets without the shared sanitizer.

### 6. Tests Required

- Contract tests reject extra query fields, unsafe/private/credential URLs,
  malformed/non-text/empty/oversized/duplicate results, and assert canonical URL
  order plus ten-source/size limits.
- Binding tests cover assignment, exact schema, review dimensions, side effects,
  disabled servers, duplicate bindings, and exclusion from ordinary Skill/tool
  projections.
- Runtime tests use fake MCP/OAuth executions to assert exact query disclosure,
  timeout/cancellation races, mandatory `close()`, stable error classes, and zero
  live network/model calls.
- Worker/Agent tests cover both supports-tools modes, shared Skill-slot rejection,
  one admission for research plus answer, exact numbered evidence in Provider
  messages, and allow-listed user/assistant metadata persistence for resend/branch
  recovery.
- Client tests assert strict evidence decoding, accessible source rendering, and
  no overflow or unsafe links at desktop and 390px touch widths.

### 7. Wrong vs Correct

#### Wrong

```typescript
const url = body.url;
return provider.complete(`Search ${url} and cite the Markdown links it returns`);
```

#### Correct

```typescript
const binding = resolveWebResearchBinding(config, access.user);
const evidence = await executeWebResearch(runtime.createExecution(), binding.binding,
  latestUserText, abortSignal);
const messages = [{ role: "system", content: formatWebResearchEvidenceForModel(evidence) }, ...baseMessages];
```

The administrator-reviewed MCP contract owns network access, the shared decoder
owns public evidence, and the Provider sees only bounded numbered sources.

## Scenario: Unified Member Capability Experience

### 1. Scope / Trigger

Use this contract when changing the conversation capability inspector, transient
per-turn capability status, recovery actions, or the nested MCP connection dialog.
It covers the React workspace and deterministic Workspace fixture only; capability
truth still comes from the exact session and availability projections above.

### 2. Signatures

```typescript
type CapabilityTurnStatus =
  | "selected" | "waiting" | "running" | "succeeded"
  | "unavailable" | "denied" | "timed_out" | "cancelled" | "error";

type CapabilityTurnSnapshot = {
  conversationId: string;
  items: Array<{
    kind: "workflow_selection" | "web_research" | "image_understanding" | "tool_execution";
    status: CapabilityTurnStatus;
    recovery: Array<"retry" | "remove_images" | "switch_route" | "connect_mcp">;
  }>;
};
```

```text
ConversationInspector section: capabilities | files | sharing
Capability recovery owners: ChatWorkspace draft, route, and MCP dialog actions
```

### 3. Contracts

- One `capabilities` inspector section owns model availability, workflow selection,
  explicit turn tools, image understanding, and MCP readiness. Attachment, one-turn
  research, and send controls remain in the composer.
- Labels, source, activation, affected data, latency, cost, assignment, and setup
  readiness are rendered from strict server projections. The browser does not infer
  Provider identity, connection readiness, or executable capability from labels.
- A turn snapshot is React memory scoped to one conversation. It is not written to
  local storage, Agent messages, exports, Provider evidence, or monitoring events.
  Switching conversations must not display or clear another conversation's state.
- Tool-part and error projections map to the closed status set. Live status uses one
  restrained polite atomic region; historical message content remains the durable
  source for completed tool output and citations.
- Recovery delegates to the existing owner: retry reuses restored draft state,
  remove-image revokes each distinct object URL once, route switching focuses the
  existing selector, and connection recovery opens the existing MCP dialog.
- A nested MCP dialog traps focus and consumes Escape before the inspector. Closing
  it restores the invoking control; closing the inspector restores its opener.
- The five required viewports keep controls contained. Touch layouts expose at least
  44 by 44 CSS-pixel interactive targets and reduced motion removes nonessential
  inspector transition and animation duration.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Turn snapshot belongs to another conversation | Do not render it in the active inspector |
| No capability selected or active | Render neutral current-state copy; do not invent success |
| Image capability is unavailable | Offer image removal and route/connection recovery only when applicable |
| Retry races with a newer draft | Preserve the newer draft; never overwrite it with the failed submission |
| The same image appears in draft/submitted/retry arrays | Revoke its object URL once, then remove every matching image reference |
| MCP dialog receives Escape | Close only the dialog and restore its opener; keep the inspector open |
| Server projection is malformed or inconsistent | Reject the complete response before rendering capability facts |

### 5. Good / Base / Bad Cases

- Good: a timed-out research turn is shown as timed out, retry delegates to the
  restored draft owner, and the live region announces only the bounded state change.
- Base: no turn is active; the inspector still shows exact readiness and disclosure
  while the composer retains its high-frequency controls.
- Bad: persist waiting state, duplicate capability facts across several tabs, infer
  readiness from a tool name, revoke one object URL more than once, or let nested
  Escape close both dialog and inspector.

### 6. Tests Required

- Pure client tests cover all nine statuses, error mapping, tool-part reduction,
  recovery lists, and empty-result failure without serializing private payloads.
- State tests cover draft-generation-safe retry, conversation switching, and
  distinct image-preview cleanup.
- Workspace Playwright covers ready/setup-required projections, status matrix,
  retry/image/route/MCP recovery, focus trap and restoration, reduced motion, local
  scrolling, no horizontal overflow, and screenshots at 1920, 1440, 780, 480, and
  touch 390 widths. The fixture must abort unexpected network and Agent requests.

### 7. Wrong vs Correct

#### Wrong

```typescript
localStorage.setItem("capability-turn", JSON.stringify(turn));
setMcpOpen(false);
setInspectorOpen(false);
```

This persists transient execution state and lets one Escape close two focus scopes.

#### Correct

```typescript
setCapabilityTurn(turn); // in-memory, conversation-scoped projection
closeMcpConnections();   // restores the nested opener; inspector remains mounted
```

The runtime owner remains authoritative, transient state cannot leak into durable
surfaces, and each modal layer owns exactly one keyboard/focus boundary.
