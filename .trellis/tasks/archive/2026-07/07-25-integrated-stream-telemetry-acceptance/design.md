# Design: Integrated Stream Telemetry Acceptance

## Data Flow

```text
Provider LanguageModelV3 stream
  -> fallback stream primer and committed-stream monitor
  -> secret-free ProviderAttemptEvent
  -> route reliability writer
  -> KV route/provider reliability records
  -> /api/admin/reliability projection
  -> exact React decoder
  -> ReliabilityAdminPanel
```

The fallback wrapper is the authoritative observation point because it sees the real provider stream before AI SDK UI-message transformation, already owns the pre-output commitment boundary, and already releases the provider lease on finish, failure, and cancellation.

## Stream Observation Contract

The committed-stream monitor will track only non-empty `text-delta` and `reasoning-delta` parts:

- `firstVisibleAt` is captured when the primer observes the first visible part.
- `visibleTextDeltaCount` increments as visible text/reasoning deltas pass through unchanged.
- On a successful `finish`, one delta maps to `single_chunk`; two or more map to `progressive`.
- A successful tool/source/file-only attempt has no text stream shape.
- A cancellation or failure can carry internal timing during cleanup, but it does not contribute a successful shape sample.

The wrapper must enqueue every original part unchanged and must not delay, split, merge, or fabricate deltas.

## Telemetry Schema

Reliability records move directly to version 2. Stream evidence remains optional because non-streaming and non-text attempts are valid, not to preserve version-1 compatibility.

```typescript
type RouteStreamShape = "progressive" | "single_chunk";

type RouteReliabilityRecord = {
  // existing fields
  firstVisibleLatencyMs?: number;
  streamShape?: RouteStreamShape;
};

type ProviderRouteReliabilityRecord = {
  // existing fields
  streamSamples?: number;
  progressiveSamples?: number;
  averageFirstVisibleLatencyMs?: number;
  lastFirstVisibleLatencyMs?: number;
  lastStreamShape?: RouteStreamShape;
};
```

Only successful text streams provide both `firstVisibleLatencyMs` and `streamShape`. Provider aggregates update as one atomic record write. `streamSamples` and `progressiveSamples` are capped at 1,000 using the same bounded-history approximation as existing attempt metrics; valid aggregates satisfy `progressiveSamples <= streamSamples <= successes <= attempts`. When a failure shrinks the bounded success history, the stream counters shrink proportionally. Latencies are integers from 0 through 600,000 ms. Version-1 and malformed records are deleted lazily when read.

## API And UI Contract

The admin reliability route projection forwards only the provider aggregate fields. The client decoder owns validation from `unknown` and enforces:

- optional fields appear as a coherent set;
- counters are integers within bounds;
- progressive samples never exceed stream samples, and stream samples never exceed successful attempts;
- shape is one of the two exact literals;
- latency is a bounded non-negative integer.

The reliability table adds compact first-output and delivery columns. It shows `未知` when there is no successful text-stream sample, `渐进` with a bounded ratio for progressive evidence, and `单块` when the latest successful text response arrived in one visible delta. These labels describe upstream delivery only and do not imply synthetic client streaming.

## Deterministic Fake-provider Matrix

Tests construct local `ReadableStream` responses and mocked provider fetches only. Progressive acceptance uses a gated stream: release the first provider delta, assert the downstream UI-message reader receives visible text, then release the second delta and finish. This proves incremental propagation without relying on fragile sleep-only timing.

The focused matrix covers:

1. delayed/gated multi-delta success -> progressive evidence;
2. one visible delta then finish -> single-chunk evidence;
3. failure before visible output -> fallback remains allowed;
4. failure after visible output -> no fallback and no successful shape sample;
5. all candidates busy -> stable busy classification within the existing deadline contract;
6. cancellation -> lease release and no success/failure shape sample.

Existing Worker branch persistence/idempotency tests are included in focused acceptance rather than reimplemented in a second harness.

## Compatibility And Rollback

- No KV migration is required. Version-1 and malformed reliability records are deleted lazily when read, and a later real task writes a fresh version-2 record.
- Rolling back to a version-1 build discards version-2 reliability evidence as unknown; this is acceptable while all existing reliability data is synthetic development data.
- Removing the new optional fields from display is sufficient UI rollback; routing and stream delivery are unchanged.
- Legacy chat/SSE/storage paths remain intact until separate production migration acceptance authorizes removal.

## Security And Privacy

- Attempt events contain identifiers, timing, counts, status class, and booleans only.
- No prompt/completion/tool content or raw provider metadata is retained.
- Admin-only API authorization and origin rules remain unchanged.
- Fake-provider fixtures use synthetic content and local mocked endpoints.
