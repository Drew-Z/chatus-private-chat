# Background Cleanup and Deletion Reliability

## Goal

Make guest expiry, conversation deletion, Workspace object deletion, and account purge converge without requiring later member traffic, while retaining durable retry ownership and privacy-safe operational evidence when a backend remains unavailable.

## Background

- Guest cleanup markers are stored in `CHAT_STORE`, but `cleanupGuestData()` uses `Promise.allSettled()` and the caller deletes the marker even when UserState or TeamAgent purge fails (`src/worker.ts:8180-8235`).
- Conversation tombstones are durable in Root TeamAgent SQLite, but transcript cleanup failures are retried only from later API traffic and UserState deletion failures are swallowed outside the outbox (`src/agent/team-agent.ts:735-788`, `src/worker.ts:3831-3839`, `src/worker.ts:5200-5221`).
- Workspace file and account-purge operations retain failed rows, but reconciliation is request-driven and rows have no due time, bounded backoff, or retained terminal state (`src/agent/team-agent.ts:1233-1263`, `src/agent/team-agent.ts:1492-1520`, `src/worker.ts:5317-5369`).
- The project already uses Durable Object alarms for autonomous lease expiry, so per-owner Root TeamAgent alarms can schedule cleanup without introducing a global cron or another Queue (`src/provider-coordinator.ts:141-205`).

## Requirements

- R1. A cleanup marker/outbox row must remain durable until every backend owned by that cleanup succeeds. Partial failure must never be converted into success by `allSettled`, a swallowed exception, or unconditional marker deletion.
- R2. Root TeamAgent must autonomously drain due conversation and Workspace/account cleanup records with a Durable Object alarm. Normal requests may opportunistically drain, but eventual retry must not depend on another request.
- R3. Conversation cleanup owns both the conversation TeamAgent transcript and the rollback UserState chat/tombstone. Both operations must be idempotent, and the Root row is completed only after both succeed.
- R4. Guest cleanup owns UserState, Root/conversation TeamAgent data, Workspace R2 objects, and its KV marker. The marker is deleted last and must not expire while work is incomplete.
- R5. Account purge owns Workspace R2 objects and metadata, conversation agents, Root state, UserState, sessions, feedback/audit indexes, legacy memory/chat indexes, and usage keys. The account-purge lock and Root identity remain until all owned side effects succeed.
- R6. Retry scheduling uses deterministic exponential backoff with a documented cap, maximum automatic attempts, and retained terminal records. Successful idempotent replay completes normally; exhausted work stays inspectable and is never silently discarded.
- R7. Cleanup processing is bounded per alarm invocation and reschedules the next earliest eligible record. An eviction or exception during one attempt must leave durable ownership for the next alarm.
- R8. Operational evidence exposes only aggregate counts, kind/state, attempts, timestamps, and stable error codes. It must not expose member labels, conversation IDs, object keys, content, tokens, or raw exception messages.
- R9. Existing SQLite rows and KV guest markers remain readable. Schema changes are additive and old rows become immediately eligible; newly scheduled guest markers use autonomous alarms.
- R10. Tests use local fake Durable Object, KV, R2, and Provider bindings only. Do not add a production cron, live Provider/MCP call, local production deployment, or new Queue/DLQ.

## Acceptance Criteria

- [x] AC1. Injected UserState and TeamAgent guest-purge failures leave the guest marker present; after the dependency recovers, an alarm retry removes all guest data and deletes the marker exactly last.
- [x] AC2. Conversation failure injection proves transcript success plus UserState failure retains one cleanup row, then an alarm retry completes without resurrecting or duplicating the conversation.
- [x] AC3. Workspace file deletion and account purge retain their operation/generation locks across R2 and finalize failures; a later alarm converges without duplicate metadata mutation or cross-generation deletion.
- [x] AC4. A member account purge continues autonomously after the initiating request fails or its session is revoked, and releases the purge lock/Root identity only after every owned backend succeeds.
- [x] AC5. Retry tests prove due-time filtering, exponential backoff cap, maximum automatic attempts, terminal retention, bounded batch size, and rescheduling after Durable Object eviction.
- [x] AC6. Cleanup inspection/log tests prove aggregate operational fields are available and identifiers, object keys, content, secrets, and raw exception messages are absent.
- [x] AC7. Backward-compatibility tests load pre-change conversation/workspace rows and guest marker payloads and prove they remain eligible for cleanup.
- [x] AC8. `npm run check:frontend`, `npm test`, `npm run test:browser:workspace`, `npm run test:browser:agent`, `npm run typecheck`, `npx wrangler deploy --dry-run`, `git diff --check`, Trellis consistency, and Trellis tests pass using local fakes only.

## Out of Scope

- A global scheduled Worker, a new cleanup Queue/DLQ, an administrator cleanup dashboard, or cross-instance fleet aggregation.
- Backup/restore, RPO/RTO, member sharing/ACL, Provider finance governance, or legacy data-store retirement.
- Production probes, local production deployment, or changes to document-ingest Queue/DLQ behavior.
