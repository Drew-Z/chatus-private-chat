# Chatus Post-release UX Optimization Design

## Status And Approval Gate

This design and its completed Figma review set were explicitly approved by the user on 2026-08-19. It preserves the approved Chatus information architecture and backend contracts while addressing the findings in `audit.md`. The design approval closes the design gate only; no UI implementation, production deployment, or rollout change is authorized until the user separately approves implementation.

## Design Intent

Chatus remains a quiet daily AI workbench under BIAU PORT / 泊岸. The optimization does not chase novelty. It makes the existing product feel more deliberate through stable alignment, better conversational rhythm, fewer equal-weight signals, clearer monitoring confidence, and stronger light/dark layering.

OpenAI and DeepSeek remain pattern references only: content-first composition, restrained controls, compact model access, and progressive disclosure. Their assets, branding, exact component shapes, and color values are not copied.

## Experience Principles

1. The current task is always the strongest signal; navigation and instrumentation recede until needed.
2. One interaction owner remains responsible for each action. Visual refinement must not duplicate route, Skill, file, memory, MCP, account, or monitor contracts.
3. Status communicates certainty. Unknown, stale, limited, refreshing, degraded, and unavailable are distinct states.
4. Light and dark share semantic roles, not literal luminance inversions. Dark surfaces need enough tonal separation to express hierarchy without becoming navy/slate-heavy.
5. The product remains asset-light. No decorative illustration is added to the core workspace, settings, or monitor.

## Preserved Information Architecture

```text
Member workspace
|-- Conversation rail
|-- Workspace header
|-- Transcript and turn groups
|-- Composer
`-- On-demand conversation inspector

Member settings
|-- Settings navigation/list
`-- One settings detail surface

Monitoring
|-- Member route availability in model selection/context
`-- Administrator aggregate 24-hour monitor in Operations
```

`ChatWorkspace` remains the composition and state owner (`client/src/components/ChatWorkspace.tsx:534`). `App` retains device-theme ownership (`client/src/App.tsx:114`). `ConversationInspector`, `MemberSettingsCenter`, and `AdminOperationsPanel` retain their current data and mutation owners.

## Member Workspace

### Desktop Header

- Keep one 60px structural row.
- Use three stable zones: conversation identity, route/availability control, and global actions.
- Give the conversation title the only flexible track. Route/model uses a bounded width and never competes with global actions.
- Render connection state and availability as one concise contextual line. Do not repeat equivalent health phrases in adjacent controls.
- Rename or clarify the context action through its accessible name and supporting label; keep the Lucide context-panel icon.

### Mobile Header

- Use a 56px primary row for rail access, product/conversation identity, context, and logout/account action.
- Represent the active route with one stable compact control that includes a state dot/icon and a truncated model label; its accessible name contains the full route, model, and state.
- When the compact control cannot fit beside the title, move it to a 40px contextual row below the primary row. Do not squeeze both labels into one line.
- Opening the control continues to use the existing full-screen conversation inspector and restores focus to the opener.

### Transcript And Turn Rhythm

- Treat each user message plus subsequent assistant response as a visual turn group without changing message data or DOM semantics.
- Target `12-16px` within a response's supporting blocks, `20-24px` between user and assistant inside one turn, and `32-40px` between completed turns.
- Keep assistant content unframed on the reading canvas. Keep user content on a quiet muted surface with an 8px maximum radius.
- Maintain the `720px` readable transcript maximum. Permit a slightly wider composer only when it remains aligned to the reading column.
- Keep message actions visible on touch and keyboard paths. On pointer layouts they may be visually quiet at rest, but never absent or hover-only.
- Tool traces, sources, files, reasoning, and memory proposals use separators and muted bands; they do not compete with the main answer heading or first paragraph.

### Composer

- Keep sticky positioning, attachment ownership, textarea growth cap, send/stop dimensions, safe-area handling, and reserved status space.
- Remove the visual effect of a separate full-width footer by weakening the outer top border and letting the composer box supply the focus boundary.
- Keep an 8px maximum radius, restrained elevation, and a clearly visible focus ring.
- Align attach, text, and send controls on one stable grid. Dynamic labels and pending states must not resize the composer.

## Member Settings

### Desktop Master-detail

- Narrow the navigation to approximately `240-256px` and bound detail content to approximately `760-840px` depending on the section.
- Add Lucide icons to section rows for appearance, memory, connections, account/data, and sessions/devices.
- Use one quiet selected row, not a saturated card. Navigation and detail remain full-height structural regions.
- Treat settings content as labeled sections and rows. Do not nest cards; borders and whitespace define groups.
- Separate destructive account actions with spacing, danger text/icon, and explanatory copy rather than a large danger-filled container.

### Mobile List-detail

- The first screen remains a full settings list with icons, label, one-line state, and chevron.
- Detail pages use a stable back/header row and content that begins close enough to preserve continuity.
- Keep touch targets at least 44px and reserve status/error space near the owning action.
- Large unused space is acceptable after short content, but the content block must have deliberate vertical rhythm and surface separation.

### Dark Theme Layering

- Retain the existing neutral dark family and cobalt accent.
- Strengthen role separation through canvas, structural surface, muted row, and elevated dialog values rather than adding a new hue family.
- Proposed semantic direction:

| Role | Light | Dark | Notes |
| --- | --- | --- | --- |
| Canvas | `#F8F9FB` | `#121316` | Product background |
| Structural surface | `#FFFFFF` | `#191B1F` | Workspace, settings detail |
| Muted surface | `#F2F4F7` | `#202329` | Rail, rows, user message |
| Strong surface | `#E9EDF3` | `#292D34` | Selected/hover state |
| Elevated surface | `#FFFFFF` | `#23262D` | Dialogs and inspector |
| Primary ink | `#17191D` | `#F4F6F8` | Main text |
| Secondary ink | `#666D78` | `#A7ADB7` | Supporting text |
| Separator | `#E3E7ED` | `#343943` | Structural lines |
| Accent | `#4D6BFE` | `#93A7FF` | Sparse actions and selection |

