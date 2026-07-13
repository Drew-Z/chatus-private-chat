<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

## Chatus Project Rules

- Production deployments must run through GitHub Actions; do not deploy production from a local Wrangler account.
- Never commit or print access codes, API keys, tokens, conversation content, or stored memories.
- Keep `.trellis/spec/`, `.trellis/tasks/`, and `.trellis/workspace/` in Git; never commit `.trellis/.developer` or `.trellis/.runtime/`.
- Before shipping, run `npm run check:frontend`, `npm test`, `npm run typecheck`, `npx wrangler deploy --dry-run`, and `git diff --check`.
- Preserve unrelated user changes in a dirty worktree.
