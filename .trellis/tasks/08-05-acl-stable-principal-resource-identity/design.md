# ACL stable principal and resource identity design

## Identity Contracts

- `Principal`: immutable opaque ID plus status and versioned mutable aliases.
- `ConversationResource`: immutable resource ID, current owner principal ID,
  revision and exact Agent/storage routing identity.
- `MigrationMarker`: source identity/version, target IDs, reconciliation digest,
  state and idempotency fence.

Exact storage owners are selected after `trellis-before-dev` inspects Root
TeamAgent, UserState, conversation Agent and current membership/auth contracts.

## Migration Flow

1. Create principals and aliases without changing Agent names/routing.
2. Backfill resource/owner IDs and markers; reject ambiguous mappings.
3. Reconcile one-to-one identity and retain unresolved reports.
4. Add resource-derived routing behind dual-read compatibility.
5. Compare projections and route assertions on deterministic fixtures.
6. Flip routing only after exact parity; keep ACL disabled.

## Security and Compatibility

All server boundaries resolve authenticated labels to one principal, then assert
the exact resource/Agent identity. Clients cannot supply authoritative principal,
owner or routing IDs. Unknown migration/schema state fails closed.

## Rollback

Disable the new routing selector and retain old owner access while preserving
stable IDs, aliases, markers and migrated data for repair. Never delete IDs or
rebind Agents to mutable labels.
