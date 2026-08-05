# DR manifest and maintenance capture implementation plan

- [x] Run `trellis-before-dev`; inspect all current storage, Queue, operation
      fence, deletion and deployment specs and copy exact owning paths/symbols
      into this plan before editing.
- [x] Add versioned manifest/entry/maintenance contracts with strict parsing,
      unknown-key rejection, bounds, and deterministic serialization.
- [x] Implement the revisioned maintenance coordinator and enforce it at all
      member/admin mutation and Provider execution boundaries.
- [x] Add Queue pause/drain and active-operation fence registration/reporting.
- [x] Implement store-owned capture adapters, one-epoch generation checks,
      encrypted object output, checksums and atomic manifest sealing.
- [x] Add cleanup/resume behavior for every partial failure phase.
- [x] Build deterministic local fixtures for all state classes, concurrent work,
      wrong/lost keys, tamper, orphan references and Queue/DLQ states.
- [x] Run `trellis-check`, focused tests, impact-path Workspace Playwright/local
      fake Provider tests, and the full validation baseline from the parent.
- [x] Update backup/recovery, security, Queue and delivery specs; append `DR-01`,
      `DR-02`, and `DR-04` evidence without declaring restore support.
- [x] Commit, open a PR, retain exact-head CI and exact-main GitHub Actions
      evidence when deployable, record work commit/validations, then archive.

## Rollback Point

Before manifest sealing, invalidate the operation, remove only incomplete archive
objects, release maintenance after fence reconciliation, and leave source state
unchanged. After sealing, disable capture entry points while retaining evidence.

## Current Code Map And Blocking Evidence

- Runtime bindings are owned by `Env` in `src/worker.ts`: `CHAT_STORE`,
  `WORKSPACE_FILES`, `DOCUMENT_INGEST`, `USER_STATE`, `TEAM_AGENT`, and
  `PROVIDER_COORDINATOR`.
- `UserState` creates its SQLite tables in the constructor in `src/worker.ts` but
  has no explicit schema migration/version record; capture must not infer one.
- `TeamAgent.applySchemaMigrations()` in `src/agent/team-agent.ts` owns app tables
  through migration 6, while Agents SDK `cf_*` tables remain an additional
  explicit inventory concern.
- Workspace R2 source/extracted object references and generations live in
  `workspace_file_versions` and `workspace_file_operations`; no current global R2
  inventory proves the absence of orphan objects.
- Queue/DLQ dispatch is owned by `handleDocumentIngestBatch()` in
  `src/worker.ts`. Cloudflare does not expose an application-level enumeration of
  in-flight Queue bodies, so maintenance must pause consumers/producers and rely
  on durable ingest generation/outbox/DLQ evidence rather than claim a Queue dump.
- Provider admission is owned by `prepareTeamAgentTurn()`; member/admin HTTP
  mutations pass through `handleApi()`. These are the first shared enforcement
  boundaries for a persisted maintenance state.
- `InstanceCoordinator` now owns a fail-closed object registry for `UserState`,
  root/conversation `TeamAgent`, and every touched `ProviderCoordinator`. A
  count-plus-SHA-256 baseline must be confirmed and is invalidated by each new
  identity; dormant historical objects still require an operator-supplied
  inventory before a complete baseline can be asserted.
- The capture service now produces a versioned AES-GCM envelope and independently
  verifies manifest/payload inventory, sizes and checksums. There is still no
  archive transport, restore command, isolated restore drill, production cutover,
  or numeric RPO/RTO claim; those remain unsupported and belong to later children.
- External baseline confirmation now carries the complete operator-owned object
  inventory plus a bounded evidence ID. It can seed dormant identities that did
  not awaken after rollout; any observed conflict or later identity invalidates
  the baseline and fails capture closed.
- Every operation acquisition owns a random durable fence ID, so duplicate logical
  request/Queue IDs cannot release each other. Ambiguous RPC results retry and
  compensate using that exact ID. Persistent coordinator unavailability remains
  intentionally fail-closed; fences are never expired by time while a long stream
  may still be live.