These values are candidates for Figma contrast validation, not implementation approval by themselves.

## Model Availability

### Member-facing State Model

The API contract remains unchanged. The UI derives presentation from existing `status`, `confidence`, `speed`, `observedAt`, `fallbackRecentlyUsed`, and `generatedAt` fields.

| Evidence state | Primary label | Supporting meaning |
| --- | --- | --- |
| `healthy` + `recent` | `可用` | Recent real Chatus traffic completed normally |
| `degraded` | `有波动` | Recent traffic had elevated failures, latency, or fallback behavior |
| `unavailable` | `暂不可用` | Recent traffic indicates the route should not be selected when alternatives exist |
| `unknown` with no observation | `暂无观测` | No real request evidence exists in the active window |
| `limited` confidence | `样本较少` | The status is based on insufficient recent evidence |
| `stale` confidence | `状态已过期` | Historical evidence exists but is no longer fresh enough for a current claim |
| refresh in progress | `正在更新` | Preserve the prior projection until the latest fenced request wins |

- Color remains secondary: use a status icon/dot, explicit label, and supporting sentence.
- The compact header control shows only the primary state. The inspector shows confidence, speed, last observed time, fallback note, and the advisory disclaimer.
- Member surfaces never expose physical Provider identity, raw counts, failure classes, or raw telemetry.

## Administrator Model Monitor

### Summary Hierarchy

- Primary summary: attempts, completed, failures, and in-flight. These establish denominator and reconciliation first.
- Derived summary: success rate, fallback count, and average latency. These appear after the primary counts and explicitly show `暂无数据` when undefined.
- Keep all existing fields; change only their visual order and explanation.

### Trend

- Replace 24 equal-height progress rows with a compact 24-bucket bar plot or sparkline-like bar sequence using existing bucket values.
- Provide accessible text for each bucket and retain a details/table path for exact counts.
- Label meaningful time intervals rather than repeating a full timestamp beside every zero bucket.
- Use attempts as bar height and encode failures/fallbacks with small markers or supporting detail, not stacked decorative color.

### No-observation State

