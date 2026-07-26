# Backup Restore Contract And Purge Residue

## Goal

Define an honest, testable instance backup/restore readiness contract for Chatus and close confirmed permanent-user-deletion residue without presenting the existing bounded user export as a complete disaster-recovery mechanism.

## Background And Confirmed Facts

- Chatus persists instance data in `CHAT_STORE` KV plus the SQLite `UserState`, `TeamAgent`, and `ProviderCoordinator` Durable Objects (`src/worker.ts:284-289`, `wrangler.jsonc:14-47`).
- `GET /api/user-data/export` produces a secret-free, bounded `chatus-user-data` v1 user export. It can truncate conversations and excludes instance configuration, credentials, raw tool payloads, and file URLs, so it is not an instance backup (`src/worker.ts:2929-2990`, `docs/operations.md:137-140`).
- The supported user chat import modes are `merge`, `restore`, and `replace`; they restore selected user chat data, not an instance archive (`src/worker.ts:3291-3333`).
- The repository currently has no automated KV/Durable Object cross-account backup or restore command. Changing the Worker name, KV namespace ID, or Cloudflare account selects a new storage boundary rather than restoring the old one (`docs/operations.md:145`, `docs/self-hosting.md:152`).
- Managed provider-key ciphertext can only be recovered with the original externally retained `ROUTE_KEYS_MASTER_KEY`; replacing that key requires re-entering the managed provider keys (`docs/operations.md:90-120`, `docs/self-hosting.md:150`).
- `clearPersistedChatState()` already deletes `chatus_conversation_branch_launches`; this is not a current production-code omission, but the permanent-delete API has no focused regression assertion for it (`src/agent/team-agent.ts:1091-1103`, `tests/worker-api.test.ts:2882-2949`).
- The non-SQL Agent identity record `chatus:agent-identity:v1` contains the user label and, for conversation Agents, the chat ID. It is created by `initializeIdentity()` and is not currently removed by root or conversation purge (`src/agent/team-agent.ts:72`, `src/agent/team-agent.ts:1116-1143`).
- `DELETE /api/user-data` deletes the legacy KV memory and bounded usage keys but not `chats:{label}:index`. A malformed or not-yet-migrated legacy chat index may therefore survive permanent deletion (`src/worker.ts:1181-1194`, `src/worker.ts:3584-3586`, `src/worker.ts:3844-3861`).

## Requirements

### R1. Distinguish The Three Recovery Meanings

- Documentation and Trellis specs must distinguish user export/import, code/configuration rollback, and full-instance disaster recovery.
- The bounded user export must never be described as a complete or lossless backup.
- Full-instance recovery must remain explicitly unsupported until a transport, manifest, reconciliation, and restore drill exist.

### R2. Define The Instance Data Inventory

- The platform contract must classify all known KV and Durable Object surfaces as required durable data, transitional durable data, or intentionally rebuildable/ephemeral state.
- The contract must include stable Worker/KV/DO identity, TeamAgent root/conversation mapping, UserState data, managed configuration and encrypted secrets, migration/tombstone state, and externally retained key material.
- Provider leases, expiring sessions, short-lived rate-limit state, and passive reliability telemetry may be excluded only when the contract states how they are safely recreated or allowed to expire.

### R3. Define Backup/Restore Readiness Gates

- A future instance archive must have a versioned manifest containing source instance identity, schema/migration version, export time, object/key inventory, counts, sizes, and integrity checks.
- A future backup procedure must define a stop-write or equivalent consistency boundary across KV and multiple Durable Objects; the current cross-object operations are not globally transactional.
- A future restore must define target provisioning, stable identity mapping, restore order, key custody, post-restore reconciliation, and a restore drill before the product claims disaster-recovery readiness.
- This task must not invent numeric RPO/RTO guarantees before an executable backup mechanism exists.

### R4. Keep Operator Documentation Consistent

- Add one authoritative platform contract and link it from the platform spec index.
- Update operations and self-hosting documentation to state the supported recovery boundaries, the external `ROUTE_KEYS_MASTER_KEY` custody requirement, and the current absence of an automated instance restore.
- Do not duplicate step-by-step implementation promises across multiple documents.

### R5. Remove Confirmed Permanent-Delete Residue

- Permanent user-data deletion must remove `chatus:agent-identity:v1` from both root and conversation TeamAgent instances after clearing their persisted user state.
- Permanent user-data deletion must delete the exact legacy `chats:{encodeURIComponent(label)}:index` KV key in addition to the existing memory and usage cleanup.
- Existing tombstones required to prevent stale devices or legacy sources from recreating deleted data must remain intact.
- Access codes, provider configuration, and instance-level administrator configuration remain outside user-data deletion.

### R6. Lock The Purge Contract With Focused Tests

- Extend the existing `DELETE /api/user-data` test to prove that legacy chat-index KV, root/conversation Agent identity records, conversation branch launch records, chats, memory, sessions, and the existing stale-write protections are cleared or preserved according to their contract.
- Cleanup must remain idempotent and safe to retry after a partial cross-store failure.
- Tests must not call live models or print user content, access codes, or secret material.

## Acceptance Criteria

- [x] A new platform spec distinguishes user restore, deployment rollback, and instance disaster recovery and lists all currently known persistent/rebuildable data surfaces.
- [x] The contract defines manifest, consistency, identity mapping, encryption/key custody, restore ordering, reconciliation, and drill gates without claiming an implementation that does not exist.
- [x] `docs/operations.md` and `docs/self-hosting.md` consistently state that the current bounded user export is not an instance backup and that changing instance identity is not a restore.
- [x] Permanent user-data deletion removes the exact legacy chat-index KV key and root/conversation `chatus:agent-identity:v1` records while preserving anti-resurrection tombstones and instance configuration.
- [x] A focused Worker API regression proves branch-launch, Agent identity, legacy KV, chats, memory, session, and stale-write behavior for permanent deletion.
- [x] Relevant focused tests and the full project quality gate pass without live model calls.

## Out Of Scope

- Implementing scheduled backups, a restore CLI, Cloudflare cross-account transfer, or a destructive production restore command.
- Promising a numeric RPO or RTO before executable backup/restore and drill evidence exist.
- Restoring active sessions, provider-capacity leases, short-lived rate-limit windows, or passive reliability telemetry.
- Removing all legacy storage structures before migration evidence exists.
- Changing administrator-audit retention policy or deleting instance-level provider/member configuration during user-data purge.
