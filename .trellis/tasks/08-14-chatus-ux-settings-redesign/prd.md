# Chatus UX And Settings Redesign

## Goal

Create a calmer, more comfortable, and more coherent Chatus product experience under the BIAU PORT / 泊岸 parent brand. Chatus has no established brand or color system today; the redesign will derive a product identity for 泊语 HarborTalk | Chatus from the main site at `https://biau.playlab.eu.cc`. Use mature AI products such as ChatGPT and DeepSeek as interaction and layout references without copying their branding, assets, or exact visual treatment.

The work is Figma-first: agree on information architecture, interaction states, responsive behavior, and reusable design tokens/components before production UI implementation begins.

## Confirmed Constraints

- Treat BIAU PORT / 泊岸 as the parent brand and 泊语 HarborTalk | Chatus as the product identity. The current green tokens and letter-C mark are implementation placeholders, not protected brand assets.
- Adapt the main site's deep navy typography, mist cyan, soft blush, and restrained warm-gold accents into a simpler, cleaner product palette.
- Limit mist-cyan and soft-blush atmosphere to bounded brand moments such as login, loading, empty states, and restrained shell backgrounds. Keep the active chat workspace predominantly neutral, with deep navy text and sparse warm-gold emphasis for long-session comfort.
- Design the actual application experience, not a marketing landing page.
- Reference proven layout and interaction patterns only; do not create a visual clone of another product.
- Keep the interface quiet, work-focused, accessible, and efficient for repeated chat workflows.
- Keep this work independent from active legacy-surface rollout tasks and do not change production rollout phases, observation windows, governance controls, or deployment state.
- Do not start UI implementation until the user reviews and approves the final PRD, Figma direction, `design.md`, and `implement.md`.

## Current Product Evidence

- The BIAU PORT main site uses a deep navy editorial type system over mist-cyan, soft-blush, and warm-light atmospheric fields, with warm gold for emphasis, translucent pale surfaces, compact navigation, and rounded project rows. Its identity language is `BIAU PORT / 泊岸`; Chatus is presented as `泊语 HarborTalk | Chatus 私人 AI 工作台`.
- Current Chatus UI tokens use neutral white/gray surfaces with a green accent and a generated letter-C mark. No repository evidence defines these as a durable brand system (`client/src/styles.css:1-32`, `client/src/styles.css:113-120`).
- The member workspace currently places conversation history, files, and conversation settings in one sidebar. Route/model, Skills, tools, usage, and account/data controls live inside that settings view; memory and MCP connections open from separate header actions (`client/src/components/ConversationSidebar.tsx:209-409`, `client/src/components/WorkspaceHeader.tsx:54-134`).
- The existing chat workspace already supports permission-aware conversation history, sharing, branching, attachments, message actions, streaming/recovery states, route availability, offline handling, and destructive confirmations. The redesign must reorganize and clarify these capabilities without redefining their backend contracts.
- Existing browser acceptance covers 1920px, 1440px, 780px, 480px, and touch 390px viewports, including focus, containment, offline, permission, retry, destructive confirmation, and configuration conflict states.

## Requirements

### R1. First Milestone Scope

- The first design milestone covers the member-facing chat workspace and member settings only: login/session recovery, conversation navigation, transcript, composer, route/model and Skill selection, files, sharing, memory, MCP connections, account/data actions, session/device controls, and their responsive states.
- Full administration remains a later milestone and must not be mixed into this task.

### R2. Theme And Design System

- Define semantic light and dark theme variables together.
- Light mode is the primary presentation and acceptance target for the first milestone.
- Dark mode must be represented across tokens, reusable components, and critical member-workspace states so implementation does not require a later color-system rewrite.
- Member appearance settings provide three theme choices: follow system, light, and dark. Follow system is the default.
- Persist the first-milestone theme preference on the current device/browser. Do not add a server-side member preference field or cross-device theme synchronization in this task.
- Keep operational surfaces neutral and high-contrast in both themes; atmospheric brand colors must not reduce transcript readability or compete with semantic status colors.
- Define a Figma design system for color, typography, spacing, elevation, separators, icons, controls, focus, motion, and responsive layout.

### R3. Settings Ownership

- Separate settings by ownership.
- Conversation-scoped route/model, Skills, tools, files, and sharing remain in a contextual conversation inspector.
- Member-global appearance, memory, MCP connections, account/data export, and session/device controls move into a dedicated settings center.
- Follow the mature AI-product pattern of layered access rather than putting every control in Settings: keep a compact in-chat model/route selector and necessary contextual controls near the active conversation, while cross-conversation preferences live in the global settings center.
- Keep conversation-object actions such as rename, share, archive, and delete in the conversation menu/rail rather than mixing them with global preferences.
- Treat the desktop conversation inspector as an on-demand expansion layer, closed by default; tablet and mobile present the same contextual controls as a drawer or full-screen layer.
- Auto-save low-risk preferences such as appearance, default model, and display options with a concise saved-state confirmation.
- Use explicit execution controls and visible in-progress/success/failure/retry states for MCP connections, device sessions, data export, and other operational settings.
- Require a second confirmation for destructive or hard-to-reverse actions such as deletion, revoke, and sign out of all devices. Do not add one global save button covering every settings section.
- Settings must reflect real product capabilities and configuration ownership in the repository; no decorative or non-functional settings may be invented.

