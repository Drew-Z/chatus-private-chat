# Chatus Post-release UX Audit And Optimization

## Goal

Audit the production Chatus experience after the approved member-workspace, member-settings, and model-monitoring release, then define a focused optimization milestone that makes the product feel calmer, more coherent, and more premium without reopening backend, security, or rollout contracts.

The task remains planning-only while Trellis reports `planning`. Production deployment is not authorized by this task.

## Confirmed Facts

- The approved product identity remains `泊语 HarborTalk | Chatus` under the BIAU PORT / 泊岸 parent brand. OpenAI and DeepSeek are pattern references for restraint, hierarchy, and interaction maturity, not sources to copy.
- The previous redesign established a neutral pearl-white light theme, near-black typography, sparse cobalt emphasis, a neutral dark theme, a conversation rail, an on-demand conversation inspector, and a separate member settings center (`.trellis/tasks/archive/2026-08/08-14-chatus-ux-settings-redesign/design.md`).
- The member workspace, settings, and model-monitoring release is deployed at production application SHA `fd6a2690ac3bf5026fde3ee736f35e32d14f940d`; the 24-hour passive observation completed successfully with a legitimate zero-traffic aggregate state (`.trellis/tasks/archive/2026-08/08-16-chatus-production-release-observation/prd.md:44`).
- Current browser acceptance passes the desktop workspace, member settings, and operations-monitoring scenarios. The fixture verifies containment and ownership, but passing geometry does not by itself establish visual quality (`tests/browser/workspace-visual.spec.ts:242`, `tests/browser/workspace-visual.spec.ts:759`, `tests/browser/workspace-visual.spec.ts:998`).
- The current member workspace uses the approved semantic light/dark variables and cobalt accent (`client/src/styles.css:1`). Its desktop shell is stable, but the visual review baseline shows opportunities to improve header compression, transcript rhythm, message/action hierarchy, and the relationship between the reading column and persistent rail.
- Member settings already separates appearance, memory, MCP connections, account/data, and sessions/devices, with desktop master-detail and mobile list-detail behavior (`client/src/components/MemberSettingsCenter.tsx:127`). The current dark settings baseline is functional but visually sparse and dominated by one dark surface family.
- Members already receive passive route availability in the header and conversation inspector. The inspector lists route states, speed, fallback notice, freshness, and the advisory-data disclaimer without exposing Provider identity or raw telemetry (`client/src/components/ConversationInspector.tsx:147`).
- Administrators already receive rolling 24-hour attempts, successes, failures, in-flight count, success rate, fallbacks, latency, hourly buckets, group views, and failure classes (`client/src/components/AdminOperationsPanel.tsx:728`). In the legitimate no-data state, success rate is rendered as an em dash and latency as unknown.
- No synthetic model traffic is permitted merely to make availability appear healthier. A zero-attempt window is a valid state and must be explained rather than colored as success or failure.
- The user approved including a bounded visual and information-design refinement of the existing administrator 24-hour model monitor. The rest of the administrator workspace remains outside this milestone.
- The user approved preserving the current macro information architecture while allowing local structural improvements inside the header, message/action area, settings detail, and model-monitor section.
- The user approved prioritizing the first P1 optimization batch around the daily member workspace: reading rhythm, header hierarchy, message actions, whitespace, and composer anchoring. Settings/mobile continuity and monitoring clarity follow as later batches.
- The user approved an asset-light direction: core workspace, settings, and monitoring remain typography-, spacing-, icon-, and state-led. Free imagery or illustration may appear only in a bounded entry or empty state when it adds clear product value.
- The user approved a compact Figma review set before implementation: desktop light and dark workspace, mobile conversation/composer, desktop member settings, mobile settings list/detail, member model availability, administrator model monitoring with data and with no observations, plus one component/variable/state inventory page. The exhaustive edge-state matrix belongs to implementation QA after the direction is accepted.
- The user explicitly approved the completed final Figma direction on 2026-08-19. This closes the design gate only; `task.py start` and UI implementation still require a separate explicit implementation approval.
- The user separately authorized implementation on 2026-08-19. The authorization is recorded, but UI changes must wait until the Trellis workflow permits leaving `planning` and `task.py start` succeeds.

## Requirements

### R1. Evidence-based Audit

- Audit production-equivalent light and dark experiences at desktop, tablet, mobile, and touch viewports using deterministic, network-blocked fixtures.
- Compare implementation against the approved Figma references and semantic design variables, while treating current code and actual screenshots as the implementation truth.
- Record each finding with severity, affected workflow, evidence anchor, user impact, and proposed disposition.
- Separate functional defects, accessibility risks, visual-quality gaps, and optional polish so implementation scope can be prioritized rationally.

