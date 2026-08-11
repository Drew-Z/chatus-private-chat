# Future Product Governance Decision Gates

## 1. Scope / Trigger

Use this contract when planning or implementing member sharing/transfer/ACL, Provider usage/cost/budget/feedback accounting, full-instance backup/restore, RPO/RTO commitments, or destructive legacy retirement.

Provider attempt identity, normalized usage, immutable price bindings, append-only
cost evidence, and bounded reconciliation summaries are now supported for
administrator operations. Stable principal/resource identity plus conversation
viewer/editor sharing and authoritative revocation are also supported. Ownership
transfer, owner deletion disposition, shared files/tools/export, hard budget
enforcement, finance feedback receipts, numeric RPO/RTO, and destructive legacy
retirement remain unimplemented. The legacy-surface registry and evidence control
plane are supported, but all initial records remain `discovered`.
Design records under `.trellis/tasks/07-27-q3-followup-design-decisions/research/`
establish future gates but do not by themselves create a supported API, schema,
workflow, or operating claim for those deferred capabilities.

## 2. Signatures And Current Decision Records

Conversation sharing/revocation runtime contracts are documented in
`conversation-acl.md`; this file continues to govern the deferred transfer,
owner-deletion, shared-file/tool/export, hard-budget, finance-feedback, numeric
RPO/RTO, and destructive-cleanup capabilities. The non-destructive retirement
control-plane signatures are documented in `legacy-surface-governance.md`;
their presence does not authorize instrumentation, disablement, or cleanup.
Provider finance v2 signatures are documented in `provider-attempt-ledger.md`;
a future deferred-capability task must define its own versioned signatures after
satisfying the gates below.

- `member-sharing-acl-design.md`: stable principal/resource identity, role/action policy, transfer, revoke, deletion, memory, trust, and export boundaries.
- `provider-usage-cost-budget-feedback-design.md`: turn/run/attempt identity, evidence classes, price versions, reserve/settle/reconcile, feedback receipts, and privacy.
- `instance-recovery-legacy-retirement-design.md`: state inventory, consistency, key custody, restore order/drills, RPO/RTO measurement, and per-surface retirement gates.
- `risk-register.md`: durable risk IDs, owners, review gates, and required acceptance evidence.

Future tasks must copy the relevant decision and risk IDs into their PRD rather than relying on a link alone.

## 3. Contracts

### Cross-domain Invariants

### Member Sharing And Transfer

- Introduce an immutable principal identity before a mutable member label can participate in ACL or transfer.
- Share explicit conversation resources, not a member root. Root memory, credentials, OAuth tokens, workspace root state, feedback ownership, exports, and capability trust do not follow a share implicitly.
- The supported v1 share roles are viewer plus bounded editor. Every effective ACL
  change advances one resource access revision; active shared mutations commit
  only after revalidating the exact actor/resource/grant snapshot.
- A shareable resource has exactly one owner. Transfer is an idempotent, revisioned ownership transition, not copy-and-revoke.
- Revocation becomes authoritative before cleanup/cache invalidation, and in-flight mutations recheck the resource revision at commit.
- Owner deletion requires an explicit disposition for each owned resource. Never elect an owner implicitly.

### Provider Usage, Cost, Budget, And Feedback

- Keep user turn, logical run, and physical Provider attempt identities distinct. Actual Provider/offering/model attribution is generated server-side at the execution boundary.
- The v2 Provider attempt ledger is authoritative for exact call identity plus
  content-free usage/price/cost/reconciliation evidence. A lingering `started`
  record after terminal-RPC failure is incomplete evidence. Unknown usage never
  means zero; hard budget reservation/settlement and finance feedback receipts
  remain deferred.
- Provider-reported, estimated, invoice-reconciled, corrected, and unknown usage are distinct evidence. Unknown never means zero.
- Every monetary amount has currency, precision, immutable price-catalog version, and provenance. Corrections append reversing/replacement evidence.
- Hard budgets require idempotent reserve, settle/release, and reconcile semantics before any Provider call. Fallback and tool loops cannot bypass them.
- Feedback requires a server-issued receipt bound to the current principal and final answer. Browser-supplied route/provider attribution is not authoritative.

### Full-instance Recovery And RPO/RTO

- User export/import and code rollback are not full-instance recovery.
- Full-instance recovery remains unsupported until a versioned encrypted manifest, one consistency protocol, external key custody, stable object mapping, idempotent restore order, reconciliation, and a retained restore drill all exist.
- The first implementation should prefer an explicit stop-write capture boundary unless a global epoch/changelog can prove online consistency across KV, R2, Queue, and every Durable Object.
- The internal stop-write capture primitive closes only capture-integrity evidence for `DR-01`, `DR-02`, and `DR-04`: one epoch, externally keyed encryption, durable-fence admission, explicit Queue regeneration evidence, and fail-closed inventory/reference validation. It does not close archive transport, restore mapping/order, reconciliation, cutover, drill, RPO, or RTO gates.
- Cloudflare cannot enumerate historical dormant Durable Object identities. A complete capture therefore requires an operator-owned external object inventory whose bounded evidence ID and digest are retained; a registry made only from objects that happened to awaken is incomplete.
- Sessions, leases, PKCE state, and other declared ephemeral data are explicit exclusions; missing state is never inferred after restore.
- Do not publish numeric RPO/RTO until a capture schedule and repeated representative restore drills measure them.

