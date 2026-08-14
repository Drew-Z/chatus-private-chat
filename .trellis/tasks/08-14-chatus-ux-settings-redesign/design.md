# Chatus UX And Settings Design

## Status And Approval Gate

This is a planning artifact for `08-14-chatus-ux-settings-redesign`. It describes the proposed member experience and the implementation boundary; it does not change production code. `task.py start` and UI implementation remain blocked until the user approves the final PRD, this design, the Figma direction, and `implement.md`.

## Design Intent

Chatus should feel like a durable daily workbench inside the BIAU PORT / 泊岸 family. The parent brand supplies the relationship, wordmark, and a restrained atmospheric vocabulary. The active work surface stays quiet: neutral surfaces, deep navy text, stable reading width, sparse warm-gold emphasis, and explicit semantic status colors. The product identity is `泊语 HarborTalk | Chatus`; the first milestone does not invent a separate logo or app icon.

The design is Figma-first and implementation-ready. It keeps the existing member chat and account contracts, separates conversation-scoped controls from member-global preferences, and gives every responsive state a clear owner.

## Approved Product Decisions

- First milestone: member chat workspace and member settings only. Full administration is a later milestone.
- Figma establishes light and dark variables together. Light is the primary review and acceptance theme; dark covers the same reusable component states and representative core flows.
- Conversation scope: route/model, Skills, tools, files, and sharing remain close to the active conversation.
- Member-global scope: appearance, memory, MCP connections, account/data export, and session/device controls live in a dedicated settings center.
- Desktop shell: persistent conversation rail, centered transcript, optional on-demand conversation inspector. The inspector is closed by default and remembered per device after the user opens it.
- Tablet shell: rail can collapse; the inspector opens as a drawer.
- Mobile shell: the transcript is the only persistent region; conversation navigation and contextual configuration open as separate full-screen drawers.
- Brand: reuse the BIAU PORT parent mark and a `泊语 HarborTalk` product wordmark. Do not make a standalone HarborTalk mark in this milestone.
- Language: Simplified Chinese first; preserve the product wordmark and necessary technical terms such as Skill and MCP; do not implement language switching.
- Density: one comfortable-compact mode. No user density preference in the first milestone.
- Theme behavior: follow system, light, or dark; follow system is the default; store the preference on the current device/browser.
- Save behavior: auto-save low-risk preferences with saved feedback; explicitly execute operational settings; confirm destructive actions; no universal Save button.
- Motion: low-motion, state-first transitions with full `prefers-reduced-motion` support.
- Brand atmosphere: mist-cyan and soft-blush fields are bounded to login, loading, empty states, and restrained shell moments; active chat surfaces remain neutral.

## Repository Evidence And Boundaries

The typed client is the default teammate experience under `client/`; `public/` is a separate legacy rollback surface and is outside this task (`.trellis/spec/frontend/directory-structure.md:1-24`). The existing composition already provides a suitable ownership boundary:

| Existing owner | Current responsibility | Planned relationship |
| --- | --- | --- |
| `App.tsx` | session gate and composition root | Keep the root small; route member workspace vs settings surface without adding a second app shell |
| `ChatWorkspace.tsx` | active conversation, bootstrap, sidebar state, async locks, conversation settings persistence | Remain the state owner for chat navigation and conversation-owned mutations; split presentation into focused children |
| `ConversationSidebar.tsx` | history, files, settings tabs, account/data controls | Keep rail/history behavior; move global settings into the settings center and conversation controls into the inspector |
| `WorkspaceHeader.tsx` | menu, title/branch context, route status, memory/MCP/account actions | Keep the compact header; add an explicit model/route quick access and settings entry without exposing provider secrets |
| `MessageView.tsx` | markdown, files, sources, reasoning, tools, actions | Keep message semantics and action contracts; only adjust hierarchy and visual states |
| `MessageComposer.tsx` | attachments, drafts, submit/stop, status | Keep send/stop and attachment contracts; apply the new token system and state feedback |
| `MemoryPanel.tsx` / `McpConnectionsDialog.tsx` | member-global memory and MCP flows | Reuse the existing validated flows from the settings center; do not invent parallel API contracts |
| `ConfirmDialog.tsx` / `ConversationShareDialog.tsx` | confirmation and sharing | Keep native dialog semantics, focus lifecycle, revision/conflict behavior, and redaction |
| `client/src/styles.css` | typed-client visual system | Become the single implementation home for semantic light/dark variables and responsive rules |

