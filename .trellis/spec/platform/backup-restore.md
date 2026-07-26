# Backup, Restore, And Permanent Deletion

## 1. Scope / Trigger

Use this contract when changing user export/import, deployment rollback, instance identity, Cloudflare storage bindings, managed-secret custody, Durable Object persistence, or `DELETE /api/user-data`.

Chatus currently supports bounded user portability and deployment rollback. It does not yet provide an automated full-instance backup or restore. Cloudflare point-in-time recovery for one SQLite Durable Object is a platform primitive, not proof of a consistent restore across `CHAT_STORE`, `UserState`, root/conversation `TeamAgent` instances, and provider coordination state.

## 2. Signatures

Current user-data boundaries:

```text
GET    /api/user-data/export
POST   /api/chats/migrate  { mode: "merge" | "restore" | "replace", chats: CloudChat[] }
DELETE /api/user-data
```

Current Agent purge RPCs:

```typescript
TeamAgent.clearConversation(): Promise<void>
TeamAgent.purgeRootData(): Promise<{ conversationIds: string[] }>
```

Exact persisted identifiers owned by the deletion path include:

```text
chats:{encodeURIComponent(label)}:index
memory:{encodeURIComponent(label)}
usage:{encodeURIComponent(label)}:{YYYY-MM-DD}
chatus:agent-identity:v1
```

No full-instance backup manifest, archive envelope, capture command, or restore command exists yet. Do not invent a supported signature before its transport and restore drill are implemented.

## 3. Contracts

### Recovery Meanings

| Operation | Current support | Contract |
| --- | --- | --- |
| User export/import | Supported with limits | `chatus-user-data` v1 is secret-free and may be truncated. Chat `merge`, `restore`, and `replace` operate on selected user chats, not an instance archive. |
| Code/configuration rollback | Supported | Revert Git history and publish through GitHub Actions while preserving the Cloudflare account, Worker name, and KV namespace. Durable Object migration tags are append-only and are not rolled back by code. |
| Full-instance disaster recovery | Not implemented | Do not claim support until capture, transport, a versioned manifest, stable object mapping, reconciliation, and a restore drill exist. |

Changing `CHATUS_WORKER_NAME`, `CHATUS_KV_NAMESPACE_ID`, or the Cloudflare account selects a new storage boundary. It is not a restore operation.

### Required Durable Data

- Stable instance identity: Cloudflare account, Worker name, KV namespace, Durable Object bindings/classes, and applied migration history.
- `CHAT_STORE` configuration and security state: `config:routes_config`, `config:access_codes`, `route-secret:*`, `mcp-secret:*`, administrator audit state, feedback, and any other non-expiring operational records.
- Root `TeamAgent` state: conversation index, durable memory, migration markers, cleanup queue, branch reservations, and capability trust.
- Conversation `TeamAgent` state: Agents SDK messages, resumable-stream metadata/chunks, request context, tool milestones/runs, branch launches, capability trust, and the persisted `chatus:agent-identity:v1` record.
- `UserState` usage/metrics and compatibility state, including chats, deletion tombstones, and `chats_purged_at` anti-resurrection state.
- External key material required to decrypt archived ciphertext. In particular, the original `ROUTE_KEYS_MASTER_KEY` must be retained outside the application data archive under operator control.

### Transitional Durable Data

- Legacy `chats:{label}:index`, `memory:{label}`, and `usage:{label}:{day}` KV records.
- Legacy `UserState.chats` records and their deletion/timeline evidence.

These remain in the recovery inventory until a separate migration-retirement audit proves they are no longer required as import or rollback evidence.

### Rebuildable Or Expiring Data

- `session:*` and `admin:*` sessions are not restored; users and administrators authenticate again.
- `provider-leases:v1` and its alarm are not restored; provider capacity starts empty and is rebuilt by new requests.
- Guest cleanup/turn leases, minute bursts, login-failure windows, and passive route-reliability telemetry may expire or rebuild.

Every excluded prefix/table/key must appear in the future archive manifest. Absence must be deliberate rather than inferred after recovery fails.

### Full-Instance Readiness Gates

A future instance backup/restore implementation is ready only when all of these are executable and verified:

