# ACL sharing and revocation design

## Authorization Model

The authoritative decision joins authenticated principal, stable resource,
resource revision, active grant revision and requested action. Client role or
resource metadata is advisory only. Denial is the default.

## Grant State

Grants are versioned, idempotent and auditable with grantor, grantee, resource,
role, revision, status and bounded timestamps. Only one active owner exists, but
ownership is unchanged by this task.

## Enforcement

Worker/Agent/API boundaries share one policy vocabulary, but each owning server
path performs its own authorization and exact resource identity assertion.
Editor commits include expected resource/ACL revision. Streams and cached reads
observe authoritative revocation and stop/deny stale access.

Files, tools, root memory, credentials/OAuth and shared exports are explicit deny
rules, not missing implementation assumptions.

## Rollout and Rollback

Roll out owner/viewer first, then explicitly approved editor actions. Rollback
disables new grants and shared mutations, revokes execution, clears derived
trust/caches, and preserves ACL history, stable IDs and owner access.
