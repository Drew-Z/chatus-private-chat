# Legacy browser shell parity evidence

This handoff records local deterministic parity and stale-client fixtures for
`legacy.browser.shell`. It does not claim a production routing rollback or
completion of either 14-day observation window.

## Local storage isolation

- The fake-Provider Agent browser suite seeds all legacy persistence families:
  messages, v2/v3 sessions, active session, route, session snapshot, memory,
  memory draft, and conversation draft.
- Direct navigation from `/legacy/` to `/`, `/react-chat/`, and the admin entry
  proves the legacy values retain the same content-free SHA-256 fingerprint.
- React keeps its member-scoped `chatus:react:<member>:` namespace separate and
  does not import, delete, or rewrite legacy conversation storage.

## Service worker isolation

- The service worker harness executes the real `public/sw.js` source.
- Install coverage proves only legacy-exclusive shell assets carry the explicit
  `service_worker` caller marker; React and shared PWA assets do not inherit it.
- Navigation cache fallback remains isolated across `/legacy/`, `/react-chat/`,
  and the root shell, including offline and server-error behavior.
- Authentication and terminal responses (`401`, `403`, and `410`) pass through
  unchanged, so cached legacy HTML cannot bypass a later read-disable response.
- API, Agent, release, non-GET, and cross-origin traffic stays outside the
  service worker fetch boundary.
- Activation removes stale cache versions, and only the explicit update message
  requests `skipWaiting`.

## Local validation

- `npx vitest run tests/service-worker-shell.test.ts`: 12 passed.
- `npm test`: 51 files and 789 tests passed with local fixtures.
- `npm run test:browser:agent`: 3 passed with the isolated fake Provider.
- `npm run test:browser:workspace`: 110 passed and 55 configured matrix skips
  across the five required viewports.
- `npm run check:frontend`, `npm run typecheck`, and
  `npx wrangler deploy --dry-run` pass without a production deployment.

Production caller census, routing rollback, the 14-day write/read windows,
read-disable, and cleanup approval remain open.
