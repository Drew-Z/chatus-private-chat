# Legacy surface registry and control plane

## Goal

Create the content-free, recoverable control plane required to retire legacy
surfaces independently. The task provides a strict manifest, durable state
machine, evidence ledger, administrator projection, and reusable admission API.
It does not disable any legacy read or write path.

## Dependencies

- Parent census and task split are approved in
  `08-05-legacy-surface-disable-observation`.
- The isolated restore drill is completed and archived, but it does not by itself
  prove recovery for any individual legacy surface.
- Each later rollout child must copy its exact surface, caller, parity, recovery,
  observation, owner, and rollback requirements into its own artifacts.

## Confirmed Facts

- The `INSTANCE_COORDINATOR` namespace already owns instance maintenance,
  operation fences, and the authoritative object registry with revision checks
  and idempotent transitions (`src/instance-coordinator.ts:22-292`).
- The object registry is captured as `authoritative/restore`, while maintenance
  and operation fences are excluded and rebuilt empty
  (`src/services/instance-capture-adapters.ts:122-178`).
- `CHAT_STORE` mixes authoritative, transitional, and excluded data, so a single
  KV prefix or namespace cannot represent retirement authority
  (`src/services/instance-capture-adapters.ts:38-55`).
- `USER_STATE` remains authoritative for non-chat data. No whole Durable Object
  namespace is currently a valid legacy read-disable target.
- The parent census identifies 13 initial candidate records. Production caller
  absence, observation, owner approval, and disable readiness remain unproven.

## Requirements

### R1. Code-owned manifest

- Define a versioned exact-shape manifest for every known surface. Each record
  contains an immutable `surfaceId`, version, kind, risk class, functional owner,
  data classes, caller classes, replacement, rollback route, recovery class, and
  maximum supported phase.
- Seed the 13 census records. All initial records use functional owner
  `unassigned` and maximum phase `discovered` unless a separate rollout child has
  approved stronger facts.
- Manifest updates are additive or forward-versioned. Missing, duplicate,
  reordered-conflicting, downgraded, or silently removed records fail closed.
- Administrators cannot create surfaces, change immutable manifest policy, set an
  observation window, or raise the maximum supported phase through an API.

### R2. Durable state and transitions

- Extend the existing `INSTANCE_COORDINATOR` namespace with one deterministic
  `InstanceCoordinator` object per `surfaceId`; do not place all surface traffic
  on the `$instance-maintenance` singleton, add a new Durable Object namespace,
  or store registry state in a member/root Agent.
- Persist a current projection plus append-only transition/evidence events.
- Use the phases `discovered`, `instrumented`, `censused`, `parity_proven`,
  `shadowing`, `write_disabled`, `write_observing`, `recovery_proven`,
  `read_disabled`, `read_observing`, and `approved_for_cleanup`.
- Advance only one phase at a time and never beyond the code-owned maximum phase.
  Every mutation requires `expectedRevision`, a bounded idempotency operation ID,
  exact evidence kinds, and server time validation.
- Read and write controls remain separate. Read rollback returns to
  `recovery_proven` while preserving write-disable evidence; write rollback
  returns to `shadowing`. Rollback appends evidence and never deletes history.
- Invalid storage, manifest drift, stale revision, unknown surface, missing
  evidence, premature observation, unsupported phase, or coordinator outage fail
  closed for the mutation.

### R3. Content-free evidence and bounded census

- Evidence records may retain only bounded identifiers, SHA-256 digests, exact
  deployment/commit SHA, timestamps, integer counters, caller-class enums,
  result/status enums, and functional owner/approval references.
- Never store prompts, conversation content, memories, file names/content,
  access codes, API keys, tokens, request bodies, raw logs, base URLs, headers,
  labels, or arbitrary operator notes.
- Provide a reusable surface-use RPC for later rollout children. It accepts only
  manifest-declared surface/caller/access enums, records bounded daily counts, and
  returns the current read/write control projection.
