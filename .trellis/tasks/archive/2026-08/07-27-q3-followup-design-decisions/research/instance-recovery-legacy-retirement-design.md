# Instance Recovery, RPO/RTO, And Legacy Retirement Design

## Status And Scope

This is a future disaster-recovery and retirement design. Chatus does not currently provide full-instance backup or restore, and this document does not add capture, restore, migration, destructive cleanup, or production workflow behavior.

## Current Evidence

- The checked-in deployment has one KV namespace, one R2 bucket, one document Queue with DLQ, and three SQLite Durable Object classes: `UserState`, `TeamAgent`, and `ProviderCoordinator` (`wrangler.jsonc:14`, `wrangler.jsonc:19`, `wrangler.jsonc:24`, `wrangler.jsonc:44`).
- Durable Object migration tags `v1` through `v3` are append-only SQLite class declarations (`wrangler.jsonc:60`).
- `UserState` owns usage, burst limits, login failures, metrics, legacy chats/tombstones, OAuth owner/state/token/candidate rows, and anti-resurrection state (`src/worker.ts:569`, `src/worker.ts:587`, `src/worker.ts:597`, `src/worker.ts:610`).
- Root `TeamAgent` owns conversation index, memory, cleanup/branch state, capability trust, and workspace file/version/reference/operation metadata. Conversation Agents also own Agents SDK transcript/stream persistence (`src/agent/team-agent.ts:288`, `src/agent/team-agent.ts:296`, `src/agent/team-agent.ts:312`, `src/agent/team-agent.ts:361`).
- R2 stores immutable workspace versions and extracted document objects; Queue delivery is asynchronous and metadata reconciliation is required (`src/worker.ts:1613`, `src/worker.ts:1624`, `.trellis/spec/frontend/workspace-files.md`).
- Managed Provider/MCP secrets and OAuth tokens are ciphertext whose usability depends on the external `ROUTE_KEYS_MASTER_KEY` (`.trellis/spec/platform/deployment-configuration.md`, `.trellis/spec/platform/backup-restore.md:60`).
- User export is bounded, may be truncated, and excludes instance configuration, credentials, Durable Object operational state, and stable object mapping (`src/worker.ts:4226`, `docs/operations.md:140`, `.trellis/spec/platform/backup-restore.md:46`).
- Current operations explicitly state that legacy Durable Object state still supports login throttling, usage compatibility, and rollback import (`docs/operations.md:72`).
- No full-instance manifest, archive envelope, capture command, restore command, or measured restore drill exists (`.trellis/spec/platform/backup-restore.md:38`).

## Recovery Meanings

| Operation | Current status | Required interpretation |
| --- | --- | --- |
| User export/import | supported, bounded | portability for selected user data, not instance DR |
| Code/config rollback | supported through GitHub Actions | preserves the same Cloudflare account, Worker, KV, R2, Queue, and DO identity |
| Cloudflare point-in-time restore of one DO | platform primitive | not a consistent multi-store restore |
| Full-instance capture/restore | not implemented | unsupported until every readiness gate and drill passes |

Changing account, Worker name, KV namespace ID, R2 bucket, Queue names, or Durable Object namespace creates a new storage boundary. It is not recovery by itself.

## Required Invariants

1. A versioned manifest lists every included and explicitly excluded state class, source identity, schema/migration version, count, size, checksum, and capture epoch.
2. Capture has one declared consistency boundary. Per-service snapshots taken at unrelated times cannot be described as one recoverable instance.
3. Archives are encrypted independently from application records. Decryption keys and `ROUTE_KEYS_MASTER_KEY` remain under external custody and are never stored as the only copy inside the archive.
4. Restore targets are provisioned and compatibility-checked before data import. Applied Durable Object migration tags are never rewritten.
5. Stable member/root/conversation/object mapping is preserved exactly or migrated by a versioned, verified mapping table.
6. Restore is resumable and idempotent. Each phase has a durable checkpoint, verification output, and rollback/abandon boundary.
7. Sessions, leases, throttling windows, PKCE state, and other declared ephemeral data start empty.
8. Writes remain closed until integrity reconciliation and product acceptance pass.
9. RPO and RTO are measured evidence, not promises. No number may be published before a real schedule and restore drill produce it.
10. Legacy data is deleted only after census, parity, backup, rollback, observation, and owner approval gates pass for that exact surface.

## State Inventory

### Persistent And Required

