# ACL sharing and revocation

## Goal

Add explicit conversation-resource sharing between existing member principals.
The first release gives viewers read-only access and gives editors only bounded
conversation mutations, with server-side authorization and authoritative,
revisioned revocation at every entry point. Sharing must not turn an owner's
root Agent into a workspace membership boundary.

## Background and confirmed facts

- `08-05-acl-stable-principal-resource-identity` is archived. Immutable
  `principalId` and owner-independent `resourceId` routes are authoritative;
  label aliases are not durable ACL identity.
- `IdentityRegistry` owns stable principal/resource routing in embedded SQLite
  (`src/identity-registry.ts:111`, `src/identity-registry.ts:750`). A resource
  currently has an owning `principal_id`, stable `resource_id`, conversation ID,
  Agent instance and migration revision (`src/identity-registry.ts:787`).
- The authenticated Worker currently resolves all conversation HTTP and Agent
  traffic through the caller's root Agent (`src/worker.ts:2295`,
  `src/worker.ts:4994`). The shared path must instead resolve an active grant to
  an exact stable resource route.
- Conversation summaries/title/settings live in the owner root Agent while the
  transcript lives in the stable conversation Agent
  (`src/agent/team-agent.ts:790`, `src/agent/team-agent.ts:2632`). A shared list
  therefore needs a bounded target-summary lookup; it must never list the
  owner's whole root.
- A member turn currently loads owner root memory and conversation workspace
  references and enables tools (`src/agent/team-agent.ts:2737`,
  `src/agent/team-agent.ts:2812`). Shared editor execution must omit all three.
- Current request/identity checks happen at turn start and current stream abort
  is local to the turn (`src/agent/team-agent.ts:2692`,
  `src/agent/team-agent.ts:2850`). They are not an ACL commit fence and are not
  sufficient for a revoke race.
- `future-governance-decisions.md` requires exact API/data/state contracts,
  deterministic local tests and explicit unsupported behavior before ACL can be
  supported (`.trellis/spec/platform/future-governance-decisions.md:83`).

## Applicable decisions and risks

- `ACL-03`: a grant covers one explicit conversation resource. Root memory,
  workspace state, credentials/API keys/OAuth, feedback ownership, exports and
  tool trust never follow implicitly. Closure evidence is a viewer/editor matrix
  across memory, file and token boundaries.
- `ACL-04` partial: ACL revision changes invalidate existing resource tool trust;
  editor/viewer tools remain denied and revoke tests prove zero remote calls.
  Shared tool enablement and confirmation policy remain for the next child.
- Revocation is authoritative at the successful `IdentityRegistry` ACL revision
  transaction. Cache clearing, active-turn abort and UI refresh are derived
  cleanup and cannot delay denial.
- A mutation is successful only if its final server-side access fence linearizes
  before revocation. A stale turn is aborted and its tentative transcript/index
  changes are removed; already delivered browser bytes cannot be retracted and
  do not confer continuing authorization.

## Product policy

### Grant shape and discoverability

- Only an authenticated owner can grant or revoke access to an existing active
  member, identified in the request by an exact bounded member label and stored
  by immutable `principalId`.
- Direct member grants have no expiry in v1. They remain active until explicit
  owner revocation, member retirement or later ownership/deletion policy. The
  v1 request/schema rejects expiry fields rather than silently ignoring them.
- Public links, invitation credentials, one-time grants, groups and organization
  roles are unsupported.
- Active shared resources appear only in the grantee's authenticated conversation
  list. A non-granted principal receives the same `conversation_not_found` 404
  for unknown, revoked and unauthorized resources.
- Owners can see the current bounded label for each grantee in the share dialog.
  Grantees see their role and stable resource ID, not owner/grantor labels.

### Initial role/action matrix

| Server action / surface | Owner | Editor | Viewer |
| --- | --- | --- | --- |
| List the accessible resource and read/resume transcript | allow | allow | allow |
| Send a new message or stop own active turn | allow | allow | deny |
| Rename conversation title | allow | allow | deny |
| Change route, Automatic Skill mode or selected Skills | allow | deny | deny |
| Edit/resend/regenerate into a branch or create a branch | allow | deny | deny |
| Delete conversation | allow | deny | deny |
| List/upsert/revoke ACL entries | allow | deny | deny |
| Read/change conversation workspace file references | allow | deny | deny |
| Attach/download/delete owner workspace files | allow under existing policy | deny | deny |
| Load or mutate owner/editor root memory | owner context only | deny | deny |
| Invoke or approve MCP/tools, including read-only tools | allow under existing policy | deny | deny |
| Use owner/editor API keys or OAuth credentials | owner context only | deny | deny |
| Submit feedback owned by the conversation owner | allow under existing policy | deny | deny |
| Export owned conversation through user export | allow under existing policy | deny | deny |
| Change ownership | unsupported | unsupported | unsupported |

