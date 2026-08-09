# Product direction validation

## Goal

Validate and calibrate the existing Chatus product strategy around a private,
auditable, multi-Provider Agent workspace for trusted small teams. The task
tests product value and near-term priority; it does not replace the approved
general private work-Agent strategy or turn competitor parity into a goal.

The task must produce enough repository-backed and hands-on evidence to decide
which capabilities deserve the next implementation cycle. It must not authorize
new runtime implementation by itself.

## Primary Audience And Product Thesis

The first validated product cycle targets a self-hosting owner and a trusted
team of 2-10 members. The owner needs to make several model Providers, files,
Skills, and reviewed MCP tools safely usable by the team without operating a
large AI platform. Members need to complete recurring work while understanding
what the Agent can access, which logical model they selected, whether fallback
occurred, and how to recover a failed run.

The working product thesis is:

> Chatus is a private, auditable, multi-Provider Agent workspace that lets a
> small trusted team use models, files, Skills, and MCP tools through clear
> permission and recovery boundaries.

This audience choice keeps member identity, per-member policy, Provider
governance, auditability, and minimal resource sharing relevant. It does not
justify enterprise SSO, organization-wide RBAC, subscription/payment systems,
or large multi-node operations in the first cycle.

## Strategy Continuity Decision

- Preserve the approved product boundary: a general private work Agent for
  trusted teammates, with programming and project collaboration as the first
  bundled capability pack and an optional restricted guest entry.
- Preserve the Cloudflare-native runtime, per-member isolation, administrator
  capability assignment, Provider governance, passive reliability, recovery,
  and GitHub-Actions-only production delivery decisions.
- Treat the 2-10-member audience as the first validation cohort, not as a new
  hard platform limit.
- Treat this task as a product-value review and priority-calibration gate. It
  does not cancel, pause, start, or rewrite the existing legacy and ACL tasks.
- Any later recommendation to defer, change, or stop an approved roadmap stream
  requires explicit review and approval after evidence is available.
- Preserve the optional restricted guest entry as a compatibility surface. The
  validation cycle covers its existing security and regression contracts but
  does not add guest features or use guests in the three primary workflows.

## Background And Confirmed Facts

- Chatus is currently a Cloudflare-native web Agent for trusted members with an
  optional constrained guest entry. It does not expose a public
  OpenAI-compatible proxy.
- The existing product already has substantial foundations in Provider pooling,
  logical models and offerings, bounded fallback, per-member Durable Objects,
  resumable conversations, secret-safe telemetry, member administration,
  files, Skills, MCP, recovery, and destructive-state protection.
- The current roadmap contains separately gated legacy-surface retirement and
  ACL programs. Those plans are valid governance work but do not, by themselves,
  prove that the daily product is valuable or understandable.
- LobeHub is most useful as a product and interaction reference for Agent,
  Project, Workspace, Skill, memory, schedule, and run-status concepts. Its
  current community license means code must not be treated as generally MIT and
  copied without file-level license review.
- DEEIX-Chat is most useful as an architecture and administration reference for
  Provider/Model/Route separation, runtime configuration, file/RAG/MCP
  information architecture, request correlation, usage, and audit. It is Apache
  2.0, but its Go/PostgreSQL/Redis deployment and enterprise billing breadth are
  not Chatus requirements.
- Open WebUI, LibreChat, and Dify provide secondary references for self-hosting,
  RBAC, chat/file UX, Provider setup, and visual capability composition. They do
  not define the intended Chatus scope.
- Production deployment and production acceptance may run only through GitHub
  Actions. Validation must use local deterministic fake Provider/MCP services;
  live model calls, synthetic probes, and local production deployment are
  prohibited.
- The existing `test:browser:agent` harness runs a real local Worker against a
  generated-secret fake Provider and already covers progressive/single-chunk
  output, reconnect, cancellation, memory approval, attachments, and durable
  branching. Workspace Playwright and Vitest separately cover file workspace,
  document ingestion, Automatic Skill, and OAuth MCP contracts.
- Existing checks are strong feature contracts but do not yet form three
  repeatable product-level journeys from owner configuration to a useful member
  outcome with one shared evidence rubric.

## Requirements

### R1. Product thesis and audience

- Use a self-hosting owner plus 2-10 trusted members as the primary audience;
  define the problems Chatus solves for that audience and explicit non-goals.
- Compare the proposed thesis against the current README and current roadmap;
  identify contradictions without silently rewriting or cancelling approved
  tasks.
- Preserve the approved general private work-Agent strategy; use the target
  audience and workflows to calibrate sequencing rather than redefine the
  runtime as a single-purpose product.
- Express the differentiator in user-observable terms rather than as an
  infrastructure inventory.

### R2. Reference-project adoption map

- Record the capabilities worth adopting from LobeHub, DEEIX-Chat, Open WebUI,
  LibreChat, and Dify.
- Classify every candidate as `adopt now`, `adapt later`, or `do not pursue`,
  with a reason tied to the product thesis.
- Separate product-pattern reuse from source-code reuse and record license risks.

### R3. Three representative workflow evaluations

