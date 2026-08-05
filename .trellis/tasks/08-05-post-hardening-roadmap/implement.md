# Post-hardening roadmap implementation plan

## Planning gate

- [x] Create the parent Trellis task and keep it in `planning`.
- [x] Confirm the first implementation candidate is the offline stop-write
      recovery MVP with no premature numeric RPO/RTO commitment.
- [x] Map the approved `DR-*`, `FIN-*`, and `ACL-*` contracts into the parent
      PRD and design.
- [x] Resolve whether Provider feedback is part of this roadmap or a later
      independently approved program.
- [x] Run the PRD convergence pass; the final artifacts are ready for explicit
      user review.
- [x] Obtain explicit user review of `prd.md`, `design.md`, and `implement.md`;
      the user approved proceeding with the first child task.
- [x] Create the agreed child tasks. Keep every child in `planning` until its
      own artifacts are reviewed and implementation is separately approved.

## Child-task map

The ten children below are created and linked. All remain `planning`; the first
child to review for implementation is the recovery manifest/capture task.

### 1. `dr-manifest-maintenance-capture`

- [ ] Inventory authoritative, transitional, reconstructable, and excluded
      instance state in a machine-verifiable versioned manifest contract.
- [ ] Implement revisioned maintenance/stop-write coordination, Queue drain,
      active-operation fences, single capture epoch, encrypted archive output,
      counts/checksums, and secret-safe evidence.
- [ ] Verify unresolved cross-store references, unsafe active work, wrong keys,
      or incomplete inventory prevent a backup claim.
- Risks: `DR-01`, `DR-02`, `DR-04` foundations.
- Rollback: exit maintenance without publishing an archive; preserve source.

### 2. `dr-isolated-restore-drill`

- [ ] Implement stable principal/root/conversation/object mapping and exact
      isolated-target preflight.
- [ ] Implement checkpointed idempotent restore in the approved store order,
      Queue/outbox regeneration, reconciliation, isolation and deletion tests.
- [ ] Retain an exact-SHA local/non-production drill artifact and keep the
      recovery capability unsupported until all required evidence passes.
- [ ] Record repeated phase timing/loss measurements; leave RPO/RTO unpublished.
- Depends on child 1. Risks: `DR-01` through `DR-05`.
- Rollback: keep target isolated and retry/discard it; never mix source/target.

### 3. `provider-attempt-shadow-ledger`

- [ ] Add server-issued turn/run/attempt identities and operation fences at all
      Provider execution boundaries, including Skill selection, retry, fallback,
      and tool continuation.
- [ ] Append content-free shadow attempt evidence without costs or enforcement.
- [ ] Reconcile deterministic multi-Provider/fallback fixtures with existing
      quota and telemetry semantics.
- Risks: `FIN-01` and the schema boundary of `FIN-05`.
- Rollback: disable projections; retain append-only shadow evidence.

### 4. `provider-cost-reconciliation-capacity`

- [ ] Normalize reported/estimated/unknown/late/corrected usage.
- [ ] Add immutable effective-dated price evidence and append-only corrections.
- [ ] Add secret-safe reconciliation imports and capacity/spend projections that
      expose unknown, provisional, corrected, retry and fallback state.
- [ ] Define retention, deletion, export and aggregation privacy contracts before
      production capture.
- Depends on child 3. Risks: `FIN-02`, `FIN-05`.
- Rollback: hide projections/imports while preserving encrypted source evidence.

### 5. `provider-budget-engine-enforcement`

- [ ] Implement atomic idempotent reserve/settle/release/reconcile events,
      conservative unknown holds, crash recovery and operator reconciliation.
- [ ] Start in shadow/alert mode; enable only an explicitly approved scope after
      concurrency, retry, fallback and settlement-outage exact-balance tests.
- [ ] Prove a denied reservation makes zero Provider calls.
- Depends on children 3 and 4. Risk: `FIN-03`.
- Rollback: disable enforcement and new reservations; preserve balances/history.

### 6. `legacy-surface-disable-observation`

- [ ] Create one record per legacy surface with caller/data census, owner,
      replacement parity, dual-read/shadow evidence, stop-write result,
      observation window, backup/restore proof and rollback rehearsal.
