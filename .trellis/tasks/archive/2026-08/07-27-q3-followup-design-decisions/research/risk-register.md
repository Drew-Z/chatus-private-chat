# Consolidated Future Governance Risk Register

## Register Contract

This register is design evidence, not a claim that a mitigation is implemented. Every future task must preserve the immutable risk ID and append evidence rather than deleting an inconvenient risk.

Field meanings:

- **Asset / trust boundary**: protected data or authorization boundary.
- **Trigger**: condition that activates the risk.
- **Failure mode**: externally meaningful failure.
- **Severity / likelihood**: `critical|high|medium|low` and `likely|possible|unlikely` before mitigation.
- **Invariant**: condition that must remain true.
- **Detection**: observable evidence.
- **Mitigation**: required future control.
- **Rollback**: recovery action if the change fails.
- **Acceptance evidence**: executable proof required to close or downgrade the risk.
- **Owner / review date**: accountable role and next mandatory review date.

## ACL Risks

| ID | Asset / trust boundary | Trigger | Failure mode | Severity / likelihood | Invariant | Detection | Mitigation | Rollback | Acceptance evidence | Owner / review date |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ACL-01 | Member identity and Agent routing | label rename or reuse | wrong principal receives another member's Agent/resource | critical / possible | authorization uses immutable principal and stable resource IDs | identity conflict, mapping mismatch, isolation test | principal alias registry; resource-derived routing; exact identity assertion | disable sharing; preserve current owner routing | rename/reuse migration test with zero cross-principal reads | Security owner / before ACL implementation |
| ACL-02 | Conversation ownership | transfer retry or partial cross-store failure | two owners, no owner, or divergent copy | critical / possible | exactly one owner per active resource | revision mismatch, pending transfer older than SLA | atomic resource owner transition with idempotency and recovery state | freeze transfer; keep prior owner authoritative | interrupted transfer drill and retry proves one resource/owner | Product + data owner / before transfer beta |
| ACL-03 | Owner memory, files, and credentials | broad root membership or shared execution | editor/viewer receives implicit private context | critical / possible | resource share never grants root memory, credentials, OAuth, or unrelated files | secret/content canary projection tests | conversation ACL; explicit resource-local context/file policy | revoke grants; disable shared execution | viewer/editor matrix tests across memory/file/token boundaries | Security owner / before first external share |
| ACL-04 | Tool authorization and side effects | editor invokes tool using owner trust | remote side effect without current principal confirmation | high / possible | trust is principal/resource/review scoped; write tools are per-call | remote call counters on deny/revoke/transfer | invalidate trust on ACL/owner revision; default editor tools denied | disable shared tools and clear trust | consecutive confirmation and zero-call revoke tests | Capability owner / before shared tools |
| ACL-05 | Deletion and export | owner/member deletion or shared export | orphaned resource, cascade loss, or other-member disclosure | high / possible | disposition is explicit and exports state ownership/snapshot scope | orphan census, export leak scan, blocked-delete metrics | block owner deletion; explicit transfer/tombstone; bounded shared export policy | restore grant metadata; keep tombstone | owner deletion and export matrix with anti-resurrection test | Privacy owner / before ACL GA |

## Provider Finance And Feedback Risks

