# Provider turn deadline and fallback progress

## Goal

Prevent one member turn from waiting through a separate full timeout for every
Provider fallback candidate. Chatus must bound the complete pre-visible Provider
run, show truthful and secret-free progress while fallback is still possible,
and leave enough passive request-correlated evidence for an administrator to
diagnose the failure without sending a probe.

## Dependencies and confirmed facts

- `PROVIDER_FIRST_VISIBLE_DEADLINE_MS` is 60 seconds and
  `createFallbackLanguageModel()` creates a fresh deadline inside every
  candidate attempt (`src/services/provider-first-visible-deadline.ts:1-38`,
  `src/services/fallback-language-model.ts:109-174`). Three stalled candidates
  can therefore consume about 180 seconds plus planning, lease, settlement, and
  transport overhead before the member sees `upstream_timeout`.
- Logical routes may contribute their full configured fallback chain, and each
  logical route may expand to multiple Provider offerings
  (`src/services/provider-router.ts:45-50`,
  `.trellis/spec/platform/provider-plan-runtime.md:21-32`).
- Fallback is already forbidden after visible output, user cancellation does
  not fall back, and committed streams intentionally have no post-visible idle
  deadline (`.trellis/spec/frontend/agent-streaming.md:372-382,417-420`). This
  task preserves those boundaries.
- Provider capacity uses one shared wait deadline of at most 10 seconds. Attempt
  admission, budget reservation, settlement, leases, and one-message quota
  accounting are already durable and must not be bypassed by the new deadline.
- The member UI currently shows only an unbounded elapsed first-output counter
  (`client/src/components/ChatWorkspace.tsx:627-637,891-898`). It cannot tell
  whether a bounded fallback run is progressing or how much server budget
  remains.
- The server already reuses one secret-free request reference in Agent errors,
  structured failure logs, and passive route reliability. Reliability records
  retain timeout/fallback/latency and the React admin can filter by request
  reference without a synthetic request (`src/services/route-reliability.ts`,
  `client/src/components/ReliabilityAdminPanel.tsx:38-45,94-118`).

## Requirements

### R1. One pre-visible budget for the complete Provider run

- Add one code-owned 90-second pre-visible deadline for a logical Provider run.
  The first main-answer budget begins before candidate-plan preparation; later
  AI SDK Provider runs such as tool continuations receive their own run budget.
- Candidate planning that ignores abort may finish in the background, but a late
  result must be rejected and must never start a Provider attempt after the run
  deadline.
- Every candidate keeps the existing 60-second per-attempt first-visible cap,
  further limited by the remaining run budget. Fast failures may still advance
  through eligible candidates, but accumulated planning, capacity waiting,
  attempt I/O, pre-visible reads, required attempt settlement, and fallback may
  not exceed the run budget.
- Deadline expiry aborts the active upstream request, cancels its pre-visible
  reader, releases the Provider lease and turn resources, settles any started
  attempt as `timed_out/upstream_timeout`, and prevents every later candidate.
- The run deadline commits at the same first visible part as the existing
  fallback boundary. A valid committed stream may continue beyond 90 seconds;
  this task adds no post-visible idle deadline.
- Parent cancellation remains `AbortError/request_cancelled`, never becomes a
  timeout sample, and never opens fallback. Blocking attempt-ledger or budget
  errors still make zero additional Provider calls.

### R2. Bounded, truthful member progress

- Define one exact-shape versioned progress frame for the conversation Agent.
  It may contain only a normalized request reference, monotonic sequence,
  phase, attempt ordinal, bounded candidate count, and server-issued
  run/deadline timestamps.
- Supported phases are finite and user-relevant: candidate planning/capacity,
  primary attempt, and pre-visible fallback. Frames must not contain Provider or
  offering IDs, model names, endpoints, credentials, upstream messages, prompt
  content, tool payloads, or arbitrary notes.
- Broadcast progress only for the currently running conversation turn. The
  client strictly decodes frames, accepts only monotonic state for the newest
  request, ignores malformed/stale/foreign frames, and clears progress on first
  visible output, terminal error, cancellation, disconnect, conversation
  switch, or idle state.
- While no visible output exists, the React workspace shows the exact attempt
  ordinal when available and a bounded remaining-time projection from the
  server deadline. If a frame is missed, keep the existing generic waiting
  state rather than inventing a fallback attempt.
- Progress is ephemeral transport state. It must not enter Agent public state,
  transcript/message metadata, browser persistence, export, logs, or recovery.

### R3. Passive reliability correlation

