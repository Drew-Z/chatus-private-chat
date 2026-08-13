# Legacy API cloud chats rollout design

## Boundary

This child owns only the legacy cloud-chat route methods: `GET /api/chats`,
`PUT /api/chats`, `DELETE /api/chats`, and `POST /api/chats/migrate`, including
their legacy UserState/Agent synchronization edges. The Agent conversation API
is the replacement boundary; storage projections and browser navigation remain
separate surfaces.

## Instrumentation and Caller Census

Record method-level read/write use through the immutable
`legacy.api.cloud-chats` manifest record. Caller classification is fail-closed
to a declared safe class. Evidence contains only access, caller class, UTC
bucket, occurrence time, deployment SHA, and bounded counters. No conversation
identity or request metadata is persisted.

## Parity Contract

Use deterministic fake UserState, Agent, KV, and Provider/MCP fixtures to compare
legacy and replacement outcomes for list/get/upsert/delete/migrate, ordering,
pagination, metadata, tombstones, retry/idempotency, account cleanup, import/
sync, and stable errors. Identity/resource reconciliation is an explicit artifact
and must be one-to-one before any disable gate.

## Controls

Write-disable rejects `PUT`, `DELETE`, and `migrate` before mutation or hidden
sync. Read methods remain available until the separate read-disable gate. A
rejected write must not create a second mutation, accounting event, or partial
UserState/Agent projection.

## Recovery and Rollback

Capture/restore snapshots the legacy route's transitional UserState and Agent
representations with their manifest/digest and per-object receipts. The
`compatibility_read` rollback re-enables the retained route against the same
authoritative source, reconciles any fenced in-flight work, and never mixes
isolated restore data into production.

## Observation

Write and read windows are independent 30-day exact-SHA windows. Any unknown
caller, parity divergence, stale recovery artifact, or unexplained access resets
only the affected window and keeps this child open.
