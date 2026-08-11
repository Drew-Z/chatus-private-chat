# ACL stable principal and resource identity

## Goal

Introduce immutable opaque member principal IDs and owner-independent
conversation resource IDs. Existing Durable Object data remains in place and is
routed through reconciled pinned identities. Sharing, transfer, and ACL grants
remain unavailable until later children.

## Background And Dependencies

- `ACL-01` is the owning risk. Mutable labels are login/display aliases, never
  durable authorization or storage identities.
- The deployed `legacy.api.chat-post` rollout records the current identity
  handoff at main SHA `a0f8b30a4549dbf832827d6e54de4fbbb48790b3`:
  Root and conversation TeamAgent names are currently derived from a member
  label, and existing Agent identity records assert that legacy label.
- Full legacy read-disable and destructive cleanup are not prerequisites for
  this additive identity foundation. An unresolved mapping blocks authority for
  that principal/resource, but does not block creating the registry or
  reconciling other mappings.
- Existing recovery, deletion, access lifecycle, workspace, and Provider gates
  remain authoritative. Production deployment and acceptance run only through
  GitHub Actions; tests use local deterministic fixtures and fake Provider/MCP.

## Requirements

### Stable registry and session identity

- Add one instance-wide SQLite Durable Object registry with strict versioned
  principal, alias, conversation-resource, migration-marker, and idempotency
  contracts. Add it through an append-only Wrangler SQLite migration.
- Member sessions carry an immutable `principalId`. Legacy stored sessions are
  upgraded only after a server-side exact alias lookup; missing, retired,
  duplicated, or conflicting mappings fail closed. Guest sessions do not gain a
  member principal.
- Alias history is retained. Revoking/removing a member retires the alias binding;
  later reuse creates a new principal and must never recover the prior
  principal's UserState, Root Agent, conversation Agents, memory, files, OAuth
  tokens, usage, or export scope.

### Pinned resource routing and migration

- Existing principals pin their current label-derived Root TeamAgent and
  UserState instance names. Existing conversations pin their current
  label/chat-derived TeamAgent instance names. No existing Durable Object data is
  copied, renamed, or rebound by this child.
- Native post-migration principals and conversations derive their initial pinned
  instance names from `principalId` and `resourceId`, never from a label.
- Every TeamAgent and authoritative UserState route asserts a stable marker in
  addition to the retained legacy identity. A client cannot supply principal,
  owner, resource, registry revision, or Agent instance identity.
- Backfill and replay are bounded and idempotent. They report duplicate aliases,
  orphan resources, wrong Root/Conversation instances, missing conversations,
  and digest conflicts without silently selecting one mapping.
- Dual-read compares the legacy-computed route with the registry-pinned route for
  migrated records. Stable routing becomes authoritative per record only after
  exact route/identity/revision reconciliation. A mismatch fails closed and
  remains visible in content-free administrative evidence.

### Compatibility and unsupported behavior

- Current owner-only chat, memory, workspace, file, OAuth, tool, export, cleanup,
  and deletion behavior remains owner-scoped. All call sites use the authenticated
  principal's resolved pinned routes; the browser label remains presentation and
  policy lookup only.
- No sharing, ACL grant, transfer, shared discovery, shared file/tool access,
  cross-principal export, or owner deletion disposition is added. Existing
  endpoints must not accept authoritative identity fields from request bodies,
  query parameters, headers, cookies, or Agent payloads.
- Recovery inventory and isolated restore validate the identity registry binding,
  migration tag, schema, stable mappings, and reconciliation evidence before
  target mutation.

## Acceptance Criteria

- [x] AC1. Every active member resolved by the migration has exactly one opaque
      principal, active alias, pinned Root/UserState route, and marker; every
      active conversation has exactly one resource/owner/pinned Agent route.
- [x] AC2. Rename, alias retirement, and label reuse fixtures produce zero
      cross-principal reads across Root Agent, UserState, conversation Agent,
      memory, files, OAuth, usage, cleanup, deletion, and export paths.
