# Chatus explicit web research

## Goal

Implement member-initiated per-turn web research through an administrator-reviewed read-only MCP binding and structured citations.

## Requirements

- Dependency: `08-17-chatus-capability-catalog-adoption` must be complete and
  green. This child does not depend on auxiliary vision.
- Web research is a member-initiated capability for one turn and is excluded
  from automatic selection. It occupies one of the existing three per-turn Skill
  slots and is rejected when manual selection already consumes all three.
- Administrators bind `chatus:web_research` only to an enabled, reviewed,
  read-only MCP tool whose exact schema accepts one bounded query and no required
  browser-controlled URL or secret.
- Invoke search before the main answer for tool-capable and no-tool routes. Use
  the latest user text as the disclosed query; do not add a hidden query model.
- Enforce assignment, OAuth readiness, review fingerprint/revision, public HTTPS
  and SSRF rules, timeout, cancellation, response limits, and close behavior.
- Decode exact structured JSON into at most ten sanitized public HTTPS sources,
  bound all fields and total size, canonicalize/deduplicate URLs, and preserve
  server order.
- Pass a numbered normalized source block to the Provider and persist/render the
  same normalized citation metadata without parsing model-generated Markdown.
- Denial, timeout, drift, connection loss, malformed/empty results, and
  cancellation are stable recoverable errors; the system must not continue with
  a false fresh-search claim.
- Tests use fake MCP/OAuth and fake Providers with zero live network/model calls.

## Acceptance Criteria

- [x] Search is absent from ordinary/automatic turns and runs only after a valid
  explicit member activation within the shared three-Skill budget.
- [x] Incompatible, write-capable, unreviewed, drifted, unassigned, disconnected,
  or stale requests fail before external I/O where applicable.
- [x] Fake MCP tests cover timeout, cancellation, close, non-text, malformed,
  oversized, empty, duplicate, and unsafe URL results.
- [x] Tool and no-tool model routes receive numbered normalized evidence and
  never raw MCP output; the UI renders exact safe citation links.
- [x] Retry and draft recovery preserve newer edits and never imply freshness
  after a failed search.

## Parent Acceptance Mapping

This child owns parent AC6 and the web-research portions of AC7, AC9, and AC10.
