# Chatus Post-release UX Audit

## Audit Status

This audit is a planning artifact. It evaluates production-equivalent typed-client fixtures and the approved Figma references; it does not authorize implementation, deployment, or rollout changes.

The focused browser baseline passed with `7 passed` and `2 skipped` across `desktop-1440`, `mobile-480`, and `touch-390`. No P0 functional blocker was found. The remaining work is concentrated in P1 hierarchy, state comprehension, and responsive information density.

## Evidence Set

- Approved references: `test-results/figma-reference/chatus-workspace-approved.png` and `test-results/figma-reference/chatus-settings-approved.png`.
- Current member workspace fixtures: the `workspace geometry stays contained and ordered` screenshots from `tests/browser/workspace-visual.spec.ts:242`.
- Current settings fixtures: the `member settings center keeps global preferences out of conversation context` screenshots from `tests/browser/workspace-visual.spec.ts:759`.
- Current model-monitor fixtures: the `operations data stays scannable with local table overflow` screenshots from `tests/browser/workspace-visual.spec.ts:998`.
- Focused validation command:

```powershell
npx playwright test --config tests/browser/playwright.config.ts --project=desktop-1440 --project=mobile-480 --project=touch-390 -g "workspace geometry stays contained and ordered|member settings center keeps global preferences out of conversation context|operations data stays scannable with local table overflow"
```

## Keep Decisions

- Keep the conversation rail, centered transcript, on-demand context inspector, and separate member settings center.
- Keep the semantic neutral light/dark variables and sparse cobalt accent rather than replacing the palette wholesale.
- Keep the member/admin monitoring privacy boundary: members see route-level advisory availability; administrators retain aggregate diagnostic counts and groupings.
- Keep the current API, revision, permission, focus, reduced-motion, and device-local preference contracts.
- Keep the core product asset-light. Visual quality must come from typography, spacing, contrast, iconography, and state clarity.

## Prioritized Findings

| ID | Severity | Surface | Finding and evidence | User impact | Disposition |
| --- | --- | --- | --- | --- | --- |
| A1 | P1 | Mobile workspace header | The 480px baseline compresses rail access, product mark, long conversation title, route/model availability, and logout into one 60px row. The route label and title truncate simultaneously (`client/src/components/WorkspaceHeader.tsx:44`, `client/src/styles.css:34`). | The highest-value context is technically present but hard to scan before sending. | Preserve the header owner; create stable primary and contextual zones with a compact mobile route/availability trigger. |
| A2 | P1 | Transcript and messages | The current baseline produces a weak conversational rhythm: a large visual break separates the user message and assistant response, action rows consume fixed height, and technical/tool blocks compete with the answer (`client/src/styles.css:867`, `client/src/styles.css:873`, `client/src/styles.css:879`). | Long conversations feel assembled from states rather than read as one coherent exchange. | Define turn groups, tighter within-turn spacing, quieter persistent actions, and clearer separation between answer content and execution detail. |
| A3 | P1 | Composer | The composer is stable and accessible, but its top border, shadow, and fixed status allocation make it read as a separate footer rather than the natural continuation of the transcript (`client/src/styles.css:955`). | The intended primary action is visible but visually detached from the reading flow. | Retain sticky ownership and dimensions; soften the outer boundary, strengthen focus, and align its width and baseline with the transcript. |
| A4 | P1 | Dark member settings | The desktop and mobile dark baselines use nearly the same dark value across canvas, navigation, and detail. Sparse detail content leaves large undifferentiated areas (`client/src/styles.css:48`, `client/src/styles.css:1037`). | The interface is functional but feels flat and less premium than the light workspace. | Increase semantic tonal separation, improve master-detail balance, and use full-width settings rows rather than decorative cards. |
| A5 | P1 | Member model availability | The response contract includes `confidence` and `observedAt`, while the current inspector primarily renders status, speed, fallback, and one generated-time footnote (`client/src/lib/api.ts:2265`, `client/src/components/ConversationInspector.tsx:159`). | A stale or limited sample can look too similar to a recent observation, weakening user trust in model choice. | Add explicit `recent`, `limited`, `stale`, refreshing, and no-observation copy; use icon/shape/text in addition to color. |
| A6 | P1 | Administrator model monitor | Seven KPIs have equal visual weight, every hourly bucket consumes a row even when empty, and null success rate/latency are rendered as `-`/unknown without a dedicated no-observation explanation (`client/src/components/AdminOperationsPanel.tsx:728`). | Operators must parse low-signal content and may misread a legitimate zero-traffic window as broken telemetry. | Prioritize attempts/completions/failures/in-flight, demote derived metrics, use a compact 24-hour plot, and add an explicit zero-observation state without hiding the underlying 24 buckets. |
| A7 | P1 | Touch model monitor | The 390px baseline stacks large metric cells before the trend and group evidence; the section title/meta also wraps tightly (`client/src/styles.css:1211`). | The monitor is technically contained but slow to scan on a small screen. | Use a compact primary summary, expandable secondary metrics, readable title/meta stacking, and local detail disclosure. |
| A8 | P2 | Settings navigation | Desktop settings navigation is text-led while the detail actions use icons; mobile list/detail continuity relies mainly on chevrons and back copy (`client/src/components/MemberSettingsCenter.tsx:131`). | Sections are understandable but less quickly distinguishable during repeated use. | Add consistent Lucide section icons and stronger current-location semantics without turning rows into cards. |
| A9 | P2 | Brand and terminology | Product metadata varies between `Chatus · Member`, `BIAU PORT · Chatus`, and the `泊语 HarborTalk` wordmark; the `上下文` action is accurate but broad. | The shell feels less intentional and the context action requires learning. | Standardize product metadata and pair the context label with model/status meaning where space permits. |
| A10 | P2 | Small supporting type | Multiple operational labels use 10-11px text in dense control areas (`client/src/styles.css:663`, `client/src/styles.css:790`). | Chinese status text is legible in tests but tiring in sustained use and on lower-density displays. | Raise essential supporting copy to 12px where layout permits; reserve 10-11px for tertiary metadata only. |

## P0 And Deferred Findings

- P0: none in the focused fixture baseline.
- Deferred: full administrator navigation, configuration editing, legacy surfaces, new monitoring data collection, cross-device preferences, and new brand assets.
- The complete browser and accessibility matrix remains an implementation gate; this audit does not claim that the focused baseline replaces the full suite.

## Recommended Delivery Order

1. Member workspace hierarchy, transcript rhythm, message/action treatment, and composer integration.
2. Member settings density, dark-theme layering, and mobile continuity.
3. Member model-availability confidence and freshness presentation.
4. Bounded administrator model-monitor hierarchy, chart, and no-observation state.
5. Full responsive, accessibility, privacy, and regression verification.