| Store | Required state | Restore concern |
| --- | --- | --- |
| Instance identity | account, Worker name, KV/R2/Queue/DO bindings, migration history | target mismatch selects different data |
| `CHAT_STORE` KV | routes/config, access configuration, managed-secret ciphertext, feedback, admin audit, drift overlays, durable operational keys | eventually consistent listing and non-atomic multi-key capture |
| Root `TeamAgent` | conversation index, memory, cleanup/branch reservations, capability trust, workspace metadata/outbox | stable root mapping and SQLite consistency |
| Conversation `TeamAgent` | messages, stream/request/tool persistence, trust, identity | many independently named objects |
| `UserState` | usage/metrics, chats/tombstones, purge time, OAuth encrypted tokens and owner binding | per-member object mapping and master-key dependency |
| `WORKSPACE_FILES` R2 | source and extracted immutable objects | checksum/object inventory must match SQLite metadata |
| Queue topology | Queue/DLQ names and consumer settings | messages in flight cannot be reconstructed from metadata alone |

### Transitional, Retained Until Retirement

- Legacy `chats:{label}:index`, `memory:{label}`, and `usage:{label}:{day}` KV records.
- Legacy `UserState.chats` and deletion/timeline evidence.
- Legacy route/provider configuration fields and credential references required for rollback.
- Legacy browser/admin entry points while operational parity or rollback still depends on them.

### Rebuildable Or Expiring

- Member/admin sessions, guest sessions and cleanup leases.
- Provider capacity leases and coordinator alarms.
- Login failure windows, minute bursts, and passive seven-day reliability samples.
- OAuth PKCE state and member discovery candidates.
- Queue deliveries that can be deterministically regenerated from a durable queued/outbox state. Any delivery without such an outbox is potential data loss and must be reported.

Every exclusion belongs in the manifest with a reason and post-restore behavior.

## Candidate Consistency Protocols

### A. Offline Stop-write Capture

Enter maintenance mode, reject mutations, drain or freeze Queue consumers, wait for active operations to settle, capture every store under one epoch, then reopen writes.

Recommended first implementation because it provides the clearest correctness boundary. Availability cost is explicit and measurable.

### B. Online Epoch/Changelog Capture

Assign a global capture epoch, snapshot stores independently, and replay all committed mutations after each store's snapshot position.

Future option only. Chatus has no global transaction log or cross-store sequence today, so this is not currently implementable.

### C. Best-effort Service Exports

Export each service independently and reconcile counts later.

Rejected as a recoverable instance guarantee. It can be an operator diagnostic bundle if labeled incomplete.

## Recommended Capture Protocol

1. Preflight source identity, bindings, schema versions, available capacity, and external keys.
2. Create a capture operation ID and encrypted manifest draft outside application data.
3. Enable maintenance mode through an exact revision; reject new member/admin mutations and Provider turns.
4. Drain or pause Queue consumption and wait for active uploads, purges, branches, streams, and tool runs to reach safe states.
5. Record per-store checkpoints and capture KV configuration/security state, DO SQLite exports by stable mapping, and R2 objects/checksums.
6. Record Queue/DLQ counts and classify in-flight messages as captured, regenerated, excluded, or unresolved.
7. Re-read operation/outbox and manifest counts; fail the capture if unresolved cross-store generations remain.
8. Finalize and sign/encrypt the manifest, then reopen writes.

The first release should accept planned downtime rather than claim online consistency without a global log.

## Key Custody

- Archive encryption key and application `ROUTE_KEYS_MASTER_KEY` have separate identities and rotation policies.
- At least two operator-controlled recovery paths must exist; the application archive cannot be the only key backup.
- Key access uses quorum/dual control, records bounded audit metadata, and is tested without printing key material.
- A restore drill proves old ciphertext can decrypt under the original application key before writes reopen.
- Loss of the master key is an explicit unrecoverable-secret outcome. Restore must require credentials/OAuth connections to be re-entered rather than falling back to stale Worker secrets.

## Restore State Machine And Order

```text
requested -> preflighted -> provisioned -> importing -> reconciling
          -> accepting -> completed
          -> failed_retryable | abandoned
```

Required order:

1. Validate manifest signature/encryption, source identity, completeness, schema compatibility, and external keys.
2. Provision target KV/R2/Queue/DO bindings and apply append-only migrations.
3. Keep production writes disabled and sessions/leases empty.
4. Restore durable KV configuration/security state and transitional rollback sources.
5. Restore `UserState` objects using the stable principal mapping.
6. Restore root Agent objects, then conversation Agent objects using exact resource mappings.
7. Restore R2 objects and verify every metadata reference, size, checksum, version, and ownership generation.
8. Recreate Queue deliveries only from durable queued/outbox state; never guess missing payloads.
9. Reconcile counts/checksums/exclusions, decrypt a non-sensitive canary record, and run deletion/isolation tests.
10. Run GitHub-Actions-only exact-SHA product acceptance, then reopen writes at a new revision.

