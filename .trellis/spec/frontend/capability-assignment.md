# User Skill Assignment

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
