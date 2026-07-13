# Type Safety

## Overview

The Worker and tests use strict TypeScript. Browser modules are plain ES modules and rely on careful runtime checks plus focused tests/static checks.

## Type Organization

- Define Worker domain interfaces and unions close to their use in `src/worker.ts` while the backend remains a single module.
- Use literal unions for closed domains such as message roles, route types, and reset reasons.
- Reuse shared shapes across Worker handlers and Durable Object methods instead of recreating incompatible variants.
- Tests may use `as const` to preserve literal values, as in `tests/user-state.test.ts`.

## Validation

- Treat request JSON, storage values, environment configuration, imports, and upstream model responses as runtime data requiring validation/normalization.
- Return stable machine-readable error codes and appropriate HTTP statuses.
- Reject unsupported backup versions and invalid routes rather than coercing them into partial state.
- Validate URLs and markdown protocols before rendering; `sanitizeMarkdownUrl` blocks executable schemes and unsupported data images.

## Common Patterns

- Narrow `unknown` values before field access.
- Normalize optional arrays/objects at the boundary.
- Include optimistic-concurrency revisions in response and mutation contracts.
- Use generic KV reads only when the expected stored shape is known and immediately checked.

## Forbidden Patterns

- Do not add `@ts-ignore`, `@ts-nocheck`, or broad type assertions to bypass a failing contract.
- Do not use `any` in production code when a concrete interface or `unknown` plus narrowing is possible.
- Do not cast raw request/storage data directly into a trusted domain type.
- Do not weaken `strict`, `noEmit`, or `isolatedModules` in `tsconfig.json` to make a change pass.
