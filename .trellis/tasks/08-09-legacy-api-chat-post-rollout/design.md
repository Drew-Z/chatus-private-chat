# Legacy API chat post rollout design

## Boundary

The surface owns `POST /api/chat` admission and dispatch. The replacement is the
existing TeamAgent transport. Conversation storage projections and browser shell
navigation stay separate.

## Instrumentation and Parity

Every admitted route dispatch records content-free write use; route availability
records read use only at the exact compatibility boundary. Caller classification
is fail-closed. Deterministic fake Provider/MCP fixtures compare legacy and Agent
results across quota, attempts, fallback, progress, streams, tools, files,
errors, cancellation, and guest policy without live calls.

## Controls

Write-disable rejects or routes no new legacy POST and guarantees zero Provider,
tool, file mutation, or quota side effect through that path. Read-disable removes
compatibility route availability after the browser shell and other callers have
completed migration/observation.

## Recovery and Rollback

Current capture/restore evidence must include transitional conversation state.
`routing_switch` rollback restores the unchanged route and reconciles any
in-flight fence without mixing restored/source data. A late caller resets the
relevant 30-day window.

## Production Census Evidence

The coordinator exposes a read-only, bounded daily census projection through an
authenticated admin endpoint. A main-only GitHub Actions workflow verifies the
exact deployed SHA before and after collection and retains only canonical
content-free rows for 90 days. This evidence delivery does not start, shorten,
or satisfy either 30-day observation window by itself. A bundled surface with
no initialized coordinator is projected as an empty census without creating or
synchronizing control-plane state.
