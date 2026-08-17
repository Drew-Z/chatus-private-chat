# Member request timeout and recovery

## Goal

Ensure ordinary browser API requests cannot wait forever and that timeout failures are distinguishable, actionable, and safe to retry.

## Requirements

- Apply a bounded timeout to non-streaming API requests through a shared client path.
- Preserve caller cancellation and do not impose this timeout on streaming chat responses.
- Normalize timeout failures into the existing public client error model without exposing secrets or raw internals.
- Keep retry decisions in the owning UI; the client must not automatically repeat mutating requests.

## Acceptance Criteria

- [x] A stalled non-streaming request aborts after the configured duration and returns a timeout-specific client error.
- [x] Existing caller-provided abort behavior still works.
- [x] Streaming requests are unchanged.
- [x] Deterministic tests cover success, timeout, caller abort, and cleanup of timeout resources.
- [x] Existing request/error tests remain green.

## Notes

- Baseline evidence: `client/src/lib/api.ts:3951`.
- Validation: `npm run check:frontend`, client TypeScript, and `tests/client-api.test.ts` (73 tests) pass.
- Spec review: no update required; this implementation restores the existing `fetchWithTimeout` contract documented in `frontend/hook-guidelines.md`.
