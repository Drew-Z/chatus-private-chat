# Implementation Plan: Public Error Redaction And Turn Correlation

## Ordered Checklist

- [x] Expand the canonical public error registry, fail unknown codes closed, add strict optional request-ID envelope parsing, and cover secret-bearing negative cases.
- [x] Normalize the AIChat SDK turn request ID and route every TeamAgent early, preparation, synchronous stream, and asynchronous stream failure through one safe SSE boundary.
- [x] Add redacted structured Agent failure evidence and pass the normalized request ID into passive Provider reliability without changing scoring, fallback, quota, or capacity behavior.
- [x] Redact legacy `/api/chat` Provider failures while preserving stable status/code behavior and route semantics.
- [x] Redact Capability SSE and MCP discovery/execution failures at their public boundaries; remove MCP server IDs from member-facing messages.
- [x] Redact administrator model-discovery failures and remove member labels from MCP OAuth audit targets.
- [x] Extend the React error presentation with an accessible copyable request reference while preserving offline, retry-branch, reconnect, and draft recovery behavior.
- [x] Add local fake Provider/MCP and browser regression coverage for all bypass and leakage paths.
- [x] Run `trellis-check`, the full shipping gate, affected Playwright suites, Trellis consistency, and secret-marker scans.
- [x] Update frontend/platform specs, commit, push, open a stacked PR, retain CI artifacts, and retarget to `main` after the base PR merges.
- [x] Record main SHA, GitHub Actions deployment, and production/user acceptance before archive.

## Validation Commands

```text
npx vitest run tests/agent-error.test.ts tests/client-state.test.ts tests/route-reliability.test.ts tests/team-agent-turn.test.ts tests/worker-api.test.ts
npm run check:frontend
npm test
npm run test:browser:workspace
npm run test:browser:agent
npm run typecheck
npx wrangler deploy --dry-run
git diff --check
python ./.trellis/scripts/task.py validate-all
python -m unittest discover -s .trellis/tests -p test_*.py -v
```

## Rebase Validation Evidence (2026-08-04)

- Rebased the five task commits onto exact base `4d3811776ced8644a971e4bbc3074cf59c112098`; the functional work commit is now `31028f36aa14ad159c2680fd695ed45810f2684d`.
- The route-reliability conflict preserves current `ProviderCoordinator` atomic aggregation, full BYOK shared-quality isolation, and separate selector telemetry while carrying the normalized answer-turn request ID through the chat sample and KV projection.
- Affected Vitest: 8 files / 251 tests passed. Full Vitest: 40 files / 562 tests passed.
- Workspace Playwright: 83 passed / 42 viewport-conditional skips. Local fake Provider Agent Playwright: 3 passed.
- `npm run check:frontend`, `npm run typecheck`, `npx wrangler deploy --dry-run`, `git diff --check main...HEAD`, Trellis repository consistency, and all 7 Trellis unit tests passed.
- No live Provider/MCP request, production probe, production data read/mutation, or local production deployment was used.

## PR And Delivery Evidence (2026-08-04)

- Work commit: `31028f36aa14ad159c2680fd695ed45810f2684d`.
- PR #33 was retargeted to `main`, validated at exact head `93fee92100998ae86cb7eddd174447f555abe4d7`, and squash-merged as exact main SHA `b37e4574162496e60a4e2a2d2332b1fdb34d2acf`.
- PR quality run `30900182157` passed `changes`, `quality`, `agent-browser`, and `workspace-browser` for the exact PR head.
- PR artifacts remain available through 2026-08-18: path classification `8888726764`, Agent Playwright `8888763796`, quality manifest `8888807657`, and Workspace Playwright `8888925900`.
- GitHub Actions deployment run `30900906173` passed for the exact main SHA, including stale-revision guards, frontend check, full Vitest, typecheck, whitespace check, Wrangler validation, `Deploy Worker`, `Verify production`, and deployment manifest retention.
- Deployment artifacts: path classification `8889018311` (through 2026-09-03) and production deployment manifest `8889113950` (through 2026-11-02).
- Authenticated user production acceptance passed on 2026-08-04 with screenshot evidence of a successful normal chat turn; no conversation content was copied into Trellis.

## Risky Files And Rollback Points

- `src/contracts/agent-error.ts`: shared Worker/client contract; exact parser and canonical messages must change together.
- `src/agent/team-agent.ts`: preserve AIChat recovery, cancellation, cleanup, and UI Message SSE semantics; never return JSON for chat failures.
- `src/worker.ts`: keep Provider selection, fallback, capacity, quota, and MCP/OAuth behavior unchanged while replacing only public projections and audit identifiers.
- `src/services/route-reliability.ts`: optional request ID must not alter quality scoring or invalidate version-2 records.
- `client/src/components/ChatWorkspace.tsx`: request references must not disrupt mobile layout, retry branching, or the primary error alert.

## Review Gates

- Secret-like Provider body, exception text, endpoint, member label, MCP server ID, prompt, tool data, file, and memory markers never cross tested public/log/audit boundaries.
- Every Agent error path returns UI Message SSE and one canonical code/message pair; cleanup and failure accounting happen once.
- Turn correlation uses the SDK per-turn ID, not the WebSocket handshake ID, and remains absent from persisted conversation/model context.
- Existing envelopes and reliability records remain readable; no active probe or new high-cardinality storage is introduced.
- All model and MCP tests use deterministic local fixtures only.
