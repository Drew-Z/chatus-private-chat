# Provider budget engine and enforcement design

## State Machine

```text
requested -> reserved -> settled
                    \-> released
                    \-> unknown-hold -> reconciled/operator-review
```

Every transition is append-only, scoped, fenced and idempotent. The authoritative
scope projection updates atomically with its event or through an equivalent
single-owner transaction boundary selected after current topology inspection.

## Execution Contract

The Provider boundary requires a reservation token before network execution.
Fallback creates another reservation after prior billable evidence is settled.
Unknown price or unavailable policy fails closed for hard mode unless a versioned
approved conservative policy says otherwise.

## Rollout

Deploy the event engine in shadow/alert mode, compare expected and actual costs,
run concurrency/crash drills, then enable one approved scope. Other scopes remain
soft/unsupported. Enforcement and projection health are independently observable.

## Partial Failure and Rollback

Provider success is not discarded merely because settlement storage is delayed;
the approved outage policy determines admission and a durable pending settlement
is reconciled. Rollback disables new enforcement/reservations, preserves all
events/fences/holds, and continues reconciliation.
