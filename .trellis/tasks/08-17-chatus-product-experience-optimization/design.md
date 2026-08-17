# Design: Chatus product experience optimization

## Boundaries

The work is split into ten child tasks with stable ownership boundaries. Shared frontend helpers may be introduced when they reduce duplication, but each child remains independently verifiable. Server behavior is changed only when an existing member-facing contract needs a compatible extension; no provider, rollout, or production-delivery control is in scope.

## Integration shape

1. Reliability helpers bound non-streaming requests and make browser storage best-effort.
2. Member workspace state exposes explicit availability and quota states to presentational components.
3. Accessibility and responsive CSS establish interaction and layout invariants shared by member and admin surfaces.
4. Admin monitoring treats sections as independently recoverable and visualizes monitor-native metrics.
5. Route-level lazy loading and streaming render controls reduce initial and per-token work; the service worker caches lazy chunks at runtime.
6. Browser tests exercise the integrated states with intercepted HTTP fixtures only, never real model calls.

## Compatibility and failure policy

- Existing API response shapes remain backward compatible.
- New browser persistence helpers degrade to in-memory UI behavior when storage is unavailable.
- Timeout errors retain an actionable retry path and never apply to streaming responses unless separately designed.
- Partial admin failures stay local to their section.
- Lazy-load failures surface the existing recoverable error UI and cached chunks use same-origin runtime caching.
- All monitoring and availability UI consumes existing read endpoints; it does not trigger synthetic provider probes.

## Rollback shape

Each child is implemented and checked in sequence. A failing child can be reverted without rolling back previously accepted children. The parent is complete only after a final cross-child regression pass.
