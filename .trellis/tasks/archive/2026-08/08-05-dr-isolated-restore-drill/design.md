# DR isolated restore drill design

## Boundary

The restore engine consumes only a sealed compatible manifest and provisions a
separate target. It never treats service export/import or code rollback as full
instance recovery and never writes into the active source.

## Identity and Preflight

A versioned mapping binds source stable principal/root/conversation/object IDs
to exact target bindings and Durable Object identities. Mutable labels are
diagnostic aliases only. Preflight verifies archive/key integrity, schema and
append-only migrations, target isolation/emptiness, quotas/capacity, and every
required mapping before importing bytes.

## Checkpoint State Machine

```text
preflight -> provision -> durable/transitional stores -> UserState
-> root Agent -> conversation Agents -> R2 -> Queue regeneration
-> reconciliation -> acceptance -> eligible-for-cutover
```

Each checkpoint records operation ID, manifest ID, target identity, input/output
digests and terminal state. Reentry is idempotent. Unknown or divergent output
fails closed and keeps the target isolated.

## Queue and Reconciliation

Queue delivery is regenerated only from durable generation/outbox evidence.
Every queued/extracting/failed/DLQ item is restored, deterministically regenerated,
or reported unresolved. Final reconciliation joins metadata to objects and
validates isolation, auth, deletion and application-level canaries.

## Rollout and Rollback

Initial acceptance is local/non-production only. Before cutover, discard or retry
the isolated target. After a separately approved cutover, use forward repair or
return wholly to the untouched source; never merge the two instances.
