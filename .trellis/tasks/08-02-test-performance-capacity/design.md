# Design: Test Performance And Capacity Observability

## Boundary

This task changes Vitest configuration and coverage enforcement, adds deterministic contract coverage for the existing member/Provider policies, and projects Workspace occupancy already represented in Root TeamAgent SQLite metadata. It does not introduce new admission behavior, Provider stream lifecycle behavior, storage limits, R2 enumeration, or cleanup mechanisms.

## Vitest Performance Experiment And Rollback

The experiment added two named project configs beneath the root coverage configuration:

- `node`: normal Vitest Node environment, browser tests excluded, no Cloudflare plugin, and no `maxWorkers: 1` cap;
- `workers`: the existing `cloudflareTest` plugin and Miniflare bindings, with `maxWorkers: 1` retained for Windows random-port stability.

The Workers project owns exactly these files because all except `image-input.test.ts` import `cloudflare:workers` or `cloudflare:test` directly; `image-input.test.ts` transitively imports the Cloudflare Worker/TeamAgent runtime:

1. `tests/document-ingest-queue.test.ts`
2. `tests/document-ingest-state.test.ts`
3. `tests/image-input.test.ts`
4. `tests/provider-coordinator.test.ts`
5. `tests/route-reliability.test.ts`
6. `tests/team-agent-turn.test.ts`
7. `tests/user-state.test.ts`
8. `tests/worker-api.test.ts`
9. `tests/workspace-file.test.ts`

The Node project included the remaining unit tests and explicitly excluded the nine Workers files. A configuration contract test proved the two project sets disjoint and complete during the experiment.

The split was eligible for retention only if three final post-change `npm test` runs preserved all 40 existing files, ran at least the 581 baseline tests plus this task's regressions, and had a median no higher than 91.564 seconds. The final external-wall-time samples were 96.900, 92.203, and 88.938 seconds, with a 92.203-second median. Because the median missed the bound, the final configuration restores one `cloudflareTest` pool for the complete suite with `maxWorkers: 1`; the coverage and occupancy work remains.

## Istanbul Coverage Budget

Add `@vitest/coverage-istanbul` at the same compatible Vitest major and configure coverage once at the root. V8 coverage is forbidden because the Cloudflare Workers pool does not support it. Coverage emits terminal text, `json-summary`, and HTML under `coverage/`; generated output remains ignored and is not committed.

`npm run test:coverage` invokes one complete `vitest run --coverage` through the serial Workers pool. The PR quality job uses the same single instrumented run as its Vitest gate instead of running the suite once normally and once with coverage, then retains only the bounded `coverage-summary.json` artifact for 14 days. The source-level HTML report remains local and ignored. Local `npm test` remains uninstrumented for feedback and future performance evidence.

After the first complete instrumented run, pin explicit integer global thresholds for statements, branches, functions, and lines to the floor of the measured baseline. The final evidence records both the unrounded baseline and the configured floors. Istanbul returns non-zero when any metric falls below its floor; a focused governance test locks provider, reporters, report directory, and explicit thresholds.

## Member Concurrency Decision

No member lease is added. `createQuotaAdmissionService().admitTurn()` continues to apply message quotas and then returns a no-op release for member sessions. Two concurrent member admissions must both succeed without calling `acquireGuestTurn`; guest single-turn lease behavior remains unchanged.

This is an explicit product decision, not an accidental omission: there is still no measured member saturation, expected multi-tab limit, or approved member concurrency budget. Daily/minute message buckets provide member fairness, while ProviderCoordinator capacity policies protect upstream capacity. A later task may revisit member leases only with measured saturation and a product-level limit.

## Provider Stream Decision

The shared 60-second deadline from Provider attempt start to first visible output remains the capacity bound. Fetch stalls and pre-visible stream stalls abort and may fallback; parent cancellation preserves its reason; the first visible output commits the route and clears the deadline.

There is deliberately no post-visible idle timeout in this task. A provider that emits one visible part and then stalls can hold request, lease, and admission resources until downstream cancellation. Record this as a residual capacity risk because adding an idle timeout requires a user-visible partial-response policy, a stream error projection, and coordinated lease cleanup semantics beyond this task.

## Workspace Usage Contract

Compute usage inside the Root TeamAgent from the same SQLite metadata snapshot used for file listing. The public contract is:

```ts
interface WorkspaceTrackedUsage {
  quotaBytes: number;
  extractedBytes: number;
  pendingCleanupBytes: number;
  trackedBytes: number;
  limitBytes: number;
}
```

Definitions are exact:

- `quotaBytes`: `SUM(size)` for versions whose state is not `deleting`; this matches the existing 250 MiB upload quota calculation.
- `extractedBytes`: `SUM(extracted_bytes)` for versions whose state is not `deleting`.
- `pendingCleanupBytes`: `SUM(size + extracted_bytes)` for versions whose state is `deleting`.
- `trackedBytes`: `quotaBytes + extractedBytes + pendingCleanupBytes`.
- `limitBytes`: the existing `WORKSPACE_MEMBER_LIMIT_BYTES` constant.

Failed non-deleting uploads remain in `quotaBytes` because that is the current quota contract. A deleting object remains in `pendingCleanupBytes` until metadata cleanup finishes, even if one underlying R2 delete already succeeded. These values describe metadata-tracked occupancy; they do not prove that every referenced object exists and cannot discover orphan R2 objects.

Return `usage` with the Workspace list response. The additive `usage` object contains only the five numeric fields above and omits R2 object keys, extracted object keys, paths, checksums, and internal operation data; existing file/version projections remain unchanged. Keeping aggregation in the member's Root TeamAgent preserves tenancy and avoids administrator-wide enumeration.

## React Projection

The files workspace renders a compact, unframed usage summary above the file controls:

- quota usage against the 250 MiB source-file limit;
- parsed artifact bytes;
- pending cleanup bytes when non-zero;
- a short accessible label that identifies all values as metadata-tracked.

The quota progress indicator uses only `quotaBytes / limitBytes`; `trackedBytes` is not presented as a quota percentage because parsed and deleting artifacts are outside the current upload limit. Existing loading, ready, error, empty, upload, rename, pin, delete, retry, and download states remain intact. Formatting uses integer byte values with stable labels and no filenames or storage keys.

## Compatibility And Rollback

- Public Workspace responses gain an additive `usage` object; existing file entries and `maxFileBytes` remain unchanged.
- Storage schema and R2 objects are unchanged; no migration or bucket scan is required.
- Member and Provider runtime behavior remains unchanged and is locked by tests.
- The Node/Workers split missed the final performance threshold and has been removed. Future attempts must repeat the three-sample gate rather than restoring the split from history.
- Reverting the work commit removes the additive UI/API projection without deleting user data. Production rollout and rollback remain GitHub Actions only.

## Evidence Sources

Repository findings, benchmark samples, test ownership, platform compatibility notes, and residual risks are recorded in `research/current-capacity-and-test-baseline.md`.
