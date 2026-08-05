# Legacy surface disable and observation design

## Surface Registry

Each surface is a separate state machine with immutable identity, type, owner,
callers, data classes, replacement, parity/recovery/rollback evidence, approval,
observation timestamps and deployment SHA. An aggregate dashboard may summarize
records but cannot advance them in bulk.

## State Machine

```text
discovered -> instrumented -> censused -> parity-proven -> shadowing
-> write-disabled -> observing -> recovery-proven -> read-disabled -> observing
```

Every transition validates its own evidence and is idempotent. Unknown callers,
data or parity keep the surface at its current state.

## Surface Boundaries

The initial census includes legacy chat KV/UserState projections, memory KV,
daily usage KV, route/provider fields, `/api/chat`, `/admin.html`, credential/
secret representations, and legacy Durable Object namespaces. Exact current
symbols and additional surfaces are discovered during `trellis-before-dev`.

## Compatibility and Rollback

Dual-read/shadow compares projections without making the legacy path
authoritative. Stop-write and read-disable use independent reversible controls.
Rollback re-enables the untouched read path and reconciles divergence; it never
deletes append-only migrations or mixes restored/source instances.
