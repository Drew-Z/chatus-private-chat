# Post-hardening roadmap

## Goal

Turn the three approved Q3 follow-up designs into an ordered, independently
verifiable delivery roadmap without weakening the hardening baseline already in
production. The roadmap starts with recoverability, then adds accountable
Provider governance, retires proven-obsolete legacy surfaces, and only then
introduces member sharing and ACLs.

Today, full-instance recovery, durable Provider cost/budget accounting, legacy
surface retirement, and member sharing/transfer/ACL are design-only or
unsupported capabilities. This task plans their delivery; it does not itself
authorize implementation.

## Confirmed Product Decisions

- The first implementation candidate is an offline, stop-write full-instance
  recovery MVP. A planned maintenance window is acceptable.
- The recovery MVP must produce an encrypted manifest, preserve stable identity
  mappings, restore into an isolated target, and complete at least one local or
  non-production drill before any production recovery claim is made.
- Numeric RPO/RTO commitments remain out of scope until repeated restore drills
  provide measured evidence.
- The roadmap preserves all decisions and risks already recorded as `DR-01` to
  `DR-06`, `FIN-01` to `FIN-05`, and `ACL-01` to `ACL-05`.
- All implementation work will use the repository's PR and GitHub Actions gates.
  Production deployment and production acceptance may run only through GitHub
  Actions.
- Tests may use only local fake Provider/MCP implementations and deterministic
  fixtures. Live model/MCP/OAuth calls, synthetic model probes, and local
  production deployment are prohibited.
- Chatus remains on 0.x SemVer while these streams are delivered.
- Member feedback capture, Provider quality scoring, feedback aggregation, and
  feedback-based routing are deferred to a separately approved future task after
  durable usage/cost/budget accounting is operational.

## Roadmap Requirements

### R1. Full-instance backup, restore, and disaster-recovery readiness

- Establish an offline stop-write capture boundary that covers all authoritative
  instance state and rejects or safely drains writes during capture.
- Define a versioned, integrity-protected, encrypted backup manifest with stable
  identity mapping and explicit inventory for D1/SQLite, R2, KV, Durable Object,
  configuration, and secret-reference state as applicable.
- Restore only into an isolated target until validation completes; restoration
  must never silently overwrite a live instance.
- Provide deterministic preflight, capture, restore, integrity verification,
  reconciliation, and cleanup/rollback phases with persistent audit evidence.
- Complete repeated non-production drills before proposing numeric RPO/RTO or a
  production recovery runbook.

### R2. Provider usage, cost, budget, and capacity observability

- Introduce distinct durable identifiers for user turns, logical runs, and
  Provider attempts.
- Record Provider usage and cost in an append-only ledger with source,
  attribution, pricing version, and reconciliation state. Missing usage is
  represented as unknown, never as zero.
- Add capacity and spend views that distinguish request counts, tokens, latency,
  failures, retries, unknown usage, estimated cost, and settled cost.
- A hard budget may block a Provider call only after atomic, idempotent
  reserve/settle/release/reconcile semantics are implemented and verified.
- Budget and observability failures must fail safely without double charging,
  silently losing usage, or counting one user message quota more than once.
- Bound sequential Provider fallback with one pre-visible logical-run deadline,
  show secret-free request-scoped progress, and correlate failures through
  passive real-task evidence without active probes.

### R3. Legacy chat, API, and storage retirement

- Inventory each legacy surface and identify its owner, callers, authoritative
  data, replacement, parity evidence, rollback route, and deletion impact.
- Retire surfaces independently; no umbrella "legacy cleanup" may bypass a
  surface-specific gate.
- Each retirement requires census, replacement parity, backup/restore drill,
  rollback rehearsal, observation window, and explicit approval before
  destructive cleanup.
- Compatibility shims must be time-bounded, observable, and removable; they may
  not become a new source of truth.

### R4. Member sharing, transfer, and ACL

- Do not add sharing or transfer until immutable opaque principal IDs and stable
  conversation resource IDs exist and have migration/compatibility coverage.
- Define owner/member/recipient semantics, explicit permissions, revocation,
  transfer invariants, deleted/disabled-principal behavior, and auditable
  authorization decisions.
- Enforce authorization server-side for every read, write, export, tool, file,
  search, memory, and streaming path; client visibility is not an access-control
  boundary.
- Sharing must not expose Provider credentials, OAuth tokens, hidden system
  prompts, private memories, or files outside the granted resource boundary.

### R5. Parent and child delivery model

- This parent task owns the source requirements, ordered task map, cross-stream
  constraints, and final integration audit.
- Delivery work is split into independently reviewable child tasks with their own
  PRD, design, implementation plan, verification evidence, work commit, spec
  update, and archive gate.
- The required order is recovery foundations and drill, Provider accounting and
  budget foundations, legacy retirement, then ACL foundations and sharing.
- A later child may start only when the prerequisites named in its own plan have
  verifiable evidence; parent/child linkage alone does not imply dependency.

## Cross-stream Constraints

- All code changes go through PRs. Documentation and Trellis-only records may be
  committed directly under the existing repository policy.
- Required shipping checks remain `npm run check:frontend`, `npm test`,
  `npm run typecheck`, `npx wrangler deploy --dry-run`, and `git diff --check`,
  plus impact-path Workspace Playwright and local fake Provider/MCP tests.
- Main-branch deployment must remain traceable to a commit SHA and retain its
  artifacts; docs/Trellis-only changes must not trigger production deployment.
- Backups, ledgers, ACL audit records, and retirement evidence must not contain
  plaintext secrets, tokens, conversation content, or stored memories unless the
  owning encrypted data contract explicitly requires and protects that payload.
- Rollout must be additive and reversible until each stream's destructive gate
  is explicitly satisfied.

## Acceptance Criteria

- [ ] `design.md` maps all four streams to existing decisions and risk IDs and
      defines their boundaries, dependencies, rollout gates, and rollback shape.
- [ ] `implement.md` provides an ordered, independently verifiable child-task map
      with validation commands, approval gates, and rollback points.
- [ ] The recovery plan explicitly uses the approved offline stop-write MVP and
      defers numeric RPO/RTO until measured drills exist.
- [ ] The Provider plan preserves run/attempt identity, append-only accounting,
      unknown-usage semantics, and atomic budget reservation requirements.
- [ ] The legacy plan requires a per-surface census-to-cleanup gate and forbids
      destructive removal before backup and rollback evidence exists.
- [ ] The ACL plan blocks sharing/transfer on stable opaque principal and
      resource identities and covers every server-side access path.
- [ ] Every child has testable acceptance criteria and can be checked, committed,
      and archived independently.
- [ ] Planning artifacts contain no live credentials, Provider/MCP calls,
      production deployment steps, or unmeasured availability promises.
- [ ] The final parent review can trace each `DR-*`, `FIN-*`, and `ACL-*` risk to
      an owning child, mitigation evidence, or an explicitly accepted residual
      risk.

## Out of Scope

- Implementing any roadmap item in this planning task.
- Online or zero-downtime consistent backup based on a new global epoch/changelog.
- Publishing numeric RPO/RTO before repeated restore-drill measurements.
- Live Provider, MCP, OAuth, or production tests outside GitHub Actions.
- Destructive legacy data deletion before all retirement gates pass.
- Broad external/anonymous sharing, organization-wide RBAC, or public links in
  the first ACL delivery.
