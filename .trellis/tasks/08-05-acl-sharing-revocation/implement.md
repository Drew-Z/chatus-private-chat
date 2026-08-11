# ACL sharing and revocation implementation plan

## Preconditions

- [x] Create/switch to `codex/acl-sharing-revocation`, record branch/base/scope,
      activate this child only after planning validation, then run
      `trellis-before-dev` for platform and frontend layers.
- [x] Re-read the exact code to be changed and enumerate the final route/action
      matrix against `handleApi`, `handleTeamAgentRequest`, root/conversation
      TeamAgent RPCs, React API helpers and all owner-only adjacent paths.

## Ordered implementation

### 1. Contract and registry foundation

- [x] Add strict ACL roles/actions/snapshot/grant/RPC decoders to
      `src/contracts/identity.ts`; reject unknown and expiry fields.
- [x] Append IdentityRegistry schema migration v2, capture tables and inspection
      counts in `src/identity-registry.ts`.
- [x] Implement resource-by-ID/access/list/grant/revoke/final-fence RPCs using one
      access revision transaction and existing operation fingerprint storage.
- [x] Add registry unit tests for migration, owner synthesis, role matrix, bounded
      cursor, alias retirement, idempotent no-op/replay, operation conflict,
      revision conflict, audit retention and capture/restore table coverage.

### 2. Worker authorization and bounded summaries

- [x] Add one server action resolver and stable error projection in `src/worker.ts`.
- [x] Add root `getConversationSummary(id)` and merge bounded owned/shared list
      results without listing another owner's root.
- [x] Require exact resource/chat assertions across Agent transport, PATCH,
      branch, delete, ACL, workspace refs, file attachment, feedback and export;
      retain documented owner-only compatibility when `resourceId` is absent.
- [x] Add owner-only share list/upsert/revoke endpoints and schedule best-effort
      resource invalidation only after the authoritative registry transaction.
- [x] Add Worker tests for unauthorized undiscoverability, forged IDs/roles,
      exact path matrix, share target lifecycle, stale revisions and derived
      invalidation failure.

### 3. Resource Agent actor separation and revoke fence

- [x] Separate stable owner identity props from the server-derived request actor;
      never persist or trust browser access metadata.
- [x] Make owner turns preserve current behavior. Make editor turns use actor
      quota/telemetry plus resource settings with no root memory, workspace
      context, API key, OAuth, tools or inherited trust. Deny viewer sends before
      Provider preparation.
- [x] Register active turns by actor/access revision, add best-effort revision
      invalidation/abort and clear trust on every ACL revision.
- [x] Snapshot tentative transcript/index state and run the final registry access
      fence before durable message/activity commits. On stale/revoke, abort and
      restore the baseline; release Provider/tool/instance state exactly once.
- [x] Add fake-Provider/fake-MCP Agent tests for owner parity, editor attribution,
      zero context/token/tool leakage, viewer denial, revoke during prepare/stream/
      persistence, stale resume and zero remote calls.

### 4. React experience

- [x] Extend API and conversation state with stable resource/access fields and
      update SDK client naming/query to the exact resource.
- [x] Add the owner share dialog with exact-label grant, viewer/editor selector,
      role change, React Dialog revoke confirmation, loading/error/ready recovery
      and accessible focus/keyboard behavior.
- [x] Add shared-role indicator and owner/editor/viewer gating to sidebar,
      workspace, composer, attachments, message actions, route/Skill controls,
      feedback, tool approvals and delete/share commands.
- [x] On access 404/409, refresh/remove stale shared state and select a valid
      fallback without reconnect loops.
- [x] Update frontend static checks, Vitest and Workspace Playwright fixtures for
      owner management, viewer, editor, revoke, reload and narrow viewports.

### 5. Last-iteration verification and governance

- [x] Run `trellis-check` inline and fix all spec/data-flow/type/test findings.
- [x] Run `npm run check:frontend`, `npm test`, `npm run typecheck`,
      `npx wrangler deploy --dry-run`, `git diff --check` and
      `python ./.trellis/scripts/task.py validate-all`.
- [x] Run complete Workspace Playwright plus the local fake-Provider Agent suite;
      use only local fake Provider/MCP fixtures.
- [x] Run `trellis-update-spec`; update authorization, identity, privacy, Agent
      streaming, workspace/file, memory, tool/OAuth/export and backup/restore
      contracts, and append `ACL-03` / partial `ACL-04` evidence.
- [ ] Commit the coherent work, open a PR, wait for exact-head required CI, merge,
      wait for exact-main GitHub Actions deployment/production smoke, and retain
      SHA/artifact/expiry evidence. Never deploy production locally.
- [ ] Record validations/work commit/PR/deployment evidence, verify every AC and
      risk item, archive this child, update the parent roadmap and journal, commit
      documentation-only records directly without triggering deployment, then run
      final full consistency validation.

## Risky files and rollback points

- `src/identity-registry.ts`: append-only schema migration; rollback disables ACL
  behavior and retains tables/events.
- `src/worker.ts`: exact routing/owner compatibility; unauthorized access must be
  404 and shared access must never fall back to caller ownership.
- `src/agent/team-agent.ts`: Agents SDK persistence timing and active-stream abort;
  tests must prove tentative messages are removed on stale commit fences.
- `client/src/components/ChatWorkspace.tsx`: resource-derived SDK client identity;
  stale tabs must not reconnect to a caller-owned conversation with the same ID.

Operational rollback order: disable new grants/editor mutations, transactionally
revoke active grants, abort shared turns and clear trust/caches, preserve owner
access plus all stable identity/ACL history, then reconcile derived state.

## Activation review gate

- [x] PRD has no blocking open questions and every requirement maps to AC1-AC9.
- [x] Design names exact schema, RPC/API, action matrix, stream linearization,
      compatibility, rollback, privacy and unsupported behavior.
- [x] Inline mode is retained; `implement.jsonl` / `check.jsonl` curation is not
      required and no implement/check sub-agent will be dispatched.