- [x] AC3. Resource IDs and pinned Agent routes remain stable across alias changes;
      new principals/resources use only stable-ID-derived instance names.
- [x] AC4. Bounded backfill/replay is idempotent and returns all duplicate,
      orphan, missing, wrong-instance, and digest-conflict evidence without
      mutating an ambiguous record.
- [x] AC5. Dual-read reconciliation proves exact legacy/pinned route and identity
      parity for migrated fixtures before each record becomes authoritative;
      drift fails closed with no Provider, tool, file, or conversation mutation.
- [x] AC6. Member sessions are principal-bound, legacy sessions upgrade safely,
      guests remain isolated, and client-supplied identity/routing fields have no
      authority.
- [x] AC7. ACL, sharing, transfer, shared files/tools/export, and cross-principal
      resource discovery remain unavailable and have explicit negative tests.
- [x] AC8. Rollback stops new authority transitions while preserving stable IDs,
      aliases, markers, pinned routes, current owner access, and all existing
      Durable Object data without rebinding.
- [x] AC9. Capture/restore, permanent deletion, access revocation, and recovery
      contracts include the new registry and preserve anti-resurrection behavior.
- [ ] AC10. Focused/full fake-runtime tests, impacted Workspace and Agent
      Playwright, specs, PR/commit/exact-SHA deployment evidence, and Trellis
      archive consistency pass.

## Acceptance Evidence

- AC1/AC3: `tests/identity-registry.test.ts` and `tests/worker-api.test.ts`
  prove opaque legacy/native principal and resource creation, exact pinned route
  derivation, resource ownership, stable markers, and authoritative transitions.
- AC2: Worker, feedback, quota, cleanup, deletion, and session tests prove alias
  retirement/reuse isolation. An established conversation Agent rechecks the
  active registry binding and performs zero Provider calls after retirement.
- AC4: registry and admin API tests cover bounded reconciliation, operation
  replay, stale revision, wrong instance, missing resource/marker, digest
  conflicts, and ambiguity without mutation.
- AC5: route-parity regressions reject corrupted legacy/native Root and
  conversation routes before I/O. Queue tests ack stale Root-marker drift without
  R2, Provider, or metadata mutation while retaining retry/DLQ on availability
  failures.
- AC6: Worker API tests cover principal-bound sessions, exact legacy session
  upgrade, guest isolation, injected identity-field rejection, and fail-closed
  registry conflicts.
- AC7: negative Worker API tests retain the absence of ACL/share/transfer/shared
  discovery and execution surfaces.
- AC8: registry transitions require current markers and an active principal;
  rollback retains stable IDs, aliases, route history, and Durable Object data.
- AC9: capture requires a registered, non-placeholder identity registry snapshot;
  restore validates the v6 binding/schema before mutation. Principal-scoped
  cleanup, feedback, usage, Workspace, export, and revocation tests preserve
  anti-resurrection behavior.
- AC10 local portion: `npm run check:frontend`; 49 files / 758 Vitest tests;
  Workspace Playwright 90 passed with 55 project-filtered skips; Agent local
  fake-Provider Playwright 3 passed; typecheck; Wrangler 4.110.0 dry-run; diff
  check; and Trellis repository consistency all passed. Work commit
  `05bdc8461fbd200a600922428796e5e3aa27d25b` and draft PR
  `https://github.com/Drew-Z/chatus-private-chat/pull/61` are recorded; PR CI,
  exact-main GitHub Actions deployment evidence, and archive remain pending.

## Out Of Scope

- ACL rows or roles, sharing UI/API, invitations, editor/viewer execution,
  ownership transfer, deletion disposition, shared exports, or shared tools.
- Copying or renaming existing Durable Object storage, public links, groups,
  organization RBAC, live Provider/MCP probes, or local production deployment.