The frontend component specification requires stable owning IDs for asynchronous updates, semantic controls, initial focus, Tab containment, Escape, and opener focus restoration (`.trellis/spec/frontend/component-guidelines.md:7-20`). State remains React local state, refs, device storage, and validated server projections; there is no global-state library (`.trellis/spec/frontend/state-management.md:1-24`).

## Information Architecture

### Member Chat Shell

```text
Member shell
|-- Conversation rail
|   |-- New conversation
|   |-- Search conversations
|   |-- Conversation list and active state
|   |-- Conversation object menu: rename, share, archive/delete
|   |-- Files entry (member capability gated)
|   `-- Account/settings entry
|-- Conversation header
|   |-- Mobile rail toggle
|   |-- Conversation title and branch context
|   |-- Compact model/route selector (quick access)
|   |-- Connection/status projection
|   |-- Context inspector toggle
|   `-- Memory, MCP, and account shortcuts where capability allows
|-- Transcript
|   |-- Empty/new-chat state
|   |-- User and assistant messages
|   |-- Sources, files, reasoning, tools, errors, and actions
|   `-- Streaming/recovery/offline projections
`-- Composer
    |-- Attachments and file context
    |-- Draft textarea
    |-- Send/stop and status
    `-- Offline/unavailable/busy states
```

### Conversation Context Inspector

The inspector is an on-demand contextual surface, not a replacement for global settings. It is opened from the header or quick model control and is keyed to the active conversation ID. It contains:

1. Model and route: current logical route, available member-safe routes, passive health/status, and the current selection.
2. Skills: automatic/manual mode and the existing maximum selection rules.
3. Tools: available tool projection and approval-related context, without raw payloads.
4. Files: workspace files and attachment context for this conversation, using existing permission and version contracts.
5. Sharing: the existing share dialog and role-gated controls for the active conversation.

Changing a conversation-owned option keeps the current chat visible, queues the mutation by conversation ID, and reports saving/saved/error inline. Provider IDs, credential references, upstream payloads, and raw failure details never enter the UI.

### Global Member Settings Center

The settings center is reached from the account/settings entry and is separate from the conversation inspector. Its desktop structure is a narrow settings navigation column plus one readable detail column. Its mobile structure is a full-screen list-to-detail flow with a persistent back path to chat.

```text
Settings center
|-- Appearance
|   |-- Theme: follow system / light / dark
|   `-- Bounded display preferences (only capabilities confirmed in code)
|-- Memory
|   `-- Existing root-Agent memory editor and revision/conflict states
|-- Connections
|   `-- Existing MCP connection list, OAuth, secret, discovery, and retry states
|-- Account and data
|   |-- Export data
|   |-- Revoke sessions / sign out all devices
|   `-- Delete data/account actions with explicit confirmation
`-- Sessions and devices
    `-- Existing session projection and revocation status
