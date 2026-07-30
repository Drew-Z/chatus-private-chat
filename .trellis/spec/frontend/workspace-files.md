# R2 Workspace Files

## 1. Scope / Trigger

Use this contract when changing member workspace-file storage, file/version APIs, Root `TeamAgent` SQLite schema, R2 object lifecycle, conversation file selection, provider context, the React file workspace, or permanent user-data deletion.

Workspace files are member-owned and versioned. R2 stores immutable bytes; the member's root `TeamAgent` SQLite database owns authoritative metadata, exact conversation references, idempotency, and cleanup state. PDF and Office extraction are not part of this contract: until a later ingest pipeline marks extracted content ready, those versions are represented to the provider as unavailable without exposing raw bytes.

## 2. Signatures

Public HTTP boundaries:

```text
GET    /api/workspace/files?q=<query>&cursor=<cursor>&limit=<1..50>
POST   /api/workspace/files                              multipart/form-data
GET    /api/workspace/files/:fileId/versions
POST   /api/workspace/files/:fileId/retry                multipart/form-data
PATCH  /api/workspace/files/:fileId
DELETE /api/workspace/files/:fileId?expectedUpdatedAt=<timestamp>&operationId=<id>
GET    /api/workspace/files/:fileId/download?versionId=<exact-version-id>
PUT    /api/agent/conversations/:conversationId/workspace-files
```

Root `TeamAgent` owns these tables:

```sql
workspace_files(
  id, path, path_key, name, current_version_id, pinned, state,
  generation, created_at, updated_at, deleted_at
)
workspace_file_versions(
  id, file_id, object_key, size, media_type, checksum, state,
  generation, error, created_at, updated_at
)
conversation_file_refs(conversation_id, file_id, version_id, created_at)
workspace_file_operations(
  id, kind, file_id, version_id, generation, state, fingerprint,
  object_keys_json, size, checksum, attempts, last_error, created_at, updated_at
)
```

Cross-service lifecycle RPCs include:

```typescript
reserveWorkspaceUpload(input: WorkspaceUploadReservationInput): Promise<WorkspaceUploadReservationResult>
completeWorkspaceUpload(operationId: string, generation: number): Promise<WorkspaceMutationResult>
reserveWorkspaceFileDelete(fileId: string, expectedUpdatedAt: number, operationId: string): Promise<WorkspaceDeleteReservationResult>
completeWorkspaceFileDelete(operationId: string, generation: number): Promise<boolean>
beginWorkspaceAccountPurge(operationId: string): Promise<WorkspaceAccountPurgeReservationResult>
completeWorkspaceAccountPurge(operationId: string, generation: number): Promise<boolean>
releaseWorkspaceAccountPurge(operationId: string, generation: number): Promise<boolean>
```

## 3. Contracts

### Storage And Versioning

- The Worker binding is `WORKSPACE_FILES: R2Bucket`. Only the Worker and root `TeamAgent` may see R2 object keys; browser responses, exports, diagnostics, Provider requests, and audit fields must not contain them.
- Object keys use `workspace/v1/<owner-hash>/<random-file-id>/<random-version-id>`. Original filenames, member labels, and paths never appear in the key.
- Workspace version bytes are immutable. Replacing or retrying a logical file creates a new version and generation; it never overwrites an existing object key.
- Upload ordering is SQLite `pending` reservation -> R2 `put` with SHA-256 -> SQLite `ready` finalize. R2 and SQLite are not one transaction.
- Delete ordering is SQLite tombstone plus outbox -> idempotent R2 delete -> metadata finalize. A tombstoned file cannot be revived by a delayed upload or retry.
- A missing R2 object for a pending upload remains recoverable for 60 seconds. After that bound reconciliation marks the operation/version/file failed so the member can retry with a new operation and version.
- Download streams the R2 body and requires both the expected byte size and R2 SHA-256 metadata to match the exact version row.

### Paths, Limits, And Projections

- `src/contracts/workspace-file.ts` owns path normalization, ID/checksum/media-type normalization, limits, and shared projections.
- Paths use `/`, are normalized to NFC, and are at most 1,024 characters with segments at most 255 characters. Reject absolute paths, drive prefixes, backslashes, empty segments, `.`/`..`, control characters, and case-folded/NFC conflicts.
- One file is at most 10 MB. One conversation may pin at most 10 workspace files. List requests return at most 50 rows and use an opaque cursor ordered by `pinned DESC, updated_at DESC, id DESC`.
- Public file projections contain only public file/version IDs, normalized path/name, pin/state/timestamps, size, media type, checksum, and retry state. Client decoders reject unknown keys and invalid finite states.

### Exact Conversation References

- `conversation_file_refs` stores `conversationId + fileId + versionId`; selection never stores only the current logical file.
- Sending resolves the exact saved version again through the root `TeamAgent`. Renaming the logical path updates display context, but a changed `current_version_id` does not change the selected bytes.
- Branch creation copies exact references. Deleting one conversation removes only its references. Deleting a file removes every reference to all of its versions.
- Valid UTF-8 text-like versions become deterministic `<attached_file>` provider context. PDF/Office and unsupported binary versions become bounded `<attached_file_unavailable reason="document_ingest_not_ready">` context. Raw binary bytes, object keys, file IDs, and version IDs are not sent to the Provider.
- User-data export omits workspace references and checksums rather than embedding R2 bytes or storage identifiers.

### Account Purge Lock

