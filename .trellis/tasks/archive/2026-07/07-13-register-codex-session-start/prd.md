# Register Codex SessionStart hook

## Goal

Register and verify the project-local Codex SessionStart hook without changing per-turn workflow-state injection.

## Requirements

- Register the existing `.codex/hooks/session-start.py` script for the Codex `SessionStart` event in the project hook configuration.
- Preserve the existing `UserPromptSubmit` registration for `.codex/hooks/inject-workflow-state.py`.
- Keep the change scoped to project-local Codex integration files; do not alter user-level Codex configuration or deploy anything.
- Ensure the resulting hook configuration remains valid JSON and uses the same command/timeout conventions as the existing hook registration.
- Verify that the session-start script emits Codex hook output with `hookEventName: "SessionStart"` and non-empty Trellis context.

## Acceptance Criteria

- [ ] `.codex/hooks.json` contains both `SessionStart` and `UserPromptSubmit` registrations.
- [ ] `SessionStart` invokes `python -X utf8 .codex/hooks/session-start.py` with a bounded timeout.
- [ ] Existing per-prompt workflow-state injection remains unchanged.
- [ ] `.codex/hooks.json` parses successfully as JSON.
- [ ] A local invocation of the session-start hook returns valid JSON containing `hookSpecificOutput.hookEventName = "SessionStart"` and non-empty `additionalContext`.
- [ ] Repository checks relevant to this configuration-only change pass, including `git diff --check`.

## Notes

- This is a lightweight, PRD-only task.
- Codex may still require the user-level `[features].hooks = true`, project trust, and one-time `/hooks` approval before a newly registered hook runs in the host application.