- When `attempts=0`, `completed=0`, `failures=0`, and `inFlight=0`, render: `最近 24 小时暂无真实模型请求`.
- Explain that monitoring is passive, the state is not a success/failure verdict, and no synthetic request is generated.
- Keep the exact window and freshness visible. Group tabs remain available but may show a concise empty state instead of pagination chrome.

### Touch Layout

- Stack the section title and generated/window metadata without collision.
- Use a two-column primary metric grid, then a compact secondary disclosure.
- Show the plot before low-value group pagination so the current window can be understood within the first viewport.

## Accessibility And Motion

- Preserve semantic buttons, labels, `aria-pressed`, live regions, focus traps, Escape behavior, and opener restoration.
- Do not rely on color for route state, selected settings section, or monitor failure evidence.
- Essential supporting copy targets at least 12px; 10-11px is reserved for tertiary metadata.
- Keep transitions within `120-180ms`, drawers within `240ms`, and near-zero duration under `prefers-reduced-motion`.
- Verify 200% zoom, keyboard-only operation, touch targets, and local overflow for code, tables, model names, and status text.

## Figma Update Direction

Reuse the existing Chatus file and component language. Add or update a compact review set:

1. Foundations delta: adjusted semantic tones, type sizes, turn spacing, and status-confidence tokens.
2. Components delta: mobile header, message/turn group, composer, settings row, availability row/badge, monitor KPI, plot, and no-observation state.
3. Desktop workspace light and dark.
4. Mobile conversation and composer.
5. Desktop member settings and mobile settings list/detail.
6. Member availability with recent, limited, stale, unavailable, refreshing, and no-observation variants.
7. Administrator monitor with populated and zero-observation variants at desktop and touch width.

Do not create a new disconnected design system. Variables and reusable components should update the existing foundations/components pages when native Figma capabilities are available; bridge-created screen scaffolds must not be represented as native variables or component sets when they are not.

## Figma Phase 0 Discovery And Gap Resolution

### Connected File Inventory

- Target file: `泊语 HarborTalk | Chatus · Member UX System`, Bridge key `unsaved-msymdaei-30c4zgzn`.
- The file currently has one canvas page (`Page 1`, `0:1`) with five Chatus review frames: `00 Foundations` (`7:2`), `01 Components` (`7:3`), `02 Member Workspace` (`7:4`), `03 Member Settings` (`7:5`), and `04 Prototype And QA` (`7:6`).
- The same page also contains three BIAU PORT homepage exploration frames at x=16000 and beyond. They are brand context only and are not modification targets for this task.
- The Bridge reports zero native variable collections and zero local paint, text, effect, or grid styles. The visual foundations and components are ordinary editable frames, shapes, and text, not native Figma Variables, Components, Component Sets, or Instances.
- Code Connect discovery found no `*.figma.ts`, `*.figma.tsx`, or `*.figma.js` files in the repository.
- Official `get_libraries` and `search_design_system` calls cannot resolve the unsaved Bridge key and return an edit-access error. Library discovery is therefore recorded as N/A for this file state; no third-party kit or free visual asset is imported in this review set.

### Existing Frames To Keep

- Keep the five Chatus top-level review frames and their existing node IDs as historical references.
- Keep the existing light/dark workspace, mobile transcript/drawers, desktop/mobile settings, and QA flow frames unchanged during the post-release review build.
- Keep the Foundations and Components frames as a visual reference only. Do not relabel their ordinary shapes as native tokens or components.

### Code-to-Figma Gaps

| Area | Present in code | Present in current Figma | Resolution for this review |
| --- | --- | --- | --- |
| Semantic theme | Full light/dark CSS roles, status colors, shadows, spacing, radii, shell dimensions | Six light and six dark swatches only | Add a delta/inventory panel documenting the missing roles and proposed values; do not claim native variables |
| Workspace header | Route state, availability, title, actions, responsive ownership | Desktop route/model control; mobile shows title plus a generic overflow control | Create the approved compact/two-row mobile route treatment and rebalance desktop zones |
| Conversation rhythm | Message actions, tool/source/file states, streaming/recovery ownership | Representative messages and composer, but no message action or execution-detail state matrix | Add one representative turn group with quiet actions and supporting-state hierarchy |
| Composer | Stable attachment, send/stop, status, focus, safe-area behavior | Default visual shell only | Show default, focused, and sending/stop presentation without changing ownership |
| Settings | Five real sections, operational states, mobile list/detail | Appearance-focused desktop plus mobile list/appearance/account examples | Refine navigation icons, density, dark layering, and representative operational feedback |
| Member availability | Healthy/degraded/unavailable plus confidence, freshness, refresh, fallback projection | Only generic `可用` copy in the inspector | Add recent, limited, stale, refreshing, unavailable, and no-observation variants |
| Administrator monitor | 24-hour reconciled aggregates, trend buckets, grouping, populated and zero-observation states | No administrator model-monitor frame | Add bounded populated and no-observation review frames; do not redesign the wider admin workspace |

