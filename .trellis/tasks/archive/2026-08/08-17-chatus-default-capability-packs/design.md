# Chatus Default Capability Packs Design

## Planning And Approval Gate

This design covers a parent planning task. It does not authorize product-code
changes. After review, create the child tasks listed in the task map and start
only the first child that owns implementation. Do not start this parent task.

No production deployment, production observation action, PR #93 change, or
legacy rollout task/gate/evidence change is part of this design. All external
execution tests use local fake Providers and fake MCP/OAuth services.

## Design Intent

The system should answer two separate questions truthfully:

1. What can the selected model do natively?
2. What can Chatus add through instructions, trusted orchestration, or a reviewed
   external service?

The first answer remains a route property. The second answer comes from a
versioned capability catalog, administrator assignment, current executable
configuration, and per-turn user intent. UI labels and routing decisions must
never collapse these sources into a single "supports" boolean.

## Product Reference Position

The OpenAI references support separating instruction workflows from MCP and
connector authorization, and support explicit approval/data-sharing controls.
The DeepSeek reference supports protocol-compatible Provider integration and
agent-tool use. Neither source is a contract for a private web UI. The local
research record is `research/product-capability-reference.md`.

## Existing Boundaries And Reuse

| Boundary | Existing owner | Design relationship |
| --- | --- | --- |
| Skill/tool assignment | `src/services/capability-registry.ts` | Extend one shared filter/projection. Do not duplicate assignment logic in Agent, legacy chat, or React. |
| Configuration authority | `loadEditableConfig()`, revisioned `PUT /api/admin/config` | Add a server-owned catalog/install action using the same revision and validation boundary. |
| Image validation/persistence | `src/contracts/image.ts`, Agent message storage | Reuse canonical inline-image parsing and limits. Never send raw image bytes through generic MCP JSON. |
| Provider planning | provider plan, capacity, deadlines, attempt ledger | Run helper vision as a first-class Provider run with existing lease, budget, credential, and cancellation rules. |
| MCP governance | `src/services/mcp-runtime.ts` | Reuse HTTPS/SSRF, OAuth, discovery, fingerprint, side-effect, approval, timeout, and close behavior. Add only a strict web-result adapter. |
| Agent tools | `src/services/agent-tools.ts` | Add one trusted, request-bound image inspection executor. Keep arbitrary tool IDs and schemas server-side. |
| Member workspace | `ChatWorkspace`, `ConversationInspector`, `MessageView` | Present one coherent capability model, per-turn search, image mode, progress, citations, and recovery. |
| Admin workspace | `CapabilityAdminPanel`, member assignment, Operations | Add catalog installation, helper/search binding, assignment, availability, and content-free monitoring. |
| Passive Provider monitoring | `ProviderAttemptLedger`, model monitor | Add `auxiliary_vision` to the closed run-kind contract. Do not modify production observation artifacts or workflows. |

## Parent And Child Task Map

The parent owns this design, cross-child acceptance, and final integration
review. It has no direct implementation deliverable.

| Order | Proposed child slug | Independently verifiable deliverable | Explicit dependency |
| --- | --- | --- | --- |
| 1 | `chatus-capability-catalog-adoption` | Code-owned catalog, five workflow Skills, origin/activation/disclosure contracts, revisioned install/preview, assignment compatibility | None |
| 2 | `chatus-auxiliary-vision` | Vision-helper configuration, three image paths, private bounded evidence, `auxiliary_vision` ledger run, recovery | Child 1 public catalog/disclosure contracts |
| 3 | `chatus-web-research` | Explicit-turn research activation, reviewed MCP binding, strict source decoding, citations, recoverable errors | Child 1 activation/disclosure contracts |
| 4 | `chatus-capability-experience-monitoring` | Unified member/admin UX, content-free capability aggregates, responsive/accessibility states | Children 1-3 stable runtime/public contracts |
| 5 | `chatus-capability-integration-hardening` | Cross-layer fake-service matrix, branch/export/delete/restore checks, complete quality gate, spec updates | Children 1-4 complete and individually green |

Child dependencies must be copied into each child `prd.md` and `implement.md`
when the child tasks are created. Tree position alone is not a dependency.

## Capability Taxonomy And Catalog

### Categories

The public catalog uses three activation categories:

- `workflow`: instructions only. Eligible for existing automatic/manual Skill
  selection and never performs an extra external request by itself.
- `explicit_turn`: a member action for the next turn. Excluded from the automatic
  selector. Web research is the first item.
- `route_augmentation`: server-selected behavior triggered by an attachment and
  current route capability. Assisted image understanding is the first item.

The member projection exposes a derived disclosure rather than arbitrary prose:

