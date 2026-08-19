# Default capability packs delivery design

## Delivery Strategy

Use a normal merge of `origin/main` into the published PR branch. The branch
already contains public merge commits and is under review, so rebasing would add
force-push risk without improving the final squash-merge result.

The merge base is `e074560`, the PR #96 merge. Main-only changes are the PR #98
CI reliability fix and PR #99 Trellis archive. A merge-tree simulation shows
only three content conflicts, all in generated or append-only workspace records.

## Conflict Resolution

For `.trellis/workspace/codex/journal-1.md`, keep the branch's capability
sessions and append the main-only Playwright CI session under a unique sequence.
Do not discard or duplicate either history. The delivery session added at task
finish receives the next sequence.

For `.trellis/workspace/codex/index.md`, rebuild the current status, line count,
session total, and ordered history from the reconciled journal. For
`.trellis/workspace/index.md`, regenerate the developer projection with the
Trellis consistency command instead of choosing either conflict side manually.

PR #99's task archive is a non-conflicting rename and must remain completed under
`.trellis/tasks/archive/2026-08/`.

## Compatibility And Change Boundary

The merge introduces no application-side `main` changes after PR #96. Capability
code remains the feature-branch version, while CI and delivery governance take
the newer `main` version. Integration fixes are allowed only when a current test
demonstrates a regression caused by combining those states.

The delivery task does not change configuration migration, assignments,
capability disclosures, auxiliary execution, or monitoring contracts. Existing
stored configuration and deny-all semantics remain untouched.

## Validation And Remote Delivery

Run build/test commands serially because frontend generation is consumed by
Worker tests. Browser suites use local fixtures and the fake Provider. After
local gates pass, push normally, wait for all PR checks, and only then mark the
PR Ready. Final merge remains a separate explicit decision.

## Rollback

Before push, abort or revert only the merge/integration changes while preserving
the published feature history. After push, a normal revert commit is preferred
over rewriting the branch. Do not roll back PR #98 or PR #99 on `main`.

## Protected Boundaries

- Do not modify or advance any legacy rollout task, gate, workflow, or evidence.
- Do not modify PR #93 or the archived production observation task/evidence.
- Do not deploy production or run live Provider, MCP, OAuth, or model probes.

