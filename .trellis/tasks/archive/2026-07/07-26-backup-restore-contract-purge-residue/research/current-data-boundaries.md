# Current Data And Recovery Boundaries

## Storage Surfaces

- Bindings: `CHAT_STORE`, `USER_STATE`, `TEAM_AGENT`, and `PROVIDER_COORDINATOR` (`src/worker.ts:284-289`, `wrangler.jsonc:14-47`).
- `UserState` tables include usage, bursts, login failures, metrics, legacy chats, deleted-chat tombstones, user state, and guest leases (`src/worker.ts:447-499`).
- `TeamAgent` owns conversation metadata, memory, migration markers, cleanup/branch state, capability trust, Agents SDK chat tables, and a non-SQL `chatus:agent-identity:v1` record (`src/agent/team-agent.ts:155-223`, `src/agent/team-agent.ts:1091-1143`).
- `ProviderCoordinator` stores expiring provider leases under `provider-leases:v1`; empty leases delete the storage key/alarm (`src/provider-coordinator.ts:42-52`, `src/provider-coordinator.ts:194-205`).
- KV includes instance configuration, access records, managed secret ciphertext, sessions, feedback/audit data, passive reliability records, guest cleanup records, and legacy chat/memory/usage sources.

## Current Recovery Capabilities

- User export is bounded and secret-free, with 5 MB total and 512 KB per-conversation caps (`src/worker.ts:2929-2990`). It is user portability, not disaster recovery.
- Chat migration accepts `merge`, `restore`, and `replace`, but does not import the complete user-export envelope or instance configuration (`src/worker.ts:3291-3333`).
- Code rollback preserves instance Variables and uses append-only Durable Object migration history (`docs/operations.md:126-145`).
- No automated cross-account KV/Durable Object restore exists; changing account/Worker/KV identity creates a new storage boundary (`docs/operations.md:145`, `docs/self-hosting.md:152`).
- Managed provider-key ciphertext requires the original `ROUTE_KEYS_MASTER_KEY`; rotating it makes old ciphertext unusable until keys are re-entered (`docs/operations.md:90-120`, `docs/self-hosting.md:150`).

## Confirmed Purge Findings

- `chatus_conversation_branch_launches` is already cleared by `clearPersistedChatState()` (`src/agent/team-agent.ts:1091-1103`). The missing piece is focused API-level regression coverage.
- `chatus:agent-identity:v1` is written but never deleted, leaving a user label/chat ID after conversation or root purge (`src/agent/team-agent.ts:72`, `src/agent/team-agent.ts:1116-1143`).
- `DELETE /api/user-data` omits the exact legacy `chats:{encoded-label}:index` KV key even though malformed legacy records are deliberately retained during migration (`src/worker.ts:1181-1194`, `src/worker.ts:3584-3586`, `src/worker.ts:3844-3861`).
- `UserState.user_state.chats_purged_at` is intentionally retained to reject pre-deletion stale writes and must not be removed (`src/worker.ts:758-768`, `src/worker.ts:795-807`).

## Planning Conclusion

The minimum safe task is a readiness contract plus narrow residue cleanup and regression coverage. A restore implementation remains blocked on a verified Cloudflare transport, a consistent-capture protocol, a versioned manifest, deterministic object identity mapping, and a successful restore drill.

## Current Cloudflare Verification

- Cloudflare's current SQLite-backed Durable Object storage reference states that each object's storage is private to that instance and exposes SQL, point-in-time recovery, key-value, and alarm APIs. Per-object PITR therefore does not by itself provide a consistent Chatus instance restore across KV and many objects: <https://developers.cloudflare.com/durable-objects/api/storage-api/>.
- The same reference and `@cloudflare/workers-types@5.20260724.1` define `DurableObjectStorage.delete(key)` as an awaited promise (`Promise<boolean>` in the current type package).
- Cloudflare KV documents `KVNamespace.delete(key)` as a promise that should be awaited; deleting a missing key succeeds, which supports idempotent retry: <https://developers.cloudflare.com/kv/api/delete-key-value-pairs/>.
- The current Workers best-practices page requires awaited binding promises, generated/current binding types, and local `@cloudflare/vitest-pool-workers` integration coverage: <https://developers.cloudflare.com/workers/best-practices/workers-best-practices/>.
