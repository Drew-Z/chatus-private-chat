# Directory Structure

## Overview

Chatus serves the typed React/Vite client under `client/` as the default teammate experience. The framework-free client remains deployable at `/legacy/` as a rollback surface. The typed administrator workspace is served at `/react-chat/admin`; the exact `/admin.html` path is retained only as a same-origin 308 rollback redirect.

## Directory Layout

```text
client/
├── index.html                  # isolated React application entry
├── vite.config.ts             # builds to public/react-chat
├── tsconfig.json              # browser/React type boundary
└── src/
    ├── App.tsx, main.tsx      # session gate and composition root
    ├── components/            # typed product views
    ├── lib/                   # validated browser API boundaries
    └── styles.css             # typed-client visual system
public/
├── index.html, app.js          # legacy user chat source, served through /legacy/
├── legacy/                     # generated independent legacy rollback shell
├── markdown.js                 # reusable markdown rendering helpers
├── theme.js, pwa.js, sw.js     # cross-page browser behavior
└── styles.css                  # shared application styles
src/
├── index.ts                    # Worker composition root and Durable Object exports
├── worker.ts                   # gateway, legacy APIs, provider/capability services during migration
├── agent/
│   └── team-agent.ts           # per-member Cloudflare AIChatAgent runtime
├── contracts/
│   ├── agent.ts                # shared Agent state and props contracts
│   ├── chat.ts                 # conversation and tool-event contracts
│   ├── provider.ts             # provider route and credential contracts
│   └── session.ts              # authenticated member session contract
└── services/
    ├── fallback-language-model.ts # pre-output route fallback and stream commitment
    ├── provider-model.ts       # AI SDK provider instances and message conversion
    ├── provider-router.ts      # route plans, credential precedence, fallback decisions
    └── route-reliability.ts    # passive real-task reliability storage and classification
tests/
├── worker-api.test.ts
├── user-state.test.ts
├── fallback-language-model.test.ts
├── provider-model.test.ts
├── provider-router.test.ts
├── route-reliability.test.ts
├── team-agent-turn.test.ts
├── client-api.test.ts
├── client-markdown.test.ts
├── client-state.test.ts
└── markdown.test.ts
scripts/
└── check-frontend.mjs          # static frontend contract checks
```

## Module Organization

- Keep the typed Agent client under `client/`; use React components for product views and runtime-validated helpers for HTTP projections and pure state recovery.
- Keep `/admin.html` as a compatibility-only same-origin 308 redirect to
  `/react-chat/admin`; preserve its query string and instrument only bounded,
  content-free read observations for the declared caller classes. Do not add
  new administrator UI or navigation links to the alias, and keep the route
  source available for an independently reversible routing switch.
- Build the typed client to `public/react-chat/` with Vite. Treat that directory as generated output: ignore it in Git and regenerate it through `npm run build:client` or `npm run check:frontend` before deployment.
- Serve the React shell at `/` and `/react-chat/`; serve an independent generated copy of the framework-free chat shell at `/legacy/`. `DEFAULT_CLIENT=legacy` is the emergency root rollback switch.
- Keep legacy chat DOM orchestration in `public/app.js`; administrator behavior belongs in the typed React workspace.
- Extract pure, testable behavior when it is reusable or security-sensitive. Examples: `client/src/lib/api.ts`, `client/src/lib/markdown.ts`, `client/src/lib/state.ts`, and `public/markdown.js`.
- Keep shared and legacy browser assets at the `public/` root. Vite content-hashed assets live under `public/react-chat/assets/` and receive immutable caching.
- Keep navigation cache keys isolated for `/`, `/react-chat/`, and `/legacy/`; the retired `/admin.html` path must never be cached as an administrator shell.
- Keep Worker composition in `src/index.ts`: it exports the default gateway plus every Wrangler Durable Object class.
- Keep per-member Agent lifecycle and persistence behavior under `src/agent/`; gateway authentication and server-side instance selection stay in `src/worker.ts`.
- Keep cross-runtime state and transport shapes under `src/contracts/`; validate untrusted request or storage data before it becomes one of these types.
- Keep provider, reliability, capability, persistence, and telemetry behavior under focused `src/services/` modules as the monolithic Worker is decomposed. Services must not depend on browser modules or Agent instance state.
- Avoid a runtime `worker.ts` -> Agent class import. Use type-only imports in the gateway and export both modules from `src/index.ts` so the Agent may reuse transitional services without a circular runtime dependency.
- Do not import browser DOM modules into Worker or Agent modules.

## Naming Conventions

- Use lowercase kebab-case for multiword public asset names.
- Use descriptive camelCase for functions and state variables.
- Keep test names aligned with their module or boundary: `markdown.test.ts`, `user-state.test.ts`.
- Asset imports include the release placeholder, for example `./markdown.js?v=development`; deployment replaces the fingerprint.

## Examples

- Typed browser helpers: `client/src/lib/api.ts`, `client/src/lib/markdown.ts`, and `client/src/lib/state.ts`, tested by focused `tests/client-*.test.ts` files.
- Legacy page controller: `public/app.js`, paired with the `/legacy/` shell generated from `public/index.html`.
- Backend gateway: `src/worker.ts`; composition/export boundary: `src/index.ts`; durable member runtime: `src/agent/team-agent.ts`; stream fallback: `src/services/fallback-language-model.ts`; provider adapters: `src/services/provider-model.ts`; provider routing: `src/services/provider-router.ts`; passive reliability: `src/services/route-reliability.ts`.

## Avoid

- Do not add another component framework or a second browser build pipeline. New typed product work uses the reviewed React/Vite boundary under `client/`.
- Do not add nested paths to the legacy `public/` surface without updating HTML, release fingerprinting, and service-worker discovery. Vite-owned hashed asset directories are expected.
- Do not duplicate a pure helper inside both page scripts; extract and test a shared ES module.