- `beginWorkspaceAccountPurge()` always inserts or returns one persisted `account_purge` operation, including when the workspace has zero object keys. There is no lock-free fast path.
- A pending upload blocks purge admission. Once the purge operation exists, upload, rename/pin, file delete, and conversation-reference mutations reject with `workspace_account_purge_in_progress`.
- Upload and delete reservation repeat the purge-lock check inside the same synchronous SQLite transaction that writes metadata. A transaction-external precheck alone is insufficient.
- After R2 objects are deleted, `completeWorkspaceAccountPurge()` removes file/version/ref rows but retains the operation in `completed` state. `purgeRootData()` also retains it.
- Release the lock only after conversation Agents, root data, `UserState`, sessions, exact legacy KV keys, and member feedback are deleted. A retry reuses the existing lock and snapshot.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Invalid path, checksum, size, or multipart body | `400 workspace_path_invalid` / `workspace_upload_invalid`; no R2 write |
| File exceeds 10 MB | `413 workspace_file_too_large`; no reservation |
| Case/NFC-equivalent active path exists | `409 workspace_path_conflict`; preserve the existing row |
| Stale `expectedUpdatedAt` or overlapping upload | `409 workspace_file_conflict` with the current public projection |
| Operation ID is reused with a different fingerprint/kind | `409 workspace_operation_conflict` |
| Requested file/version belongs to another member | `404 workspace_file_not_found` / `workspace_version_not_found`; expose no owner metadata |
| Exact selected version is tombstoned, failed, or missing | Reject the reference/send or return the bounded unavailable context; never follow current version |
| R2 put fails | Mark operation/version/file failed; allow a new immutable retry |
| R2 put succeeds but finalize is interrupted | Return pending and reconcile from size plus SHA-256 evidence |
| R2 delete fails | Keep tombstone/outbox retryable; never show the file as active |
| Download size/checksum metadata differs | `503 workspace_object_unavailable` / `workspace_object_invalid`; do not stream bytes |
| Pending upload exists when account purge starts | `workspace_purge_pending_upload`; preserve the authenticated session for retry |
| Workspace mutation races an active account purge | `409 workspace_account_purge_in_progress`; create no metadata or object |
| Any permanent-delete sub-operation fails | Return `503 user_data_purge_incomplete`; retain the purge lock and retry idempotently |

## 5. Good / Base / Bad Cases

- Good: a member uploads version A, uploads version B, pins A to a conversation, renames the logical file, and the fake Provider receives only A under the updated display path.
- Good: account deletion snapshots every object key, rejects an upload attempted after the snapshot, deletes objects and all user stores, then releases the persisted lock.
- Base: an empty workspace still creates a purge lock before other account stores are deleted and releases it only after the complete deletion path succeeds.
- Base: a PDF version can be listed, downloaded, selected, and deleted, but provider context says extraction is not ready and contains no raw PDF bytes.
- Bad: persist only `fileId`, resolve `current_version_id` during send, or overwrite the old R2 key during retry.
- Bad: return `completed: true` without persisting an empty-workspace purge lock, or delete the lock immediately after clearing workspace tables while the remaining account purge is still running.

## 6. Tests Required

- Unit-test safe path normalization plus traversal, drive, empty-segment, control-character, case, and Unicode conflicts.
- Prove schema migration 1 -> 2 is idempotent and creates all workspace tables and indexes without changing the Durable Object Wrangler migration tag.
- Prove upload/retry operation fingerprints, optimistic timestamps, transaction compare-and-swap behavior, tombstone authority, missing-object timeout, and SHA-256 reconciliation.
- Prove two immutable versions exist, a conversation pins the old exact version, rename/current-version changes do not drift it, and a local fake Provider sees only that old text.
- Prove object keys and raw PDF/Office bytes are absent from APIs, exports, client state, Provider payloads, and diagnostics.
- Prove conversation deletion, file deletion, and account deletion clean their respective references, versions, operations, and R2 objects.
- Prove both an empty workspace and an object-bearing workspace persist the account purge lock; mutations after snapshot, after workspace finalize, and after root purge remain blocked until explicit release.
- Client decoder tests reject unknown/malformed file projections and delete/pending envelopes.
- Workspace Playwright covers list/search, directory upload, rename focus restoration, pin, delete/pending, download, retry, exact version selection, search-empty recovery, and the 1920/1440/780/480/390 viewport matrix.
- Agent acceptance uses only the local fake Provider. Never use a live model, remote R2 bucket, synthetic production probe, or local production deploy.
- Run the full project gate from `quality-guidelines.md`.

## 7. Wrong Vs Correct

### Wrong

```typescript
const keys = listWorkspaceObjectKeys();
if (keys.length === 0) return { completed: true };
await deleteObjects(keys);
deleteAccountPurgeOperation();
await purgeRemainingUserStores();
```

This leaves both the empty-workspace path and the post-workspace-cleanup window open to an unsnapshotted upload.

### Correct

```typescript
const purge = await root.beginWorkspaceAccountPurge(operationId);
await deleteWorkspaceObjects(env.WORKSPACE_FILES, purge.objectKeys);
await root.completeWorkspaceAccountPurge(purge.operationId, purge.generation);
await purgeConversationAgentsAndUserStores();
await root.releaseWorkspaceAccountPurge(purge.operationId, purge.generation);
```

Keep the persisted purge operation authoritative across the full cross-store deletion window, and repeat its check inside each workspace reservation transaction.
