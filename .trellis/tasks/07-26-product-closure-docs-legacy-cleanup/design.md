# Product Closure Docs And Legacy Cleanup - Design

## Documentation Boundary

This task updates operator-facing docs and produces a cleanup audit. It does not change runtime behavior unless a documentation check exposes a small broken reference that can be fixed safely.

Target docs:

- `README.md` for product overview and common configuration.
- `docs/self-hosting.md` for clean fork setup and first deploy.
- `docs/operations.md` for production runbook, rollback, secret rotation, and acceptance.

## Cleanup Audit Shape

Create a tracked audit note under the task directory, for example `legacy-cleanup-audit.md`, with this table:

| Surface | Evidence | Current owner | Removal condition | Risk | Candidate task |
| --- | --- | --- | --- | --- | --- |

Each row should cite file paths, endpoints, storage keys, or tests. Use current-state evidence, not memory.

## Decision Rules

- Documentation can be updated in this task.
- Local-only references, stale screenshots, and obsolete `ACCESS_CODES` instructions can be corrected in this task.
- Runtime deletion should become a later child task unless it is provably dead code with tests.
- Data deletion requires explicit migration evidence and rollback notes.

## Rollback

Documentation changes revert with Git. Audit notes are non-runtime artifacts. No production deployment is run locally.