1. **Manifest:** a versioned manifest records source account/Worker/KV identity, applied schema/migration versions, export timestamp, included and excluded key prefixes/object classes, stable Durable Object identifiers, counts, sizes, and integrity checks.
2. **Consistency:** capture uses a documented stop-write/maintenance boundary or an equivalent protocol. There is no global transaction across KV and multiple Durable Objects.
3. **Confidentiality:** archives are encrypted, logs remain secret-free, and decryption keys have an external custody/rotation policy. The archive cannot be the only copy of `ROUTE_KEYS_MASTER_KEY`.
4. **Provisioning:** the target has compatible bindings and append-only Durable Object migrations before import. Existing migration tags are never rewritten.
5. **Identity mapping:** every user label and chat ID maps deterministically to the intended root/conversation object. Importing data into differently derived object names is not recovery.
6. **Restore order:** validate/decrypt the archive; provision schema; restore durable KV configuration and transitional sources; restore `UserState` and Agent objects using the manifest mapping; leave sessions/leases empty; then reopen writes.
7. **Reconciliation:** compare manifest counts/checksums and run product acceptance for authentication, user isolation, conversations, memory, managed configuration, and permanent deletion.
8. **Drill:** retain evidence of a successful restore rehearsal. A readable archive alone does not establish recoverability.

Do not promise numeric RPO/RTO until an executable capture schedule and measured restore drill can support those values.

### Permanent User-Data Deletion

`DELETE /api/user-data` is an idempotent cross-store operation, not a global transaction. It must:

- revoke the member's sessions;
- clear user-owned `UserState` chats, usage, metrics, and leases while retaining `chats_purged_at` so stale clients cannot recreate deleted data;
- clear root and conversation Agent persistence, including SDK tables, branch launches, memory, cleanup/migration state, capability trust, and `chatus:agent-identity:v1`;
- delete the exact legacy KV memory, chat-index, and bounded usage keys and remove the member's feedback entries;
- preserve access codes, provider/logical-model configuration, managed provider/MCP secrets, and instance-level administrator configuration.

Any failed sub-operation fails the request. Retrying must be safe because every deletion is exact and idempotent. Never replace exact keys with a broad prefix delete in the request path.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| User export reaches a size limit | Return the valid bounded envelope with `truncated` / `messagesTruncated`; never describe it as complete |
| Import version/envelope is unsupported | Reject it; do not coerce it into partial state |
| Worker name, KV namespace, or account changes | Treat the target as a new instance boundary, not restored data |
| Original `ROUTE_KEYS_MASTER_KEY` is unavailable | Old managed provider-key ciphertext is unrecoverable; require keys to be re-entered |
| Proposed instance backup lacks manifest, consistency, mapping, reconciliation, or drill evidence | Keep full-instance recovery marked unsupported |
| Any permanent-delete sub-operation fails | Fail the request; a retry repeats exact idempotent deletes |
| Permanent deletion sees a missing exact KV/identity key | Treat deletion as successful and continue |
| Permanent deletion encounters pre-delete local/legacy data later | Retained tombstones reject stale merge/upload; only explicit `restore` may cross the deletion timeline |

## 5. Good / Base / Bad Cases

- Good: permanent deletion removes user-owned KV/DO data and Agent identities, preserves anti-resurrection tombstones and instance configuration, and succeeds again on retry.
- Good: a future restore validates an encrypted versioned manifest, uses the same logical object mapping, excludes documented ephemeral state, reconciles counts/checksums, and passes a restore drill before writes reopen.
- Base: a user downloads a bounded export, sees truncation warnings when present, and explicitly restores selected old chats without treating the file as an instance archive.
- Bad: an operator changes Worker/KV/account identity and assumes an imported user JSON restored provider configuration, credentials, sessions, or Durable Object state.
- Bad: a user-data endpoint lists and deletes broad prefixes, removes shared provider/access configuration, or deletes `chats_purged_at` and allows stale devices to resurrect data.

## 6. Tests Required

- Prove the user export envelope remains bounded, secret-free, and explicit about truncation.
- Prove permanent deletion revokes sessions and removes Agent conversations/memory, legacy KV chat/memory, branch launches, and root/conversation identity records.
- Prove the anti-resurrection timestamp rejects stale uploads while an explicit user-selected `restore` can recover old backup content.
- Prove provider/access configuration and encrypted secret records are not deleted with one member's data.
- Keep tests local and deterministic; do not call a live model or print access codes, credentials, conversations, or memories.
- Run the full project quality gate from `frontend/quality-guidelines.md`.

## 7. Wrong Vs Correct

### Wrong

```text
Download the user JSON, switch the Worker/KV IDs, and import it as an instance restore.
```

The export may be truncated and excludes configuration, credentials, Durable Object operational state, and identity mapping.

### Correct

```text
Use user export/import only for bounded user portability. Preserve instance identity for deployment rollback. Treat full-instance disaster recovery as unavailable until every readiness gate in this contract passes.
```
