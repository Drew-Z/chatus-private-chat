# Legacy surface and caller census

## Status

This is a repository-backed planning census for `DR-06`. It does not claim
production caller absence, parity, observation completion, owner approval, or
read-disable readiness. Those claims require per-surface runtime evidence.

The approved source design requires each surface to receive an independent task
and observation window. The existing umbrella task therefore cannot be activated
as one implementation unit without first correcting its delivery topology.

## Confirmed system boundaries

- `CHAT_STORE` mixes authoritative, transitional, and excluded/rebuildable data.
  Capture already classifies `config:`, managed secrets, feedback, and cleanup
  markers as authoritative; `chats:`, `memory:`, and `usage:` as transitional;
  and session/reliability prefixes as excluded (`src/services/instance-capture-adapters.ts:38-55`).
- Unknown KV prefixes fail capture closed instead of being silently ignored
  (`src/services/instance-capture-adapters.ts:399-434`). This is the strongest
  existing deterministic census primitive.
- `USER_STATE` is not a legacy namespace. It remains authoritative for quota,
  metrics, OAuth, anti-resurrection, sessions, and cleanup. Only its legacy chat
  projection is a retirement candidate (`src/worker.ts:611-738`).
- `TEAM_AGENT`, `PROVIDER_COORDINATOR`, `PROVIDER_ATTEMPT_LEDGER`, and
  `INSTANCE_COORDINATOR` remain current replacement, accounting, or coordination
  owners. No whole Durable Object namespace is currently eligible for read-disable.
- Applied Durable Object migrations `v1` through `v5` remain append-only, and the
  restore preflight requires all current binding/class/tag identities
  (`wrangler.jsonc:44-88`, `src/services/instance-restore.ts:974-1013`).
- A single code PR cannot prove the two required production observation windows.
  Code can add registry, controls, counters, deterministic parity, and rollback
  mechanics; actual stop-write/read-disable observation remains later exact-SHA
  deployment evidence.

## Candidate surface records

The IDs below are proposed planning boundaries. They remain blocked at
`discovered` until the coordinating registry child defines their exact contract.

