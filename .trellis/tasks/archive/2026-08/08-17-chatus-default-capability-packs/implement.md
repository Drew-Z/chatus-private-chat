# Chatus Default Capability Packs Implementation Plan

## Activation Gate

This parent remains `planning`. After the user reviews and approves `prd.md`,
`design.md`, and this plan:

1. Create the five child Trellis tasks in the listed order and link them to this
   parent.
2. Copy each dependency and acceptance subset into that child's `prd.md` and
   `implement.md`.
3. Run `task.py start` only for child 1. Do not start the parent.
4. Complete, check, commit, and archive one child before starting the next.

Inline mode applies throughout: load `trellis-before-dev`, implement in the main
session, then load `trellis-check`. Do not dispatch implement/check sub-agents.

## Child 1: Capability Catalog And Adoption

Proposed slug: `chatus-capability-catalog-adoption`

Dependency: none.

### Deliverables

- Extend capability contracts with origin, activation, disclosure, augmentation
  assignment, and exact public/admin projections.
- Add a code-owned catalog service containing the five instruction-only workflow
  Skills and the setup-required external templates.
- Seed only the low-risk workflow pack in a truly unconfigured default config;
  keep `normalizeAppConfig()` non-injecting for KV/secret configs.
- Add exact catalog preview/install APIs with expected revision, collision
  refusal, atomic validation/write, and bounded admin audit.
- Update admin client decoders and add Catalog installation/preview UI without
  exposing credentials or duplicating canonical instructions.
- Preserve `undefined` versus explicit empty assignment semantics and existing
  automatic selection behavior/three-Skill limit.

### Primary risk files

- `src/contracts/capability.ts`
- `src/services/capability-registry.ts`
- new catalog service under `src/services/`
- `src/worker.ts` config normalization, validation, session/admin projections
- `client/src/lib/api.ts`
- `client/src/lib/admin-config.ts`
- `client/src/components/CapabilityAdminPanel.tsx`
- member assignment helpers/components

### Focused validation

- Registry/catalog/install helper unit tests.
- Worker API tests for default, KV, secret, stale revision, collisions, guests,
  missing assignment, explicit empty assignment, rename/delete, and audit
  secrecy.
- Client exact-decoder and admin conflict-retention tests.
- Workspace/admin browser fixture at desktop and touch 390px.

### Rollback point

Catalog code and endpoints are additive. Remove the default seed and hide the
Catalog view; installed config items remain ordinary revisioned Skills and can
be disabled explicitly. Never auto-delete administrator data.

## Child 2: Auxiliary Vision

Proposed slug: `chatus-auxiliary-vision`

Dependency: child 1 public capability/disclosure and augmentation-assignment
contracts must be merged and green.

### Deliverables

- Add vision-helper config normalization/validation and admin route selection.
- Extend the built-in executor union with request-bound `image_inspect` without
  allowing generic raw-image MCP payloads.
- Add server-derived `native | assisted_tool | assisted_preanswer | none` route
  image mode while preserving native `supportsImages` truth.
- Add `auxiliary_vision` to all closed Provider-attempt/monitoring decoders,
  finance projections, exact tests, and admin labels. Do not edit production
  observation tasks, workflow, collector, gate, or evidence.
- Implement helper-route plan, lease, credential, budget, absolute deadline,
  usage, terminal settlement, and late-result cancellation.
- Implement forced tool path for tool-capable text routes and pre-answer path for
  no-tool text routes in Agent and shared Worker preparation boundaries.
- Add exact bounded evidence decoding and conversation-private persistence needed
  for continuation/history, branch copy, cleanup, export exclusion, and restore.
- Add canonical helper configuration/output/timeout/cancellation errors.

### Primary risk files

- `src/contracts/capability.ts`
- `src/contracts/provider-attempt.ts`
- `src/contracts/agent-error.ts`
- Provider attempt/monitoring contracts and ledger validation
- `src/services/agent-tools.ts`
- `src/services/provider-*`
- `src/worker.ts`
- `src/agent/team-agent.ts`
- image/branch/delete/backup-restore paths

### Focused validation

- Route matrix: native, text+tools, text-only, helper missing, helper disabled,
  helper credential missing, helper fallback, BYOK rejection.
- Fake Provider assertions for exact request counts/run kinds, one quota charge,
  no unsupported image in main requests, usage/cost capture, timeout, cancellation,
  required-ledger failure, and late-result disposal.
- Strict evidence decoder, limits, no URL/reasoning/raw response persistence.
- Agent eviction, branch, edit/resend/regenerate, delete, export, capture/restore,
  and shared ACL denial tests.

### Rollback point

Disable the helper config and public assisted modes. Native image behavior stays
unchanged. Private evidence remains scoped to existing conversations and is
removed by ordinary cleanup; no route or app-config downgrade is required.

## Child 3: Explicit Web Research

Proposed slug: `chatus-web-research`

Dependency: child 1 activation/disclosure/catalog contracts must be merged and
green. It does not depend on auxiliary vision.

### Deliverables

- Install/bind `chatus:web_research` only through reviewed compatible MCP config.
- Add explicit-turn request validation and integrate it with the existing
  three-Skill per-turn limit in automatic and manual modes.
- Add read-only search-tool role validation, member assignment/OAuth readiness,
  review-revision checks, and per-turn explicit approval semantics.
- Invoke search before the main answer for both tool and no-tool selected routes.
- Strictly decode/deduplicate/bound structured sources; attach normalized
  citations to Agent and legacy capability output without Markdown scraping.
- Add canonical denied, timeout, changed, malformed, empty, unavailable, and
  cancellation recovery states; never continue with a false fresh-search claim.

