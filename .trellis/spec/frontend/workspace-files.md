# R2 Workspace Files And Document Ingest

## 1. Scope / Trigger

Use this contract when changing member workspace-file storage, file/version APIs, Root `TeamAgent` SQLite schema, R2 object lifecycle, conversation file selection, provider context, the React file workspace, or permanent user-data deletion.

Workspace files are member-owned and versioned. R2 stores immutable originals and generation-scoped extracted text; the member's root `TeamAgent` SQLite database owns authoritative metadata, exact conversation references, ingest state, idempotency, and cleanup state. Text, PDF, DOCX, XLSX, and PPTX all cross the Provider boundary only after the exact ingest generation is ready.

## 2. Signatures

Public HTTP boundaries:

```text
GET    /api/workspace/files?q=<query>&cursor=<cursor>&limit=<1..50>
POST   /api/workspace/files                              multipart/form-data
GET    /api/workspace/files/:fileId/versions
POST   /api/workspace/files/:fileId/retry                multipart/form-data
POST   /api/workspace/files/:fileId/ingest-retry         { versionId? }
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
  generation, error, ingest_status, ingest_generation, ingest_attempts,
  ingest_error, extracted_object_key, extracted_checksum, extracted_bytes,
  extracted_chars, created_at, updated_at
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
beginDocumentIngest(message: DocumentIngestMessage): Promise<DocumentIngestBeginResult>
completeDocumentIngest(message: DocumentIngestMessage, artifact: DocumentIngestArtifact): Promise<boolean>
recordDocumentIngestFailure(message: DocumentIngestMessage, error: string, transient: boolean): Promise<boolean>
recordDocumentIngestDlq(message: DocumentIngestMessage, error: string): Promise<boolean>
retryDocumentIngest(fileId: string, versionId: string): Promise<DocumentIngestRetryResult>
```

Queue bindings and messages:

