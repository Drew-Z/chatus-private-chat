# Implementation Plan: Integrated Stream Telemetry Acceptance

## 1. Stream Observation

- [x] Extend `ProviderAttemptEvent` with optional first-visible latency and successful stream-shape evidence.
- [x] Capture the first visible timestamp in the stream primer and count only non-empty text/reasoning deltas in the committed monitor.
- [x] Emit `progressive` or `single_chunk` only on a successful finish and keep original stream parts byte-for-byte/field-for-field unchanged.
- [x] Preserve pre-output fallback, post-output route commitment, cancellation, provider lease, and best-effort callback semantics.

## 2. Passive Reliability Storage

- [x] Move route and provider-pair reliability records to version 2 with optional evidence for non-streaming/non-text attempts.
- [x] Validate coherent field sets, bounds, and sample-count relationships while deleting version-1 or malformed records on read.
- [x] Aggregate first-visible latency and progressive/single-chunk samples within the existing 1,000-sample cap.
- [x] Keep failures, cancellations, tool-only attempts, and BYOK authentication isolation from corrupting successful text-stream evidence.

## 3. Typed Admin Projection

- [x] Add the aggregate fields to the admin reliability response projection.
- [x] Extend exact client types/decoders and reject malformed or secret-bearing payloads.
- [x] Add compact first-output and delivery evidence columns to `ReliabilityAdminPanel` with progressive, single-chunk, and unknown states.
- [x] Preserve narrow-layout containment and existing provider readiness/capacity/fallback information.

## 4. Deterministic Acceptance

- [x] Add fallback-wrapper tests for gated progressive delivery, single-chunk success, post-output failure, and cancellation evidence.
- [x] Extend route-reliability tests for aggregation, malformed optional fields, cap behavior, and version-1 cleanup.
- [x] Extend Worker/TeamAgent fake-provider tests to prove first output is consumable before a later delta is released.
- [x] Extend admin API/client tests for exact secret-free projection and decoder validation.
- [x] Keep existing branch persistence/idempotency, provider-busy, and workspace browser tests in the focused acceptance run.

## 5. Documentation And Closure

- [x] Update `.trellis/spec/frontend/agent-streaming.md` with the executable telemetry and fake-provider contract.
- [x] Update operator documentation to explain first-visible latency, progressive versus single-chunk evidence, unknown states, and the no-probe policy.
- [x] Reconcile the parent implementation checklist with completed Phase E/F work without marking legacy removal or production migration complete.

## Validation Order

```powershell
npm.cmd run check:frontend
npm.cmd test
npm.cmd run test:browser:workspace
npm.cmd run typecheck
npx.cmd wrangler deploy --dry-run
git diff --check
python ./.trellis/scripts/task.py validate 07-25-integrated-stream-telemetry-acceptance
```

No validation command may contact a live model or perform a production deployment.

## Verification Record

- 2026-07-25: `npm run check:frontend` passed; Vite reported only the existing oversized-chunk warning.
- 2026-07-25: `npm test` passed with 21 files and 256 tests. Deterministic fake-provider coverage consumed the first visible delta before releasing the second and made no live model call.
- 2026-07-25: `npm run test:browser:workspace` passed with 23 tests and 2 expected desktop skips across 1920px, 1440px, 780px, 480px, and touch-enabled 390px viewports. Reliability evidence stayed within a local scroll container and the fixture blocked API, Agent, and external requests.
- 2026-07-25: Final full-scope rerun passed `npm run typecheck`, `npx wrangler deploy --dry-run`, `git diff --check`, and `python ./.trellis/scripts/task.py validate 07-25-integrated-stream-telemetry-acceptance`. The Wrangler command was dry-run only; no production deployment or push occurred. Storage and client decoders now enforce `progressiveSamples <= streamSamples <= successes <= attempts`, including bounded-history shrink after a failure.

## Rollback Points

- After stream-observer unit tests, before storage/API changes.
- After storage/client decoder tests, before UI changes.
- Before spec/operator documentation updates and final full-scope validation.
