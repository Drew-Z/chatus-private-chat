# Post-hardening roadmap design

## 1. Purpose and authority

This document turns the approved Q3 follow-up designs into a delivery topology.
It does not make any of the capabilities supported and does not authorize
runtime implementation. The normative sources remain:

- `.trellis/spec/platform/future-governance-decisions.md`
- `.trellis/spec/platform/backup-restore.md`
- `research/instance-recovery-legacy-retirement-design.md` from the archived
  `07-27-q3-followup-design-decisions` task
- `research/provider-usage-cost-budget-feedback-design.md` from that task
- `research/member-sharing-acl-design.md` from that task
- `research/risk-register.md` from that task

Every implementation child must copy its applicable `DR-*`, `FIN-*`, or
`ACL-*` requirements into its own PRD. A link to the source is not sufficient.

## 2. Delivery topology

The program is a dependency-ordered sequence, not four parallel feature tracks.

```text
DR manifest + stop-write capture
        -> isolated restore + drill evidence
        -> Provider attempt ledger
        -> cost/reconciliation/capacity
        -> budget engine and scoped enforcement
        -> bounded Provider-run deadline + fallback progress/correlation
        -> legacy identity-source census + deployed handoff
        -> stable principal/resource identity
        -> sharing/revocation
        -> transfer/deletion/export/tool policy

legacy surface disable/observation -> separately approved destructive cleanup
```

Provider feedback is not on the critical path to budget or capacity governance
and is deferred to a separately approved future task after durable accounting is
operational.

## 3. Stream A: offline full-instance recovery

### 3.1 Boundary

The first supported shape is an offline stop-write capture with a planned
maintenance window. Online consistent capture would require a global
epoch/changelog that Chatus does not have and is not part of this roadmap.

The recovery boundary includes authoritative and transitional state until each
legacy surface completes retirement. The versioned manifest records every state
class as included or explicitly excluded, with source identity, schema/migration
version, item count, size, checksum, capture epoch, and post-restore behavior.

### 3.2 Capture flow

1. Enter a revisioned maintenance state.
2. Reject member/admin mutations and new Provider executions.
3. Pause or drain Queue work and wait for fenced operations to reach a safe
   state.
4. Resolve cross-store generations and freeze a single capture epoch.
5. Capture D1/SQLite, Durable Object mappings/state, KV, R2 and recoverable Queue
   state into a versioned encrypted archive.
6. Verify counts/checksums and persist content-free audit evidence.
7. Reopen writes only when capture either completes or rolls back cleanly.

### 3.3 Restore flow

Restore always targets an isolated instance. It performs manifest/key/binding
preflight, provisions append-only migrations, restores durable stores in the
approved order, regenerates Queue deliveries only from durable generations or
outbox evidence, then reconciles all references and isolation invariants.

The engine is checkpointed and idempotent. Failure before cutover leaves the
target isolated and retryable/discardable. After cutover, operators use forward
repair or return wholly to the untouched source; source and target state are
never mixed.

### 3.4 Security and evidence

Archive keys are separate from application route keys, externally controlled,
rotatable, and recoverable through at least two operator-controlled paths with
dual control. Wrong/lost-key drills fail before import and emit no secrets.

`DR-01` through `DR-04` require a retained isolated restore drill with exact
commit SHA, phase evidence, reconciliation results, and deterministic local or
non-production fixtures. `DR-05` remains open until repeated representative
drills produce measured RPO/RTO data. No number is published from a single drill.

## 4. Stream B: Provider accounting and budgets

### 4.1 Identity and ownership

The server issues opaque `turnId`, `runId`, and `attemptId` values. One admitted
user message is a turn; each logical execution is a run; every exact
Provider/offering/model request is an attempt. Retry, fallback, Skill selection,
and tool continuation cannot reuse an attempt identity or hide a billable call.

Attribution is captured at the Provider execution boundary. Browser metadata is
never authoritative accounting input.

### 4.2 Ledger and projection

An append-only durable ledger owns attempt, usage, price, cost, reservation and
correction evidence. Provider-reported, estimated, invoice-reconciled,
operator-corrected, and unknown usage remain distinct. Unknown is never zero.

Historical costs reference immutable effective-dated price versions and
currency/precision/provenance. Corrections append reversal/replacement evidence;
they do not rewrite history. Content-free projections provide capacity and spend
views while prompts, completions, tool payloads, credentials, raw Provider
metadata, and invoice payloads stay outside ordinary telemetry.

### 4.3 Budget state machine

Hard enforcement is unavailable until one budget scope can atomically and
idempotently execute:

```text
reserve before Provider call
  -> settle known charge and release remainder
  -> retain bounded conservative hold for unknown charge
  -> reconcile late/corrected evidence
```

Reservation denial produces zero Provider calls. Retry/fallback attempts reserve
separately, and tool continuations cannot bypass the remaining turn ceiling.
Rollback disables enforcement but preserves ledger events, operation fences,
holds, and cost history.