- Every started attempt continues to use a distinct attempt identity and the
  same main-run turn/run identity. Fallback never reuses an attempt or charges
  the user message quota again.
- Attempt success/failure callbacks caused by the run deadline must retain the
  same normalized request reference shown in the member error and progress
  frame. Shared passive reliability remains disabled for BYOK outcomes.
- A run-deadline failure projects to the existing canonical
  `upstream_timeout` member error. Raw upstream/provider text and provider IDs
  remain absent from the public envelope.
- The Reliability admin view remains passive-only and can locate the newest
  affected route/provider rows by the copied request reference, showing timeout,
  fallback, latency, and observation time without issuing a model request.
- Telemetry failure must never change the member outcome, extend the run budget,
  or start another Provider attempt.

### R4. Rollout and compatibility

- Use a code-owned 90-second value in the first release; do not add an admin or
  environment timeout knob until measured evidence supports a safe range.
- Keep the 60-second per-attempt contract, Provider ordering, reliability-based
  tie-breaks, BYOK terminal policy, budget enforcement, route permissions,
  Automatic Skill five-second boundary, and 0.x SemVer behavior unchanged.
- Tests use fake timers, deterministic local fake Provider streams, and the
  existing local fake-Provider Agent runner only. No live model, synthetic
  Provider probe, live MCP/OAuth request, or local production deployment is
  allowed.

## Acceptance Criteria

- [x] AC1. Fake-timer tests prove three stalled fallback candidates terminate at
      the single 90-second run boundary instead of accumulating three 60-second
      waits, and no candidate starts after the boundary.
- [x] AC2. A fast primary failure may reach a fallback within the remaining
      budget; a 60-second primary timeout leaves only the run remainder, and all
      planning/lease/reader dependencies that settle late are ignored.
- [x] AC3. First visible output commits both deadlines, route fallback cannot
      reopen, and a committed stream remains valid beyond 90 seconds.
- [x] AC4. Parent cancellation, blocking budget/ledger errors, candidate
      settlement, lease release, quota charging, and attempt/run identities keep
      their existing exact behavior under deadline races.
- [x] AC5. The progress frame is exact-shape, bounded, monotonic, request-scoped,
      secret-free, ephemeral, and emits truthful planning/primary/fallback state.
- [x] AC6. React shows bounded first-output progress on desktop and 390px touch,
      ignores stale/malformed frames, falls back to generic waiting when evidence
      is absent, and clears state at every terminal/switch boundary.
- [x] AC7. Deadline attempts record passive timeout/fallback evidence with the
      same request reference as the progress/error UI; BYOK and telemetry-failure
      exclusions remain intact and no probe is introduced.
- [ ] AC8. Focused fallback, Agent, error, reliability, client, and Workspace
      tests pass using local fixtures, followed by the full repository gate,
      Trellis/spec update, PR CI/artifacts, exact-main deployment acceptance,
      delivery evidence, and archive validation.

## Local Acceptance Evidence

- AC1-AC3: fake-timer fallback tests cover stalled stream and generate candidates, transferred planning time, fast fallback, no post-deadline Provider start, and a committed stream continuing past 90 seconds.
- AC4: fallback/lease/TeamAgent tests cover parent cancellation, blocking budget and ledger admission, late settlement, late capacity winners, exact lease release, quota reuse, and Provider run/attempt identity.
- AC5: shared server/client contract tests reject malformed IDs, unknown keys, contradictory phase ordinals, altered duration, and stale sequence/timestamp state; emitted frames remain bounded and secret-free.
- AC6: full Workspace Playwright covers generic/evidenced waiting, clearing, desktop, and touch-enabled 390px containment; local fake-Agent acceptance observes the actual raw broadcast and verifies it never enters localStorage.
- AC7: TeamAgent and fallback tests reuse the normalized request reference in progress and passive reliability, preserve canonical timeout projection, keep BYOK excluded, and prove broadcast/telemetry callback failure cannot affect routing.
- AC8 remains open until the work commit, exact-head PR checks/artifacts, exact-main deployment and production acceptance, delivery evidence, and archive validation all complete.

## Out of scope

- A post-visible idle/no-byte timeout or partial-response recovery UX.
- Parallel hedged Provider calls, speculative execution, or automatic retry of
  the member message after terminal failure.
- Dynamic timeout selection from passive quality, per-Provider timeout fields,
  or an administrator-editable deadline.
- New routing weights, changes to Provider priority, or a synthetic health probe.
- Live Provider/MCP/OAuth tests or local production deployment.
