# ACL transfer deletion export and tools design

## Ownership Transition

Transfer is a revisioned state machine under one operation fence and exact stable
resource identity. It records current owner, proposed owner, acceptance/policy,
revision, audit evidence and recovery state. Storage routing never derives from
mutable owner labels.

## Deletion and Tombstones

Owner deletion performs a preflight over every owned resource and requires an
explicit transfer or tombstone disposition. Tombstones carry stable resource and
revision identity so stale clients/imports/retries/projections fail closed.

## Export Boundary

Principal-scoped export separates owned payloads from approved bounded shared
references/snapshots. Server policy owns inclusion. Root memory, credentials,
OAuth tokens and another principal's local context are never inherited.

## Files, Tools and Trust

File/tool rights are explicit actions under resource and ACL revision. Read-only
tools may be separately approved; unknown and side-effect tools default deny.
Side effects require confirmation per call. Any ACL/owner revision invalidates
prior trust before another invocation.

## Rollout and Rollback

Enable transfer only after interruption drills, deletion/export only after their
matrices, and tools last. Rollback freezes new transitions/invocations, preserves
the current authoritative owner and tombstones/history, and reconciles pending
operations.