### R2. Member Workspace Quality

- Preserve the established conversation rail, centered transcript, on-demand inspector, and stable composer ownership.
- Improve hierarchy and rhythm across brand, header, route availability, transcript, messages, actions, tool states, files, and composer without adding decorative surfaces or marketing composition.
- Keep conversation content as the primary visual signal; navigation, status, and contextual controls must remain discoverable while visually receding.
- Preserve long-content containment, streaming/recovery states, revision-aware actions, keyboard behavior, focus lifecycle, and permission-aware controls.

### R3. Member Settings Quality

- Preserve settings ownership and existing API/dialog flows; do not invent settings unsupported by repository capabilities.
- Improve master-detail balance, detail-page density, navigation state, dark-theme tonal separation, destructive-action hierarchy, and mobile list-detail continuity.
- Keep theme choice device-local and retain the existing follow-system, light, and dark semantics.
- Operational actions must continue to expose pending, success, failure, retry, and confirmation states without layout shift.

### R4. Model Availability And Monitoring

- Make member route availability easy to interpret at the moment of model selection without implying guarantees or exposing Provider details.
- Distinguish healthy, degraded, unavailable, stale/limited-confidence, refreshing, and no-observation states through text and shape as well as color.
- Preserve the passive 24-hour evidence contract and clearly explain that no observations is not the same as success or failure.
- Keep administrator-only aggregates, Provider/model grouping, failure classes, and diagnostic counts out of member-facing surfaces.
- Refine the existing administrator model-monitor section so summaries, the 24-hour trend, grouped results, freshness, and the legitimate no-data state are easier to scan.
- Administrator-monitoring changes must remain bounded to the existing model-monitor section and must not become a general administrator workspace redesign.

### R5. Responsive And Accessible Interaction

- Retain at least 44px touch targets, visible focus, semantic names, reduced-motion behavior, local overflow containment, and focus restoration.
- Audit `1920x1080`, `1440x900`, `780x900`, `480x844`, and touch-enabled `390x844` baselines in both representative light and dark states.
- Ensure long Chinese labels, technical terms, model names, file names, code, tables, and status copy do not overlap or widen the document.
- Avoid viewport-scaled typography, pill-heavy UI, card nesting, decorative gradients, and one-note color themes.

### R6. Planning Deliverables And Approval

- Produce a prioritized audit report within this task, with P0/P1/P2 findings and explicit keep/change decisions.
- Produce `design.md` for the approved target experience, token adjustments, component boundaries, state behavior, and Figma update direction.
- Produce `implement.md` with ordered changes, validation commands, rollback points, and scope-isolation checks.
- Update or extend the existing Figma file only after the audit direction is approved; reuse existing components and free assets only when licensing, product relevance, and visual consistency are clear.
- Run `task.py start` only after final planning convergence, final Figma approval, explicit implementation authorization, and a Trellis workflow state that permits leaving `planning`. The user approval gates are complete; the workflow transition is still pending.

### R7. Scope Isolation

- Do not modify backend schemas, API contracts, Provider routing semantics, monitoring aggregation semantics, privacy rules, deployment workflows, or production state during planning.
- Do not modify or advance any legacy rollout task, gate, workflow state, evidence, or legacy browser surface.
- Do not record prompts, responses, conversations, memories, credentials, Provider payloads, or member identities in audit evidence.

## Acceptance Criteria

- [x] AC1: The audit covers the member workspace, member settings, responsive states, both themes, member model availability, and the bounded administrator model-monitor section with reproducible evidence.
- [x] AC2: Every prioritized finding includes severity, evidence, user impact, and an explicit keep/change recommendation.
- [x] AC3: The proposed visual direction remains recognizably BIAU PORT / 泊岸 while using mature AI-workbench patterns without copying third-party branding or assets.
- [x] AC4: Model availability distinguishes no data, stale/limited evidence, active refresh, degraded service, and unavailability without overstating certainty.
- [x] AC5: The approved `design.md` maps recommendations to existing React components, semantic variables, and state owners without requiring new backend contracts.
- [x] AC6: The approved `implement.md` defines focused implementation batches, browser/accessibility validation, privacy checks, and rollback points.
- [x] AC7: No legacy rollout, production gate, deployment state, private data, or monitoring evidence contract is changed or advanced.
- [x] AC8: The user explicitly approves the final audit and design plan before implementation starts.

## Out Of Scope

- A broad administrator workspace redesign.
- New monitoring collection, synthetic health probes, billing telemetry, or per-member surveillance.
- A new HarborTalk logo, main-site redesign, or copied third-party visual assets.
- Backend preference synchronization, new member profile fields, or changes to account/data semantics.
- Production deployment, rollout observation, or rollback execution during planning.