```typescript
type PublicCapabilityDisclosureV1 = {
  execution: "instructions" | "trusted_local" | "auxiliary_provider" | "reviewed_mcp";
  externalRequest: boolean;
  dataClasses: Array<"prompt_text" | "search_query" | "image">;
  latency: "none" | "small" | "variable";
  cost: "none" | "provider_request" | "external_service";
};

type PublicCapabilityV1 = {
  id: string;
  label: string;
  description: string;
  source: "chatus" | "administrator";
  activation: "workflow" | "explicit_turn" | "route_augmentation";
  availability: "available" | "unavailable" | "requires_setup" | "disabled";
  disclosure: PublicCapabilityDisclosureV1;
  unavailableReason?: "not_assigned" | "route_incompatible" | "helper_unavailable"
    | "tool_unavailable" | "review_required" | "connection_required";
};
```

This projection is server-derived. The browser must reject unknown enum values,
unknown keys, duplicate IDs, inconsistent availability/reason pairs, and
unbounded strings.

### Workflow pack

The code-owned first version contains:

| ID | Purpose | Automatic |
| --- | --- | --- |
| `chatus:writing` | Draft, rewrite, and improve text while preserving intent | Yes |
| `chatus:summarize` | Produce bounded summaries, key points, and open questions | Yes |
| `chatus:translate` | Faithful translation with terminology and formatting preservation | Yes |
| `chatus:code_explanation` | Explain supplied code without claiming execution | Yes |
| `chatus:structured_output` | Format supplied information into requested structures | Yes |

These definitions contain no tools. Existing custom Skills default to their
current automatic/manual behavior. A new optional Skill activation field must
therefore normalize omission to the compatibility behavior, not to
`explicit_turn`.

### External templates

`chatus:web_research` is a code-owned Skill template with
`activation: "explicit_turn"`. It becomes available only after the administrator
binds one reviewed read-only MCP tool with the compatible search contract.

Assisted image understanding is not represented as a normal selectable Skill.
It is a route augmentation because image attachment and route capability select
the execution path. Its helper is configured separately and assigned through
the capability assignment projection.

## Configuration And Adoption

### Stored shape

Extend the shared capability contracts with bounded optional metadata rather
than creating parallel config files:

```typescript
type SkillActivation = "automatic" | "explicit_turn";
type CapabilityOrigin = "chatus" | "administrator";

type SkillConfig = {
  // existing fields
  activation?: SkillActivation;
  origin?: CapabilityOrigin;
};

type ToolConfig = {
  // existing fields
  capabilityRole?: "web_search";
};

type VisionAssistConfig = {
  enabled?: boolean;
  routeId: string;
  maxOutputChars?: number;
};

type CapabilityAssignment = {
  allowedSkills?: string[];
  allowedTools?: string[];
  allowedAugmentations?: Array<"vision_assist">;
};
```

For `allowedAugmentations`, user omission inherits the default assignment and
default omission means none. This makes the new field migration-safe. The
existing `allowedSkills` and `allowedTools` semantics do not change.

### Catalog APIs

Add exact authenticated endpoints:

```text
GET  /api/admin/capability-packs
  -> catalog version, item install/setup/conflict status, no credentials

POST /api/admin/capability-packs/install
  <- { packId, itemIds, expectedRevision }
  -> { ok: true, config, source: "kv", revision, installed, skipped }
```

The server owns canonical definitions and merge behavior. Installation:

1. Loads the current editable config and compares `expectedRevision`.
2. Validates a bounded known pack/item list.
3. Refuses any ID collision whose current item is not the same installed catalog
   definition; it never overwrites or silently updates administrator content.
4. Adds selected workflow Skills and only the references explicitly selected by
   the administrator.
5. Runs normal config validation, writes one atomic KV revision, and appends a
   content-free admin audit action.

The unconfigured `getDefaultAppConfig()` may seed the workflow pack and set an
explicit default allow-list for those five IDs. `normalizeAppConfig()` never
adds catalog items. KV and deployment-secret configs therefore remain unchanged
on upgrade. Search, vision helper configuration, MCP URLs, and credentials are
never part of the automatic default.

## Assisted Vision Architecture

### Route projection

Keep `supportsImages` truthful and add a derived member-safe mode:

```typescript
type PublicImageMode = "native" | "assisted_tool" | "assisted_preanswer" | "none";
```

The Worker derives the mode from the selected logical route, executable
offerings, member augmentation assignment, and helper-route readiness. The
browser uses `imageMode !== "none"` for acquisition but retains
`supportsImages` for native badges.

### Helper eligibility

The administrator-selected helper logical route must be enabled, have at least
one executable native-image offering, have an instance credential, and not
require a member BYOK credential. Helper fallback stays inside that logical
route's offerings. It cannot recurse into assisted vision.