### R4. Brand Identity

- Reuse the BIAU PORT parent mark with a `泊语 HarborTalk` product wordmark for the first milestone.
- Do not create an unrelated standalone logo or replace the parent identity.
- A distinct HarborTalk app icon or standalone product mark may be evaluated in a later brand task.

### R5. Responsive Information Architecture

- Desktop uses a persistent conversation rail, centered transcript, and optional right-side conversation inspector.
- Tablet may collapse the conversation rail and open the inspector as a drawer.
- Mobile keeps the transcript as the only persistent region and presents conversation navigation and contextual controls as separate full-screen drawers.
- The global settings center uses a desktop master-detail layout within the product shell and a full-screen hierarchical flow on mobile.

### R6. Core Experience Quality

- Preserve progressive disclosure so model, Provider, Skill, file, sharing, memory, MCP, privacy, and account controls do not overload the primary chat flow.
- Use one comfortable-compact density for the first milestone. Keep navigation and settings surfaces efficient to scan while preserving generous transcript line height and reading rhythm.
- Do not add a density preference in the first milestone. Desktop icon controls may remain compact, but touch layouts must retain at least 44px interactive targets.
- Use low-motion, state-first interaction feedback: short drawer, overlay, and theme transitions; no decorative or marketing animation; streaming and saving feedback must remain readable.
- Respect `prefers-reduced-motion` in every proposed transition, replacing motion with immediate state changes or static indicators when requested.
- Use Simplified Chinese as the first-milestone interface language. Keep `泊语 HarborTalk | Chatus` and necessary established technical terms such as Skill and MCP in English where translation would reduce clarity.
- Do not duplicate every label in Chinese and English or implement a language switch in the first milestone. Design reusable components and responsive layouts so longer future localized strings can fit without overlap or truncating core commands.
- Include complete loading, empty, success, disabled, validation, offline, permission, destructive-confirmation, and retry states where applicable.
- Define measurable implementation acceptance for accessibility, keyboard/focus behavior, responsive containment, contrast, and visual regression coverage.
- Produce coherent desktop and mobile designs for the approved core workflows.

### R7. Planning Deliverables

- Define the Figma file/page structure, variables, reusable components, responsive frames, interaction states, and approval prototypes.
- The first Figma review must cover: brand entry/session recovery; new conversation; active conversation; conversation navigation; contextual conversation configuration; global settings; desktop, tablet, and mobile key layouts; light coverage for all core flows; dark coverage for representative new-chat, active-chat, contextual-settings, and global-settings screens.
- The first review prototype must connect new conversation → model selection → send → streaming response → contextual configuration, plus settings → theme switch → MCP/data operation states.
- Produce `design.md` mapping the approved product experience to existing React components and contracts.
- Produce `implement.md` with an ordered implementation sequence, validation gates, risky boundaries, and rollback points.
- Keep the task in planning until the user explicitly approves the final design.

## Acceptance Criteria

- [x] AC1: The current product and configuration inventory is traceable to code, tests, or existing specifications.
- [x] AC2: The approved information architecture separates primary chat work, conversation context, member-global settings, integrations/data controls, and administrative tools.
- [x] AC3: Figma direction contains Chatus-owned light/dark variables and reusable components rather than disconnected one-off screens.
- [x] AC4: Approved desktop, tablet, and mobile flows include all relevant operational states and preserve keyboard, focus, contrast, and containment requirements.
- [x] AC5: Reference-product influence is documented at the pattern level and the resulting design remains recognizably part of BIAU PORT / 泊岸.
- [x] AC6: Brand presentation uses the BIAU PORT parent mark and 泊语 HarborTalk wordmark without inventing an unrelated first-milestone logo.
- [x] AC7: Technical design and implementation planning map each approved Figma surface to existing React routes/components/configuration contracts and tests.
- [x] AC8: The member settings center separates global preferences and account/integration controls from conversation-scoped configuration.
- [x] AC9: No legacy rollout task, production rollout gate, deployment path, or production behavior is modified or advanced.
- [x] AC10: The user explicitly reviews and approves the final planning artifacts before UI implementation begins.
- [x] AC11: The approved Figma direction defines the agreed core screens, light/dark representative coverage, responsive frames, and two connected prototype flows for a future Figma file.

## Out Of Scope

- Full administrator workspace redesign.
- Main-site redesign or copying third-party brand assets.
- A standalone HarborTalk logo or app icon in the first milestone.
- Inventing backend settings or changing Provider, security, storage, ACL, rollout, billing, privacy, streaming, or routing semantics as part of visual design.
- Production implementation, deployment, rollout validation, or rollout evidence changes before design approval.
