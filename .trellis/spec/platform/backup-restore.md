# Backup, Restore, And Permanent Deletion

## 1. Scope / Trigger

Use this contract when changing user export/import, deployment rollback, instance identity, Cloudflare storage bindings, managed-secret custody, Durable Object persistence, or `DELETE /api/user-data`.

Chatus currently supports bounded user portability, deployment rollback, and internal stop-write capture primitives. It does not yet provide an automated full-instance backup or restore. Cloudflare point-in-time recovery for one SQLite Durable Object is a platform primitive, not proof of a consistent restore across `CHAT_STORE`, `UserState`, root/conversation `TeamAgent` instances, and provider coordination state.

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
TeamAgent.beginWorkspaceAccountPurge(operationId: string): Promise<WorkspaceAccountPurgeReservationResult>
TeamAgent.completeWorkspaceAccountPurge(operationId: string, generation: number): Promise<boolean>
TeamAgent.releaseWorkspaceAccountPurge(operationId: string, generation: number): Promise<boolean>
```

Exact persisted identifiers owned by the deletion path include:

```text
chats:{encodeURIComponent(label)}:index
memory:{encodeURIComponent(label)}
usage:{encodeURIComponent(label)}:{YYYY-MM-DD}
chatus:agent-identity:v1
```

`CaptureManifestV1` and the encrypted archive envelope now exist as internal service contracts. There is still no production capture API/CLI, archive transport, restore command, target provisioning flow, or restore drill. Do not describe the internal capture primitive as a supported recoverable-instance workflow.

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
- Root `TeamAgent` state: conversation index, durable memory, migration markers, cleanup queue (including due time, attempts, stable error and terminal metadata), guest cleanup tickets/schedules, branch reservations, and capability trust.
- Workspace-file state: the `WORKSPACE_FILES` R2 bucket plus root `TeamAgent` file, immutable-version, exact-reference, and operation/outbox tables. A future backup manifest must inventory object keys indirectly, sizes, SHA-256 checksums, version/generation ownership, and include/exclude decisions without exposing keys to users.
- Conversation `TeamAgent` state: Agents SDK messages, resumable-stream metadata/chunks, request context, tool milestones/runs, branch launches, capability trust, and the persisted `chatus:agent-identity:v1` record.
- `UserState` usage/metrics and compatibility state, including chats, deletion tombstones, and `chats_purged_at` anti-resurrection state.
- Provider attempt shards are authoritative instance-level operational evidence. Each `provider_attempt_ledger` object captures as `provider-attempt-ledger-v3` with `restoreBehavior: "restore"`; it includes content-free attempt identity, usage, price, cost, reconciliation, versioned budget policies/events/decisions, current reservations, and balance projections. It is retained by member account deletion and excluded from user export. Budget state is never rebuilt or reset during restore; raw invoices and Provider responses are never captured.
- The legacy-surface control plane captures as exactly one authoritative/restore
  `legacy_surface_registry` payload with schema
  `legacy-surface-registry-v1`. It contains the code-owned manifest digest plus
  every deterministic surface object's current projection, append-only events,
  operation receipts, and bounded daily counters. It is content-free, retained
  by member deletion, and restored only to the existing
  `INSTANCE_COORDINATOR/InstanceCoordinator/v4` namespace.
- Member OAuth MCP token rows in `UserState.mcp_oauth_tokens` and their owner binding are required durable security state. Token values are AES-GCM ciphertext whose AAD binds member, server, and schema v1; the original `ROUTE_KEYS_MASTER_KEY` remains external key material. A future manifest may record only the table/class, schema version, row count, and an explicit `ciphertextOnly: true` inventory marker. The manifest must not contain `encrypted_record`, IV, ciphertext, access/refresh token, member label, server endpoint, authorization code, state, verifier, or session fingerprint.
- External key material required to decrypt archived ciphertext. In particular, the original `ROUTE_KEYS_MASTER_KEY` must be retained outside the application data archive under operator control.

### Transitional Durable Data

- Legacy `chats:{label}:index`, `memory:{label}`, and `usage:{label}:{day}` KV records.
- Legacy `UserState.chats` records and their deletion/timeline evidence.

These remain in the recovery inventory until a separate migration-retirement audit proves they are no longer required as import or rollback evidence.

### Rebuildable Or Expiring Data

- `session:*` and `admin:*` sessions are not restored; users and administrators authenticate again.
- `provider-leases:v1` and its alarm are not restored; provider capacity starts empty and is rebuilt by new requests.
- `ProviderCoordinator` reliability remains rebuildable, but `ProviderAttemptLedger` events/projections are not reliability telemetry and must not be excluded or rebuilt.
- Guest turn leases, minute bursts, login-failure windows, and passive route-reliability telemetry may expire or rebuild. Guest cleanup KV markers and Root cleanup tickets are durable deletion ownership and must not be treated as expiring/rebuildable state until their purge completes.
- OAuth PKCE state and member discovery candidates are short-lived/rebuildable and are not restored. Future manifests must list `mcp_oauth_states` and `mcp_oauth_discovery_candidates` as explicit exclusions; members restart authorization or discovery after recovery.

Every excluded prefix/table/key must appear in the future archive manifest. Absence must be deliberate rather than inferred after recovery fails.

### Full-Instance Readiness Gates

A future instance backup/restore implementation is ready only when all of these are executable and verified:

1. **Manifest:** a versioned manifest records source account/Worker/KV identity, applied schema/migration versions, export timestamp, included and excluded key prefixes/object classes, stable Durable Object identifiers, counts, sizes, and integrity checks.
2. **Consistency:** capture uses a documented stop-write/maintenance boundary or an equivalent protocol. There is no global transaction across KV and multiple Durable Objects.
3. **Confidentiality:** archives are encrypted, logs remain secret-free, and decryption keys have an external custody/rotation policy. The archive cannot be the only copy of `ROUTE_KEYS_MASTER_KEY`.
4. **Provisioning:** the target has compatible bindings and append-only Durable Object migrations before import. The current exact Durable Object mapping is `USER_STATE/UserState/v1`, `TEAM_AGENT/TeamAgent/v2`, `PROVIDER_COORDINATOR/ProviderCoordinator/v3`, `INSTANCE_COORDINATOR/InstanceCoordinator/v4`, and `PROVIDER_ATTEMPT_LEDGER/ProviderAttemptLedger/v5`. Existing migration tags are never rewritten.
5. **Identity mapping:** every user label and chat ID maps deterministically to the intended root/conversation object. Importing data into differently derived object names is not recovery.
6. **Restore order:** validate/decrypt the archive; provision schema; restore durable KV configuration and transitional sources; restore `UserState` and Agent objects using the manifest mapping; leave sessions/leases empty; then reopen writes.
7. **Reconciliation:** compare manifest counts/checksums and run product acceptance for authentication, user isolation, conversations, memory, managed configuration, and permanent deletion.
8. **Drill:** retain evidence of a successful restore rehearsal. A readable archive alone does not establish recoverability.

Do not promise numeric RPO/RTO until an executable capture schedule and measured restore drill can support those values.

The ciphertext inventory above is implemented only inside the encrypted internal capture envelope. No current public API/CLI or restore path may claim to export or restore OAuth MCP tokens, and the manifest may identify only the table/class, schema, count, and ciphertext-only policy.

## Scenario: Stop-write instance capture primitives

### 1. Scope / Trigger

Use this scenario when changing `InstanceCoordinator`, `captureInstance()`, a store-owned capture adapter, maintenance admission, or the encrypted archive envelope. It proves one sealed capture epoch only; restore support remains gated by transport plus the isolated restore drill.

### 2. Signatures

```typescript
captureInstance({
  archiveId, keyId, archiveKey, source, captureEpoch, capturedAt,
  coordinator, drain, adapters,
  persistArchive: (archive) => Promise<{ evidenceId: string }>,
}): Promise<{ manifest: CaptureManifestV1; archive: EncryptedCaptureArchiveV1 }>