- [ ] Disable reads only after its own gate passes; make no destructive deletion.
- Depends on child 2 and each replacement's parity. Risk: `DR-06`.
- Rollback: re-enable the untouched legacy read path and reconcile divergence.

### 7. `legacy-surface-destructive-cleanup`

- [ ] Treat each physical deletion as a separate approved production change
      after the disable observation period.
- [ ] Verify restore/rollback evidence, final no-caller census, owner approval,
      exact-main deployment and post-cleanup acceptance for every surface.
- Depends on child 6. Risk: `DR-06` closure per surface.
- Rollback: restore from the proven archive or forward-repair; Durable Object
      migration history remains append-only.

### 8. `acl-stable-principal-resource-identity`

- [ ] Add immutable principal IDs and alias mappings without changing Agent
      identity prematurely.
- [ ] Backfill stable conversation resource/owner IDs, migration markers and
      one-to-one reconciliation.
- [ ] Add resource-derived routing with dual-read compatibility; keep ACL off
      until exact projection parity passes.
- Depends on legacy identity-source census where applicable. Risk: `ACL-01`.
- Rollback: disable new routing while preserving stable IDs and current owners.

### 9. `acl-sharing-revocation`

- [ ] Implement owner/viewer and then editor grants with revisioned server-side
      authorization at every data and execution boundary.
- [ ] Make revocation authoritative before cleanup and recheck revision at
      mutation commit; keep shared tools/files default-denied until approved.
- [ ] Verify undiscoverability, cross-principal isolation and revoke-vs-write
      races.
- Depends on child 8. Risks: `ACL-03`, partial `ACL-04`.
- Rollback: stop new grants/mutations, revoke shared execution, preserve history.

### 10. `acl-transfer-deletion-export-tools`

- [ ] Implement idempotent revisioned transfer with interrupted-operation
      recovery, one-owner invariant and trust invalidation.
- [ ] Implement explicit owner-deletion disposition, non-owner cleanup,
      tombstones, bounded export semantics and anti-resurrection behavior.
- [ ] Enable file/read-only/side-effect tool policies only after their explicit
      permission matrix and per-call confirmation tests pass.
- Depends on child 9. Risks: `ACL-02`, `ACL-04`, `ACL-05`.
- Rollback: freeze transfer/tools, retain current owner and tombstones, reconcile.

## Per-child workflow

For every child, in dependency order:

1. Complete `trellis-before-dev` and copy exact risk/decision requirements into
   the child PRD/design/implementation plan.
2. Implement inline; do not dispatch implement/check subagents.
3. Run `trellis-check`, focused deterministic tests, and the full shipping gate.
4. Update affected `.trellis/spec/` contracts and append risk evidence.
5. Commit intentionally, push a `codex/` branch, open a PR, and retain exact-head
   CI artifacts plus impact-path Workspace Playwright/fake Provider/MCP evidence.
6. After merge, record exact-main GitHub Actions deployment/acceptance when the
   change is deployable. Docs/Trellis-only work must skip deployment.
7. Record work commit, PR, validations and any persistent waiver; verify all AC;
   archive the child only after repository-wide consistency validation passes.

## Required validation baseline

```powershell
npm run check:frontend
npm test
npm run typecheck
npx wrangler deploy --dry-run
git diff --check
python ./.trellis/scripts/task.py validate-all
```

Add impact-path Workspace Playwright and local fake Provider/MCP suites for the
owning child. Do not run live Provider/MCP/OAuth tests, synthetic model probes,
or local production deployment.

## Parent completion gate

- [ ] All agreed children are archived with checked AC, validation records,
      work commit, PR evidence, spec updates, and persisted waivers if any.
- [ ] Run a final cross-stream privacy, deletion, identity, rollback, quota,
      accounting and compatibility audit on the final `main` SHA.
- [ ] Trace every `DR-*`, `FIN-*`, and `ACL-*` entry to child evidence or an
      explicitly accepted residual risk with owner and review trigger.
- [ ] Run the full validation baseline and repository consistency check.
- [ ] Record the final deployable SHA and GitHub Actions acceptance artifacts,
      then archive this parent task and update the developer journal.