- A caller-owned durable archive sink must return a content-free evidence ID before
  maintenance can be released as `captured`. Sink failure rolls back as `failed`
  and returns no archive result.

## Focused Validation Evidence

- `npm run typecheck` passed after maintenance health, registry digest, Provider
  registration, and deployment-preflight changes.
- `tests/instance-capture.test.ts`: 21 passed, covering independent decrypt,
  tamper/wrong key, structured references, cyclic values, request reconciliation,
  phase rollback, registry invalidation, Queue/DLQ evidence, and runtime gates.
- `tests/worker-api.test.ts`: 111 passed.
- UserState, ProviderCoordinator, TeamAgent turn, Workspace focused suites: 76
  passed across five files.
- Deployment config and public agent-error regressions passed; deployment
  preflight now requires all four Durable Object bindings and v1-v4 migrations.

## Full Validation Evidence

- `npm run check:frontend` passed; Vite built 2,233 modules and the structural
  frontend check passed without tracked generated-asset drift.
- `npm test` passed: 41 files, 611 tests. The capture suite contains 23 tests;
  the affected Worker/API/Agent/Workspace/deployment/error subset contains 216.
- `npm run test:browser:workspace` passed: 84 passed and 46 viewport-conditional
  skips across the 130-case five-viewport matrix; no unexpected request escaped
  the local fixture.
- `npm run test:browser:agent` passed: 3 local fake-Provider tests. The bounded
  secret-free summary is retained under ignored `test-results/agent-e2e-local/`.
- `npm run typecheck` passed for Worker, React client, and browser-test configs.
- `npx wrangler deploy --dry-run` passed with Wrangler 4.110.0 and listed all
  four Durable Object bindings plus KV, Queue, R2, and Assets; no deployment ran.
- `git diff --check` passed. `python ./.trellis/scripts/task.py validate-all`
  reported `Repository consistency: OK`.
- All Provider/MCP fixtures were local. No live model, live MCP, production probe,
  local production deployment, or secret/content-bearing artifact was used.

## Delivery Evidence

- The exact work commit is
  `d877ee6cee7c2921c4041f3a763e9b3bb7242947`; task evidence was committed
  separately so the implementation revision remains traceable.
- PR [#47](https://github.com/Drew-Z/chatus-private-chat/pull/47) merged the exact
  head `30da20e5b46329ac74f3752da6fe37ccd7c69045` as main revision
  `1a016d42389a13d58bc1e32578ceebd23fe8fabd`.
- Exact-head PR run
  [30979361666](https://github.com/Drew-Z/chatus-private-chat/actions/runs/30979361666)
  passed `changes`, `quality`, `workspace-browser`, and `agent-browser`. Its
  path-classification, quality, coverage, Workspace Playwright, and local
  fake-Provider Agent artifacts were retained by GitHub Actions.
- Exact-main deployment run
  [30980066814](https://github.com/Drew-Z/chatus-private-chat/actions/runs/30980066814)
  passed the `deploy` job for `1a016d42389a13d58bc1e32578ceebd23fe8fabd`,
  including both stale-main guards, production smoke, and manifest retention.
  Artifacts `deployment-paths-1a016d42389a13d58bc1e32578ceebd23fe8fabd`
  and `production-deployment-1a016d42389a13d58bc1e32578ceebd23fe8fabd`
  were retained; the deployment manifest expires 2026-11-03.
- Exact-main production member acceptance run
  [30980363359](https://github.com/Drew-Z/chatus-private-chat/actions/runs/30980363359)
  passed deployed-revision verification and temporary-member acceptance for the
  same SHA. Artifact
  `production-acceptance-1a016d42389a13d58bc1e32578ceebd23fe8fabd` was retained
  through 2026-11-03. No credential, response body, conversation content, or
  stored memory was copied into this task.
- Pre-archive `git diff --check` and
  `python ./.trellis/scripts/task.py validate-all` passed after the delivery
  evidence and code-task branch metadata were recorded; repository consistency
  remained `OK` with every acceptance and implementation checkbox complete.
