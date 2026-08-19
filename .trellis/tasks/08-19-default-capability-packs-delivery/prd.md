# Deliver default capability packs PR

## Goal

Bring PR #97 onto the current `main`, preserve the completed default capability
packs and PR #96 user experience, restore a complete green delivery signal, and
prepare the pull request for an explicit merge decision.

## Background And Confirmed Facts

- PR #97 is a published draft from `codex/chatus-default-capability-packs`. Its
  five implementation children and parent product task are already completed and
  archived; this task does not reopen product design.
- The branch is two commits behind and twenty-two commits ahead of
  `origin/main`. The missing commits are PR #98 (`710505a`) and PR #99
  (`98bf4eb`).
- A merge-tree simulation against `origin/main` reports conflicts only in
  `.trellis/workspace/codex/index.md`,
  `.trellis/workspace/codex/journal-1.md`, and `.trellis/workspace/index.md`.
  There are no application, capability, monitoring, or UI merge conflicts.
- PR #97 previously passed `changes`, `quality`, and `agent-browser`. Its
  `workspace-browser` job was cancelled after the old Playwright installation
  path exhausted the job budget. PR #98 replaced that path with a bounded
  browser-only install and passed the full browser matrix.
- PR #97 already merged the PR #96 commit (`e074560`), so current workspace,
  settings, and model-monitoring presentation is part of the branch baseline.

## Requirements

- Merge the current `origin/main` into the published feature branch without
  rebasing, force-pushing, dropping capability commits, or rewriting PR history.
- Resolve the three Trellis conflicts by preserving both histories. Keep the
  capability sessions, retain the Playwright CI session with a unique sequence,
  regenerate derived workspace projections, and preserve the archived Actions
  minute task from PR #99.
- Accept PR #98's CI workflow and delivery-governance changes exactly unless a
  current structural test proves an integration defect.
- Preserve the completed capability catalog, auxiliary vision, explicit web
  research, member/admin capability UX, privacy boundaries, monitoring, and
  PR #96 visual refinements. Do not add new capability scope during delivery.
- Fix only integration regressions exposed by the merge or current validation.
  Any product redesign or material contract change requires returning to
  planning before implementation continues.
- Run the complete quality gate serially with local fixtures and fake services.
- Update PR #97 only after local validation passes. Make it Ready only after the
  refreshed GitHub quality and browser checks complete successfully.

## Acceptance Criteria

- [x] `git rev-list --left-right --count origin/main...HEAD` reports zero commits
  behind after the merge, with no force push or dropped capability commit.
- [x] The resolved Trellis journal and indexes retain both the capability and
  Playwright CI sessions, use unique session numbers, and pass
  `python ./.trellis/scripts/task.py validate-all`.
- [x] The merged diff contains PR #98's bounded Playwright Chromium install and
  PR #99's completed Actions-minute task archive.
- [x] Capability contracts, UI, monitoring, privacy tests, and the PR #96 visual
  baseline remain present; no unrelated application behavior is changed.
- [x] `npm run check:frontend`, `npm test`,
  `npm run test:browser:workspace`, `npm run test:browser:agent`,
  `npm run typecheck`, `npx wrangler deploy --dry-run`,
  `python ./.trellis/scripts/task.py validate-all`, and `git diff --check` pass
  in the documented serial order.
- [x] PR #97 is pushed without force, all required GitHub checks are green, and
  the draft is converted to Ready for an explicit final merge decision.
- [x] No production deployment, live Provider/model/MCP/OAuth request,
  production observation action, PR #93 mutation, or legacy rollout
  task/gate/evidence mutation occurs.

## Out Of Scope

- New default Skills, MCP servers, external credentials, autonomous agents, or
  changes to capability assignment policy.
- Salvaging PR #93, rebuilding PR #55, dependency migration, or branch cleanup.
- Production deployment, production acceptance, synthetic production traffic,
  or live external capability probes.