```typescript
DOCUMENT_INGEST: Queue<DocumentIngestMessage>
type DocumentIngestMessage = { ownerId: string; fileId: string; versionId: string; generation: number };
type DocumentIngestStatus = "queued" | "extracting" | "ready" | "failed" | "deleted";
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
- Text files are at most 1 MiB; PDF/Office files are at most 10 MiB. One upload selection contains at most 50 files, retained member versions total at most 250 MiB, and one conversation pins at most 10 exact versions. List requests return at most 50 rows and use an opaque cursor ordered by `pinned DESC, updated_at DESC, id DESC`.
- Public file projections add only bounded ingest status/generation/attempt/error and retry availability. They never expose Queue owner IDs or R2 keys. Client decoders reject unknown keys, invalid finite states, a current version whose `fileId` differs from its file, or `ingestRetryAvailable` that does not exactly match a failed current ingest.

### Async Document Ingest

- Upload finalization persists `queued`, generation `1`, and the deterministic key `workspaceExtractedObjectKey(originalKey, generation)`, then sends the exact `{ ownerId, fileId, versionId, generation }` message. A Queue send failure marks that generation failed and returns a retryable `503`; the HTTP response never returns the internal message.
- The main consumer is locked to batch size `1`, concurrency `1`, and `max_retries: 3` (initial delivery plus three retries). Transient failures return the state to `queued`; permanent parser failures become `failed` and ack; the DLQ marks only the matching queued/extracting generation failed.
- `extracting` owns a 60-second processing lease. A duplicate delivery retries after the remaining lease instead of doing parallel work; an expired lease increments attempts and reclaims only the same file/version/generation. This prevents a Worker termination between begin and failure recording from leaving a version permanently stuck.
- Manual retry is current-version-only and changes only `failed -> queued`, increments generation, clears artifact metadata, and sends a new message. Old main/DLQ/completion messages cannot change the new generation.
- `deleted` is terminal. File/account deletion tombstones ingest state first and deletes both original and extracted keys. Late completion, failure, DLQ, and begin calls cannot revive content.
- The parser accepts only UTF-8 text, a pre-gated PDF subset, and structurally matched DOCX/XLSX/PPTX packages. PDF names are escape-decoded before rejecting scripts/actions/attachments/encryption/object streams. OOXML verifies main content type plus root relationship, rejects macros/ActiveX/OLE/embedded packages/external or escaping relationships/nested archives, and bounds ZIP/XML/domain expansion.
- Parser budgets are centralized: 200 PDF pages, 10,000 PDF objects, 512 ZIP entries, 8 MiB per expanded entry, 32 MiB total expanded bytes, 100:1 ratio, XML depth 64, 128 attributes per element, 100,000 rows, 50,000 cells, 500 slides, 200,000 output characters, and a 5-second cooperative deadline.

### Exact Conversation References

- `conversation_file_refs` stores `conversationId + fileId + versionId`; selection never stores only the current logical file.
- Sending resolves the exact saved version again through the root `TeamAgent`. Renaming the logical path updates display context, but a changed `current_version_id` does not change the selected bytes.
- Branch creation copies exact references. Deleting one conversation removes only its references. Deleting a file removes every reference to all of its versions.
- Every supported format uses the exact referenced version's `ready` extracted artifact. The resolver verifies generation-derived key, R2 size/SHA metadata, recomputed SHA, UTF-8, byte count, character count, aggregate prompt limits, and current tombstone authorization before creating deterministic `<attached_file>` text. It never falls back to original bytes or native non-image file parts.
- Queued, extracting, failed, and deleted versions produce bounded per-file unavailable status. A malformed/tampered artifact fails before any Provider call. Raw binary bytes, parser errors, Queue owner IDs, object keys, file IDs, and version IDs are not sent to the Provider.
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
| Text exceeds 1 MiB, document exceeds 10 MiB, batch exceeds 50, or member retained bytes exceed 250 MiB | Reject before object creation; concurrent final-byte admission permits at most one winner |
| Case/NFC-equivalent active path exists | `409 workspace_path_conflict`; preserve the existing row |
| Stale `expectedUpdatedAt` or overlapping upload | `409 workspace_file_conflict` with the current public projection |
| Operation ID is reused with a different fingerprint/kind | `409 workspace_operation_conflict` |
| Requested file/version belongs to another member | `404 workspace_file_not_found` / `workspace_version_not_found`; expose no owner metadata |
| Exact selected version is tombstoned, failed, or missing | Reject the reference/send or return the bounded unavailable context; never follow current version |
| R2 put fails | Mark operation/version/file failed; allow a new immutable retry |
| R2 put succeeds but finalize is interrupted | Return pending and reconcile from size plus SHA-256 evidence |
| R2 delete fails | Keep tombstone/outbox retryable; never show the file as active |
| Download size/checksum metadata differs | `503 workspace_object_unavailable` / `workspace_object_invalid`; do not stream bytes |
| Queue binding/name contract is missing or Queue send fails | Retry/fail closed; mark the exact generation failed so manual retry is available |
| Duplicate delivery arrives during an active processing lease | Retry after the bounded remainder; do not parse in parallel |
| Processing lease expired after Worker termination | Reclaim the same generation and increment attempts |
| Parser finds active content, package mismatch, traversal, encryption, malformed input, or a resource limit | Persist a bounded permanent error, ack, and make zero Provider calls |
| Transient delivery fails four times total | Cloudflare moves it to the DLQ; matching generation becomes `failed` |
| Ready extracted key, SHA, bytes, UTF-8, or character count differs | Fail before Provider execution; never read the original as fallback |
| Pending upload exists when account purge starts | `workspace_purge_pending_upload`; preserve the authenticated session for retry |
| Workspace mutation races an active account purge | `409 workspace_account_purge_in_progress`; create no metadata or object |
| Any permanent-delete sub-operation fails | Return `503 user_data_purge_incomplete`; retain the purge lock and retry idempotently |

## 5. Good / Base / Bad Cases

- Good: a member uploads PDF version A, it reaches `ready`, then uploads version B and pins A; the fake Provider receives only A's verified extracted text under the updated display path.
- Good: a Worker terminates after `extracting`; duplicate delivery waits for the lease, reclaims the same generation, and completes without parallel parsing.
- Good: account deletion snapshots every object key, rejects an upload attempted after the snapshot, deletes objects and all user stores, then releases the persisted lock.
- Base: an empty workspace still creates a purge lock before other account stores are deleted and releases it only after the complete deletion path succeeds.
- Base: a queued or failed PDF remains listable/downloadable and produces only its explicit unavailable status until a ready generation exists.
- Bad: persist only `fileId`, resolve `current_version_id` during send, or overwrite the old R2 key during retry.
- Bad: treat `extracting` as a terminal duplicate ack, read the original when extraction metadata is invalid, or return `{ ok: true, message: { ownerId } }` from manual retry.
- Bad: return `completed: true` without persisting an empty-workspace purge lock, or delete the lock immediately after clearing workspace tables while the remaining account purge is still running.

## 6. Tests Required

- Unit-test safe path normalization plus traversal, drive, empty-segment, control-character, case, and Unicode conflicts.
- Prove schema migration 1 -> 2 is idempotent and creates all workspace tables and indexes without changing the Durable Object Wrangler migration tag.
- Prove upload/retry operation fingerprints, optimistic timestamps, transaction compare-and-swap behavior, tombstone authority, missing-object timeout, and SHA-256 reconciliation.
- Prove two immutable versions exist, a conversation pins the old exact version, rename/current-version changes do not drift it, and a local fake Provider sees only that old text.
- Prove object keys and raw PDF/Office bytes are absent from APIs, exports, client state, Provider payloads, and diagnostics.
- Table-test normal Queue extraction for all five formats and permanent rejection for macro/script, ActiveX/OLE, embedded/nested archives, external/escaping relationships, compression bombs, encryption, corrupt packages, and PDF active names before Provider execution.
- Prove initial delivery plus exactly three transient retries reaches DLQ; permanent failure does not retry; manual retry advances generation; duplicate/concurrent/expired-lease/old-generation/deleted races remain idempotent.
- Boundary-test text/document bytes, 49/50/51 upload selection, 250 MiB concurrent admission, and 9/10/11 exact turn references.
- Prove the fake Provider receives only verified ready extracted text for 10 exact versions, consumes one user-message quota unit, and receives zero calls for tampered artifacts.
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

### Document Ingest

Wrong:

```typescript
if (version.ingestStatus === "extracting") message.ack();
const object = await WORKSPACE_FILES.get(version.objectKey); // original fallback
```

Correct:

```typescript
if (leaseActive(version)) message.retry({ delaySeconds: remainingLease(version) });
if (leaseExpired(version)) await root.beginDocumentIngest(exactGenerationMessage);
const object = await WORKSPACE_FILES.get(verifiedReadyVersion.extractedObjectKey);
```

The lease preserves crash recovery without parallel parsing, and the Provider boundary remains fail-closed on the exact extracted generation.