An editor turn is charged and attributed to the authenticated editor principal,
uses the resource's existing route/Skill settings, and uses only administrator
configured Provider access. It receives no owner or editor root memory, workspace
file context, browser-supplied API key, OAuth token, tool definition or tool
trust. Pin mutation is not a supported current surface and is not added here.

## Requirements

### R1. Versioned authorization model

- Add a resource-scoped `accessRevision` independent of identity migration and
  principal revisions.
- Store at most one active `viewer|editor` grant per `(resourceId, principalId)`;
  ownership continues to come only from the resource owner principal.
- Persist append-only, content-free ACL events for grant, role change and revoke.
- Grant/revoke operations require `operationId` and `expectedAccessRevision` and
  replay idempotently; reuse with a different fingerprint fails closed.

### R2. Exact server-side enforcement

- Resolve the authenticated actor, stable resource and allowed action at every
  list/read/WebSocket/send/title/settings/branch/delete/ACL/workspace/file/
  memory/tool/OAuth/feedback/export boundary.
- Browser role, principal, owner, Agent instance and ACL revision values are
  advisory. The Worker replaces them with a server-derived access snapshot.
- Owner backward compatibility may resolve a missing `resourceId` by the caller's
  `(principalId, conversationId)` for one release. Shared access always requires
  an exact stable `resourceId`; mismatched resource/chat pairs fail closed.

### R3. Shared list and UI

- Merge owned summaries and active shared summaries in the existing bounded
  conversation-list response. Obtain each shared summary through an exact
  single-conversation owner-root lookup, never `listConversations()` followed by
  client-side filtering.
- Return `resourceId`, `accessRole` and `accessRevision` with every summary.
- Add an owner-only React share dialog for exact-label grant, role change and
  revoke. Show the current role on shared conversations and gate every affected
  control in the UI, while retaining server enforcement as authority.

### R4. Authoritative revoke and commit fence

- The ACL revision transaction revokes first. Derived cache/trust invalidation,
  active-turn abort and UI refresh run only after that transaction and may retry.
- Every shared mutation captures an access snapshot and revalidates the exact
  resource, actor, role and access revision immediately before its durable commit.
- A stale editor turn closes tools/Provider work, aborts streaming, restores the
  pre-turn transcript/index state and records no successful post-revoke activity.
- The resource Agent accepts best-effort revision invalidation to abort matching
  in-flight turns, but correctness must not depend on that callback arriving.
- A stream authorized before revoke may expose bytes already sent; after revoke it
  terminates at the next server-controlled boundary and cannot resume or commit.

### R5. Privacy, audit and failure behavior

- ACL rows/events contain only opaque principals/resources, bounded roles,
  revisions, operation IDs and timestamps. They contain no access code, session,
  Provider data, prompt, completion, memory, filename, OAuth token or tool payload.
- Stable errors are: `conversation_not_found` (404 undiscoverable),
  `conversation_action_denied` (403 for a known active grant with insufficient
  role), `conversation_access_revision_conflict` (409 stale expected revision),
  `conversation_acl_operation_conflict` (409 replay fingerprint conflict), and
  `conversation_acl_unavailable` (503 authority unavailable).
- Owner access remains available if the ACL projection/cleanup callback fails;
  shared access fails closed when authoritative ACL state cannot be read.

### R6. Rollout and rollback

- Roll out owner-compatible access snapshots and viewer access before enabling
  editor sends/title changes.
- Rollback disables new grants and shared mutations, then transactionally revokes
  active grants. It preserves principals, resource routes, ACL rows/events,
  owner transcripts and current-owner access.
- No local production deployment, live Provider/MCP call or synthetic production
  probe is allowed. Production deploy and acceptance run through GitHub Actions.

## Acceptance criteria

