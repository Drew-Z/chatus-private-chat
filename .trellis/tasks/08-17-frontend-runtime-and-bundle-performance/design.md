# Design: Frontend runtime and bundle performance

Use `React.lazy`/`Suspense` at the authenticated role branch so the login/session shell stays eager but member/admin workspaces become separate chunks. Add a same-origin stale-while-revalidate or cache-first runtime strategy for immutable built assets while retaining the existing navigation fallback.

Represent streaming status as render-time context or update only the active message instead of mapping every message on every token. Track whether the viewport is near the bottom and schedule one `requestAnimationFrame` follow-scroll; use instant/auto behavior during streaming and smooth motion only for discrete user actions when allowed.
