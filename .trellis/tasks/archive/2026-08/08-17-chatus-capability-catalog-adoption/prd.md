# Chatus capability catalog and adoption

## Goal

Implement the code-owned capability catalog, five default workflow Skills, safe adoption, assignment, projections, and revisioned installation.

## Requirements

- Dependency: none. The parent planning contract is
  `08-17-chatus-default-capability-packs`.
- Add a versioned, code-owned catalog containing exactly five instruction-only
  workflow Skills: `chatus:writing`, `chatus:summarize`, `chatus:translate`,
  `chatus:code_explanation`, and `chatus:structured_output`.
- Preserve the distinction among workflow instructions, explicit-turn
  capabilities, route augmentations, trusted local execution, auxiliary
  Provider work, and reviewed MCP execution in exact public/admin projections.
- Seed the five workflow Skills only in the truly unconfigured application
  default. `normalizeAppConfig()` must not inject catalog items into KV or
  deployment-secret configurations.
- Existing instances adopt known catalog items only through revision-checked
  preview/install APIs. Installation must reject collisions and stale revisions,
  preserve unrelated fields, and never install an endpoint or credential.
- Preserve current `allowedSkills` and `allowedTools` inheritance. Add
  migration-safe augmentation assignment where omission inherits and the default
  omission grants none. Explicit empty arrays remain deny-all.
- Existing custom Skills retain their current automatic/manual behavior. The
  automatic selector remains deterministic and never exceeds three Skills.
- Add an administrator Catalog view driven by server projections; the browser
  must not duplicate canonical Skill instructions.
- Tests use local fixtures only. Do not touch production observation, PR #93,
  legacy rollout tasks/gates/evidence, or production deployment.

## Acceptance Criteria

- [x] A new unconfigured default exposes the five workflow Skills, while stored
  KV/secret configurations receive no implicit item or assignment mutation.
- [x] Guests and explicit deny-all assignments receive no capabilities; omitted
  legacy assignment fields retain current inheritance semantics.
- [x] Catalog preview/install accepts known bounded IDs, rejects stale revisions
  and collisions, writes one validated revision, and records no content/secret.
- [x] Public/admin decoders reject unknown fields, enum values, duplicate IDs,
  unbounded strings, and inconsistent availability/reason combinations.
- [x] Existing custom Skill selection and the three-Skill ceiling remain green.
- [x] Admin installation and conflict retention work at desktop and touch 390px.

## Parent Acceptance Mapping

This child owns parent AC1-AC3 and the catalog/projection portion of AC4. Later
children depend on its public capability, activation, disclosure, and assignment
contracts.
