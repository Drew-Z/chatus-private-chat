# Provider attempt shadow ledger implementation plan

- [x] Run `trellis-before-dev`; map every Provider execution path and current
      quota, routing, fallback, Automatic Skill, tool and telemetry contract.
- [x] Define strict versioned turn/run/attempt and append-event schemas.
- [x] Issue identities and operation fences at server execution boundaries.
- [x] Append start/terminal shadow evidence idempotently for every fake Provider
      execution path and expose bounded operator diagnostics.
- [x] Add deterministic fallback/retry/cancel/timeout/replay/quota fixtures and
      content/secret leak scans.
- [x] Define backup, restore, deletion, retention and export classification.
- [x] Run `trellis-check`, focused tests and the full parent validation baseline.
- [x] Update Provider, quota, telemetry, privacy and recovery specs; append
      `FIN-01` and `FIN-05` evidence while documenting unsupported accounting.
- [ ] Commit, PR, CI/deployment evidence, validation records and archive checks.

## Rollback Point

Disable shadow appends and projections while preserving immutable events and
fences for reconciliation. Do not change existing quota or routing behavior.