InstanceCoordinator.confirmObjectRegistryBaseline({
  version: 1,
  inventoryId: string,
  objects: InstanceObjectRegistrationV1[],
  confirmedAt: number,
})

InstanceCoordinator.registerObject({
  version: 1,
  kind: InstanceObjectKind,
  instanceName: string,
  rootInstanceName: string,
  schemaVersion: `${string}-v${number}`,
  stateClass: CaptureStateClass,
  restoreBehavior: CaptureRestoreBehavior,
  registeredAt: number,
})
```

`InstanceOperationStateV1` contains exact `operationId`, random per-acquisition `fenceId`, operation `kind`, and `startedAt`. A release must present the same `operationId`, `fenceId`, and `kind`.

### 3. Contracts

- The baseline input is the operator-owned external historical object inventory. Confirmation rejects conflicts, atomically adds inventory objects that have not awakened since rollout, and persists a bounded `inventoryId`, object count, and digest. Merely repeating the coordinator's currently observed list is not proof that dormant historical objects are complete.
- A new object identity invalidates the baseline. Adapter construction and the registry adapter capture both re-read `baselineComplete` and the digest so an identity appearing before or during maintenance aborts the capture.
- Re-registering an unchanged object is idempotent and preserves its stored record even when the caller supplies a later `registeredAt`. A schema migration may replace that record only when kind, instance identity, root ownership, state class, and restore behavior are unchanged; both schema strings match lowercase `<family>-v<positive base-10 integer>`; the family is identical; and the incoming numeric version is strictly greater. Skipped forward versions are legal because migration history, not the registry, proves the applied steps.
- A successful schema registration upgrade persists the incoming schema record, deletes the confirmed object-registry baseline, and returns `baselineComplete: false` with the new registry digest. Operators must confirm a new external inventory before capture. Downgrades, family changes, leading-zero/zero/unsafe versions, and ownership or restore-policy drift return `instance_object_conflict` without changing the stored record.
- Requested or active maintenance freezes both new identities and otherwise-valid schema upgrades. Exact same-schema registration remains idempotent, but an upgrade returns `instance_maintenance_busy` and writes nothing until maintenance is released. This ordering prevents a capture epoch from mixing an old external inventory with an object that migrated after the drain boundary.
- Durable Object rollout tests must seed the previously deployed registration and then register the current schema. A deployment smoke can hit an already-running old isolate and pass before eviction; only the restart registration path proves that applying a new SQLite migration will not make the object permanently unavailable.
- Request maintenance before draining. New HTTP mutations, Provider/Agent turns, OAuth callbacks, Queue delivery, Workspace mutation, branches, and cleanup acquire durable fences; each acquisition has an independent `fenceId`, including duplicate logical operation IDs.
- Ambiguous acquire and release RPCs retry the same `fenceId`; a failed acquire path attempts the same bounded cleanup. Long-term coordinator unavailability or process termination remains fail-closed: never expire a possibly live stream by time alone.
- Every required store is present in one epoch. KV unknown prefixes, Durable Object unknown tables/values, R2 missing/changed objects, incomplete Queue regeneration evidence, schema drift, duplicate payloads, and unresolved generation references abort sealing.
- AES-GCM uses an externally supplied 32-byte archive key, fresh IVs, and AAD bound to the archive header plus payload identity and plaintext metadata. The manifest itself is encrypted; key material and source content never enter maintenance evidence.
- `persistArchive()` must durably accept the encrypted envelope and return a bounded content-free evidence ID before maintenance can be released with `outcome: "captured"`. Persistence failure releases as `failed` and returns no archive result.
- `instance_coordinator_runtime` is an explicit exclusion rebuilt empty; Provider leases/reliability are rebuildable. No capture outcome implies archive transport, restore, cutover, or numeric RPO/RTO support.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| External inventory is missing, malformed, omits an observed object, or conflicts with schema/ownership | Reject baseline with `instance_object_conflict` |
| New identity appears after baseline | Invalidate baseline; stale adapters fail with `capture_object_registry_changed` |
| Same object registers a higher numeric version in the same schema family while writes are open | Persist the upgrade, invalidate the baseline, and return the updated digest with `baselineComplete: false` |
| Schema registration downgrades, changes family/policy/ownership, or uses a malformed numeric suffix | Return `instance_object_conflict`; preserve the existing registration and baseline |
| A valid schema upgrade arrives while maintenance is requested or active | Return `instance_maintenance_busy`; preserve the existing registration and baseline |
| Two operations share one logical ID | Store two independent fence IDs; releasing one leaves the other active |
| Acquire/release RPC rejects after persisting | Retry/reconcile the exact fence; persistent uncertainty remains fail-closed |
| Drain proof is unknown/non-zero or a durable fence remains | Do not activate maintenance or capture |
| Archive key is missing/wrong, payload/AAD is changed, or a store/reference is incomplete | Fail without a valid archive result and release maintenance as failed |
| Archive persistence fails or returns an invalid evidence ID | Never record `captured`; release as failed |
| Encrypted envelope verifies but no restore drill exists | Keep full-instance recovery unsupported |

### 5. Good / Base / Bad Cases

- Good: an external inventory seeds a dormant `UserState`, every store captures one epoch, the encrypted envelope is durably accepted, then the coordinator records only its evidence ID and reopens writes.
- Good: `team-agent-v6` re-registers as `team-agent-v7` after applying its SQLite migration, the registry baseline becomes incomplete, and a newly confirmed external inventory restores capture readiness.
- Base: a failed drain or archive sink releases the requested/active boundary as failed; source stores remain unchanged and no archive is returned.
- Base: an unchanged object re-registers during maintenance and receives its existing idempotent record; a version upgrade waits until maintenance is released.
- Bad: confirm the objects that happened to wake, let two deliveries share one releasable fence, mark captured before durable persistence, or call a readable archive a recoverable instance.
- Bad: treat every schema change as an identity conflict. The deployment may pass a smoke against an old isolate, then return persistent 503 responses after eviction when the migrated object restarts and cannot re-register.

### 6. Tests Required

- Prove external inventory seeding, later-registration invalidation, digest recheck, unknown/missing stores, cross-generation references, Queue/DLQ regeneration evidence, and explicit exclusions.
- Prove same-family forward schema upgrade persistence, exact-schema idempotency, baseline deletion/digest change, downgrade/family/malformed/policy conflicts, and requested plus active maintenance rejection. Assert rejected upgrades leave the old registration unchanged.
- For every Durable Object schema bump, seed the immediately previous deployed registration and execute the current startup registration locally; do not rely only on a fresh-object test or the first deployment health smoke.
- Prove independent duplicate-operation fences, ambiguous acquire/release reconciliation, drain rejection, every capture-phase rollback, and persistent fail-closed behavior.
- Prove wrong/missing keys, fresh IVs, AAD/header/payload tamper rejection, deterministic manifest checksums, exact payload counts/sizes, and absence of keys/content from evidence.
- In the archive callback, assert maintenance is still active/pending; inject callback failure and assert no captured outcome or returned archive.
- Keep all fixtures local. Never call a live Provider/MCP, production storage, local production deploy, or synthetic production probe.

### 7. Wrong Vs Correct

Wrong:

```typescript
const archive = await encryptCaptureArchive(snapshot);
await coordinator.releaseMaintenance({ outcome: "captured" });
return archive; // the process may terminate before any durable sink accepts it
```

Correct:

```typescript
const archive = await encryptCaptureArchive(snapshot);
const receipt = await persistArchive(archive);
await coordinator.releaseMaintenance({
  outcome: "captured",
  archiveEvidenceId: receipt.evidenceId,
});
return archive;
```

The maintenance outcome follows durable encrypted-envelope custody, not in-memory construction.

Schema registration has the same migration boundary. Wrong:

```typescript
if (existing.schemaVersion !== incoming.schemaVersion) {
  return { ok: false, error: "instance_object_conflict" };
}
```

Correct:

```typescript
if (sameIdentityAndPolicy(existing, incoming) && isStrictForwardSchemaUpgrade(existing, incoming)) {
  if (maintenanceRequestedOrActive) return { ok: false, error: "instance_maintenance_busy" };
  await persistRegistrationAndInvalidateBaseline(incoming);
}
```

Schema evolution is a controlled update of one registered object, not a new identity and not an unrestricted metadata rewrite.

### Autonomous Purge Retry

`account_purge` is both the member-wide Workspace write lock and the durable owner for the complete cross-store deletion. The initiating request may return an error or revoke the member session; the Root `TeamAgent` alarm must continue from the persisted operation until every owned backend succeeds. Root identity and the purge row are released only after Workspace R2/metadata, conversation Agents, Root state, UserState, sessions, feedback/audit indexes, legacy KV records, and usage keys have completed.

Cleanup rows and guest tickets persist `next_attempt_at`, failed-attempt count, an allowlisted stable error code, and `terminal_at`. Automatic retries use a 5-second exponential base, a 5-minute cap, and eight failed attempts. Terminal work remains inspectable and explicitly replayable; partial success never becomes a silently completed delete. Aggregate inspection/logs may expose cleanup family/state, counts, due/attempt timestamps, terminal state, scheduled alarm, and stable error code only. They must omit member labels, chat/file/operation IDs, object keys, content, secrets, tokens, and raw exceptions.

### Permanent User-Data Deletion

`DELETE /api/user-data` is an idempotent cross-store operation, not a global transaction. It must:

- revoke the member's sessions;
- clear user-owned `UserState` chats, usage, metrics, and leases while retaining `chats_purged_at` so stale clients cannot recreate deleted data;
- clear root and conversation Agent persistence, including SDK tables, branch launches, memory, cleanup/migration state, capability trust, and `chatus:agent-identity:v1`;
- delete the exact legacy KV memory, chat-index, and bounded usage keys and remove the member's feedback entries;
- preserve access codes, provider/logical-model configuration, managed provider/MCP secrets, and instance-level administrator configuration.

Workspace cleanup has an additional admission and ordering invariant:

1. Reject account purge while an upload operation is still pending; retry after the upload is finalized or failed.
2. Persist one `account_purge` operation before snapshotting R2 keys, including for an empty workspace. This row is the member-wide workspace write lock.
3. Check the lock again inside upload/delete reservation SQL transactions; transaction-external checks alone have a time-of-check/time-of-use gap.
4. Tombstone files and exact references, delete the snapshotted R2 objects idempotently, then finalize file/version metadata while retaining the purge row in `completed` state.
5. Clear conversation Agents, root state, `UserState`, sessions, exact legacy KV keys, and feedback. `purgeRootData()` must preserve the completed purge row.
6. Release the purge row only after every user-data sub-operation succeeds. Failures keep the lock and exact object snapshot retryable.

Do not clear workspace metadata before object inventory is persisted. Do not release the lock after R2 deletion while other user stores remain live: either ordering can create an unsnapshotted orphan object during concurrent upload.

Any failed sub-operation fails the request. Retrying must be safe because every deletion is exact and idempotent. Never replace exact keys with a broad prefix delete in the request path.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| User export reaches a size limit | Return the valid bounded envelope with `truncated` / `messagesTruncated`; never describe it as complete |
| Import version/envelope is unsupported | Reject it; do not coerce it into partial state |
| Worker name, KV namespace, or account changes | Treat the target as a new instance boundary, not restored data |
| Original `ROUTE_KEYS_MASTER_KEY` is unavailable | Old managed provider-key ciphertext is unrecoverable; require keys to be re-entered |
| Provider attempt capture is missing, classified rebuildable, uses a schema other than `provider-attempt-ledger-v3`, or targets anything other than `ProviderAttemptLedger`/`v5` | Reject capture/restore readiness before target mutation |
| Proposed instance backup lacks manifest, consistency, mapping, reconciliation, or drill evidence | Keep full-instance recovery marked unsupported |
| Any permanent-delete sub-operation fails | Fail the request; a retry repeats exact idempotent deletes |
| Account purge starts while a workspace upload is pending | Fail with `workspace_purge_pending_upload`; keep the session valid for retry |
| Workspace mutation races a persisted account purge | Reject with `workspace_account_purge_in_progress`; write no SQLite row or R2 object |
| Workspace has no objects | Still persist the purge lock; do not use a lock-free completed fast path |
| R2 objects are gone but another user-data delete fails | Retain the completed purge row and retry remaining exact deletes before release |
| Initiating request fails or member session is revoked | Keep the persisted purge lock/Root identity and let the Root alarm retry autonomously |
| Cleanup row is not due or has reached terminal state | Skip it or stop automatic scheduling respectively; retain the row for explicit idempotent replay |
| Alarm/list/read fails | Treat the queue as unknown, preserve ownership, emit only a stable aggregate error, and schedule a bounded retry |
| Root identity is released before the last user-data store succeeds | Forbidden; retain identity and lock until final release succeeds |
| Permanent deletion sees a missing exact KV/identity key | Treat deletion as successful and continue |
| Permanent deletion encounters pre-delete local/legacy data later | Retained tombstones reject stale merge/upload; only explicit `restore` may cross the deletion timeline |

## 5. Good / Base / Bad Cases

- Good: permanent deletion removes user-owned KV/DO data and Agent identities, preserves anti-resurrection tombstones and instance configuration, and succeeds again on retry.
- Good: a future restore validates an encrypted versioned manifest, uses the same logical object mapping, excludes documented ephemeral state, reconciles counts/checksums, and passes a restore drill before writes reopen.
- Good: an account purge resumes after the request and session disappear, retries only the exact operation/generation, and releases the Root identity last.
- Base: a user downloads a bounded export, sees truncation warnings when present, and explicitly restores selected old chats without treating the file as an instance archive.
- Bad: an operator changes Worker/KV/account identity and assumes an imported user JSON restored provider configuration, credentials, sessions, or Durable Object state.
- Bad: a user-data endpoint lists and deletes broad prefixes, removes shared provider/access configuration, or deletes `chats_purged_at` and allows stale devices to resurrect data.
- Bad: delete a guest marker or purge lock after one backend succeeds, or classify an alarm read failure as an empty queue.

## 6. Tests Required

- Prove the user export envelope remains bounded, secret-free, and explicit about truncation.
- Prove permanent deletion revokes sessions and removes Agent conversations/memory, legacy KV chat/memory, branch launches, and root/conversation identity records.
- Prove permanent deletion snapshots and deletes every member-owned R2 version before clearing its metadata, leaves no file operation/outbox row after success, and remains idempotent after partial R2 failure.
- Prove empty and non-empty workspace purges persist the same account lock, block uploads after the object snapshot and root purge, and release only after the complete user-data path succeeds.
- Inject each purge backend failure and prove the marker/operation/lock/Root identity remains, the same alarm retry converges after request/session loss, and the final release is idempotent.
- Prove additive legacy cleanup metadata migration, due filtering, exponential backoff/cap, terminal retention, bounded alarm batches, eviction recovery, and privacy-safe aggregate evidence.
- Prove the anti-resurrection timestamp rejects stale uploads while an explicit user-selected `restore` can recover old backup content.
- Prove provider/access configuration and encrypted secret records are not deleted with one member's data.
- Prove member deletion retains content-free Provider attempts, finance, and budget evidence; user export excludes attempts/finance/budgets/raw invoices; capture marks the ledger authoritative/restore with `provider-attempt-ledger-v3`; and isolated restore rejects a v3 archive on a v1/v2-only ledger target or any wrong v1-v5 Durable Object migration tag.
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

## Scenario: Isolated restore drill

### 1. Scope / Trigger

Use this scenario when implementing or reviewing the internal, local/non-production
restore engine for a sealed `CaptureManifestV1`. It validates recovery claims without
adding a production restore API, Cloudflare management call, cutover, or RPO/RTO promise.

### 2. Signatures

```typescript
restoreIsolatedInstance(input: {
  operationId: string;
  archive: EncryptedCaptureArchiveV1;
  archiveKey: Uint8Array;
  target: RestoreTargetIdentityV1;
  mappings: RestoreObjectMappingV1[];
  checkpoints: InstanceRestoreCheckpointStore;
  adapter: IsolatedRestoreTargetAdapter;
}): Promise<RestoreIsolatedInstanceResult>

