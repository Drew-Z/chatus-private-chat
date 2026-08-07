# Legacy surface disable and observation design

## Planning Correction

`research/legacy-surface-census.md` shows that the current umbrella scope crosses
independent API, browser, KV, SQLite, Provider, credential, build, deployment,
and recovery boundaries. The approved `DR-06` source requires independent tasks
per exact surface. This task therefore remains a coordinating parent and is not
an implementation target until the task tree is corrected.

The first proposed implementation child owns only the shared registry/control
plane. Later rollout children each own one surface record and can remain open
through exact-SHA stop-write and read-disable observation. Destructive cleanup is
never part of those children.

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

Whole Durable Object bindings are physical boundaries, not automatically legacy
surfaces. `USER_STATE` must be decomposed by data class; the other current
Durable Objects remain authoritative, replacement, accounting, or coordination
owners and cannot be read-disabled by this program.

## Compatibility and Rollback

Dual-read/shadow compares projections without making the legacy path
authoritative. Stop-write and read-disable use independent reversible controls.
Rollback re-enables the untouched read path and reconciles divergence; it never
deletes append-only migrations or mixes restored/source instances.