### Legacy Retirement

- `DR-06` is mitigated only at the shared control-plane layer: the code-owned
  manifest, per-surface phase ceiling, append-only evidence, independent rollback,
  bounded census RPC, admin projection, and capture/restore boundary now exist.
  No initial surface has an assigned owner, caller census, parity proof,
  observation, recovery proof, read/write disablement, or cleanup approval, so
  `DR-06` remains open for every surface.
- Retire each surface independently through census, parity, backup/restore evidence, rollback rehearsal, observation, owner approval, and only then destructive cleanup.
- Absence of recent logs does not prove absence of callers.
- Do not remove a legacy source in the same release that first disables it.
- Applied Durable Object migration tags remain append-only, and storage namespaces are never deleted as a code rollback step.

### Required Future Planning Artifacts

Every implementation task must include:

1. Current code/storage evidence with exact paths and symbols.
2. Exact API/data/state-machine contracts and ownership boundaries.
3. Migration, compatibility, rollback, and partial-failure behavior.
4. Privacy, deletion, export, and secret-handling policy.
5. Local deterministic tests; no live Provider/MCP, local production deployment, or synthetic production probe.
6. Applicable risk IDs and the executable evidence that closes or downgrades them.
7. An explicit statement of unsupported behavior that remains after the task.

## 4. Validation And Error Matrix

| Proposal condition | Required result |
| --- | --- |
| ACL uses mutable label as durable principal/resource identity | Reject planning; introduce stable identity first |
| Share implicitly exposes memory, trust, credentials, or unrelated files | Reject the capability boundary |
| Transfer can leave two/no owners after retry | Keep transfer unsupported |
| Cost source or price is missing | Store unknown/provisional; never report zero/actual |
| Reconciliation repeats a fingerprint with an older timestamp or changed identity | Reject the revision; preserve the append-only chain |
| Raw invoice, credential, prompt, completion, or Provider response is supplied | Reject and retain only the bounded fingerprint/summary |
| Hard budget lacks atomic idempotent reservation | Do not enforce or call it a hard budget |
| Feedback trusts browser Provider attribution | Reject the attribution design |
| Backup lacks consistency, key, mapping, reconciliation, or drill | Keep full-instance recovery unsupported |
| Capture baseline has no external historical Durable Object inventory evidence | Reject capture readiness; do not infer completeness from the runtime registry |
| RPO/RTO has no measured schedule/drill evidence | Do not publish the number |
| Legacy cleanup lacks per-surface rollback/observation evidence | Do not delete the surface or data |
| A shared registry exists but a surface is still capped at `discovered` | Treat the surface as fully active and `DR-06` as open |

## 5. Good / Base / Bad Cases

- Good: the supported sharing path resolves stable resources, keeps owner
  memory/trust private, and proves revoke races locally; a future transfer task
  separately proves exactly-one-owner transition and deletion disposition.
- Good: a cost task records every fallback attempt with evidence class and price version before enabling an idempotent budget reservation.
- Good: a recovery task restores an isolated target from a consistent encrypted manifest, reconciles it, and retains exact drill evidence before making an availability claim.
- Good: a legacy rollout versions one exact manifest record, wires and tests all
  declared callers, and advances only that record while the other surfaces remain
  independent.
- Base: the current system continues without these capabilities while the design/risk records remain reviewable.
- Bad: add an `ownerLabel`, token counter, cron export, or delete-old-data command and claim the corresponding product problem is solved.

## 6. Tests Required

The deferred portions of this contract require no runtime test. Conversation ACL
runtime behavior follows `conversation-acl.md`, and Provider finance runtime
behavior follows `provider-attempt-ledger.md`; future design-only deliveries must prove:

- only Trellis/spec/docs paths changed;
- every decision document contains current evidence, invariants, options/recommendation, migration/rollback, acceptance scenarios, open decisions, and linked risks;
- the consolidated risk register contains asset, trigger, failure mode, severity/likelihood, invariant, detection, mitigation, rollback, acceptance evidence, owner, and review date;
- the full project gate remains green or is reused from the exact current `main` SHA with retained GitHub Actions evidence;
- documentation/Trellis-only merge commits skip Worker deployment and retain path-classification evidence.

Future runtime tasks must add tests proportional to the affected cross-store and security boundaries.

## 7. Wrong vs Correct

### Wrong

```text
Add ownerLabel to conversations, add token totals to reliability KV, and schedule
an export cron. Mark transfer/shared tools, cost budgets, and full-instance recovery supported.
```

These local fields do not establish stable identity, attempt attribution, atomic budget settlement, multi-store consistency, key custody, or restore evidence.

### Correct

```text
Keep the deferred capability unsupported. Create a future Trellis task that
carries the relevant risk IDs, defines versioned cross-layer contracts, proves
migration and rollback, passes local deterministic acceptance, and only then
updates its support claim.
```

Support status follows executable evidence, not the presence of a design or one storage field.
