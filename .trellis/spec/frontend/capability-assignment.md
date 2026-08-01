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
- Automatic selection sends only public candidate `id`, `label`, and `description` plus a bounded latest user message. It uses the selected logical route only, may try offerings within that route, emits at most 200 tokens, uses `maxRetries: 0`, has no tools, requires exact JSON `{ "skillIds": string[] }`, and accepts at most three unique assigned IDs.
- A hard five-second boundary covers plan preparation, lease acquisition, Provider completion, telemetry, and release. The caller races the entire attempt against this boundary so an operation that ignores abort cannot delay the main turn or promote a late result.
- After selection, reload configuration and re-run assignment/enabled filtering before prompt and tool construction. Failure falls back to the revalidated last-success snapshot, then the first three assigned Skills in administrator order.
- Only `source: "model"` updates the snapshot. The actual per-turn result, source, and finite fallback reason are stored in assistant message metadata so history and branches retain truthful evidence.
- Selector attempts use the separate `route-provider-skill-selection:` telemetry keyspace and never update chat reliability ordering. The main turn remains the only quota admission owner; selector offerings do not consume another user message unit.
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
- Selector returns a now-disabled, unassigned, unknown, or duplicate ID -> discard it during final revalidation; no revoked instructions or tools may enter the turn.
- A stale chat turn includes a revoked Skill -> continue without that Skill, its instructions, or its tools.
- A Skill exists but is disabled -> omit it from session projection and turn selection.

### 5. Good/Base/Bad Cases

- Good: an automatic conversation selects `writing` on its current logical route, reloads configuration, records isolated selector telemetry, and displays the validated result in the assistant message.
- Base: a migrated conversation remains manual; a selector timeout uses the revalidated previous snapshot and the main answer continues while quota increments once.
- Bad: the browser supplies `automatic` and forged IDs for a guest, or a selector returns a Skill revoked during the request; the execution boundary repairs/discards them before prompt and tool construction.

### 6. Tests Required

- Registry unit tests assert assigned projection, missing-field compatibility, explicit empty denial, and selected-Skill filtering.
- Worker API tests assert admin persistence, per-member `/api/session` projection, legacy `/api/chat` prompt filtering, and missing-reference rejection.
- Worker API tests assert v4 idempotence, legacy/manual migration, automatic member defaults, guest repair, exact manual empty behavior, branch inheritance, export/import, PATCH omission, and unauthorized rejection.
- Team Agent tests assert single-logical-route planning, offering fallback, strict JSON, 200-token/tool-free requests, a hard five-second late-result boundary, last-success/admin fallback, revocation races, isolated telemetry, and one quota charge.
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
const prepared = await providerPlanRuntime(env, config).preparePlan({
  routeIds: [settings.routeId],
  accessRoutes: access.routes,
  userApiKey,
});
// Race the whole attempt against 5 seconds, then reload config and revalidate.
const selectedSkills = getSelectedSkills(reloadedConfig, attempt.skillIds, reloadedAccess.user);
```

The root conversation is authoritative, logical fallback is excluded, the hard boundary rejects late results, and current assignment is enforced immediately before execution.

## Scenario: Typed Admin Member Assignment Workspace

### 1. Scope / Trigger

- Trigger: changing the typed React administrator surface for member policy, route, Skill, or tool assignments; member discovery; or revisioned configuration editing.
- The typed workspace is a focused assignment editor. The legacy `/admin.html` surface remains the entry point for route/provider definitions, quotas, MCP administration, audit, and other administrator sections until those sections are migrated deliberately.

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
- The full legacy administration link is `/admin.html`; `/react-chat/admin` and its trailing-slash form are the typed member-assignment shell.

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
- Bad: a typed admin link points to `/admin`; the deployed asset is `/admin.html`, so the link can resolve to a missing asset or the wrong shell.

### 6. Tests Required

- Frontend structure checks assert the typed shell, semantic route fieldset, independent route inheritance, revisioned save, conflict draft retention, `beforeunload`, secret-free rendering, `/admin.html` link, and login `finally` recovery.
- Client validator tests assert unique trimmed member labels, route reference/enabled-state validation, complete session policy booleans, and rejection of `apiKey`/`headers` in sanitized config projections.
- Worker API tests assert member metadata contains no access codes, session policy flags match the client contract, both typed-admin paths serve the React shell, and `/admin.html` serves the legacy admin asset.
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

The pure draft boundary owns inheritance, all/selected route intent, default-route repair, and revision-conflict rebasing. Login still clears submission state in `finally`, and full legacy administration remains `/admin.html`.

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

## Scenario: Typed Capability Registry Administration

### 1. Scope / Trigger

- Trigger: changing the typed React administration surface for Skill definitions, tool policy, MCP server configuration, managed MCP credentials, remote-tool discovery/review, or capability reference repair.
- The registry is administrator-only. Members receive only their assigned public capability projection and never receive Skill instructions, MCP endpoints, schemas, secret metadata, or physical credential values.

### 2. Signatures

```text
GET    /api/admin/config
PUT    /api/admin/config
  <- { config: SanitizedAdminConfig, expectedRevision: string }

GET    /api/admin/mcp-secrets
PUT    /api/admin/mcp-secrets/:secretRef
  <- { secret: string, expectedRevision?: string }
DELETE /api/admin/mcp-secrets/:secretRef
  <- { expectedRevision?: string }

POST   /api/admin/mcp-discovery
  <- { serverId, label?, endpoint, authType, secretRef? }
  -> { serverId, tools: AdminMcpDiscoveredTool[], rejected }
