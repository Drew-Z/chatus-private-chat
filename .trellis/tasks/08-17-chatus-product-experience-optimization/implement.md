# Implementation plan: Chatus product experience optimization

## Ordered child delivery

1. `08-17-member-request-timeout-recovery`
2. `08-17-member-draft-storage-resilience`
3. `08-17-workspace-accessibility-hardening`
4. `08-17-member-model-availability-ux`
5. `08-17-quota-aware-member-composer`
6. `08-17-workspace-intermediate-responsive-layout`
7. `08-17-admin-model-monitor-ux-resilience`
8. `08-17-frontend-runtime-and-bundle-performance`
9. `08-17-frontend-accessibility-test-matrix`
10. `08-17-conversation-rail-pinning`

## Per-child gate

- Confirm the child artifacts and start only that child.
- Load applicable frontend/platform specs through `trellis-before-dev`.
- Implement the smallest compatible change and add focused tests.
- Run focused lint/type/test checks, then `trellis-check` before moving on.
- Do not run real provider/model traffic, production deployment, or legacy rollout commands.

## Final integration gate

- Run `npm run check:frontend`.
- Run `npm test`.
- Run the workspace and agent browser suites using intercepted fixtures only.
- Run `npm run typecheck`.
- Run `npx wrangler deploy --dry-run` only.
- Run `git diff --check` and Trellis task validation.
- Inspect the final diff to confirm the forbidden tasks and legacy rollout surfaces are unchanged.
