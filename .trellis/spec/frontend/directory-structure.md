# Directory Structure

## Overview

Chatus uses a small, framework-free frontend served from `public/`, with a Cloudflare Worker backend in `src/`. Keep this layout flat unless a feature has a genuinely reusable boundary.

## Directory Layout

```text
public/
├── index.html, app.js          # user chat shell and behavior
├── admin.html, admin.js        # administration shell and behavior
├── markdown.js                 # reusable markdown rendering helpers
├── admin-report.js             # reusable report/CSV helpers
├── theme.js, pwa.js, sw.js     # cross-page browser behavior
└── styles.css                  # shared application styles
src/
├── index.ts                    # Worker composition root and Durable Object exports
├── worker.ts                   # gateway, legacy APIs, provider/capability services during migration
├── agent/
│   └── team-agent.ts           # per-member Cloudflare AIChatAgent runtime
├── contracts/
│   └── agent.ts                # shared Agent state and props contracts
└── services/
    └── route-reliability.ts    # passive real-task reliability storage and classification
tests/
├── worker-api.test.ts
├── user-state.test.ts
├── route-reliability.test.ts
├── markdown.test.ts
└── admin-report.test.ts
scripts/
└── check-frontend.mjs          # static frontend contract checks
```

## Module Organization

- Keep page-specific DOM orchestration in `public/app.js` or `public/admin.js`.
- Extract pure, testable behavior when it is reusable or security-sensitive. Examples: `public/markdown.js` and `public/admin-report.js`.
- Keep browser assets at the `public/` root because HTML, service-worker caching, and release fingerprint checks use root-relative paths.
- Keep Worker composition in `src/index.ts`: it exports the default gateway plus every Wrangler Durable Object class.
- Keep per-member Agent lifecycle and persistence behavior under `src/agent/`; gateway authentication and server-side instance selection stay in `src/worker.ts`.
- Keep cross-runtime state and transport shapes under `src/contracts/`; validate untrusted request or storage data before it becomes one of these types.
- Keep provider, reliability, capability, persistence, and telemetry behavior under focused `src/services/` modules as the monolithic Worker is decomposed. Services must not depend on browser modules or Agent instance state.
- Avoid a runtime `worker.ts` -> Agent class import. Use type-only imports in the gateway and export both modules from `src/index.ts` so the Agent may reuse transitional services without a circular runtime dependency.
- Do not import browser DOM modules into Worker or Agent modules.

## Naming Conventions

- Use lowercase kebab-case for multiword public asset names, such as `admin-report.js`.
- Use descriptive camelCase for functions and state variables.
- Keep test names aligned with their module or boundary: `markdown.test.ts`, `user-state.test.ts`.
- Asset imports include the release placeholder, for example `./markdown.js?v=development`; deployment replaces the fingerprint.

## Examples

- Pure browser helper: `public/markdown.js`, tested by `tests/markdown.test.ts`.
- Page controller: `public/app.js`, paired with `public/index.html`.
- Backend gateway: `src/worker.ts`; composition/export boundary: `src/index.ts`; durable member runtime: `src/agent/team-agent.ts`; passive reliability service: `src/services/route-reliability.ts`.

## Avoid

- Do not introduce a component framework or build step for an isolated change. A reviewed product migration may add one only when HTML, assets, service worker, release fingerprinting, and tests move together.
- Do not create nested feature directories while HTML and service-worker asset lists still assume flat root paths.
- Do not duplicate a pure helper inside both page scripts; extract and test a shared ES module.
