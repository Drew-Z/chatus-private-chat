# Legacy browser admin alias rollout design

## Boundary

The exact boundary is the `/admin.html` compatibility route and its code-owned
manifest record. `/react-chat/admin` is the replacement. Other legacy browser
routes and APIs remain separate surfaces.

## Evidence Flow

1. Version the record with owner `frontend`, 7-day write/read durations, and only
   the phase ceiling supported by the current change.
2. Record every admitted alias hit as content-free `read` use, including caller
   classification and exact deployment SHA.
3. Characterize any build/deploy operation that could count as `write`; otherwise
   retain deterministic zero-write evidence.
4. Reconcile redirect/auth/query/error behavior with the React route.
5. Rehearse the routing switch, disable the compatibility read, observe, and
   advance only with strict evidence references.

The counter stores no URL query, label, header, access code, token, or log text.

## Controls and Rollback

The record's read control owns alias admission. Rollback restores the exact route
to its prior redirect behavior and returns the record to `recovery_proven`.
Unknown manifest state, stale revisions, missing caller coverage, or a new alias
hit blocks progression.

## Compatibility

Deployment smoke and browser fixtures must target the supported React admin route
before they stop exercising the alias. A test change is caller migration evidence,
not proof of production caller absence. Physical route deletion is deferred.
