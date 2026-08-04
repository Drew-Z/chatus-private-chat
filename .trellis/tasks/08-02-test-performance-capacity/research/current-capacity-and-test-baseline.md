# Current Test And Capacity Baseline

Recorded: 2026-08-04

## Vitest Baseline

- Current configuration: one Cloudflare Workers pool for every unit test, with global `maxWorkers: 1` in `vitest.config.ts:4-23`.
- Current suite: 40 files / 581 tests.
- Same-machine pre-change samples:

| Sample | Elapsed |
| --- | ---: |
| 1 | 184.964 s |
| 2 | 107.723 s |
| 3 | 104.500 s |
| Median | 107.723 s |

- Retention threshold: at least 15% faster, so the three-run post-change median must be no more than `107.723 * 0.85 = 91.56455`, rounded down to 91.564 seconds for the acceptance bound.
- Every sample completed the same 40 files / 581 tests. The first slow sample remains part of the median and was not discarded.

An initial split benchmark was recorded after the nine-file Workers ownership correction and cancellation-race fix. Every sample completed 40 files / 587 tests:

| Sample | External elapsed |
| --- | ---: |
| 1 | 72.270 s |
| 2 | 72.406 s |
| 3 | 71.398 s |
| Median | 72.270 s |

Sorted values are `71.398`, `72.270`, and `72.406`, so the middle value is 72.270 seconds. This initial evidence was below the bound, but it was superseded by the required final pre-PR recheck below.

The final split benchmark retained the first slow run and restarted no samples. Every sample again completed 40 files / 587 tests:

| Sample | External elapsed |
| --- | ---: |
| 1 | 96.900 s |
| 2 | 92.203 s |
| 3 | 88.938 s |
| Median | 92.203 s |

Sorted values are `88.938`, `92.203`, and `96.900`, so the middle value is 92.203 seconds. This is 14.41% lower than the 107.723-second pre-change median but exceeds the approved 91.564-second bound. The first sample's Vitest-reported duration was 95.14 seconds; 96.900 seconds is the shell wall time used consistently with the other samples. Decision: remove the Node/Workers split and restore the complete suite to the serial Workers pool. No sample was discarded.

## Workers-Owned Tests

Repository import inspection found these eight files directly using `cloudflare:workers` or `cloudflare:test`:

1. `tests/document-ingest-queue.test.ts`
2. `tests/document-ingest-state.test.ts`
3. `tests/provider-coordinator.test.ts`
4. `tests/route-reliability.test.ts`
5. `tests/team-agent-turn.test.ts`
6. `tests/user-state.test.ts`
7. `tests/worker-api.test.ts`
8. `tests/workspace-file.test.ts`

`tests/image-input.test.ts` has no direct `cloudflare:*` import but imports `src/worker.ts` and `src/agent/team-agent.ts`, so a Node project run fails while resolving the transitive `cloudflare:workers` dependency. It was the ninth Workers-owned file during the experiment. The other 31 test files had no known Cloudflare runtime dependency. These ownership findings remain useful for a future experiment, but the final configuration runs all 40 files through one Workers pool.

## Official Compatibility Evidence

- Cloudflare documents that the Workers Vitest integration does not support V8 coverage and requires Istanbul coverage: <https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/>.
- Cloudflare's Vitest 4 migration guide documents Workers storage isolation behavior: <https://developers.cloudflare.com/workers/testing/vitest-integration/migration-guides/migrate-from-vitest-3-to-vitest-4/>.
- Vitest documents project/test include matching at <https://github.com/vitest-dev/vitest/blob/main/docs/config/include.md>.
- Vitest documents Istanbul coverage configuration and thresholds at <https://github.com/vitest-dev/vitest/blob/main/docs/config/coverage.md>.

No V8 provider fallback is acceptable for this repository because a passing Node project must not conceal unsupported Workers coverage.

## Istanbul Coverage Baseline