```

The center must not become a hidden administrator panel. Provider registry, logical model administration, member access management, public access, reliability, and operations remain out of scope.

## Interaction And State Contracts

### State Ownership

| State | Owner | Persistence | Failure behavior |
| --- | --- | --- | --- |
| Rail visibility and inspector open state | `ChatWorkspace` | Device-scoped UI preference | Revert only the visual toggle; do not affect conversation data |
| Active conversation and sidebar selection | `ChatWorkspace` | Existing user-scoped session snapshot/server state | Keep current selection on transient failure and show retry |
| Route, Skill mode/IDs, tools, file references, sharing | Conversation entity/Agent contract | Existing revisioned conversation APIs | Keep local draft and associate results with conversation ID |
| Theme preference | Small browser preference helper under `client/src/lib/` | User-scoped device `localStorage` | Fall back to system/light default if storage is unavailable or malformed |
| Memory, MCP, sessions, export/delete | Existing validated API/dialog owners | Existing server state | Preserve draft/session on failure; destructive actions remain pending until exact success |
| Temporary secrets and one-time credentials | Owning dialog only | Never persisted | Clear on close, ref change, mutation outcome, conflict, refresh, and unmount |

All asynchronous results must check the initiating entity ID and revision before updating state. Low-risk preference saves may debounce by preference key; conversation saves continue using the existing per-conversation queue. This follows the repository rules for revisioned server state, scoped local storage, and conflict retention (`.trellis/spec/frontend/state-management.md:16-44`).

### Header Quick Access

The header exposes the current logical route/model as a compact, keyboard-operable selector. Selecting a route is a conversation-scoped mutation; opening the full inspector exposes Skills, tools, files, and sharing. The global settings control always leads to the settings center. The header must not expose physical Provider identity, credentials, or internal telemetry.

### Save And Confirmation Feedback

- Low-risk preference controls show `保存中`, `已保存`, and a retryable error near the changed control.
- Operational settings use explicit buttons and reserved status space so pending copy does not shift the layout.
- Destructive `ConfirmDialog` receives a connected fallback focus target and remains open on failure.
- Logout, account-data deletion, and session revocation retain the current member's drafts until the authoritative server operation succeeds.

## Responsive Behavior

Use the current breakpoint family rather than adding a second responsive system: wide desktop, the existing 780px tablet boundary, 520px/480px mobile transitions, and a touch-enabled 390px acceptance viewport. Layout rules are constraint-based and must not produce page-level horizontal overflow.

| Viewport | Rail | Transcript | Inspector/settings |
| --- | --- | --- | --- |
| Wide desktop | Persistent, stable width | Centered readable column | Inspector overlays or occupies a bounded optional column; settings uses master-detail |
| Tablet | Collapsible rail | Remains the primary region | Inspector is a drawer; settings uses list/detail with one visible detail pane |
| Mobile | Hidden until full-screen drawer opens | Only persistent region | Inspector and settings are full-screen layers with back/close and opener restoration |

All icon controls retain accessible names and visible focus. Touch controls use at least 44px targets even where desktop controls remain 36px. Long titles, model names, file names, code, tables, and status text wrap or scroll locally without widening the document.

## Design Variables

The following names are semantic contracts for Figma and the eventual `client/src/styles.css` implementation. Hex values are a starting direction, not a substitute for Figma contrast validation.

### Core Variables

| Token | Light direction | Dark direction | Use |
| --- | --- | --- | --- |
| `color.surface.canvas` | `#F4F7F7` | `#101820` | App background |
| `color.surface.default` | `#FFFFFF` | `#151F29` | Main panels and controls |
| `color.surface.muted` | `#EEF3F3` | `#1B2833` | Rail, quiet rows, code/table backing |
| `color.surface.elevated` | `#FFFFFF` | `#1E2D39` | Dialogs and inspector |
| `color.ink.primary` | `#152A3C` | `#F1F6F7` | Main text and headings |
| `color.ink.secondary` | `#5E6E77` | `#AEBEC4` | Supporting text |
| `color.line.default` | `#D8E3E4` | `#30434E` | Separators and borders |
| `color.line.strong` | `#B8C9CC` | `#48606B` | Focused/selected control boundaries |
| `color.brand.accent` | `#187C83` | `#75C8CC` | Primary action and selected state |
| `color.brand.accentSoft` | `#E2F2F2` | `#173A3E` | Low-emphasis brand state |
| `color.brand.warm` | `#A96F2D` | `#D7A65F` | Sparse emphasis and attention |
| `color.brand.blush` | `#D89192` | `#D39A9E` | Bounded brand moments only |
| `color.status.success` | `#2E795F` | `#6CC39D` | Success/connected |
| `color.status.warning` | `#94621B` | `#E1B767` | Warning/recovery |
| `color.status.danger` | `#B24752` | `#EE8F98` | Destructive/error |
| `color.focus.ring` | `#187C83` at 30% | `#75C8CC` at 45% | Keyboard focus |