| Proposed surface ID | Current owner and callers | Replacement | Current blocker |
| --- | --- | --- | --- |
| `legacy.browser.shell` | `/legacy/`, `public/app.js`, service worker, production smoke, browser E2E, and deploy fingerprinting (`src/worker.ts:1838-1849`, `scripts/smoke-production.mjs:63-70`) | React `/react-chat/` shell and Agent transport | Direct route has no hit counter or reversible read-disable; CI actively preserves it. |
| `legacy.browser.admin-alias` | `/admin.html` redirect plus old bookmarks, smoke, and E2E (`src/worker.ts:1844-1845`) | `/react-chat/admin` | Old static admin is gone, but alias traffic and an independent observation/rollback record are absent. |
| `legacy.api.chat-post` | `POST /api/chat`, guest allowlist, legacy browser, and Worker tests (`src/worker.ts:2201-2203`, `src/worker.ts:2331-2334`) | `TeamAgent` transport | No legacy-versus-Agent deterministic projection parity or independent disable control. |
| `legacy.api.cloud-chats` | `GET/PUT/DELETE /api/chats` and `POST /api/chats/migrate` still mutate `UserState` and sync Agent (`src/worker.ts:2292-2305`, `src/worker.ts:5206-5337`) | Agent conversation APIs | Still an authoritative writer for the legacy client; stop-write and read-disable are not separate. |
| `legacy.kv.chat-index` | `chats:{label}:index` is read by KV-to-UserState migration and Agent import (`src/worker.ts:5880-5897`, `src/worker.ts:6009-6030`) | `UserState` migration staging, then root/conversation `TeamAgent` | Inactive members, malformed records, and dormant data are not censused. |
| `legacy.user-state.chat-projection` | `UserState.chats`, tombstones, cleanup, legacy CRUD, and Agent import/sync (`src/worker.ts:1504-1639`, `src/worker.ts:5215-5337`) | Root/conversation `TeamAgent` | Message metadata parity is incomplete; the namespace cannot be disabled as a whole. |
| `legacy.kv.memory` | `memory:{label}` is a read-only import source reached by normal, admin, Agent, workspace, export, and chat preparation paths (`src/worker.ts:5900-5915`) | Root `TeamAgent` memory | Lazy migration coverage and malformed/dormant records are unknown. |
| `legacy.kv.daily-usage` | `usage:{label}:{day}` still affects quota admission, maintenance session projection, admin stats/reset, and purge (`src/worker.ts:2949-2955`, `src/worker.ts:3883-3949`, `src/worker.ts:10942-10947`) | `UserState.usage` and bursts | KV-to-DO monotonic parity is not proven for all retained days. |
| `legacy.provider.route-shadow` | Route-level transport fields synthesize `legacy:${routeId}` candidates (`src/services/provider-router.ts:52-74`, `src/services/provider-router.ts:163-198`) | Provider registry plus route offerings | Production config census is unknown; normalization and runtime fallback still accept the shadow. |
| `legacy.provider.inline-credential` | Inline route/provider keys resolve with credential source `legacy` (`src/services/provider-router.ts:131-150`) | Managed encrypted route secrets or Worker bindings | Hidden-shadow saves can preserve inline secrets; migration does not cover every representation. |
| `legacy.config.source-fallback` | Route config can fall back from KV to `ROUTES_CONFIG` and generated `UPSTREAM_*` defaults (`src/worker.ts:7386-7404`) | Managed provider/route configuration | Clearing KV can resurrect legacy config; deployed binding census is not repository-verifiable. |
| `legacy.kv.route-reliability` | Excluded KV reliability projections remain runtime readers/writers alongside ProviderCoordinator (`src/services/route-reliability.ts:122-223`) | ProviderCoordinator/reliability projections | Semantic parity and retention ownership are not proven. |
| `legacy.auth.access-secret-fallback` | Local/development `ACCESS_CODES` fallback and deployment preparation remain callers (`src/worker.ts:10054-10068`, `scripts/deployment-config.mjs:331-359`) | Managed access-code records | Production absence and rollback policy require deployment evidence; this must not be confused with session KV. |

## Hidden caller classes

Every per-surface census must cover more than HTTP routes:

- static legacy browser uploads and local-storage migration;
- tests, service-worker/build checks, deploy fingerprinting, and production smoke;
- scheduled `TeamAgent` cleanup, guest cleanup, account purge, and conversation cleanup;
- maintenance/session projections, admin reset, exports, and operator migration APIs;
- capture/restore manifests, provisioning checks, historical object inventory, and
  append-only Durable Object migration tags;
- Provider routing, model discovery, reliability, budget/attempt accounting, and
  secret fallback resolution;
- Queue topology and alarms, even where the current document-ingest consumer does
  not directly touch a legacy data surface.

## Required delivery correction

The source design and `DR-06` risk register require independent tasks and delayed
cleanup per exact surface. The safe delivery topology is:

1. Keep `legacy-surface-disable-observation` as a coordinating parent.
2. Create a foundation child for the strict registry, evidence model, bounded hit
   instrumentation, transition API, operator UI, and fail-closed census checks.
3. Freeze the discovered inventory through that contract.
4. Create one rollout child per exact surface record. A rollout child may advance
   only its own record and must remain open across required production observation.
5. Keep destructive deletion outside these rollout children and behind the later
   cleanup program and a new explicit production approval.

## Open product and operations decisions

- Minimum stop-write and read-disable observation periods and required traffic
  evidence for each risk class.
- Accountable surface owner and approval role for each record.
- Which production-safe telemetry source supplies hit/census evidence without
  prompts, conversation content, memories, credentials, or tokens.
- Whether deployment binding census is retained manually or imported as bounded,
  content-free evidence.