| ID | Asset / trust boundary | Trigger | Failure mode | Severity / likelihood | Invariant | Detection | Mitigation | Rollback | Acceptance evidence | Owner / review date |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FIN-01 | Spend attribution | retry/fallback/tool continuation | attempts are omitted or charged to wrong route/provider | high / likely | every Provider call has server-issued turn/run/attempt identity | ledger/reliability count mismatch | append-only attempt ledger at execution boundary | disable enforcement; retain shadow ledger | multi-Provider fallback fixture reconciles every attempt | Platform owner / before cost dashboard |
| FIN-02 | Usage and cost truth | missing/late Provider usage or price | unknown appears as zero or stale price rewrites history | high / likely | evidence class and immutable price version are explicit | unknown/late/corrected counters, catalog gaps | usage source taxonomy; effective-dated catalog; corrections | label all totals provisional; disable hard budget | late usage and price-change reconciliation tests | Finance owner / before showing money |
| FIN-03 | Budget enforcement | concurrent turns or settlement failure | overspend, double reserve, or permanent leaked hold | critical / possible | reserve/settle/release/reconcile are idempotent and atomic per scope | negative/over-limit balance, old holds | durable budget events, operation fences, conservative unknown hold | switch to approved soft mode; stop new reservations | concurrency, crash, and retry tests with exact balance | Finance + platform owner / before hard budgets |
| FIN-04 | Feedback integrity | forged/replayed browser metadata or edited answer | rating is attributed to another answer/member/provider | high / possible | feedback requires current-principal server receipt | invalid receipt/replay counters | signed/server-stored receipt linked to final run/message | hide provider feedback aggregates | forged, replayed, edited, branched answer tests | Product analytics owner / before routing use |
| FIN-05 | Privacy and retention | detailed ledger/invoice aggregation | content, credential, or member activity leaks | high / possible | projections are content-free and purpose-bounded | schema leak scan, retention expiry audit | strict event schema, aggregation thresholds, retention/deletion policy | disable projection/export; retain encrypted source | export/admin/log scan and deletion policy test | Privacy owner / before production capture |

## Recovery And Retirement Risks

| ID | Asset / trust boundary | Trigger | Failure mode | Severity / likelihood | Invariant | Detection | Mitigation | Rollback | Acceptance evidence | Owner / review date |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DR-01 | Multi-store instance consistency | independent online snapshots | restored metadata references missing/old objects or conversations | critical / likely | one declared capture epoch and resolved cross-store generations | manifest checksum/count/ref mismatch | first release stop-write capture and operation drain | abandon isolated target; reopen untouched source | full restore drill with zero unresolved references | DR owner / before first backup claim |
| DR-02 | Encrypted secrets/tokens | archive key or master key unavailable/leaked | ciphertext unrecoverable or credentials compromised | critical / possible | external, separate, tested key custody | preflight decrypt canary, key access audit | dual control, independent archive key, rotation/runbook | abort restore; revoke/re-enter credentials | lost-key and wrong-key drills without key disclosure | Security owner / quarterly |
| DR-03 | Durable identity mapping | restore to new bindings/account | data imports into wrong DO/resource namespace | critical / possible | manifest attests stable principal/root/conversation/object mapping | mapping duplicates/orphans, identity conflicts | versioned mapping table and exact target preflight | abandon target; no cutover | new-target mapping reconciliation and isolation tests | Data owner / before cross-account restore |
| DR-04 | Queue/outbox state | capture during ingest or replay | document loss, duplicate extraction, or wrong version result | high / possible | every replayable delivery derives from durable generation/outbox state | queued/extracting/outbox/Queue count mismatch | pause/drain protocol and idempotent regeneration | keep writes closed; replay from verified outbox | capture/restore with queued, extracting, failed, DLQ cases | Workspace owner / before DR GA |
| DR-05 | Availability commitments | unmeasured RPO/RTO published | operators/users rely on impossible recovery target | high / possible | only measured schedules/drills support a number | missing drill SHA/timings, objective-evidence gap | phase timing and loss measurement over repeated drills | withdraw objective; keep recovery unsupported | retained representative drill artifacts and percentile report | Operations owner / after each drill |
| DR-06 | Legacy data and rollback | destructive cleanup after incomplete census | active caller/data or only rollback source is removed | critical / possible | per-surface census, parity, backup, rollback, observation, approval | legacy reads/writes, parity mismatch, restore failure | staged retirement with independent tasks and delayed cleanup | re-enable disabled path or restore archive before cleanup | disable/rollback rehearsal plus approved destruction evidence | Surface owner / before each cleanup |

## Review Rules

1. Review dates are gates relative to a future implementation milestone because no implementation schedule is approved.
2. A risk may be downgraded only with the named acceptance evidence and an accountable owner.
3. A waiver must be structured and persisted in the future Trellis task; prose in this register is not a waiver.
4. New implementation discoveries append risks or strengthen invariants. They do not silently weaken this register.
