# Provider attempt shadow ledger design

## Identity Model

- `turnId`: one admitted user-message lifecycle.
- `runId`: one logical execution, including auxiliary and continuation runs.
- `attemptId`: one request to an exact Provider/offering/model/credential class.

All are server-issued, opaque, stable under the owning operation fence, and
immutable after append. Tool execution identity is not Provider attempt identity.

## Execution Boundary

The Provider adapter boundary creates an attempt before network execution and
appends terminal evidence after success/failure/cancel/timeout. Retry and fallback
create new attempts. A durable idempotency key prevents duplicate append on
callback or process retry.

## Ledger Boundary

The ledger is append-only durable state with independent projections. Events
contain IDs, exact route dimensions, timestamps, bounded status/error class and
provenance, but no request/response content or secrets. The implementation task
selects the exact sharding/Agent owner after inspecting current routing topology.

## Compatibility and Rollback

Run initially in shadow mode. Existing quota, response and routing contracts stay
authoritative. If ledger append/projection causes risk, disable capture/projection
without deleting events or operation fences; Provider execution failure behavior
must be an explicit reviewed policy, not inferred from exception type.
