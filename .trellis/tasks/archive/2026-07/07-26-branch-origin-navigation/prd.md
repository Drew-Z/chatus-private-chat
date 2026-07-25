# Branch Origin Navigation

## Goal

Make branched conversations easier to understand and recover from by showing where a branch came from, letting users jump back to the parent conversation, and naming branches by the action that created them. This completes the first-release branch UX promised by the parent productization task without turning the conversation sidebar into a tree browser.

## Background

- The parent task still lists "parent-origin navigation and branch naming" as open work.
- The branch API already persists `parentChatId` on returned conversation projections.
- The React workspace switches to the new branch but does not show the source conversation or offer a return path.
- Branch titles are currently generic and repeated branches can accumulate an indistinct suffix.

## Requirements

### R1. Parent Origin Visibility

- When the active conversation has `parentChatId`, the workspace header must show a compact source hint beside or below the title.
- If the parent conversation still exists in the current conversation list, the hint must include the parent title and a button/action to return to that parent.
- If the parent is missing, deleted, or not loaded, the hint must remain non-secret and non-crashing, showing only an unavailable source state.

### R2. Stable Branch Naming

- New branch titles must communicate the creating action: branch, edit, resend, regenerate, or continue.
- Generated names must remove existing generated branch suffixes before adding a new suffix, so repeated branching stays readable.
- Names must stay bounded and continue to fall back to a safe default title for blank sources.

### R3. Scope Control

- Do not add a tree sidebar, cross-conversation graph, or nested branch browser in this task.
- Do not expose provider IDs, tool payloads, message content, credentials, or deleted parent data through the origin hint.
- Do not change branch persistence semantics, quota behavior, launch behavior, or source-conversation preservation.

## Acceptance Criteria

- [x] A child conversation displays its parent title and an accessible return-to-parent control when the parent is present.
- [x] A child conversation with a missing parent displays a stable unavailable source hint and never throws.
- [x] Branch/edit/resend/regenerate/continue produce distinct bounded titles without repeated generated suffixes.
- [x] Existing branch API idempotency and source preservation tests still pass.
- [x] Browser workspace checks cover the origin hint on desktop and touch layouts without horizontal overflow.
- [x] Validation includes focused branch API tests, browser workspace tests if UI changes, type-check, `git diff --check`, and Trellis task validation.

## Notes

- Current evidence anchors:
  - `src/worker.ts:2784-2807` reserves branches with a generated title.
  - `src/worker.ts:3100-3103` currently appends only ` · 分支`.
  - `client/src/lib/api.ts:351-362` includes `parentChatId`.
  - `client/src/components/ChatWorkspace.tsx:272-286` passes no parent navigation data into the header.
