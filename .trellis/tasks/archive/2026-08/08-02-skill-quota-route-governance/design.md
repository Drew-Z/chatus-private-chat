# Design: Automatic Skill 配额与 Provider 路由治理

## Boundaries

- `prepareTeamAgentTurn()` owns one turn-level admission and cancellation decision.
- `route-reliability.ts` owns normalization, BYOK isolation, bounded reducers, KV projection keys, and failure isolation.
- `ProviderCoordinator` owns serialized aggregate mutation per physical Provider.
- `fallback-language-model.ts` and `provider-stream-runtime.ts` own their respective pre-visible-output deadlines; neither changes the fallback plan or user-facing error projection.

## Turn Admission Flow

`prepareTeamAgentTurn()` keeps `let admission: TurnAdmission | undefined` and an `admitOnce()` helper. Before selection it derives the same enabled/assigned Automatic Skill candidate set used by the selector.

1. Validate session, prompt, selected public route, image compatibility, and pre-aborted request as today.
2. If the turn is member + automatic and has at least one eligible Skill, call `admitOnce(input.continuation !== true)` before selector planning can acquire a Provider lease.
3. Run selection with the precomputed candidates, then reload config/access and revalidate the result as today.
4. If the parent signal is aborted, return `request_cancelled` immediately and do not build or start the main Provider.
5. Prepare the main route plan. Manual turns and automatic turns with no selector Provider work call `admitOnce()` at the existing late boundary; already admitted turns reuse the same object.
6. Return the single `admission.release` through `releaseTurn`; all existing TeamAgent finish/error/cancel paths remain idempotent.

Quota represents an admitted user message, not Provider-attempt count. A pre-aborted request is rejected before admission. Once an Automatic selector Provider attempt begins, later selector fallback or configuration loss does not refund the message; it has consumed real upstream work. Continuations still enter the same admission flow with `consumeQuota=false`.

## Cancellation Contract

The selector keeps its independent five-second deadline, but parent cancellation is no longer projected as an ordinary selector timeout followed by main preparation. The selector result distinguishes parent cancellation from its own deadline; the caller checks the parent signal immediately after the race and returns the stable cancellation envelope.

Provider leases remain released in `finally`. Any late non-cooperative selector completion is ignored and cannot update the last-success snapshot. The main model never starts after parent cancellation.

The cancellation code/message must use the canonical public Agent error contract when the parked public-error governance change lands. If implementation starts before that branch merges, it must still use a bounded literal code and message and must not serialize an `AbortSignal.reason` or raw exception.

## BYOK Isolation Contract

Change `RouteReliabilityWrite` into a discriminated union:

```typescript
type ChatReliabilityWrite = CommonWrite & {
  operation?: "chat";
  usedUserKey: boolean;
};

type SkillSelectionReliabilityWrite = CommonWrite & {
  operation: "skill_selection";
  usedUserKey?: boolean;
};
```

`recordRouteReliability()` routes selector telemetry first. For shared chat samples it returns immediately whenever `usedUserKey === true`, regardless of status or outcome. Every legacy stream, Agent AI SDK, small completion, and capability loop call site must pass the candidate credential flag on success, protocol failure, HTTP failure, and thrown failure. The required field makes omissions a type error.

Selector telemetry remains a separate operational record. It may include redacted BYOK outcomes because it is not consumed by chat route ordering or shared quality projections.

## Atomic Aggregate Ownership

Extend the existing `ProviderCoordinator` rather than adding another Durable Object class or a KV lock.

```text
ProviderCoordinator instance name = providerId
  provider-leases:v1
  reliability:chat:<encoded routeId>
  reliability:skill_selection:<encoded routeId>
```

The Worker normalizes each attempt into a bounded, secret-free sample. `ProviderCoordinator.recordReliabilitySample()` runs inside `blockConcurrencyWhile()`:

1. Read the operation/route record from Durable Object storage.
2. If absent, read and strictly normalize the existing KV v2 chat aggregate or v1 selector aggregate once as a migration seed.
3. Apply the existing 1,000-sample bounded reducer.
4. Persist the authoritative next record in Durable Object storage.
5. Write the same record to the existing KV key so the route planner and admin projection remain compatible.

The Durable Object record, not a subsequent KV read, feeds the next mutation. This avoids lost updates even if KV projection visibility is delayed. A KV mirror failure is logged only with bounded event/route/provider IDs, never raw error text; the stored DO aggregate survives and a later sample repairs the projection. Reads remain passive and fail closed to unknown quality.

The latest logical-route record remains a non-aggregate last observation in KV. It is still skipped for BYOK and may remain last-writer-wins because no counters are derived from it.

## First-Visible Deadline

Use one named constant, `PROVIDER_FIRST_VISIBLE_DEADLINE_MS = 60_000`, for both streaming stacks. The clock starts after a Provider lease is acquired and immediately before the network/AI SDK attempt.

Each attempt creates a child `AbortController` that forwards the parent signal and owns a timeout reason. The hard boundary races both initial request construction and every pre-visible read, so a non-cooperative fake dependency cannot keep the turn pending. On timeout it aborts/cancels the upstream reader and returns a typed `TimeoutError`; the existing pre-output fallback classifier may advance. Parent cancellation keeps `AbortError` semantics and never falls back.

Once a visible part commits the Provider, clear only the deadline timer while retaining parent cancellation propagation. The committed stream keeps its current completion/error/cancel lifecycle and Provider lease ownership. `firstVisibleLatencyMs` remains text/reasoning-only telemetry; the deadline uses the broader visible commitment predicate.

## Capacity Decision

Do not introduce a member-level lease in this task. The current authorities are:

- User fairness: atomic daily/minute message buckets.
- Guest duplicate-turn control: existing one-turn guest lease.
- Upstream capacity: ProviderCoordinator `unlimited | exclusive | bounded` leases and ten-second queue wait.
- Automatic selector: same Provider lease policy plus the five-second selector boundary.

Changing member concurrency without measured saturation, expected multi-tab behavior, and a product limit could reject legitimate parallel conversations. The later capacity task may add a lease only after those inputs exist.

## Compatibility and Rollback

- No persisted app-config or public API schema changes are required.
- Existing KV aggregate versions stay readable and seed the new authority lazily; no destructive migration or new Durable Object class is required.
- Rollback can route aggregate writes back to KV without deleting the DO records. The KV projection remains current enough for the old reader.
- The 60-second deadline is a local runtime constant. Rolling it back restores unbounded pre-visible waits without schema cleanup.
- All validation uses local fake Provider/MCP fixtures. Production deployment and acceptance remain GitHub Actions-only.