### Primary risk files

- `src/contracts/capability.ts`
- `src/contracts/chat.ts` and Agent UI part contracts
- `src/services/capability-registry.ts`
- `src/services/mcp-runtime.ts`
- `src/services/agent-tools.ts`
- `src/worker.ts`
- `src/agent/team-agent.ts`
- `client/src/lib/api.ts`
- `client/src/components/MessageView.tsx`

### Focused validation

- Fake MCP query, OAuth, drift, approval, timeout, non-text, malformed JSON,
  duplicate/unsafe URLs, oversized, empty, cancellation, and close behavior.
- Fake Provider sees numbered normalized evidence and never sees raw MCP output.
- Exact citation rendering, URL sanitizer, export, retry, draft recovery, and
  no-tool model support.
- Zero live network requests in every test.

### Rollback point

Disable or unbind the search item. The explicit-turn control disappears and
stale requests fail before MCP I/O. Existing generic MCP tools continue to use
their current model-initiated execution path.

## Child 4: Capability Experience And Monitoring

Proposed slug: `chatus-capability-experience-monitoring`

Dependency: children 1, 2, and 3 runtime/public contracts must be merged and
green.

### Deliverables

- Consolidate member capability information architecture in the conversation
  inspector while retaining high-frequency composer controls.
- Show workflow mode/slots, explicit search state, image mode, MCP connection
  readiness, source, and typed latency/cost/privacy disclosures.
- Add assisted-image and web-research progress/error/retry/model-switch states
  with exact decoders and no persisted ephemeral progress.
- Add admin helper/search readiness, assignment, and monitoring summaries.
- First evaluate and document whether the existing model-monitoring aggregate
  can own the complete content-free capability contract without changing
  Provider-attempt semantics; reuse it when it can. Do not store external tool
  calls in the Provider-attempt ledger.
- Add a separate aggregate owner only when reuse cannot satisfy the contract. If
  that owner is a new Durable Object, update bindings, migrations,
  capture/restore, readiness, retention, packaging, and local tests together.

### Primary risk files

- `client/src/components/ChatWorkspace.tsx`
- `client/src/components/ConversationInspector.tsx`
- `client/src/components/MessageView.tsx`
- `client/src/components/CapabilityAdminPanel.tsx`
- `client/src/components/AdminOperationsPanel.tsx`
- `client/src/lib/api.ts`
- React styles and browser fixtures
- Worker monitoring routes and any new Durable Object/capture files
- `wrangler.jsonc` and test environment bindings if a new DO is selected

### Focused validation

- Exact client decoders reject unknown/content/secret fields and inconsistent
  status combinations.
- Keyboard, focus restoration, live-region restraint, accessible names, touch
  targets, reduced motion, and no horizontal overflow.
- Retained browser screenshots at 1920x1080, 1440x900, 780x900, 480x844, and
  touch-enabled 390x844 for ready/setup/running/error states.
- Aggregate privacy scans and stale/unavailable behavior; monitoring failure never
  blocks chat.

### Rollback point

Hide enhanced capability panels and disable the aggregate read/write path. The
runtime catalog, vision, search, current Provider monitoring, and chat routing
remain usable independently.

## Child 5: Integration Hardening And Spec Capture

Proposed slug: `chatus-capability-integration-hardening`

Dependency: children 1-4 complete and individually green.

### Deliverables

- Run a cross-layer matrix covering Agent and applicable transitional Worker chat
  boundaries without modifying any legacy rollout task/gate/evidence.
- Assert per-member revocation races, explicit-empty denial, automatic selection
  quota, auxiliary vision paths, search citations, timeout/cancellation, Provider
  fallback, configuration conflict, offline/draft recovery, branches, deletion,
  export, capture, and restore.
- Inspect content-free logs/monitoring/storage for prohibited identity, prompt,
  image, query, citation body, raw tool result, and credential fields.
- Update the applicable Trellis specs, especially capability assignment,
  multimodal image input, Agent streaming, Provider attempt ledger, model
  monitoring, backup/restore, and frontend quality.
- Run the full ordered quality gate and perform a final diff/spec review against
  every parent acceptance criterion.

### Final validation order

```powershell
npm run check:frontend
npm test
npm run test:browser:workspace
npm run test:browser:agent
npm run typecheck
npx wrangler deploy --dry-run
git diff --check
```

Do not run these concurrently. `check:frontend` rebuilds generated assets that
Worker tests read.

### Protected-boundary verification

Before proposing commits, assert the diff contains no changes under:

- `.trellis/tasks/08-16-chatus-production-release-observation/`
- any `legacy-*-rollout` task or evidence directory
- `.github/workflows/production-model-observation.yml`
- production observation collector/evidence files

Also assert no production deployment command and no live Provider/MCP/OAuth
request was executed during development.

## Planning-Ready Checklist

- [x] Parent PRD is converged and has testable acceptance criteria.
- [x] Technical design covers boundaries, data flow, migration, privacy, and
  rollback.
- [x] Child deliverables and dependencies are explicit.
- [x] Validation uses fake/local services only.
- [x] Protected release/legacy/deployment boundaries are explicit.
- [x] User approved creation and completion of the independent Trellis children
  in this task conversation; this planning review records that activation gate.
- [x] Child tasks are created and child 1 is activated.

## Completion Review

- [x] All five implementation children are checked, committed, and archived.
- [x] Parent AC1-AC12 are mapped to child acceptance records and final integration
  evidence.
- [x] The complete ordered quality gate passed with local fixtures/fakes only.
- [x] Protected production observation, PR #93, legacy rollout, and production
  deployment boundaries remained untouched.