The first complete instrumented run exposed two project-split/cancellation races before a baseline could be accepted: `image-input.test.ts` was incorrectly assigned to Node despite its transitive Worker import, and cancellation could race a committed stream's internal prefetch into false protocol-failure telemetry. After assigning the test to Workers and making cancellation intent authoritative, the complete `npm run test:coverage` run passed 40 files / 587 tests.

| Metric | Covered / Total | Measured | Enforced floor |
| --- | ---: | ---: | ---: |
| Statements | 8399 / 13817 | 60.78% | 60% |
| Branches | 7851 / 13635 | 57.57% | 57% |
| Functions | 1601 / 2870 | 55.78% | 55% |
| Lines | 7685 / 11783 | 65.22% | 65% |

The floors are explicit positive integers in `vitest.constants.ts`. The root Vitest configuration applies them once to the complete serial Workers suite.

A negative enforcement check temporarily raised the statements floor from 60% to 61%. The otherwise-passing complete instrumented suite exited with status 1 because the measured baseline was below that floor. The configured 60% floor was then restored, and the final serial-Workers `npm run test:coverage` run passed with the tabled metrics.

## Member Concurrency Evidence

- `src/services/quota-admission.ts:145-146` admits members after message quota checks and returns a no-op release. It does not acquire the guest single-turn lease.
- `.trellis/tasks/archive/2026-08/08-02-skill-quota-route-governance/design.md:82-91` records the prior decision not to add a member lease without measured saturation, expected multi-tab behavior, and an approved product limit.
- Daily/minute message buckets provide member fairness, guest turns retain their single-turn lease, and ProviderCoordinator applies the configured upstream capacity policy.
- Existing quota tests cover member quota rejection and guest lease/refund behavior but do not yet assert two simultaneous successful member admissions. This task adds that regression contract without changing runtime behavior.

## Provider Deadline Evidence

- `src/services/provider-first-visible-deadline.ts:1-38` defines the shared 60-second first-visible deadline, parent abort propagation, commit, and disposal.
- `tests/provider-stream-runtime.test.ts` covers fetch stall, pre-visible reader stall, parent cancellation, and post-commit long streaming.
- `tests/fallback-language-model.test.ts` covers pre-visible timeout fallback, parent cancellation without fallback, and long post-commit streaming.
- There is no post-visible idle timeout. A Provider can emit one visible part and then hold resources until client/request cancellation. This is a recorded residual risk, not an implementation requirement for this task.

## Workspace Occupancy Evidence

- `src/agent/team-agent.ts:237-256` models source `size`/`object_key` and parsed `extracted_bytes`/`extracted_object_key` per immutable version.
- `src/agent/team-agent.ts:1070-1080` computes the 250 MiB quota from `SUM(size)` where state is not `deleting`.
- Upload reservation is serialized in the Root TeamAgent transaction, so two concurrent reservations cannot both spend the last byte.
- Deletion first marks versions `deleting`; only after known R2 objects are removed does metadata disappear. During that interval, source and parsed bytes can be reported as pending cleanup.
- Parse completion stores the actual generated UTF-8 extraction byte length. Parse retry can replace the tracked extraction generation and clear `extracted_bytes` until the new attempt completes.
- Production code uses R2 get/put/delete for known keys and does not use bucket `list()`. Therefore it cannot discover orphan objects, older untracked extraction generations, or objects whose metadata was lost.

The safe boundary is metadata-tracked occupancy. It is exact relative to current SQLite rows and states, but it is not R2 bucket actual usage. No API or UI label may collapse that distinction.

## Privacy And Test Constraints

- Usage projection needs only aggregate integers and the existing public byte limit.
- Object keys, extracted object keys, checksums, filenames beyond the existing file list, and internal operations are unnecessary and must not be added to usage.
- All new tests use local Vitest/Miniflare, local browser fixtures, and fake Provider/MCP behavior. No live model, real OAuth/MCP, production synthetic probe, or local production deployment is permitted.
