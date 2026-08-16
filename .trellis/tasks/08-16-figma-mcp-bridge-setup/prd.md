# Figma MCP Bridge local setup

## Goal

Configure the approved local `@gethopp/figma-mcp-bridge` STDIO MCP server so Codex can reach the bridge while the companion Figma plugin is open, allowing editable Chatus screen scaffolding without consuming the official Figma API request allowance.

## Requirements

- Install/use the published `@gethopp/figma-mcp-bridge` package through `npx -y`; do not clone or add it to the Chatus repository.
- Add one named `figma-bridge` STDIO server to the effective Codex `config.toml`, using the documented `npx` command and arguments.
- Preserve unrelated Codex settings and any existing MCP servers. The configuration must be backed up before editing.
- Do not print, copy, rotate, or modify existing tokens, API keys, conversation content, memories, or private Figma data.
- Verify the local Codex configuration parses and the bridge package can start/list its MCP tools. A live Figma connection is a separate step that requires the bridge plugin open in a Figma Design Editor file and an Editor-capable seat.
- Do not modify Chatus production code, `.trellis/tasks/08-14-chatus-ux-settings-redesign`, legacy rollout tasks, deployment workflows, or production gates.

## Acceptance Criteria

- [x] A timestamped backup of the effective Codex config exists and its pre-edit hash is recorded locally without exposing secrets.
- [x] `figma-bridge` is present exactly once with `command = "npx"` and `args = ["-y", "@gethopp/figma-mcp-bridge"]`.
- [x] Codex MCP listing/config validation succeeds after isolating and removing the unrelated invalid `[agents]` scalar block; the existing concurrency settings in `features.multi_agent_v2` were preserved.
- [x] Starting the bridge produced MCP `initialize` success and `tools/list` with server version `0.0.19` and the expected read/write tool surface.
- [x] Git scope audit shows only task/design documentation changed in the repository; no Chatus source or rollout surface changed.

## Notes

- Figma's current account is a Starter team with a View seat. The bridge can be configured now, but bridge write operations will remain unavailable until the target file is opened in Design mode by an Editor-capable user.
- This is a lightweight PRD-only task. Native Figma Variables, Styles, Components, and Instances remain outside the bridge's current write surface and must be authored in Figma itself.

## Completion Evidence

- Effective config: `D:/Agent/codex/config.toml`.
- Backup: `D:/Agent/codex/config.toml.bak-20260816-070759`.
- Pre-edit SHA-256: `D90D7EA3BFEEE5EE7E57512CFF2962F59C358CB5CD2FA20E936C5E920E701D1C`.
- Validation: Python TOML parse, `codex mcp list`, `codex mcp get figma-bridge`, and a direct STDIO MCP handshake/tool listing all passed.
- The bridge process was stopped after verification. It will not connect to a Figma file until the companion plugin is imported and running in an Editor-mode file.