### Token Conflicts And Decisions

The current code and existing Figma swatches agree on the deployed baseline: light canvas `#F7F8FA`, surface `#FFFFFF`, muted `#F3F4F6`, ink `#15171A`/`#6F747C`, accent `#4D6BFE`; dark canvas `#111214`, surface `#191A1D`, muted `#222428`, ink `#F5F6F7`/`#A8ADB5`, accent `#8EA2FF`.

The values in the proposed dark-layering table above are intentionally a review delta, not a correction silently applied to the existing frames. The post-release review set will show the candidate values side by side with the deployed baseline. Only values accepted in the final Figma approval may enter implementation. This preserves code as the deployed source of truth while allowing Figma to test a more legible hierarchy.

### Locked Figma Review Scope

- Create one new top-level frame named `05 Post-release Audit Review` to the right of the current Chatus frames, leaving existing frames untouched.
- Build a compact review set inside that frame: desktop light workspace, desktop dark workspace, mobile conversation/composer, desktop settings, mobile settings list/detail, member availability states, administrator monitor populated/no-observation, and one component/token/state inventory.
- Core surfaces remain asset-light. Use typography, spacing, Lucide-style functional icons, status shape, and restrained color. Do not add stock photography, decorative illustration, gradients, or copied OpenAI/DeepSeek/BIAU assets.
- For this Bridge review, navigation icons are derived from the repository's installed `lucide-react@1.24.0` package under its ISC license and imported as temporary PNG previews because the Bridge cannot ingest SVG. Production implementation must continue to use native `lucide-react` components, not the PNG review assets.
- Bridge-created review frames remain editable visual specifications. Native Pages, Variables, Components, Instances, library imports, and Code Connect are deferred until the file is saved to Figma and the official tool can confirm edit access.
- Each major frame is created and validated sequentially. Every created or mutated node ID is recorded in `figma-state.json`; each frame receives a structure read-back and screenshot review before the next frame begins.

## Compatibility And Rollback

- No API, Worker, Agent, Provider, storage, identity, monitoring aggregation, or schema migration is required.
- Local UI preference keys and server-authoritative conversation state remain unchanged.
- Each implementation batch can be reverted independently: workspace hierarchy, settings/dark tokens, member availability presentation, and administrator monitor presentation.
- `public/`, legacy rollout records, deployment workflows, and production state remain untouched.

## Figma Phase 4 Validation Record

- The final review container is `05 Post-release Audit Review` (`34:139`) at `3000x5200`.
- Twelve major review frames are present: foundations; desktop workspace light/dark; mobile workspace; desktop settings; mobile settings list/detail; member availability; administrator monitor desktop populated; administrator monitor touch populated/no-observation; and the component/variable/state inventory.
- Direct-boundary inspection confirms every major frame remains inside the review container. The major frames do not overlap and keep deliberate row/column separation.
- The final inventory is `Component / Variable / State Inventory` (`37:679`), with review nodes `37:680-37:694`.
- Screenshot inspection passed for the inventory and full overview with no clipped text, incoherent overlap, or horizontal overflow. Evidence is stored under `figma-review/`.
- Monitoring values shown in the review remain fixtures, not production evidence. No synthetic requests were generated and no backend or monitoring semantic changed.
- Final Figma direction approval was recorded on 2026-08-19. No UI implementation may begin until a separate explicit implementation approval is recorded and `task.py start` is run.
