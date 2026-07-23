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
```

### 3. Contracts

- `allowedSkills === undefined` is the legacy-compatible state: all enabled Skills are assigned.
- `allowedSkills: []` explicitly assigns no Skills. Do not collapse these two states during normalization or effective-user merging.
- Stored Skill IDs are normalized to at most 50 unique IDs of at most 80 characters. User values override defaults through the existing effective-user merge.
- `/api/session` exposes only enabled, assigned Skills. It never exposes Skill instructions.
- Both `/api/chat` and `prepareTeamAgentTurn()` call `getSelectedSkills()` with the effective user assignment on every turn. Persisted or client-supplied old Skill IDs cannot restore a revoked Skill.
- An unassigned or disabled Skill contributes neither instructions nor referenced tools. Executable tools remain the intersection of selected assigned Skills, `allowedTools`, enabled tool definitions, and available executors.
- The admin user editor persists `allowedSkills` through the revision-checked configuration write. Skill rename and deletion update explicit user/default allow-lists before saving.

### 4. Validation & Error Matrix

- User `allowedSkills` references a missing Skill -> `400 invalid_config` with the user label and missing Skill ID.
- Default `allowedSkills` references a missing Skill -> `400 invalid_config` with the missing Skill ID.
- Conversation create/update requests an unassigned Skill -> `403 skill_not_allowed`.
- A stale chat turn includes a revoked Skill -> continue without that Skill, its instructions, or its tools.
- A Skill exists but is disabled -> omit it from session projection and turn selection.

### 5. Good/Base/Bad Cases

- Good: a member receives `allowedSkills: ["writing"]`; the session and both execution paths expose only `writing`.
- Base: an older configuration has no `allowedSkills`; all enabled Skills remain available until an administrator saves an explicit list.
- Bad: a saved conversation continues sending a revoked Skill ID; the server filters it before prompt and tool construction.

### 6. Tests Required

- Registry unit tests assert assigned projection, missing-field compatibility, explicit empty denial, and selected-Skill filtering.
- Worker API tests assert admin persistence, per-member `/api/session` projection, legacy `/api/chat` prompt filtering, and missing-reference rejection.
- Team Agent tests assert a revoked persisted selection produces no selected Skill, instructions, or tool definitions.
- Frontend structure checks assert the user Skill assignment control exists and is included in user saves.

### 7. Wrong vs Correct

#### Wrong

```typescript
const selectedSkills = getSelectedSkills(config, input.skillIds);
```

This validates only global Skill state and lets a stale conversation reuse a Skill after per-member revocation.

#### Correct

```typescript
const selectedSkills = getSelectedSkills(config, input.skillIds, access.user);
```

The effective assignment is enforced at the execution boundary on every turn.

## Scenario: Typed Admin Member Assignment Workspace

### 1. Scope / Trigger

- Trigger: changing the typed React administrator surface for member route, Skill, or tool assignments; member discovery; or revisioned configuration editing.
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
- The typed editor may change only `defaults` or one selected user's `defaultRoute`, `allowedRoutes`, `allowedSkills`, and `allowedTools`. It must preserve route definitions, providers, MCP servers, and unrelated user fields at the draft boundary.
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
- Session cleanup is part of the server action. A response reports `{ revoked, complete }`; an incomplete cleanup must be shown as a warning rather than as full success.
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
- Session revocation is idempotent and uses the existing label session scan. The response reports whether the scan completed; incomplete cleanup is a warning, not a success claim. The endpoint does not revoke access codes or delete user data.
- The typed editor confirms configuration removal when the selected member has a dirty draft, and confirms both destructive operations in a native modal. Successful configuration removal updates the snapshot and selected member state without silently discarding unrelated dirty drafts.

### 4. Validation & Error Matrix

- Unknown configured member -> `404 member_config_not_found`; no configuration or session mutation.
- Invalid/oversized path label -> `400 invalid_member_label`.
- Session scan failure after retries -> `complete: false`; audit uses an incomplete action and the UI exposes a retryable warning.
- Any response containing provider keys, custom headers, access codes, or extra envelope fields -> client decoder rejects it.

### 5. Tests Required

- Worker tests cover missing/stale/current configuration revisions, duplicate trimmed legacy labels, configured-member retention, access/session/data preservation, secret-free response and audit output, cross-origin rejection, and incomplete session cleanup reporting.
- Client decoder tests cover exact configuration-removal and session-revocation envelopes and reject secret-bearing extras.
- Frontend checks require the reset/session actions, confirmation text, revisioned reset helper, and strict decoders.
