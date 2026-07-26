# Design

## Scope And Boundary

This task has two linked deliverables: an executable documentation contract for future instance recovery, and a narrow correction to the permanent-user-deletion path. They share the same storage inventory and deletion invariants, so they remain one independently verifiable child task under `07-16-team-agent-productization`.

No backup transport or restore command is added. The new contract describes the conditions that must be met before such a command can be considered safe.

## Recovery Vocabulary

| Operation | Current support | Boundary |
| --- | --- | --- |
| User export/import | Supported with explicit limits | Secret-free `chatus-user-data` v1 export plus chat `merge` / `restore` / `replace`; may be truncated and is not an instance archive |
| Code/configuration rollback | Supported operationally | `git revert` and GitHub Actions while preserving Worker/KV/account identity; Durable Object schema migrations are append-only |
| Full-instance disaster recovery | Not implemented | Requires a versioned archive, consistent capture, KV/DO transport, identity mapping, reconciliation, and a successful restore drill |

## Data Classification

The platform contract will classify data by recovery behavior rather than by storage product alone.

### Required Durable Data

- Stable instance identity: Cloudflare account, Worker name, KV namespace, Durable Object bindings/classes, and applied migration history.
- `CHAT_STORE` configuration and security state: route/provider/logical-model configuration, managed access records, encrypted provider/MCP secrets, and operational records that the product treats as durable.
- Root and conversation `TeamAgent` state: conversation index, transcript/stream/tool state, memory, branches, cleanup/tombstone/migration state, capability trust, and `chatus:agent-identity:v1`.
- `UserState` durable user state and anti-resurrection markers needed by compatibility and migration paths.
- External secret dependencies, especially the exact original `ROUTE_KEYS_MASTER_KEY`, retained outside the archive under operator control.

### Transitional Durable Data

- Legacy KV chat indexes and memory plus legacy `UserState` chats remain recovery/import evidence until migration retirement is separately proven.
- They are included in the inventory even when the current Agent state is authoritative, because silently omitting them can break rollback or migration reconciliation.

### Rebuildable Or Expiring State

- Member/admin sessions are not restored; users authenticate again.
- Provider coordinator leases and alarms are not restored; capacity state starts empty and is rebuilt by new requests.
- Short-lived burst/login/guest leases and passive route-reliability telemetry may expire or rebuild.
- Any exclusion must appear in the archive manifest so absence is deliberate and reviewable.

## Future Archive Readiness Contract

A future backup implementation is not ready merely because it can download bytes. It must provide:

1. A versioned manifest with source account/Worker/KV identity, applied migration/schema versions, export timestamp, included/excluded prefixes and object classes, stable DO identifiers, record counts, byte counts, and checksums.
2. A documented stop-write/maintenance boundary or equivalent consistency protocol. Chatus has no global transaction across KV, root Agents, conversation Agents, and UserState.
3. Encryption at rest and explicit external custody for decryption keys. The archive must not be the only copy of `ROUTE_KEYS_MASTER_KEY` and must not print secrets in logs.
4. A target-provisioning step that establishes compatible bindings and append-only Durable Object migrations before data import.
5. Deterministic identity mapping from each user label/chat ID to the same logical root/conversation object identity. Restoring bytes into differently derived objects is not recovery.
6. Ordered restore: validate/decrypt archive; provision target schema; restore durable KV configuration and transition sources; restore UserState and Agent objects using the manifest mapping; leave sessions/leases empty; then reopen writes.
7. Reconciliation against manifest counts/checksums plus product-level acceptance for authentication, conversation isolation, memory, configuration, and permanent deletion.
8. A recorded restore drill. Until all gates exist, docs continue to say that full-instance recovery is unavailable.

Numeric RPO/RTO is intentionally deferred. Without an executable capture schedule and measured restore drill, a number would be decorative rather than operational.

## Permanent-Delete Flow

The endpoint remains an idempotent cross-store orchestration:

1. Revoke member sessions.
2. Purge `UserState` user data while retaining the `chats_purged_at` anti-resurrection marker.
3. Enumerate conversation Agents, clear their SDK/chat state, and delete their persisted identity record.
4. Purge the root Agent tables and delete its persisted identity record.
5. Delete the exact legacy KV memory, chat-index, and bounded usage keys and filter feedback.

The operation is not globally transactional. Any failure returns an error and a retry repeats idempotent deletes. No new compensating write is introduced.

### Agent Identity Cleanup

`clearConversation()` and `purgeRootData()` are already asynchronous RPC boundaries and can await `ctx.storage.delete(AGENT_IDENTITY_STORAGE_KEY)` after SQL/chat cleanup. The in-memory identity remains valid long enough for the current RPC to return. A later call with the normal Agent props recreates the same identity record if the object is legitimately reused.

Deleting the identity in `clearConversation()` also covers root-driven cleanup retries for a permanently deleted conversation. It does not remove the root identity unless `purgeRootData()` is invoked.

### Legacy KV Cleanup

The Worker deletion handler adds `env.CHAT_STORE.delete(chatIndexKey(session.label))`. The key helper already applies the correct label encoding, avoiding duplicate ad hoc key construction. Valid, malformed, and never-migrated legacy indexes are all removed when the user explicitly requests permanent deletion.

### Branch Launch Regression

No production change is required for `chatus_conversation_branch_launches`: `clearPersistedChatState()` already deletes it. The existing account-deletion test will seed/query this table directly so future refactors cannot silently lose that coverage.

## Compatibility And Rollback

- No data migration or schema change is introduced.
- Existing user export/import envelopes remain unchanged.
- Agent identity deletion affects only fully cleared conversation objects and full root purge; normal active Agent calls keep the current initialization behavior.
- The code rollback is a normal Git revert through GitHub Actions. Reverting restores the prior cleanup behavior but cannot recreate identity or legacy KV records already deleted by an explicit user request.
- Full-instance restore remains a documented follow-up, not a deployable capability in this task.