- Evaluate a programming/project-collaboration workflow.
- Evaluate a file-backed analysis workflow.
- Evaluate an operations workflow that uses a Skill or reviewed MCP server.
- Each workflow must start from an administrator or member-visible entry point,
  end in a useful recoverable result, and record setup friction, Provider/model
  clarity, failure handling, permissions, progress visibility, and traceability.
- Run all three primary workflows as authenticated members. Restricted guest
  access receives compatibility/security regression coverage only.
- Evaluation scripts must be deterministic enough to repeat after later changes
  and must not depend on live external models or MCP servers.
- Reuse the existing local Agent, workspace fixture, and fake service harnesses;
  do not create a second product runtime merely for validation.
- Codex acts as the hands-on acceptance operator. It follows the visible owner
  and member sequence rather than calling internal APIs to bypass product steps,
  except for bounded read-only evidence capture that the UI cannot expose.
- Run the owner sequence first, then use a separately authenticated member
  session for the three workflows. Record screenshots, visible labels, elapsed
  time, request/run identifiers, recovery actions, and operator observations.
- Use synthetic accounts, files, prompts, Provider responses, and MCP data only.
  Never place maintainer credentials, production content, or stored memories in
  validation artifacts.

### R4. Measurable decision gates

- Measure whether a new instance can reach a usable member workflow within five
  minutes after required infrastructure bindings exist.
- Determine whether a member can understand the logical model choice and the
  selected/fallback Provider outcome from one run without learning internal
  configuration structures.
- Determine whether Provider failure, file-processing failure, and tool approval
  have visible, recoverable outcomes with a request/run identifier.
- Determine whether file, memory, Skill, MCP, and side-effect boundaries are
  clear and default-safe for the target audience.
- Convert findings into a short `continue`, `change`, or `stop` decision for each
  major roadmap stream, with evidence and an owner-visible rationale.

### R5. Roadmap consequence

- Produce a prioritized near-term roadmap containing no more than three product
  outcomes for the next cycle.
- Existing legacy and ACL tasks remain approved and unchanged while this task
  collects evidence. This task cannot pause, start, cancel, or rewrite them.
- A later `continue`, `change`, or `stop` recommendation is advisory until the
  user explicitly approves the corresponding roadmap change. Deferral is a
  scheduling decision, not deletion of Trellis evidence.
- Do not introduce marketplace, broad multi-Agent orchestration, public API
  proxying, enterprise subscription/payment, or heavy infrastructure merely to
  match another project.

### R6. Finding and defect handling

- Complete all three baselines before proposing ordinary fixes so the first
  visible defect does not consume the direction review.
- Stop the validation run only for a security boundary violation, data loss or
  corruption, secret exposure, or a blocker that makes the remaining sequence
  impossible.
- Record other findings with severity, exact step, expected/actual outcome,
  screenshot or request/run evidence, reproduction notes, and affected roadmap
  stream.
- Runtime fixes are not part of this task. After the final review, create a
  separately approved Trellis task for each independently verifiable fix or
  outcome group.

## Acceptance Criteria

- [x] AC1. One primary audience and one concise product thesis are approved,
      including explicit non-goals and the reason Chatus should exist alongside
      LobeHub, DEEIX-Chat, Open WebUI, LibreChat, and Dify.
- [x] AC2. A source-linked adoption map classifies the relevant capabilities of
      all five reference projects and records code-license constraints.
- [x] AC3. Three repeatable workflow evaluation scripts and evidence templates
      cover setup, model/Provider clarity, failure recovery, permission
      boundaries, progress, and traceability without live external calls.
- [x] AC4. Baseline evidence is captured for all three workflows against one
      exact commit and the current local fake Provider/MCP environment by Codex
      following the owner-to-member human acceptance order.
- [x] AC5. Findings produce no more than three prioritized next-cycle outcomes
      plus explicit `continue`, `change`, or `stop` recommendations for legacy
      cleanup, ACL, Provider governance, file ingestion, Skill/MCP, and broader
      platform work; recommendations do not alter approved tasks without a
      separate explicit decision.
- [x] AC6. The resulting recommendation identifies which README/product wording
      and Trellis roadmap artifacts would need a later, separately reviewed
      update; this task does not rewrite them implicitly.
- [x] AC7. Planning includes validation, rollback, evidence retention, and a
      clear review gate before any implementation task is started.
- [x] AC8. Every observed defect is either a documented non-blocking finding or
      a recorded stop condition; no unreviewed runtime fix is folded into the
      validation task.

## Out Of Scope

- Implementing new runtime features or UI during the planning phase.
- Copying source from reference projects without a separate technical and
  license review.
- Benchmarking model answer quality through live Provider traffic.
- Cancelling, deleting, starting, or materially rewriting the existing legacy
  and ACL task trees before the product decision is reviewed.
- Committing to a public marketplace, public API proxy, broad enterprise billing,
  Agent Groups, or a new database/deployment architecture.
- Expanding, repositioning, or removing the restricted guest entry.
- Fixing runtime or UI defects discovered by the baseline. Those fixes require
  separately approved follow-up tasks.
