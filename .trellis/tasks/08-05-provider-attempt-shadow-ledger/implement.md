# Provider attempt shadow ledger implementation plan

- [ ] Run `trellis-before-dev`; map every Provider execution path and current
      quota, routing, fallback, Automatic Skill, tool and telemetry contract.
- [ ] Define strict versioned turn/run/attempt and append-event schemas.
- [ ] Issue identities and operation fences at server execution boundaries.
- [ ] Append start/terminal shadow evidence idempotently for every fake Provider
      execution path and expose bounded operator diagnostics.
- [ ] Add deterministic fallback/retry/cancel/timeout/replay/quota fixtures and
      content/secret leak scans.
- [ ] Define backup, restore, deletion, retention and export classification.
- [ ] Run `trellis-check`, focused tests and the full parent validation baseline.
- [ ] Update Provider, quota, telemetry, privacy and recovery specs; append
      `FIN-01` and `FIN-05` evidence while documenting unsupported accounting.
- [ ] Commit, PR, CI/deployment evidence, validation records and archive checks.

## Rollback Point

Disable shadow appends and projections while preserving immutable events and
fences for reconciliation. Do not change existing quota or routing behavior.