### Path 1: native

The current image normalization, Agent persistence, Provider conversion, and
fallback behavior remain unchanged. No auxiliary request or augmented label is
added.

### Path 2: assisted tool

For a text-only route with tool support, Chatus exposes one trusted built-in
`image_inspect` tool bound to canonical images from the current user message.
Raw images are not tool arguments. The first model step is forced to this tool;
a Provider response that does not produce the required call fails before
visible output. The tool calls the vision helper, returns bounded normalized
evidence, and the existing tool continuation produces the answer.

The Provider-attempt sequence is:

```text
main_answer (forced tool request)
  -> auxiliary_vision (helper sees canonical images)
  -> tool_continuation (selected text model sees normalized evidence)
```

### Path 3: assisted pre-answer

For a text-only route without tool support, Chatus runs the helper before main
model construction, removes image parts only from the selected text model's
in-memory Provider history, and inserts bounded normalized evidence. The
original canonical image remains in conversation storage.

```text
auxiliary_vision (helper sees canonical images)
  -> main_answer (selected text model sees normalized evidence, no image bytes)
```

### Evidence contract

The helper must return exact JSON, for example:

```typescript
type VisionEvidenceV1 = {
  version: 1;
  description: string;
  ocrText: string[];
  limitations: string[];
};
```

Clamp helper output tokens and normalized characters; reject unknown keys,
remote URLs, unsupported values, excessive arrays, and malformed JSON. Store
only normalized evidence in conversation-private Agent storage when later turns
or branches need it. It is excluded from member-facing conversation export,
never enters monitoring, and is deleted with the conversation. An administrator
backup/capture includes the private evidence so restore can preserve valid
follow-up and branch behavior; restore must validate the bounded schema again
and drop evidence whose source image message is absent. Branch copy preserves
only evidence for copied validated image messages. Raw Provider responses and
reasoning are never stored.

### Failure and cancellation

Helper configuration, budget, capacity, ledger start, timeout, malformed output,
and cancellation errors settle before the unsupported main route sees any image
data. The member error offers retry, remove images, or switch to a native route.
Late helper results are ignored and cannot populate private evidence or start a
main call.

## Web Research Architecture

### Activation

The composer exposes a globe toggle for the next turn. The requested capability
ID is bounded and checked against current assignment and availability on the
server. It occupies one of the existing three per-turn Skill slots. Automatic
selection can use only the remaining slots; manual mode blocks activation when
all three are already selected.

The action is stricter than first-per-conversation trust because each research
turn is explicitly initiated. Write/destructive tools remain unsupported for
this path and keep their existing approval behavior elsewhere.

### MCP binding

The administrator can assign `capabilityRole: "web_search"` only to an enabled,
review-complete, read-only MCP tool whose schema accepts one bounded `query`
string and no required secret/browser-controlled URL. Drift removes availability
immediately. OAuth-backed tools additionally require the member connection.

Chatus invokes the bound MCP search before the main answer for both tool-capable
and non-tool-capable selected models. The latest user text is the query; no
selector model or hidden query-generation call is added. The disclosure states
that this text is sent to the configured external service.

### Result and citation contract

The MCP text block must contain exact JSON:

```typescript
type WebResearchResultV1 = {
  version: 1;
  results: Array<{
    title: string;
    url: string;
    snippet?: string;
    publishedAt?: string;
  }>;
};
```

Decode at most ten entries, allow only sanitized public HTTPS URLs, bound every
field and total size, deduplicate canonical URLs, and preserve server result
order. The main model receives a numbered source block. Agent/UI tool output
retains the same normalized title/URL citation list so `MessageView` can render
links without parsing generated Markdown. Search query, raw MCP body, and
unbounded snippets are not persisted in capability monitoring.

Denial, timeout, review drift, connection loss, malformed results, and empty
results end the research path with stable recoverable errors. The system does
not continue as if fresh sources were available.

## Member Information Architecture

Replace separate conceptual silos with one inspector section named
"Capabilities" while preserving the existing tool trace in messages:

- Workflows: automatic/manual workflow Skills and the three-slot budget.
- Turn tools: explicit web research, its availability, source, and disclosure.
- Image understanding: selected route's native/assisted/unavailable mode.
- Connections: link to the existing MCP connection dialog when an assigned
  capability requires member OAuth.

The composer keeps high-frequency controls: attachment, per-turn web research,
and send. It does not show catalog explanations or setup instructions. The
inspector owns detailed source/privacy/cost status.

Assisted progress uses an exact content-free ephemeral frame or existing tool
part. It is never saved to localStorage, Agent messages, export, or Provider
attempt evidence. Errors restore the submitted draft only when no newer draft
generation exists.

## Administrator Information Architecture

