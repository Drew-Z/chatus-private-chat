# Product audit evidence and prioritization

Baseline: `origin/main` at `08ba6b7a1f87799b5cff73b80ea20af499ebf583` on 2026-08-17. Line numbers below refer to that baseline and may move during implementation.

| Order | Impact | Risk | Cost | Finding and evidence | Child task |
| --- | --- | --- | --- | --- | --- |
| 1 | Very high | Low | Low | Non-streaming browser requests use an unbounded bare `fetch` (`client/src/lib/api.ts:3951`). | `member-request-timeout-recovery` |
| 2 | High | Low | Low | Draft and active-chat persistence call `localStorage` directly, write on each keystroke, and do not recover from storage exceptions (`client/src/features/chat/ChatWorkspace.tsx:711,846`). | `member-draft-storage-resilience` |
| 3 | Very high | Medium | Medium | Focus indicators miss 3:1 contrast, several controls are 29–36px, and the full streaming transcript is a live region (`client/src/styles.css:30,71,114,165,770,1128`; `ChatWorkspace.tsx:1067`). | `workspace-accessibility-hardening` |
| 4 | High | Low | Medium | Member model-availability failures are swallowed and the header combines aggregate availability with stale route-health semantics (`ChatWorkspace.tsx:140`; `WorkspaceHeader.tsx:91`). | `member-model-availability-ux` |
| 5 | High | Medium | Medium | Session usage is loaded initially but not refreshed after turns, so the composer is quota-unaware (`App.tsx:36`; `ChatWorkspace.tsx:520`; `MessageComposer.tsx:72`). | `quota-aware-member-composer` |
| 6 | High | Medium | Medium | There is no intentional layout between 781px and 1439px; a persisted inspector can leave about 209px for chat at 781px (`client/src/styles.css:677,1009`). | `workspace-intermediate-responsive-layout` |
| 7 | High | Medium | Medium | Operations search omits model-monitor groups, trend encoding is total-attempt-only, and unrelated section failures can collapse the operations page (`AdminOperationsPanel.tsx:157,715`; `client/src/lib/api.ts:1210`). | `admin-model-monitor-ux-resilience` |
| 8 | Medium | Medium | High | Chat/admin panels are eagerly bundled; streaming remaps the transcript and schedules smooth scrolling on each update (`App.tsx:2`; `AdminWorkspace.tsx:60`; `ChatWorkspace.tsx:894,1075`). Lazy chunks also need an offline cache contract because `public/sw.js:92-98` precaches only HTML-referenced assets. | `frontend-runtime-and-bundle-performance` |
| 9 | High | Low | Medium | The browser matrix is Chromium-only, jumps from 780px to 1440px, always emulates reduced motion, and has no automated accessibility baseline (`tests/browser/playwright.config.ts:15`; `workspace-visual.spec.ts:122`). | `frontend-accessibility-test-matrix` |
| 10 | Medium | Low | Medium | Conversation projections already expose `pinned`, but the member rail has no pin control (`client/src/lib/api.ts:861`). | `conversation-rail-pinning` |

## Global constraints

- Do not edit `08-16-chatus-production-release-observation` or any legacy rollout task/evidence/gate.
- Do not deploy production.
- Do not run model probes or any test that generates provider requests.
- Browser tests must intercept all chat/model endpoints they exercise.
