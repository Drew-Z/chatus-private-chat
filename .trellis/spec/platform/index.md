# Platform Integration Guidelines

> Executable contracts for project-local AI platform integrations.

## Guidelines Index

| Guide | Description |
| --- | --- |
| [Codex Hooks](./codex-hooks.md) | Codex hook registration, output contracts, and validation |
| [Trellis Git Tracking](./trellis-git-tracking.md) | Shared project assets versus local runtime state |
| [Production Acceptance](./production-acceptance.md) | Authenticated temporary-member acceptance and cleanup contracts |
| [Deployment Configuration](./deployment-configuration.md) | Parameterized instance identity, preflight, generated Wrangler config, and Secret boundaries |
| [Provider Plan Runtime](./provider-plan-runtime.md) | Passive quality ordering, access/capability filtering, BYOK gating, and credential preparation |
| [Provider Tool Runtime](./provider-tool-runtime.md) | OpenAI/Anthropic tool-turn adapters, history, parsing, and error contracts |
| [Provider Stream Runtime](./provider-stream-runtime.md) | OpenAI/Anthropic streaming adapters, pre-output validation, cancellation, and fallback boundary |
| [Backup, Restore, And Permanent Deletion](./backup-restore.md) | Recovery meanings, data inventory, readiness gates, key custody, and purge invariants |
