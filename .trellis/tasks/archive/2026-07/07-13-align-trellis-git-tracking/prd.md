# Align Trellis Git tracking rules

## Goal

Track shared Trellis specs, tasks, and journals while ignoring developer identity and runtime state.

## Background

- `.trellis/spec/`, `.trellis/tasks/`, and `.trellis/workspace/` are already tracked by Git.
- `.trellis/.developer` and `.trellis/.runtime/` are already ignored by the scoped `.trellis/.gitignore`.
- The scoped ignore file is preferable to duplicating the same patterns in the repository root because its patterns cannot accidentally match unrelated paths.

## Requirements

- Preserve the existing scoped ignore behavior in `.trellis/.gitignore`.
- Document `.trellis/spec/`, `.trellis/tasks/`, and `.trellis/workspace/` as shared project assets that must remain reviewable in Git.
- Document `.trellis/.developer` and `.trellis/.runtime/` as local-only state that must not be committed.
- Add a concise project-level instruction so future AI sessions preserve this boundary.
- Do not remove any currently tracked Trellis project assets or add local identity/runtime files to the index.

## Acceptance Criteria

- [ ] A project spec clearly lists the tracked and ignored Trellis paths and explains why.
- [ ] `AGENTS.md` instructs assistants to preserve the Trellis Git tracking boundary.
- [ ] `git check-ignore -v` confirms `.trellis/.developer` and `.trellis/.runtime/` are ignored by `.trellis/.gitignore`.
- [ ] Representative files under `.trellis/spec/`, `.trellis/tasks/`, and `.trellis/workspace/` remain trackable and are not ignored.
- [ ] No local developer identity or runtime-state file is staged or committed.
- [ ] `git diff --check` passes.

## Notes

- This is a lightweight, PRD-only documentation and policy task.
- No root `.gitignore` duplication is needed unless the scoped `.trellis/.gitignore` stops being supported.
