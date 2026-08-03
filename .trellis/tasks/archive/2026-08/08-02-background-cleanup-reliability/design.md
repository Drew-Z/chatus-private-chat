# Design: Background Cleanup and Deletion Reliability

## Boundary

The Root `TeamAgent` remains the per-owner durability boundary. Existing Root SQLite outboxes remain authoritative for conversation and Workspace/account work. Existing KV guest markers remain authoritative for guest expiry. A Root Durable Object alarm supplies autonomous scheduling through the Agents SDK persistent `schedule()` API; no global Worker cron or new Queue is added.

## Durable Contracts

### Retry metadata

Conversation cleanup rows and Workspace operation rows gain additive retry metadata:

- `next_attempt_at`: earliest eligible time; legacy rows default to immediately due.
- `attempts`: completed failed attempts.
- `last_error`: bounded stable code, never a raw exception.
- `terminal_at`: non-zero after automatic retries are exhausted; the row is retained.

Automatic retries use a 5-second base exponential delay capped at 5 minutes and stop after 8 failed attempts. Tests inject the clock so the schedule is deterministic. A successful retry deletes/completes the owning row. A direct idempotent user retry may still recover retained terminal work.

### Guest ticket

`scheduleGuestCleanup()` writes the existing versioned KV marker without an expiry and registers its key/due time in Root Durable Object storage. The Root alarm adopts and drains it at session expiry. Compatibility traffic-drain code can adopt legacy KV markers into the Root scheduler. The KV marker is deleted only after UserState, R2, conversation agents, and Root metadata have all completed and the account-purge lock is released.

### Conversation outbox

The existing `chatus_conversation_cleanup` row covers two idempotent effects:

1. clear the conversation-scoped TeamAgent transcript;
2. delete the rollback UserState chat and persist its tombstone.

The row is completed only after both calls succeed in the same attempt. A repeated first effect is safe. The delete API may attempt the work immediately, but the alarm owns retries.

### Workspace and owner purge

Workspace `delete_file` operations keep their operation ID and generation checks. R2 deletion remains idempotent and metadata finalization still verifies the matching generation.

`account_purge` remains the durable owner-purge lock after Workspace objects are deleted. Root identity is preserved while external work is pending. The same operation drives conversation-agent clearing, Root table clearing, UserState purge, session revocation, legacy KV/index removal, feedback/audit removal, and usage-key removal. Only the final release removes the operation and Root identity. Guest cleanup reuses this idempotent purge path and deletes its KV marker after release.

## Alarm Flow

1. Creating a conversation cleanup, Workspace delete/account purge, or guest ticket replaces the cleanup-specific one-shot Agent schedule with the earliest due time.
2. The Agents SDK owns `alarm()` and invokes `TeamAgent.runCleanupSchedule()` after restoring identity; Chatus does not override the SDK alarm handler.
3. The pass processes at most the existing small batch limit per outbox, records stable failure codes, and leaves unrelated records untouched.
4. The Root recomputes the earliest non-terminal due time, cancels only its prior cleanup callback, and creates the next persistent one-shot schedule. Other SDK schedules remain untouched.
5. Opportunistic request drains call the same due-aware functions, so request and alarm behavior cannot diverge.

An alarm invocation never treats list/read failure as an empty successful queue. Its top-level catch logs a privacy-safe aggregate event and schedules a bounded retry while Root identity still exists.

## Observability

Root exposes a testable cleanup summary containing counts by cleanup family and state, the oldest due timestamp, maximum attempts, and whether an alarm is scheduled. Logs contain event name, stable error code, attempt, terminal flag, and request/alarm correlation only. Labels, chat IDs, operation IDs, object keys, content, and exception messages are excluded.

## Compatibility and Migration

- SQLite migrations use `ALTER TABLE ... ADD COLUMN` guarded by schema inspection; defaults make legacy rows due immediately.
- Existing guest marker payloads remain valid. The compatibility scanner registers each expired marker with its owner Root before attempting it.
- Success response shapes for file/conversation deletion remain compatible. A cleanup still pending may return the existing accepted/retry response, while autonomous retry no longer requires the client to return.
- 0.x compatibility is additive at storage/API boundaries; no stored IDs or R2 object-key formats change.

## Failure and Rollback

- If R2 or a secondary Durable Object is unavailable, the owning row/marker remains and the alarm is rescheduled with backoff.
- If the process is evicted after a side effect but before completion, the repeated effect is idempotent and generation/tombstone checks prevent stale deletion.
- Terminal work is retained for diagnosis and explicit replay; it is not auto-deleted.
- The feature is independently revertible. Additive columns and retained markers remain readable by the pre-change code, although reverting removes autonomous alarms.

## Security

Cleanup persistence stores identifiers required for internal routing, but public responses and operational summaries do not project them. Error values are allowlisted stable codes. Tests use synthetic labels/object keys and assert they do not appear in logs or inspection output.