The capability admin panel adds a Catalog view alongside Skills, Tools, and MCP:

- Preview installed, missing, setup-required, disabled, and conflicting items.
- Install selected workflow items with the current revision.
- Configure the vision helper route and default/member assignment.
- Bind a reviewed compatible MCP search tool; never accept a free-form default
  server URL from the catalog.
- Show item origin, activation, affected data class, and current executable
  readiness.

The existing member assignment editor gains an independent augmentation field.
Revision conflicts retain the local draft and expose the current server version.

## Content-Free Capability Monitoring

Provider monitoring already represents the physical helper request through
`auxiliary_vision`. Reuse an existing content-free aggregate owner when it can
represent the complete contract below without changing Provider-attempt
semantics. Otherwise add one bounded capability-monitor service, with a new
Durable Object only as the last-resort persistence owner:

```typescript
type CapabilityMonitorEventV1 = {
  version: 1;
  capabilityId: string;
  kind: "workflow_selection" | "auxiliary_vision" | "web_research" | "tool";
  status: "succeeded" | "failed" | "denied" | "cancelled" | "timed_out";
  latencyMs: number | null;
  occurredAt: number;
};
```

The decoder accepts exact keys and known configured/catalog IDs only. It rejects
all identity/content fields. The stored projection is hourly aggregate counts
and latency sums/counts, not raw events. Monitoring failure is best-effort and
cannot change an otherwise valid answer; the admin projection marks stale or
unavailable evidence rather than presenting partial counts as complete.

The child task must first document why the existing model-monitoring aggregate
can or cannot own these orchestration counters. Adding a Durable Object requires
a new binding/migration, capture/restore inventory, deletion/retention decision,
and local packaging tests. External tool calls must not be placed into
`ProviderAttemptLedger` merely to avoid a separate aggregate owner.

## Security And Privacy Boundaries

- Catalog installation accepts only known IDs and never accepts instructions,
  endpoints, credentials, or tool schemas from the request.
- MCP execution keeps current public-HTTPS, SSRF, OAuth, fingerprint, review,
  side-effect, timeout, and result-size checks.
- Assisted vision uses server-selected configured routes and canonical image
  parts only. No browser-selected Provider/helper identity is trusted.
- All public/client decoders are exact. Unknown fields fail the complete
  projection before rendering or persistence.
- Provider/tool errors use canonical public codes. Raw exception messages,
  Provider bodies, MCP bodies, and credentials stay server-side and out of logs.
- Monitoring and audit remain content-free. Conversation-private evidence is
  governed by the same branch/delete/backup boundaries as the source image.

## Compatibility And Rollback

- Existing stored and deployment-secret configs are dual-read without catalog
  injection. New optional fields normalize safely and omission preserves current
  behavior.
- Existing custom Skills remain automatic/manual compatible. Search is explicit
  only when its new activation value is present.
- Existing `supportsImages` remains native capability truth. The additive
  `imageMode` controls augmented acquisition.
- Disabling the vision helper immediately returns assisted modes to `none`; no
  stored image or route migration is needed.
- Disabling/unbinding web research removes the per-turn action and invalidates
  stale requests before MCP I/O.
- The catalog installer never overwrites items, so rollback can disable/remove
  installed items through existing revisioned configuration. It does not need a
  destructive catalog downgrade.
- Capability-monitor rollback disables its write/read path and hides the admin
  aggregate. Provider attempts and chat behavior remain intact.
- Protected release observation and legacy rollout artifacts remain untouched.

## Important Trade-offs

- A code-owned catalog plus explicit merge costs an endpoint and conflict UI but
  prevents browser-defined defaults and upgrade-time privilege expansion.
- A Provider-backed trusted image executor costs more than raw-image MCP JSON but
  keeps credentials, image scope, budgets, and route governance inside Chatus.
- Forced tool use on tool-capable text routes adds one continuation request but
  creates a visible and enforceable image-inspection step.
- Direct pre-answer MCP search works for no-tool models and guarantees citations,
  but sends the latest user text as the disclosed query instead of using another
  hidden model call to rewrite it.
- A dedicated content-free capability aggregate adds operational state, but it
  avoids corrupting the semantics of the Provider-attempt ledger.

## Acceptance Mapping

- R1-R3 and AC1-AC4 map to catalog/adoption and public contract work.
- R4 and AC4-AC5 map to assisted vision and Provider-attempt changes.
- R5 and AC6-AC7 map to explicit research, MCP decoding, and citations.
- R6-R7 and AC8 map to member/admin information architecture and accessibility.
- R8-R9 and AC9-AC10 map to lifecycle, monitoring, privacy, and cross-layer tests.
- R10 and AC11-AC12 map to the final integration child and protected boundaries.