### 4.5 Provider-run latency closure

After budget enforcement, one independently reviewable child adds a code-owned
whole-run pre-visible deadline around sequential candidate fallback, an ephemeral
secret-free progress frame, and request-reference correlation through existing
passive reliability. It preserves each attempt's atomic budget admission, the
one-message quota rule, parent cancellation, and committed long streams. Active
health probes, parallel hedging, Provider-specific timeout tuning, and
post-visible idle deadlines remain outside this roadmap.

### 4.4 Rollout gates

- `FIN-01`: shadow identity/attempt ledger and exact fallback/retry fixtures.
- `FIN-02`: usage/price/reconciliation fixtures; provisional totals while
  evidence is incomplete.
- `FIN-03`: concurrency/crash/retry exact-balance tests before any hard scope.
- `FIN-04`: retained as an explicit deferred risk owned by the future feedback
  task; no feedback aggregate or route influence is introduced here.
- `FIN-05`: content-free schema, retention/deletion/export policy, aggregation
  threshold, and leak scans before production capture.

## 5. Stream C: per-surface legacy retirement

Legacy retirement is not one migration flag. Each chat, memory, usage,
route/provider, API, admin UI, credential, or Durable Object surface owns an
independent record and follows:

```text
instrument -> census -> parity -> dual-read/shadow -> stop writes -> observe
-> backup/restore evidence -> disable reads -> observe -> owner approval
-> destructive cleanup in a later production change
```

No recent traffic is not evidence of no callers. The first disable and physical
deletion never ship in the same release. Compatibility shims stay observable,
time-bounded, and non-authoritative. Durable Object migration tags remain
append-only; code rollback does not delete a namespace.

This stream depends on usable restore evidence because transitional stores remain
part of the DR boundary until their own cleanup gate closes `DR-06`.

## 6. Stream D: stable identity and ACL

### 6.1 Identity migration

ACL stays disabled while routing depends on mutable labels. The migration first
creates immutable opaque principals and aliases, then stable owner-independent
conversation resource IDs, migration markers, one-to-one reconciliation, and
resource-derived routing with dual-read compatibility.

This identity foundation may start after the exact legacy identity sources it
migrates have a deployed caller/route handoff. It does not wait for unrelated
legacy read-disable, observation, or destructive-cleanup gates. Any unresolved
source mapping blocks authority for that record, while the independent legacy
retirement stream continues its full observation and cleanup sequence.

### 6.2 Authorization contract

Authorization is server-side at every read, write, stream, search, export, file,
memory, and tool boundary. A share grants only an explicit conversation
resource; root memory, workspace root state, credentials/OAuth, feedback
ownership, exports, and tool trust never follow implicitly.

There is exactly one active owner. Revocation is authoritative before cleanup
and in-flight mutations recheck resource revision at commit. Transfer is an
idempotent revisioned transition, not copy-and-revoke, and cannot ship until an
interrupted-transfer drill proves one resource and one owner.

Owner deletion requires explicit disposition. Exports distinguish owned content
from bounded shared references/snapshots. Tombstones cannot be resurrected by
stale clients, imports, retries, or projections.

### 6.3 Risk gates

- `ACL-01`: rename/reuse isolation and stable resource routing.
- `ACL-02`: interrupted transfer and retry with exactly one owner.
- `ACL-03`: viewer/editor matrix across memory, file, token and export boundaries.
- `ACL-04`: trust invalidation, per-call side-effect confirmation, zero calls
  after revocation, and shared tools denied by default.
- `ACL-05`: owner deletion/export matrix and anti-resurrection tests.

Rollback disables new grants/mutations first and preserves principals, resource
IDs, ACL history, migrated Agent data, and current-owner access while pending
operations reconcile.

## 7. Compatibility and migration policy

- Additive schemas and dual-read compatibility precede any source-of-truth flip.
- A new projection does not become authoritative until exact reconciliation
  passes against the old source on deterministic fixtures.
- Every irreversible step is isolated in a later child or later release with an
  explicit approval and retained rollback evidence.
- Member/browser contracts remain versioned and reject unknown or untrusted
  accounting/authorization fields.
- Existing privacy, deletion, quota, Provider routing, OAuth, Workspace and
  Automatic Skill contracts remain in force throughout the roadmap.

## 8. Operational evidence

Each child retains its work commit, PR URL, exact-head CI, exact-main deployment
when applicable, deterministic acceptance artifacts, validation records, risk
mapping, rollout decision, and rollback result. Production deployment and
acceptance use GitHub Actions only. Docs/Trellis-only commits do not deploy.

The parent closes only after all children are archived and a final cross-stream
audit proves that every `DR-*`, `FIN-*`, and `ACL-*` risk has owning evidence or
an explicitly accepted persistent residual risk.
