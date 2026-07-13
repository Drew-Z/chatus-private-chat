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
└── worker.ts                   # API routing, Durable Object, storage contracts
tests/
├── worker-api.test.ts
├── user-state.test.ts
├── markdown.test.ts
└── admin-report.test.ts
scripts/
└── check-frontend.mjs          # static frontend contract checks
```

## Module Organization

- Keep page-specific DOM orchestration in `public/app.js` or `public/admin.js`.
- Extract pure, testable behavior when it is reusable or security-sensitive. Examples: `public/markdown.js` and `public/admin-report.js`.
- Keep browser assets at the `public/` root because HTML, service-worker caching, and release fingerprint checks use root-relative paths.
- Keep server and storage logic in `src/worker.ts`; do not import browser DOM modules into the Worker.

## Naming Conventions

- Use lowercase kebab-case for multiword public asset names, such as `admin-report.js`.
- Use descriptive camelCase for functions and state variables.
- Keep test names aligned with their module or boundary: `markdown.test.ts`, `user-state.test.ts`.
- Asset imports include the release placeholder, for example `./markdown.js?v=development`; deployment replaces the fingerprint.

## Examples

- Pure browser helper: `public/markdown.js`, tested by `tests/markdown.test.ts`.
- Page controller: `public/app.js`, paired with `public/index.html`.
- Backend boundary: `src/worker.ts`, tested through `tests/worker-api.test.ts`.

## Avoid

- Do not introduce a component framework or build step for an isolated change.
- Do not create nested feature directories while HTML and service-worker asset lists still assume flat root paths.
- Do not duplicate a pure helper inside both page scripts; extract and test a shared ES module.
