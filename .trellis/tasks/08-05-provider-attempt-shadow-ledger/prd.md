# Provider attempt shadow ledger

## Goal

Create authoritative server-side identity and an append-only content-free shadow
record for every Provider call without introducing cost totals, budget blocking,
feedback, or billing claims.

## Dependencies

- `08-05-dr-isolated-restore-drill` completed and archived so the new ledger has
  a proven backup/restore classification and recovery path.

## Applicable Decisions and Risks

- `FIN-01`: every Provider call has a server-issued `turnId`, `runId`, and
  `attemptId`; retry, fallback, Skill selection, and tool continuation remain
  individually attributable.
- `FIN-05`: ordinary ledger/telemetry records are content-free and exclude
  prompts, completions, tool payloads, credentials, raw Provider metadata and
  invoice payloads.
- Browser fields and assistant metadata cannot create or rewrite attribution.

## Requirements

- Define opaque server-issued identities: one admitted user message per turn,
  one logical execution per run, and one exact Provider/offering/model request
  per attempt.
- Give continuations and auxiliary runs distinct `runId`; give every retry and
  fallback a distinct `attemptId`; preserve existing user-message quota rules.
- Capture exact Provider, offering, model, logical route, fallback index,
  credential class, operation fence and terminal attempt status at the server
  execution boundary.
- Append idempotently to a durable shadow ledger and expose only secret-safe
  operator diagnostics; no money or enforcement semantics are supported.

## Acceptance Criteria

- [x] AC1. Every fake Provider call in main answer, Automatic Skill, retry,
      fallback and approved tool-continuation fixtures has exactly one attempt.
- [x] AC2. Turn/run/attempt identities are opaque, server-issued, durable and
      bound to operation-fence idempotency.
- [x] AC3. Multi-Provider fallback reconciliation accounts for failed and
      successful attempts without incrementing one user-message quota twice.
- [x] AC4. Replayed callbacks/retries cannot create duplicate ledger attempts or
      overwrite earlier evidence.
- [x] AC5. Browser attribution fields are ignored/rejected and cannot change
      Provider/offering/model/route ownership.
- [x] AC6. Ledger, logs, exports and diagnostics pass content/secret leak scans.
- [x] AC7. Backup/restore and deletion classification for the ledger is explicit
      and covered by deterministic fixtures.
- [ ] AC8. Full gates, specs, PR/commit/deployment evidence and archive checks pass.

## Out of Scope

- Usage normalization, pricing, monetary totals, budgets, feedback, invoices or
  production billing claims.
