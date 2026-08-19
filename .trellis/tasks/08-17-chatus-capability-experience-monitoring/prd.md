# Chatus capability experience and monitoring

## Goal

Unify member and administrator capability UX and add content-free availability and execution monitoring.

## Requirements

- Dependencies: catalog/adoption, auxiliary vision, and web research children
  must be complete and green with stable runtime/public contracts.
- Consolidate member capability information in one conversation-inspector
  section covering workflows/slots, explicit turn tools, image mode, connection
  readiness, source, activation, availability, data sharing, latency, and cost.
- Keep high-frequency attachment, one-turn research, and send controls in the
  composer; setup details remain in the inspector/admin surfaces.
- Provide truthful selected/waiting/running/succeeded/unavailable/denied/timed
  out/cancelled states and actionable retry/remove-image/model-switch/connection
  recovery without exposing Provider identity or raw payloads.
- Add administrator catalog/helper/search readiness, assignment, and content-free
  execution/availability summaries.
- First evaluate reuse of the existing model-monitoring aggregate. Add a separate
  owner only if it cannot represent the complete orchestration contract without
  corrupting Provider-attempt semantics; use a new Durable Object only as a last
  resort with full migration/capture/restore/retention coverage.
- Store only hourly bounded counts and latency sums/counts keyed by known
  capability/kind/status. No identity, prompt, image, query, citation body,
  credential, tool body, or raw event persists.
- Monitoring is best-effort and never changes chat outcome; stale/unavailable
  evidence is explicit.
- Meet keyboard, focus, screen-reader, touch, reduced-motion, responsive, and no
  horizontal-overflow requirements at all five parent viewports.

## Acceptance Criteria

- [x] Member and admin surfaces derive all capability facts from exact server
  projections and reject malformed/inconsistent states.
- [x] Composer/inspector information architecture remains usable at 1920x1080,
  1440x900, 780x900, 480x844, and touch 390x844 without overlap/overflow.
- [x] Keyboard names, focus restoration, restrained live regions, touch targets,
  and reduced motion pass focused accessibility checks.
- [x] Monitoring aggregates contain only approved bounded dimensions, show
  stale/unavailable honestly, and cannot block a successful chat turn.
- [x] Screenshots/fixtures cover ready, setup-required, running, success, denial,
  timeout, cancellation, and retry/recovery states.

## Parent Acceptance Mapping

This child owns parent AC8 and the visualization/content-free aggregation portion
of AC9.
