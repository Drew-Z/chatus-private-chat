# Codex Hook Integration

## 1. Scope / Trigger

Use this contract when adding, removing, or changing project-local Codex hooks under `.codex/`. A hook script is inactive until `.codex/hooks.json` registers it for a supported event.

## 2. Signatures

- Session initialization: `python -X utf8 .codex/hooks/session-start.py`
- Per-prompt workflow state: `python -X utf8 .codex/hooks/inject-workflow-state.py`
- Both commands are registered as `type: "command"` hooks with a bounded timeout.

## 3. Contracts

`SessionStart` output must be valid JSON with:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "<non-empty Trellis context>"
  }
}
```

The host also requires user-level hooks to be enabled, the project to be trusted, and any one-time `/hooks` approval to be completed.

## 4. Validation & Error Matrix

| Condition | Expected result |
| --- | --- |
| `.codex/hooks.json` is invalid JSON | Configuration check fails before shipping |
| Script exists but event is not registered | Hook is treated as inactive |
| Hook output is not valid JSON | Protocol validation fails |
| `additionalContext` is empty | Session context validation fails |
| `TRELLIS_HOOKS=0`, `TRELLIS_DISABLE_HOOKS=1`, or non-interactive mode | Session-start injection exits without output by design |

## 5. Good / Base / Bad Cases

- Good: `SessionStart` and `UserPromptSubmit` are both registered and emit their intended context.
- Base: UserPromptSubmit alone still provides per-turn state, but no context exists before the first prompt.
- Bad: A session-start script is present but omitted from `.codex/hooks.json`, creating a false impression that startup injection is active.

## 6. Tests Required

- Parse `.codex/hooks.json` with a JSON parser and assert both event keys exist.
- Pipe a JSON payload containing `cwd` and `session_id` into `session-start.py`.
- Assert `hookSpecificOutput.hookEventName` equals `SessionStart`.
- Assert `hookSpecificOutput.additionalContext` is non-empty.
- Run `git diff --check` after editing hook configuration.

## 7. Wrong vs Correct

### Wrong

```json
{
  "hooks": {
    "UserPromptSubmit": []
  }
}
```

The session-start script exists but can never run.

### Correct

```json
{
  "hooks": {
    "SessionStart": [],
    "UserPromptSubmit": []
  }
}
```

Each behavior is explicitly wired to its host event; real registrations must include their command entries and timeouts.
