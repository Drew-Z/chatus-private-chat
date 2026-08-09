# Provider turn deadline and fallback progress design

## 1. Boundary

This task adds an outer pre-visible budget around the existing candidate-level
first-visible deadline. It does not change the rule that a Provider is committed
by the first visible stream part, and it does not bound a committed stream.

```text
member turn
  -> optional Automatic Skill selection (existing independent 5s boundary)
  -> create main-run budget (90s absolute deadline)
  -> prepare candidate plan
  -> wait for capacity
  -> attempt 1 (min(existing 60s, run remainder))
       -> fast eligible failure -> settle -> attempt 2
       -> visible output -> commit run + attempt deadline -> normal stream
       -> run deadline -> abort/settle/release -> upstream_timeout
```

The 90-second budget covers candidate preparation through the first visible part
for the main answer. The prepared model creates a fresh budget for each later AI
SDK Provider run, including tool continuations, because those are separate
`runId` values under the same admitted `turnId`.

## 2. Deadline ownership

`provider-first-visible-deadline.ts` remains the primitive owner. Extend it with
an explicit bounded duration/absolute-deadline input and distinguish parent
cancellation from code-owned timeout without changing the public
`TimeoutError`/`AbortError` projections.

`prepareTeamAgentTurn()` creates the initial run deadline immediately before
`preparePlan()`. It races preparation so abort-ignorant dependency completion is
discarded, then transfers the live deadline to the first model invocation. If
preparation rejects or produces no model, it disposes the deadline and releases
admission resources.

`createFallbackLanguageModel()` owns one outer deadline per `doStream()` or
`doGenerate()` invocation. The first invocation may consume the transferred
deadline; subsequent invocations create a new 90-second run deadline. Each
candidate still creates the existing 60-second child deadline with the outer
signal as parent. `canFallback()` must check both the caller signal and the outer
deadline before acquiring or starting another candidate.

The attempt lifecycle ordering remains:

1. acquire capacity;
2. recheck both signals/deadlines;
3. start durable attempt/budget admission;
4. call Provider with the child signal;
5. settle failure before advancing;
6. recheck remaining run budget before the next acquisition.

A late promise is observed only to suppress unhandled rejection; it cannot
commit output, record success, update a Skill snapshot, or trigger fallback.

## 3. Progress protocol

Add a shared strict contract, for example:

```typescript
type ProviderTurnProgressV1 = {
  type: "chatus_provider_turn_progress";
  version: 1;
  requestId: string;
  sequence: number;
  phase: "planning" | "waiting_capacity" | "attempting" | "fallback";
  attempt: number;
  candidateCount: number;
  startedAt: number;
  deadlineAt: number;
};
```

`attempt=0` is valid only for planning/capacity before a specific attempt. A
primary attempt uses ordinal 1; fallback requires ordinal greater than 1. Counts,
timestamps, request IDs, phases, keys, and unknown fields are strictly validated.

`TeamAgent` passes a progress callback into turn preparation. It serializes the
normalized frame and uses the existing conversation WebSocket broadcast. The
frame is a Chatus-specific ephemeral message; AIChat messages and stream chunks
remain untouched. Only bounded fields are broadcast and no progress frame is
written to Agent storage.

The React `useAgent()` connection observes raw messages in addition to
`useAgentChat()`. A dedicated decoder accepts only the exact progress type. The
component keeps the latest `(requestId, sequence, startedAt)` while the turn is
busy, rejects older sequences/timestamps, and clears it when `waitingFirstOutput`
ends or the conversation/connection changes.

The waiting row renders a neutral generic state until a valid frame arrives.
With evidence, it may render “正在尝试可用线路 1/3” or “正在尝试备用线路 2/3” plus
bounded remaining seconds. It never names a Provider, model, endpoint, or error.

## 4. Reliability and error correlation

The Worker already passes `input.requestId` to every shared reliability write.
The new outer deadline must travel through the same failure callback as an
ordinary attempt timeout, so the ProviderCoordinator sample remains
`outcome=timeout`, keeps fallback state, and uses the exact progress/error
request reference. The public Agent envelope remains the strict existing
`upstream_timeout` shape.

No new active telemetry source is added. Provider attempt ledger records remain
the authoritative billable-call evidence; bounded passive reliability remains a
rebuildable quality/admin projection. BYOK samples remain excluded.

## 5. Compatibility and failure handling

- Existing callers that do not supply a transferred run deadline receive a new
  code-owned 90-second deadline automatically.
- The legacy stream adapter's per-attempt 60-second deadline remains unchanged.
- The Automatic Skill selector keeps its independent five-second whole-pipeline
  deadline and does not consume the main-answer budget.
- Budget or ledger admission failure is blocking and cannot be reclassified as
  a timeout or open fallback.
- Telemetry/broadcast failure is swallowed after bounded logging rules; it cannot
  alter routing or extend the deadline.
- If custom progress is missed during reconnect, AIChat recovery continues and
  the UI shows its existing generic recovering/waiting state.

## 6. Rollout and rollback

Ship the deadline, progress decoder/UI, and correlation tests together because a
harder timeout without truthful progress would make the UX less diagnosable.
Production deployment remains GitHub Actions-only.

Rollback removes the outer run budget and custom progress broadcast/UI while
retaining attempt ledger and passive reliability evidence. The existing
60-second per-attempt deadline and all fallback, budget, quota, and cancellation
contracts remain the safe baseline.
