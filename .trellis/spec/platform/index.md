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
| [Provider Turn Runtime](./provider-turn-runtime.md) | Main-answer absolute deadline, AI SDK fallback ownership, late-result cleanup, and ephemeral progress |
| [Provider Tool Runtime](./provider-tool-runtime.md) | OpenAI/Anthropic tool-turn adapters, history, parsing, and error contracts |
| [Provider Stream Runtime](./provider-stream-runtime.md) | OpenAI/Anthropic streaming adapters, pre-output validation, cancellation, and fallback boundary |
| [Provider Attempt Ledger](./provider-attempt-ledger.md) | Server-issued turn/run/attempt identity, required shadow capture, diagnostics, privacy, and recovery |
| [Public Error Projection And Correlation](./public-error-governance.md) | Canonical browser errors, per-turn references, redacted logs/audits, and passive correlation |
| [Feedback And Administrative Audit Persistence](./feedback-audit-persistence.md) | KV record ownership, exact decoding, privacy, retention, deletion, and failure policies |
| [Backup, Restore, And Permanent Deletion](./backup-restore.md) | Recovery meanings, data inventory, readiness gates, key custody, autonomous durable purge retry, and purge invariants |
| [Future Product Governance Decision Gates](./future-governance-decisions.md) | Remaining ACL/transfer gates, Provider finance, recovery objectives, and legacy retirement |
| [Legacy Surface Governance](./legacy-surface-governance.md) | Code-owned per-surface manifest, durable phase/evidence control plane, admin projection, and recovery boundary |
| [Delivery Governance](./delivery-governance.md) | Pull-request checks, path-aware browser suites, SHA artifacts, deployment skipping, and Trellis archive evidence gates |
| [Stable Principal And Resource Identity](./identity-registry.md) | Immutable member principal/resource routing, exact Queue identity, bounded reconciliation, and alias-reuse isolation |
| [Conversation ACL And Authoritative Revocation](./conversation-acl.md) | Resource-scoped owner/editor/viewer authorization, idempotent sharing, context isolation, and revision commit fences |