- The foundation task does not wire that RPC into legacy runtime callers. A
  rollout child must wire and test every caller before raising its manifest phase
  above `discovered`.
- Raw daily counters are bounded and pruned; sealed observation evidence remains
  append-only and recoverable.

### R4. Recovery and maintenance integration

- Capture the registry, events, sealed evidence, and active bounded counters as a
  separate authoritative `legacy_surface_registry` payload.
- Restore only through the existing isolated-target, preflighted restore flow.
  Wrong schema, manifest digest, coordinator identity, item count, or duplicate
  event fails before accepting the restored registry.
- Registry mutations require the existing instance mutation fence. Capture must
  prove the registry revision/digest remained stable for the capture epoch.
- Existing Durable Object migration tags and bindings remain unchanged.

### R5. Administrator API and React operations

- Add admin-only `GET /api/admin/legacy-surfaces?limit=100` with a strict bounded
  snapshot and no sensitive fields.
- Add exact-shape advance and rollback endpoints scoped to one `surfaceId`.
  Return stable conflict, gate-blocked, invalid-state, unavailable, and not-found
  errors without leaking evidence internals.
- Extend the typed React Operations view with filterable, 20-item pagination,
  current/total counts, phase/control state, blockers, observation summary, and
  bounded evidence status.
- State-changing actions use a React dialog, show the exact target surface and
  phase, preserve dirty/loading/error states, and refresh from server authority
  after success. No `window.confirm` or optimistic authority is allowed.

### R6. Rollout boundary

- On the merge SHA for this task, all production surface records remain at
  `discovered`; read and write behavior is unchanged.
- No global legacy switch, physical deletion, route removal, migration-tag edit,
  source-of-truth flip, or claim of completed production observation is allowed.
- Later rollout children own instrumentation wiring, parity, stop-write,
  recovery, read-disable, observation, approval, and rollback for one exact
  surface each.

## Acceptance Criteria

- [x] AC1. The strict manifest contains the 13 initial census records exactly
      once, is append-only/forward-versioned, and rejects removal, downgrade,
      conflicting identity, unknown fields, and administrator-created records.
- [x] AC2. `InstanceCoordinator` atomically and idempotently stores current state
      plus append-only events, rejects stale/conflicting transitions, and never
      advances beyond the code-owned maximum phase.
- [x] AC3. Advance/rollback tests cover every phase, required evidence matrix,
      separate read/write rollback, premature observation, replay, crash/retry,
      malformed storage, and coordinator outage.
- [x] AC4. Surface-use recording accepts only declared enums, returns authoritative
      control state, keeps bounded daily counters, and rejects content-bearing or
      unknown payload fields.
- [x] AC5. Capture/restore includes the registry as authoritative state and fails
      closed on schema/digest/count/identity/event conflicts while preserving
      existing migration tags and isolated-target rules.
- [x] AC6. Admin APIs enforce authentication, instance mutation fencing, exact
      decoding, bounded results, stable error mapping, and content-free audit.
- [x] AC7. React Operations strictly decodes the snapshot, paginates 20/21 records,
      exposes blockers and controls without sensitive data, and uses a dialog for
      mutations with loading/error/dirty recovery.
- [x] AC8. Desktop and 390px Workspace Playwright prove readable non-overlapping
      list/dialog/error states; local fake-Provider Agent tests remain green.
- [x] AC9. Tests prove all initial records remain `discovered`, existing legacy
      reads/writes and Durable Object bindings are unchanged, and no destructive
      cleanup or unsupported production claim is introduced.
- [ ] AC10. Full repository gates, spec updates, work commit, PR CI/artifacts,
      exact-main deployment/acceptance evidence, archive validation, parent-child
      consistency, and any persisted waiver all pass.

## Out of Scope

- Wiring a concrete legacy caller to control enforcement.
- Raising any production surface beyond `discovered`.
- Choosing per-surface observation durations or accountable owner roles; each
  rollout child must approve and version those values.
- Physical deletion, migration-tag removal, namespace deletion, credential
  deletion, or destructive cleanup approval.
