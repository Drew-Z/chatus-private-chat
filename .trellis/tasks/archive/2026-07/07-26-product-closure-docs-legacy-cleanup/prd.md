# Product Closure Docs And Legacy Cleanup

## Goal

Close the remaining productization gaps that block Chatus from being understandable and maintainable as an independent teammate-facing product: installation and operations documentation must match the current public-guest/provider-pool reality, and legacy protocol/storage removal must be audited before any destructive cleanup.

## Background

- The parent productization task still has open Slice 4 items: remove the custom chat SSE/tool-approval protocol, remove legacy chat storage after migration verification, complete installation/operations/backup/migration/rollback documentation, and keep optional BIAU integration disabled until standalone acceptance.
- `README.md`, `docs/self-hosting.md`, and `docs/operations.md` already document provider pools, managed access, GitHub-Actions-only deployment, and model-free operations, but they were written before the final public guest access task.
- The current codebase still preserves rollback and migration paths. This task must not delete legacy storage or protocols until acceptance evidence proves the replacement path is sufficient.

## Requirements

### R1. Documentation closure

- Update the README, self-hosting guide, and operations runbook so a clean third-party operator can configure Chatus without maintainer-specific IDs, hidden access-code steps, or live model probes.
- Document public guest access setup, managed provider secrets, member creation, production acceptance, rollback, secret deletion, and the distinction between GitHub Secrets, Cloudflare Worker Secrets, and KV-managed state.
- Preserve the rule that production deployments run only through GitHub Actions.

### R2. Legacy cleanup readiness audit

- Inventory legacy chat protocol, legacy storage, compatibility route config, old static/admin surfaces, and migration/rollback dependencies.
- Classify each legacy surface as removable now, removable after production acceptance, or retained as rollback.
- Do not remove storage, Durable Object data, or user-owned history in this task unless a later implementation checklist explicitly proves safe deletion.

### R3. Product roadmap alignment

- Record the post-productization roadmap as independently verifiable child tasks: file upload/workspace context, optional BIAU read-only MCP, legacy removal, and install/ops polish.
- Avoid mixing documentation closure with unrelated feature implementation.

## Acceptance Criteria

- [ ] README/self-hosting/operations describe the current public guest, managed member access, provider-pool, and secret lifecycle accurately.
- [ ] The docs state that no scheduled/automatic model liveness probes are allowed and that production deploys are GitHub-Actions-only.
- [ ] A legacy cleanup audit lists concrete files/endpoints/storage keys and their removal conditions.
- [ ] The audit identifies which cleanup requires production acceptance evidence and which can be done locally.
- [ ] No real credentials, access codes, conversation content, stored memories, production IDs, or maintainer-specific values are introduced.
- [ ] Validation includes documentation review, `git diff --check`, Trellis validation, and any focused tests needed for changed scripts or docs references.

## Out Of Scope

- Implementing the file upload feature.
- Optional BIAU MCP integration.
- Deleting legacy storage or old rollback surfaces without a separate approved implementation task.
- Changing GitHub Actions deployment semantics beyond documentation and audit notes.
