# Chatus product experience optimization

## Goal

Resolve the highest-impact findings from the 2026-08-17 product audit across the member chat workspace, member settings, model availability and monitoring, accessibility, responsive behavior, runtime performance, error recovery, test coverage, and conversation information architecture.

## Requirements

- Deliver the ten child tasks in the recorded order so reliability and accessibility foundations land before presentation and performance refinements.
- Keep every child independently testable and reversible.
- Preserve existing authentication, conversation ACL, provider routing, and public error contracts unless a child explicitly documents a compatible UI-only extension.
- Do not modify or advance `08-16-chatus-production-release-observation`.
- Do not modify any legacy rollout task, gate, transition control, evidence, endpoint, or rollout state, including `legacy-api-chat-post-rollout`, `legacy-browser-shell-rollout`, and `legacy-api-cloud-chats-rollout`.
- Do not deploy production and do not run probes that generate model requests.
- Preserve unrelated user changes and keep the implementation isolated on `codex/chatus-product-optimization` from `origin/main` commit `08ba6b7a1f87799b5cff73b80ea20af499ebf583`.

## Acceptance Criteria

- [ ] All ten child tasks satisfy their own acceptance criteria and are linked to this parent.
- [ ] Member requests have bounded recovery, draft persistence cannot break chat, model availability failures are visible, and quota state refreshes after turns.
- [ ] Keyboard focus, live-region behavior, touch targets, and intermediate-width layouts meet the documented accessibility and responsive contracts.
- [ ] Admin model monitoring remains useful under partial failure and its search/trend views represent the monitored data.
- [ ] Initial bundles and streaming updates avoid the identified avoidable work while lazy chunks remain available under the service-worker contract.
- [ ] Conversation pinning is available to members through the existing projection/update contract.
- [ ] Automated coverage includes intermediate widths, normal and reduced motion, an accessibility baseline, and more than one browser engine where supported.
- [ ] Full project quality gates pass without production deployment or live model traffic.

## Notes

- Source audit and initial prioritization: `research/product-audit.md`.
- This parent owns integration acceptance only; product implementation is owned by the child tasks.
