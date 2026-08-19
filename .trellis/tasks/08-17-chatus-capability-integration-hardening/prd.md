# Chatus capability integration hardening

## Goal

Complete cross-layer lifecycle, privacy, recovery, responsive accessibility, quality-gate, and specification hardening.

## Requirements

- Dependencies: all four implementation children must be complete, checked,
  committed, and archived.
- Run a cross-layer local/fake-service matrix across Agent and applicable
  transitional Worker boundaries for assignments, revocation races, admission,
  selection, vision, research, citations, fallback, configuration conflicts,
  cancellation, offline/draft recovery, branch, deletion, export, backup, and
  restore.
- Inspect storage, monitoring, logs, public projections, and backups for the
  parent privacy contracts. Monitoring must contain no prohibited identity or
  content; private evidence must follow its explicit lifecycle.
- Update executable Trellis specs for capability assignment, multimodal input,
  Agent streaming, Provider attempts/monitoring, MCP/tool runtime,
  backup/restore, frontend quality, and any new aggregate owner.
- Run every required quality command serially because frontend generation feeds
  Worker tests. Use only local fixtures, fake Providers, and fake MCP/OAuth.
- Verify the complete diff against all parent acceptance criteria and protected
  paths. Do not touch/advance production observation, PR #93, legacy rollout
  tasks/gates/evidence, or production deployment.

## Acceptance Criteria

- [x] The cross-layer matrix covers all parent success, denial, timeout,
  cancellation, fallback, revocation, conflict, offline, and lifecycle cases
  with zero live external requests.
- [x] Privacy scans find no prohibited identity/content in monitoring/logs and no
  raw Provider/MCP/credential leakage in public or persisted capability data.
- [x] Applicable specs match the final executable contracts and reference focused
  tests rather than placeholder guidance.
- [x] `npm run check:frontend`, `npm test`,
  `npm run test:browser:workspace`, `npm run test:browser:agent`,
  `npm run typecheck`, `npx wrangler deploy --dry-run`, and
  `git diff --check` pass in that order.
- [x] The final diff contains no protected production-observation/legacy-rollout
  artifacts and no production deployment or live Provider/MCP/OAuth probe ran.

## Parent Acceptance Mapping

This child owns parent AC10-AC12 and final verification of AC1-AC9.

## Completion Evidence

- Parent AC1-AC3: the archived catalog/adoption child has every acceptance item
  checked at
  `.trellis/tasks/archive/2026-08/08-17-chatus-capability-catalog-adoption/prd.md`;
  work/archive commits are `b42d180` and `2b3f093`. The final 918-test suite
  revalidated default/stored config, assignment, collision, and decoder contracts.
- Parent AC4-AC5: the archived auxiliary-vision child is fully accepted at
  `.trellis/tasks/archive/2026-08/08-17-chatus-auxiliary-vision/prd.md` (work commit
  `59fc82e`). Final integration tests add the four-mode Worker/session matrix,
  exact client contradictions, capacity-wait revocation, non-cooperative late
  cancellation, and generate/stream pre-attempt authorization ordering.
- Parent AC6-AC7: the archived explicit-research child is fully accepted at
  `.trellis/tasks/archive/2026-08/08-17-chatus-web-research/prd.md` (work/archive
  commits `1584599` and `0591f4e`). The final suite revalidated fake MCP/OAuth,
  citations, denial/drift/timeout/cancellation, and draft recovery.
- Parent AC8-AC9: the archived experience/monitoring child is fully accepted at
  `.trellis/tasks/archive/2026-08/08-17-chatus-capability-experience-monitoring/prd.md`
  (work/archive commits `273492a` and `dbb68ed`). Final privacy tests reject every
  prohibited identity/content/credential/endpoint/Provider/tool/memory field, and
  lifecycle tests prove monitoring starts only after `waitUntil` accepts ownership.
- Parent AC10: focused Vitest passed 290 tests across
  `tests/fallback-language-model.test.ts`, `tests/vision-assist-turn.test.ts`,
  `tests/capability-monitoring.test.ts`, `tests/client-api.test.ts`, and
  `tests/worker-api.test.ts`; the complete Vitest run passed 60 files / 918 tests,
  Workspace Playwright passed 119 with 71 conditional skips, and Agent E2E passed 3.
- Parent AC11: on 2026-08-19 the required commands passed serially in the documented
  order: frontend check, full Vitest, Workspace browser, Agent browser, typecheck,
  Wrangler dry-run, and final diff whitespace validation.
- Parent AC12: changed/untracked path inspection found no production-observation,
  PR #93, legacy rollout/gate/evidence, collector, or production workflow path.
  No production deploy, live Provider/MCP/OAuth/capability probe, or synthetic
  production request ran; all external boundaries used local fixtures/fakes.
