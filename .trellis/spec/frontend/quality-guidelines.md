# Quality Guidelines

## Overview

Quality is enforced through executable frontend structure checks, Vitest Worker tests, strict TypeScript, deployment packaging validation, and security/privacy review.

## Forbidden Patterns

- Never print, commit, export, or include access codes, API keys, conversation content, or stored memories in diagnostics.
- Do not add inline style mutation to `app.js`, `admin.js`, or `theme.js`.
- Do not deploy production from a local Wrangler account; production uses GitHub Actions.
- Do not silently overwrite newer cloud/config/memory state.
- Do not render untrusted markdown URLs without protocol sanitization.

## Required Patterns

- Preserve release placeholders in HTML and versioned ES module imports.
- Keep service-worker updates explicit: install does not immediately activate; the page sends `SKIP_WAITING` after user-visible release detection.
- Protect destructive and concurrent operations with confirmation, undo where available, and revision/version preconditions.
- Keep diagnostics operational and non-sensitive.
- Preserve keyboard focus indicators and reduced-motion behavior.

## Testing Requirements

- Pure reusable browser helpers receive focused Vitest tests.
- Worker/API behavior receives integration tests using `cloudflare:test`.
- Bug fixes include a regression test or a structural assertion in `scripts/check-frontend.mjs` when browser DOM behavior is impractical to unit test.
- Before shipping run:

```bash
npm run check:frontend
npm test
npm run typecheck
npx wrangler deploy --dry-run
git diff --check
```

## Code Review Checklist

- Does every queried ID exist in the paired HTML and remain unique?
- Are assets present, release-versioned, and included in the service-worker shell when required?
- Are async results associated with the correct user/session/chat?
- Are conflict, retry, cancellation, and rate-limit paths visible to the user?
- Does exported or diagnostic data exclude secrets and private content?
- Are writes protected against stale revisions?
- Are accessibility behavior and mobile/keyboard paths preserved?