Failure before reopening writes leaves the target isolated and retryable. Failure after cutover uses a declared forward repair or full rollback to the untouched source; mixing both instances is forbidden.

## RPO And RTO Measurement

No numeric target is approved.

Future measurement must record:

- scheduled capture interval and every successful/failed capture timestamp;
- newest committed mutation included in each store checkpoint;
- start/end time for detection, decision, provisioning, import, reconciliation, acceptance, and reopen phases;
- lost/unmatched records by state class;
- manual operator time and external dependency waits;
- archive size, object count, and throughput;
- drill environment and exact code/manifest SHA.

Measured RPO is the difference between the failure point and the newest reconciled committed mutation. Measured RTO is the difference between declared incident start and write reopening after acceptance. Percentiles and worst cases require multiple representative drills; a single best-case exercise cannot become the commitment.

## Legacy Surface Retirement Gates

| Surface | Current dependency | Retirement gates | Rollback boundary |
| --- | --- | --- | --- |
| Legacy chat KV/index and `UserState.chats` | migration, anti-resurrection, rollback imports | complete census; Agent parity; tombstone preservation; sampled reconciliation; restore drill | retain read-only sources through observation window |
| Legacy memory KV | import/rollback evidence | every member root reconciled; conflict policy tested; export parity | keep exact key read path disabled-but-recoverable |
| Legacy daily usage KV | usage compatibility and admin reset | DO counters authoritative; dual-reset no longer needed; bounded historical retention decision | restore compatibility read without rewriting counts |
| Legacy route/provider fields | config compatibility and rollback | managed-secret refs verified; logical route/provider parity; no hidden plaintext dependency | retain versioned config snapshot and code rollback |
| `/api/chat` legacy stream | protocol compatibility | Agent path parity for fallback, files, tools, quota, telemetry, cancellation | route traffic back without schema downgrade |
| `/admin.html` legacy UI | remaining operational sections/rollback | React parity inventory; production acceptance; operator sign-off | keep static asset and documented recovery URL |
| Legacy credentials/secrets | deployment fallback | managed record authority verified; explicit remote-secret deletion plan; decrypt drill | no deletion until independent credential works |
| Legacy Durable Object namespace | throttling, usage compatibility, rollback import | every method mapped or retired; storage census; DR support; no production callers | namespace remains untouched; never delete in same release |

Each surface receives its own task and observation window. "No recent logs" is supporting evidence, not proof of no callers. Destructive cleanup is a separate approved production change.

## Migration And Rollback

Recovery implementation starts with inventory and read-only capture. Restore runs only in an isolated target. Production cutover waits for reconciliation and acceptance.

Legacy retirement follows: instrument -> census -> parity -> dual-read/shadow -> stop writes -> observe -> backup/drill -> disable reads -> observe -> destructive cleanup. Rollback is allowed until destructive cleanup, after which recovery depends on the retained archive and measured restore drill.

## Acceptance Scenarios For A Future Implementation

1. A stopped-write capture restores KV, all mapped DOs, R2 files, and exclusions with exact counts/checksums.
2. Queue work present at capture is either restored from durable outbox state or reported unresolved; no silent drop or double extraction occurs.
3. An unavailable master key fails preflight before importing ciphertext and clearly classifies required credential reconnection.
4. Sessions/leases/PKCE state remain absent and users reauthenticate.
5. A restored member can read only their conversations/files/memory and permanent deletion remains exact and idempotent.
6. A legacy surface is disabled, observed, restored through the rollback path, then disabled again before any destructive deletion approval.
7. Drill evidence reports measured phase timings and data loss; no unsupported RPO/RTO number appears.

## Open Product And Operations Decisions

- What planned maintenance window is acceptable for the first consistent capture?
- Which external archive store, encryption service, and key quorum are approved?
- How are Queue messages drained or regenerated under maintenance mode?
- Is recovery in place, to a new account, or both, and how is identity mapping attested?
- What observation period and traffic evidence is required for each legacy surface?
- Which role can approve cutover, abandon, and destructive cleanup?
- What RPO/RTO objective is desired after measurements exist?

## Risks

The consolidated entries `DR-01` through `DR-06` in `risk-register.md` are normative inputs to future recovery and retirement tasks.
