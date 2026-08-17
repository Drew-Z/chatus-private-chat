# Capability Catalog And Adoption Design

## Boundaries

- Extend shared capability contracts; do not create browser-only capability
  types or a parallel configuration source.
- Add a server-owned catalog service with immutable versioned definitions and
  helpers for preview, collision detection, and installation.
- `getDefaultAppConfig()` may include the five low-risk workflow Skills and an
  explicit default allow-list. `normalizeAppConfig()` remains non-injecting.
- Use `loadEditableConfig()` plus the existing revisioned KV write and validation
  boundary for installation. Never overwrite an existing ID, even when the
  browser requests it.
- Derive member/admin projections after assignment and executable-readiness
  filtering. Exact browser decoders fail the whole malformed projection.

## Catalog Contract

Items have bounded ID, label, description, source, activation, availability,
and a typed disclosure of execution owner, external request, data classes,
latency, and cost. Workflow definitions contain instructions but no tools. The
external search template and assisted-image catalog metadata may be projected as
setup-required references, but this child installs no MCP server, credential, or
vision helper.

## Adoption Flow

`GET /api/admin/capability-packs` returns catalog version and install/setup or
conflict state without credentials. `POST /api/admin/capability-packs/install`
accepts `{ packId, itemIds, expectedRevision }`, reloads editable config, checks
revision and known IDs, refuses collisions, validates the merged config, writes
one revision, and appends a content-free admin audit event.

## Compatibility And Rollback

Optional activation/origin/augmentation fields normalize omission to existing
behavior. Disabling the default seed hides it for new unconfigured instances;
already installed items remain ordinary administrator-managed configuration and
are never auto-deleted. No protected rollout or production file is in scope.