- [x] AC1. Schema/RPC/API decoder tests prove strict v1 contracts, independent
      `accessRevision`, idempotent replay, revision conflicts, no expiry input,
      append-only audit and exact owner uniqueness.
- [x] AC2. The complete owner/editor/viewer action matrix passes at Worker and
      Agent boundaries; unknown roles/actions, mismatched IDs and browser-forged
      authority fail closed.
- [x] AC3. A viewer reads one granted transcript and can discover only that shared
      resource, with no owner root list, memory, file/ref, token, OAuth, feedback,
      tool/trust or export disclosure.
- [x] AC4. An editor can send a new message and rename the title, but route/Skill,
      branch/message actions, delete, ACL, file/ref, tools, memory, OAuth, feedback
      and export remain denied in API, Agent and UI fixtures.
- [x] AC5. Editor execution is attributed/charged to the editor and uses no owner
      or editor root context, user API key, OAuth credential or tool definition.
- [x] AC6. Revoke-vs-read/title/send/stream races linearize on access revision:
      no request starting after revoke succeeds, no stale mutation commits, active
      streams terminate, tentative transcript/index changes are restored and
      remote tool call count remains zero.
- [x] AC7. Grant, role-change and revoke replay is idempotent; ACL changes clear
      resource tool trust, derived invalidation can be retried, and stale browser
      tabs cannot resume access.
- [x] AC8. React tests and Workspace Playwright cover owner share management,
      viewer read-only state, editor bounded controls, role change, revoke and
      reload/error recovery without `window.confirm`.
- [x] AC9. `ACL-03` and partial `ACL-04` evidence is appended to specs/risk records;
      all full gates, fake Provider/MCP tests, PR/CI, exact-main deployment,
      production acceptance, artifact retention and Trellis archive checks pass.

## Local verification evidence

- `npm run check:frontend`: passed with the existing bundle-size warning only.
- `npm run typecheck`: passed.
- `npm test`: 49 files and 770 tests passed.
- `npm run test:browser:workspace`: 165 tests, 110 passed and 55 viewport skips.
- `npm run test:browser:agent`: 3/3 passed twice after the refresh race fix.
- Focused ACL Vitest: 4 files and 234 tests passed.
- Focused Workspace/ingest Vitest: 2 files and 33 tests passed.
- `npx wrangler deploy --dry-run`, `git diff --check`, and
  `python ./.trellis/scripts/task.py validate-all`: passed.
- All Provider/MCP coverage used local deterministic fakes. No local production
  deployment, live Provider/MCP call, or synthetic production probe was run.

## Delivery evidence

- PR `https://github.com/Drew-Z/chatus-private-chat/pull/62` merged after
  exact-head GitHub Actions run `31531082055` passed `changes`, `quality`,
  `workspace-browser` and `agent-browser` for work commit
  `e50cedc51e090fd25e4cf3138378a196e6021da4`. The retained PR artifacts use
  GitHub's pull-request merge revision `ce8fc52ffd951dcde5e9f5a21ad32ef8cdec266b`
  and expire on 2026-08-26.
- Squash merge commit `4f1b27b9177556a3e28ad63c542a0db9636def68` was the
  exact `main` tip deployed only through GitHub Actions run `31550193047`.
  Main-tip checks, full quality gates, Wrangler deployment and production smoke
  passed. Artifact `production-deployment-4f1b27b9177556a3e28ad63c542a0db9636def68`
  (`9124029413`) is retained through 2026-11-10.
- Production member acceptance run `31550547411` verified the same exact deployed
  revision and passed temporary-member acceptance. Artifact
  `production-acceptance-4f1b27b9177556a3e28ad63c542a0db9636def68`
  (`9124098901`) is retained through 2026-11-10. No waiver was used.

## Out of scope and remaining unsupported behavior

- Ownership transfer, former-owner policy, owner deletion disposition,
  tombstone/anti-resurrection and shared snapshot/reference export remain in
  `08-05-acl-transfer-deletion-export-tools`.
- Resource-local files, any shared tool execution/confirmation/trust, public or
  anonymous links, group ACL, expiring grants and organization-wide RBAC remain
  unsupported.
- Editors cannot create branches or use edit/resend/regenerate actions in v1.
- Revocation cannot retract transcript bytes already rendered or stored in a
  browser before the authoritative revision changes.
