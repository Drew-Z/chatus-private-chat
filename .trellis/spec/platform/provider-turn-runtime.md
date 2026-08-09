# Provider Turn Runtime

## Scenario: Main-answer run deadline, fallback, and cleanup

### 1. Scope / Trigger

Use this contract when changing `prepareTeamAgentTurn()`, the AI SDK fallback
model, Provider attempt admission, Provider capacity selection, or any deadline
that applies before the first visible main-answer output.

This contract is separate from the legacy SSE adapter's request-local deadline
and from Automatic Skill selection's independent five-second boundary.

### 2. Signatures

```typescript
const PROVIDER_TURN_RUN_DEADLINE_MS = 90_000;
const PROVIDER_FIRST_VISIBLE_DEADLINE_MS = 60_000;

createProviderFirstVisibleDeadline(parentSignal?, {
  timeoutMs?,
  deadlineAt?,
  startedAt?,
}): {
  signal: AbortSignal;
  startedAt: number;
  deadlineAt: number;
  commit(): void;
  dispose(): void;
}

createFallbackLanguageModel(candidates, callbacks, {
  createRun,
  initialRunDeadline?,
  onProgress?,
}): LanguageModelV3
```

`ProviderRunProgressEvent` contains only `phase`, `attempt`, `candidateCount`,
`startedAt`, and `deadlineAt`. The Worker adds the normalized request reference,
monotonic sequence, protocol type, and version before broadcasting it.

### 3. Contracts

- `prepareTeamAgentTurn()` creates the initial 90-second absolute deadline
  immediately before `preparePlan()`. Automatic Skill selection completes first
  under its own five-second boundary and does not consume this budget.
- Candidate planning and turn admission are raced against the initial deadline.
  A dependency that completes late cannot prepare a model, start Provider I/O,
  record success, or open fallback. Any late successful admission is released.
- The first AI SDK Provider invocation consumes the transferred deadline. Every
  later Provider run in the same admitted turn, including tool continuations,
  receives a fresh 90-second deadline and a distinct Provider run ID.
- Each physical candidate uses a child first-visible deadline whose absolute end
  is `min(run.deadlineAt, Date.now() + 60_000)`. Capacity wait, attempt start,
  Provider invocation, pre-visible reads, failure settlement, and the decision to
  acquire a fallback candidate all remain inside the outer budget.
- Attempt ordering is acquire capacity, recheck deadline, start required ledger
  attempt, invoke Provider, settle failure, release lease, then recheck before
  fallback. Budget/ledger admission errors are blocking and make zero Provider
  calls; they never advance to another candidate.
- Parent cancellation preserves `AbortError` and never falls back. Code-owned
  expiry preserves `TimeoutError`, records a timeout for an already-started
  attempt, projects `upstream_timeout`, and cannot start a later candidate.
- The first visible AI SDK stream part commits both child and outer deadlines.
  A successful `doGenerate()` result commits them before terminal telemetry is
  awaited because the complete result is already available for return. A
  committed stream may continue beyond 90 seconds; there is no post-visible idle
  deadline.
- Late capacity winners are observed and released. A late `doStream()` result is
  cancelled. A late attempt handle is terminally settled. Lease release is
  idempotent and lease expiry remains the final recovery boundary.
- Progress callbacks and Agent broadcasts are ephemeral and failure-isolated.
  They never change routing, extend a deadline, enter Provider attempt evidence,
  or persist in Agent messages/state.
- Capacity selection still probes ordered Providers without waiting, then waits
  on at most one contender per Provider under the shared capacity boundary.
  Losing and late-winning leases must be released even when another contender
  ignores abort.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Planning or admission reaches the 90-second absolute deadline | Return `upstream_timeout`; discard late result and release late admission |
| Candidate reaches 60 seconds while outer budget remains | Settle timeout and try only an eligible fallback within the remaining outer budget |
| Outer deadline expires during capacity, attempt start, Provider I/O, read, settlement, or fallback | Stop at one 90-second boundary; do not start another Provider |
| Parent request cancels at any pre-visible phase | Preserve `AbortError`, release resources, and never fall back |
| Budget policy, budget capacity, or required ledger admission fails | Zero Provider calls and zero fallback calls |
| First visible stream part or complete generate result arrives | Commit both deadlines; terminal persistence cannot reclassify the result as pre-visible timeout |
| Stream remains active after commitment past 90 seconds | Continue until normal finish, failure, or cancellation |
| Capacity loser ignores abort and resolves late | Ignore its result and release every acquired lease |
| Progress callback or WebSocket broadcast throws | Continue the same routing outcome without retrying the callback |

### 5. Good / Base / Bad Cases

- Good: planning uses 30 seconds, the primary stalls for the remaining 60
  seconds, and no fallback begins after the shared 90-second boundary.
- Good: the primary fails at 10 seconds, the backup emits visible output at 20
  seconds, both deadlines commit, and the stream completes after 90 seconds.
- Base: a fast primary emits visible output without fallback while progress moves
  from planning to capacity to attempt one.
- Bad: create a new 90-second timer for each fallback candidate, allowing three
  stalled Providers to retain one member turn for several minutes.
- Bad: use `Promise.race()` without observing late leases or streams; the public
  timeout returns while capacity or Provider resources remain owned.

### 6. Tests Required

- With fake timers and local fake models, prove three stalled stream candidates
  and three stalled generate candidates stop at one 90-second outer boundary and
  the third candidate never starts.
- Consume 30 seconds before the transferred model invocation and assert only 60
  seconds remain; separately prove a fast 60-second candidate timeout can reach
  an eligible fallback within the outer budget.
- Assert parent cancellation remains `AbortError`, outer expiry remains
  `TimeoutError`, and blocking budget/ledger errors create zero Provider calls.
- Assert a committed stream remains valid beyond 90 seconds and cancellation
  releases its lease exactly once without fallback.
- Resolve capacity and Provider promises after timeout; assert late winners are
  ignored, late streams are cancelled, attempts are terminally settled, and all
  leases are released.
- Assert progress phases and ordinals are monotonic, deadline timestamps keep the
  exact 90-second duration, and callback failure cannot change the model result.
- Run the full Vitest suite plus the local fake-Provider Agent acceptance. Never
  contact a live model or use a synthetic production probe.

### 7. Wrong vs Correct

#### Wrong

```typescript
for (const candidate of candidates) {
  const deadline = createProviderFirstVisibleDeadline(signal, { timeoutMs: 90_000 });
  await candidate.model.doStream({ abortSignal: deadline.signal });
}
```

Each fallback receives a fresh whole-turn budget, so total waiting grows with the
candidate count and late Provider resources are not owned explicitly.

#### Correct

```typescript
const runDeadline = takeRunDeadline(options.abortSignal);
const attemptDeadline = createProviderFirstVisibleDeadline(runDeadline.signal, {
  deadlineAt: Math.min(runDeadline.deadlineAt, Date.now() + 60_000),
});

const result = await raceWithAbort(
  candidate.model.doStream({ ...options, abortSignal: attemptDeadline.signal }),
  attemptDeadline.signal,
);
```

One absolute run boundary covers planning and every candidate while the child
preserves the established per-candidate first-visible policy.
