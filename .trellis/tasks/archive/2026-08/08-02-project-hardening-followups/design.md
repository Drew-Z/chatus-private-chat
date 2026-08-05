# Design: Project Hardening Follow-ups

## Boundary

The parent task coordinates eight independently verifiable child deliverables. Children own implementation and tests; the parent owns shared contracts, ordering, integration review, and exact-SHA delivery evidence.

## Dependency Shape

1. Admin config compatibility recovery is the first P0 because the production admin surface is currently blocked.
2. Cleanup reliability and public error redaction are P0 safety boundaries.
3. Skill/quota/route governance depends on the public error contract and may add shared telemetry helpers.
4. Frontend/legacy experience can proceed independently but must consume safe error codes; it may retire the static admin only after an atomic, fail-closed route-to-provider migration exists.
5. CI/delivery hardening should land before the final child integration so every later PR receives the stronger gate.
6. Test performance/capacity is last because it may alter test partitioning and shared concurrency assumptions.
7. Production acceptance cleanup recovery follows the first production acceptance failure and hardens temporary-member purge, session revocation, stale-label cleanup, and final release verification without changing product behavior.

## Shared Contracts

- Public errors use typed, bounded codes/messages; detailed diagnostics remain server-side and redacted.
- Retry records are durable, idempotent, bounded by attempt/backoff policy, and deleted only after all required side effects succeed.
- Telemetry is passive: it cannot block a user request, cannot contain prompt/content/secrets, and must define isolation and concurrency semantics.
- CI manifests contain exact commit/run/artifact identifiers without credentials or user content.

## Compatibility and Rollback

- Preserve existing API success schemas unless a child documents a versioned migration.
- Preserve logical route IDs and every permission/default/fallback/public reference while moving inline transport fields into Provider + Offering records.
- Use feature flags or additive records for new retry/concurrency behavior; old records must be safely readable.
- Each child is one rollback boundary. Code deployment and rollback are GitHub PR/redeploy operations at exact SHAs. The one approved production configuration mutation is the authenticated React legacy-route migration; CI and local scripts must not perform it.

## Evidence Strategy

Every child must include failure injection or deterministic fixture evidence, local full checks, a PR CI run, exact main SHA deployment/acceptance evidence when code paths change, and archive validation. Design-only capacity decisions must be recorded as decisions rather than implemented.

## Final Integration Result

All eight children are archived with checked acceptance criteria, resolvable work commits, PR evidence, and local-fake validation. The final deployable code SHA is `0d06d1074175ae93b2ed15df6144570e4d76ee90`; later commits contain only Trellis records and correctly skip deployment. Cross-child review found no contract conflict across cleanup ordering, public-error redaction, quota admission, Provider capacity, admin compatibility, route migration, or tracked Workspace occupancy. The package remains `0.1.0`.
