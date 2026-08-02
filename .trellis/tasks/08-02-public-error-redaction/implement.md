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
- [ ] Update frontend/platform specs, commit, push, open a stacked PR, retain CI artifacts, and retarget to `main` after the base PR merges.
- [ ] Record main SHA, GitHub Actions deployment, and production/user acceptance before archive.

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