IsolatedRestoreTargetAdapter.readPhaseReceipt({
  operationId, manifest, target, targetIdentityDigest, inputDigest, phase,
}): Promise<RestoreTargetPhaseReceiptV1 | undefined>
```

### 3. Contracts

- Decrypt and validate every manifest/payload, registry, schema, binding, mapping,
  Queue state, and canonical JSON value before `inspectTarget()` or any target write.
- Require exactly one prevalidated `legacy_surface_registry` restore entry. Its
  schema/class/behavior, current bundled manifest/digest/count/order, deterministic
  coordinator names, events, operation receipts, counters, and snapshot digests
  must all validate before target inspection. Pass that exact entry explicitly
  to the `durable_stores` adapter; a generic phase entry list is not sufficient
  proof that the registry reached its per-surface targets.
- The approved order is `preflight`, `provision`, `durable_stores`, `user_state`,
  `root_agent`, `conversation_agents`, `workspace_files`, `queue_regeneration`,
  `reconciliation`, `acceptance`, `eligible_for_cutover`.
- Ordinary restore phases receive only `restoreBehavior: "restore"` entries. Queue
  `rebuild` and `exclude` entries are validated/reconciled but never sent to
  `restoreEntries()`.
- Every target mutation atomically commits a target receipt bound to operation ID,
  archive ID/checksum, target digest, phase, input digest, result digest and time.
  Central checkpoints are a replay index; on retry the target receipt is recovered
  before an action is invoked. A missing, divergent, or count/byte-mismatched receipt
  fails closed.
- `queued` and valid `extracting` rows enqueue once; ordinary `failed` rows remain
  failed; `document_ingest_retry_exhausted` with attempts >= 4 remains DLQ; `ready`
  and `deleted` rows perform no logical send. Impossible combinations are rejected.
- Canonical Base64 `""` decodes to a legal zero-byte `ArrayBuffer`/R2/KV value.
- Retained drill evidence contains only exact commit SHA, checksums/digests, bounded
  counts, timings, loss boundary, and enum states. It omits archive/object IDs,
  labels, object keys, content, ciphertext, credentials, and raw exceptions.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Wrong key, AAD/payload tamper, malformed canonical JSON | Reject before target inspection with stable archive/payload error |
| Non-empty, write-open, incompatible schema/binding, insufficient capacity target | Reject before phase action |
| Duplicate, orphan, missing, mutable-label-derived, or root-conflicting mapping | Reject before target inspection |
| Existing checkpoint/receipt identity or digest differs | `restore_checkpoint_conflict` / `restore_checkpoint_diverged` |
| Target action commits then process/central checkpoint fails | Retry reads the exact target receipt; action count remains one |
| Target receipt is absent after an action or has extra/secret fields | Fail closed with receipt error; keep writes closed |
| Queue status/error/attempt combination is impossible | `restore_queue_evidence_invalid` before target inspection |
| Legacy registry entry is missing/duplicated, has the wrong schema/digest/count/order/coordinator, or contains a conflicting event | `restore_legacy_surface_registry_invalid` before target mutation |
| A restored surface snapshot differs when re-read | `restore_legacy_surface_registry_diverged`; keep writes closed |
| Reconciliation reports unresolved references or writes open | Reject and do not mark eligible |
| Drill evidence includes a label, object key, content, ciphertext, or credential | Reject evidence artifact |

### 5. Good / Base / Bad Cases

- Good: a fresh isolated target receives a verified archive, each phase records one
  receipt, a retry reuses receipts, and reconciliation proves zero unresolved references.
- Good: an empty KV value, empty R2 object, and empty DO binary value round-trip without
  being mistaken for malformed Base64.
- Base: a failed target remains isolated and is discarded or retried; the untouched
  source digest is unchanged and no writes reopen before acceptance.
- Bad: replay an adapter action merely because the central checkpoint write was lost,
  send Queue evidence directly as durable rows, or retain archive IDs/labels in drill evidence.

### 6. Tests Required

- Use a local fake provider/adapter and a real `captureInstance()` AES-GCM archive.
- Assert wrong-key/tamper paths make zero target calls; test target identity, schema,
  capacity, emptiness, duplicate/orphan/root-conflict mappings.
- Inject a failure after every phase receipt commit and a central checkpoint write
  ambiguity; assert one logical action per phase and identical convergence on retry.
- Cover `queued`, `extracting`, ordinary `failed`, DLQ, `ready`, and `deleted` plus
  invalid combinations; assert no duplicate Queue operation keys.
- Restore the full current legacy manifest into deterministic isolated
  `InstanceCoordinator` targets and assert all 13 projections remain
  `discovered`. Inject central-checkpoint failure after the target receipt and
  prove retry does not apply the registry twice.
- Assert source-before/source-after digest equality, writes closed, deletion/auth/
  isolation canaries, zero unresolved references, and absence of sensitive evidence fields.
- Run `scripts/run-isolated-restore-drill.mjs` with the current 40-character worktree
  SHA and retain only `test-results/restore-drill/<sha>.json` (ignored by Git).

### 7. Wrong Vs Correct

#### Wrong

```typescript
const checkpoint = await checkpoints.read(operationId, phase);
await adapter.restoreEntries(input); // replays after a completed checkpoint
```

#### Correct

```typescript
const receipt = await adapter.readPhaseReceipt(input);
if (receipt) return reuseReceipt(receipt);
const committed = await adapter.restoreEntries(input); // atomically records receipt
await checkpoints.write(checkpointFromReceipt(committed));
```
```
