# Explicit Web Research Implementation

## Dependency

Start after `08-17-chatus-capability-catalog-adoption` is complete and green.
Auxiliary vision may be complete first because execution is intentionally
serial, but no runtime contract from it is required.

## Checklist

- [x] Load `trellis-before-dev` and capability, streaming, MCP/tool runtime,
  privacy, and frontend quality specs.
- [x] Add explicit-turn request/activation contracts and shared slot accounting.
- [x] Add strict administrator binding compatibility and readiness projection.
- [x] Implement pre-answer MCP execution with assignment/OAuth/review/cancellation
  rechecks and existing network/timeout/close protections.
- [x] Add exact structured source decoding, URL sanitation/deduplication, bounded
  Provider evidence, and normalized citation persistence/projection.
- [x] Add composer control, citation rendering, disclosures, stable error/retry,
  and draft-generation-safe restoration.
- [x] Test with fake MCP/OAuth and fake Providers across tool/no-tool, drift,
  denial, timeout, malformed/empty/unsafe/oversized results, and cancellation.
- [x] Load `trellis-check`, run focused and child quality gates, update specs,
  commit, and archive before capability experience/monitoring starts.

## Rollback

Unbind/disable the web-research item and hide its explicit-turn control. Leave
generic MCP execution unchanged.