The brand accent is intentionally restrained. Status colors are separate semantic roles, and atmospheric cyan/blush never replaces error, warning, or success tokens.

### Layout And Type Variables

- Spacing scale: `4, 8, 12, 16, 24, 32` px; use multiples of 4 for control internals.
- Radii: `4px` for compact controls, `6px` for fields and rows, `8px` maximum for framed tools; no pill-shaped text containers unless the existing control semantics require it.
- `size.control.desktop = 36px`; `size.control.touch = 44px`; `size.input.min = 40px`.
- `size.rail.desktop = 280px`; `size.inspector.desktop = 320px` bounded by available width; `size.transcript.max = 720px`; `size.header.max = 60px`.
- Body text uses the existing system/Inter stack with Chinese fallbacks; display scale stays modest inside the workbench and never scales with viewport width.
- Default body line-height targets `1.55-1.65`; transcript content receives more vertical rhythm than rail metadata.
- Motion durations: `120-180ms` for local transitions, `240ms` maximum for drawers; reduced motion sets duration to near-zero and disables looping decoration.

## Figma File And Prototype Direction

Create one Figma file with these pages:

1. `00 Foundations`: BIAU PORT relationship, wordmark usage, semantic light/dark variables, typography, spacing, radii, focus, status, and motion notes.
2. `01 Components`: rail rows, header controls, model selector, inspector sections, settings navigation/detail, fields, toggles, dialogs, message actions, composer, status banners, and responsive variants.
3. `02 Member Workspace`: desktop and mobile brand entry, empty/new chat, active transcript, streaming/recovery, inspector open, rail actions, and composer states.
4. `03 Member Settings`: appearance, memory, connections, account/data, sessions/devices, operational pending/error/success, and destructive confirmation.
5. `04 Prototype And QA`: connected review flows, viewport matrix, dark-theme representative screens, contrast notes, and unresolved review annotations.

Use variables and component variants rather than detached screen-specific colors. The minimum approval prototype is the two-flow chain in the PRD; every destructive and async state must be represented as a component state even if not linked in the prototype.

## Compatibility, Migration, And Rollback

- No backend schema, API, Worker, Agent, Provider, ACL, memory, MCP, or storage migration is required by this design.
- Theme and inspector preferences are device-local and can be ignored safely when malformed. Existing user-scoped conversation drafts and server revisions remain authoritative.
- The implementation must not touch `public/` legacy assets, legacy rollout manifests, production gates, or deployment workflows. The typed client remains the only UI implementation boundary.
- A future implementation can be reverted by restoring the previous typed React components and `client/src/styles.css`; no data migration or irreversible rollout step is introduced.
- Browser acceptance fixtures remain synthetic and network-blocked. Production checks and deployment dry-run are validation gates only; they are not part of the design rollout.

## Design Trade-offs

- Layered settings keep chat focused and make global preferences discoverable, at the cost of one extra navigation step for rare conversation controls.
- A closed-by-default inspector protects reading width, at the cost of one click for advanced configuration.
- Device-local theme preference avoids backend and cross-device conflict work, at the cost of a member seeing different themes on different browsers.
- One comfortable-compact density avoids a large state matrix, at the cost of not serving specialized ultra-dense workflows in the first milestone.
- Bounded brand atmosphere preserves parent-brand recognition without making a long-session tool look like a marketing page.

## Acceptance Mapping

The PRD acceptance criteria map to this design as follows: IA and ownership are covered by the shell/inspector/settings sections; light/dark behavior and variables by the semantic token tables; responsive and accessibility behavior by the viewport and focus rules; Figma approval by the page/prototype structure; compatibility and rollout isolation by the migration/rollback section. Implementation verification is enumerated separately in `implement.md`.