```

```typescript
type AdminMcpServerConfig = {
  enabled: boolean;
  label: string;
  endpoint: string;
  authType: "none" | "bearer" | "x-api-key";
  secretRef?: string;
};

type AdminToolExecutor =
  | { type: "builtin"; name: "text_stats" }
  | { type: "mcp"; serverId: string; remoteName: string };
```

### 3. Contracts

- `config.skills`, `config.tools`, and `config.mcpServers` are exact runtime-decoded registries. IDs and references use locale-independent UTF-16 code-unit ordering in deterministic UI/test output.
- Skill rename/delete repairs `defaults.allowedSkills` and every explicit user `allowedSkills`. Remote-tool deletion repairs every Skill `toolIds` plus default/user `allowedTools`. `builtin:text_stats` is never deletable.
- MCP rename is delete-plus-create because remote tool IDs embed the server ID. Rename/delete removes that server's reviewed tools and all Skill/member references; it does not migrate old discovered tools to the new ID. Managed secret records remain separately owned and are not deleted implicitly.
- A Skill/tool/MCP entity draft is local. Every config save uses the current snapshot revision. `config_conflict` refreshes the snapshot but keeps the local entity draft dirty and exposes an explicit server-version reset.
- An authenticated MCP server requires a saved `secretRef`; `authType: "none"` forbids one. Secret writes are enabled only when the selected server and exact ref match the saved, clean snapshot.
- MCP secret input is write-only and ephemeral. The client sends the exact string without trimming; only a zero-length value is rejected. The input clears on success, failure, conflict, ref/entity/view/snapshot changes, refresh, and unmount.
- Discovery is read-only and saved separately through the revisioned config boundary. New tools are disabled. A changed `schemaFingerprint` forces disabled review state. A stable fingerprint preserves enabled state and preserves only `always`; all other remote policies normalize to `first-per-conversation`. Tools absent from the newest discovery response are not deleted automatically.
- The tablist uses roving tabindex plus Arrow/Home/End navigation and labels one `tabpanel`. At mobile widths, the bounded sidebar remains outside the editor scroll owner; tabs are at least 44px and cannot scroll behind the global header.

### 4. Validation & Error Matrix

- Blank/oversized label, invalid ID, missing Skill/tool/MCP reference, non-HTTPS endpoint, or invalid auth/ref pairing -> reject the local draft; submitted invalid config -> `400 invalid_config`.
- Unknown or extra response fields, blank labels, invalid executor union, invalid remote name, uppercase/malformed fingerprint, or secret-bearing projection -> client rejects the response as an invalid admin config/discovery/secret response.
- Stale config revision -> `409 config_conflict`; refresh the snapshot and retain the draft/discovery result.
- Stale managed-secret revision -> `409 mcp_secret_conflict`; clear plaintext and keep the saved secret unchanged.
- Zero-length or over-8192-character secret -> `400 secret_required` / `400 secret_too_long`. Leading and trailing whitespace are credential bytes and are preserved.
- Attempt to delete a builtin tool -> no mutation and no delete control.
- New or changed discovered schema -> persist `enabled: false`; do not silently retain the former approval state.

### 5. Good / Base / Bad Cases

- Good: rename a Skill, save with `expectedRevision`, and update every explicit assignment reference atomically while inherited assignments remain inherited.
- Good: discover a changed remote schema, save it disabled for review, then deliberately enable it in the tool-policy editor.
- Base: a stable rediscovery keeps an enabled remote tool enabled and retains `always` confirmation without deleting older reviewed tools omitted by the server.
- Bad: trim an MCP bearer token before encryption, submit the surrounding MCP form when Enter is pressed in the password input, or persist plaintext in the config draft.
- Bad: make the whole mobile sidebar sticky inside the panel scroll container; `scrollIntoView()` can place the tab under the header/editor and make touch clicks unreachable.

### 6. Tests Required

- Pure helper tests cover Skill rename/delete, remote-tool delete, MCP rename/delete, assignment/Skill reference repair, builtin deletion denial, schema merge counts, stable enablement, and changed-schema disablement.
- Client decoder tests accept exact valid Skill/tool/MCP/secret/discovery projections and reject unknown fields, blank labels, invalid auth/ref pairs, invalid executor names, malformed remote names, and malformed fingerprints.
- Worker tests decrypt a padded synthetic MCP secret and assert byte-for-byte preservation while API responses, audit records, and stored JSON omit plaintext/ciphertext.
- Desktop 1440px and touch-enabled 390px browser tests cover dirty-discard confirmation, Escape and successful-delete focus restoration, keyboard tab navigation, Enter-to-save-secret behavior, discovery review, touch targets, local editor scrolling, and horizontal containment.
- Run the full workspace matrix and the separate fake-provider Agent browser acceptance; neither may contact a live model.

### 7. Wrong vs Correct

#### Wrong

```typescript
await putAdminMcpSecret(secretRef, secretValue.trim());
tools[id] = { ...discovered, enabled: existing?.enabled ?? true };
```

This changes credential bytes and lets a new or changed remote schema execute without administrator review.

#### Correct

```typescript
await putAdminMcpSecret(secretRef, secretValue, metadata.revision);
tools[id] = {
  ...discovered,
  enabled: sameFingerprint ? existing.enabled : false,
  confirmation: sameFingerprint && existing.confirmation === "always"
    ? "always"
    : "first-per-conversation",
};
```

The secret remains byte-exact and schema trust is granted only through explicit review.
