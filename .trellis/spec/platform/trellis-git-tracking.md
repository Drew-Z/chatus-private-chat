# Trellis Git Tracking

## Purpose

Trellis stores both shared project knowledge and machine/session-local state under `.trellis/`. Git must preserve the shared assets while excluding identity and runtime pointers that differ between developers and Codex windows.

## Track In Git

| Path | Why it is shared |
| --- | --- |
| `.trellis/spec/` | Team conventions and executable implementation contracts; review like code. |
| `.trellis/tasks/` | PRDs, designs, research, task context, and archived delivery records. |
| `.trellis/workspace/<name>/` | Deliberately recorded developer journals created by `trellis-finish-work`. |
| `.trellis/workflow.md` and `.trellis/config.yaml` | Project workflow and Trellis behavior. |
| `.trellis/scripts/` and `.trellis/agents/` | Project-local Trellis runtime and agent definitions. |

Do not add broad rules such as `.trellis/` or `.trellis/workspace/` to `.gitignore`; they would discard project knowledge that future sessions need.

## Keep Local

| Path | Why it is local |
| --- | --- |
| `.trellis/.developer` | Identifies the current developer on one machine. |
| `.trellis/.runtime/` | Holds session/window-scoped active-task pointers and transient hook state. |
| `.trellis/**/__pycache__/`, `.trellis/**/*.pyc` | Generated Python cache files. |
| `.trellis/*.tmp`, `.trellis/.backup-*`, `.trellis/*.new` | Temporary update and conflict-resolution files. |

These rules belong in the scoped `.trellis/.gitignore`. Keep them there instead of duplicating them in the repository root, so they cannot accidentally match unrelated paths.

## Validation

Confirm local state is ignored:

```bash
git check-ignore -v .trellis/.developer .trellis/.runtime/probe
```

Confirm representative shared assets are not ignored:

```bash
git check-ignore .trellis/spec/platform/index.md
git check-ignore .trellis/tasks/<task>/prd.md
git check-ignore .trellis/workspace/<name>/journal-1.md
```

For the second group, exit code `1` is expected: it means the file is not ignored.

## Review Checklist

- Shared specs, task artifacts, and journals remain visible in `git status` and PR review.
- No `.developer` or `.runtime/` file is staged.
- A Trellis update does not replace the scoped ignore rules with a broad `.trellis/` exclusion.
- `git diff --check` passes before committing.
