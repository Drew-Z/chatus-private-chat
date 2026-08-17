# Chatus default capability packs

## Goal

Give member conversations a small, useful capability catalog that can augment
the selected model without pretending every model has native vision, tool
calling, current web knowledge, or external-service access. Capabilities must
remain understandable, permissioned, observable, cost-aware, and safe to
degrade when an auxiliary service is unavailable.

## Background And Confirmed Facts

- Chatus already has administrator-managed Skills, per-member Skill/tool
  assignments, automatic selection of at most three Skills, reviewed MCP tool
  discovery, user approval, tool continuations, and route capability flags.
  The shared assignment and filtering boundary is
  `src/services/capability-registry.ts:17-110`.
- `allowedSkills === undefined` means all enabled Skills are assigned, while an
  explicit empty array is deny-all (`src/services/capability-registry.ts:136-138`).
  Adding enabled external capabilities during normalization would therefore
  expand existing member access without an administrator decision.
- The built-in executor union currently contains only `text_stats`
  (`src/contracts/capability.ts:7-9`), and the unconfigured application default
  registers only `builtin:text_stats` (`src/worker.ts:9289-9309`).
- Routes distinguish native `supportsImages` and `supportsTools`, but both the
  legacy and Agent turn paths currently reject image input when the selected
  route does not support images (`src/worker.ts:8143-8154` and
  `src/worker.ts:8511-8520`).
- The typed member workspace enables image acquisition only for native-image
  routes (`client/src/components/ChatWorkspace.tsx:778-781`) and already has a
  model, Skills, tools, files, and sharing inspector
  (`client/src/components/ConversationInspector.tsx:71-76`).
- MCP execution already enforces public HTTPS/SSRF restrictions, reviewed
  schema and security fingerprints, approval policy, a 15-second call timeout,
  and a 256 KiB response ceiling. Its first release accepts text result blocks
  only (`src/services/mcp-runtime.ts:12-18`, `src/services/mcp-runtime.ts:121-167`,
  and `src/services/mcp-runtime.ts:506-520`).
- Provider attempts use a closed run-kind union and already feed passive model
  monitoring (`src/contracts/provider-attempt.ts:14-21` and
  `src/services/model-monitoring.ts:85-122`). Auxiliary Provider calls must be
  represented as their own run kind rather than as `main_answer` or
  `legacy_capability`.
- OpenAI's public documentation separates reusable Skills from connectors and
  MCP servers, and recommends explicit approval, tool allow-lists, trusted
  servers, and visible data-sharing controls. DeepSeek's public API docs describe
  OpenAI/Anthropic-compatible APIs and agent-tool integration, but do not
  document the private behavior of its signed-in web application. These are
  product references, not implementation contracts.

## Requirements

### R1. Default Catalog

- Ship five low-risk Chatus workflow Skills: writing and rewriting, summarizing,
  translation, code explanation, and structured output.
- Workflow Skills contain instructions only. They cannot claim fresh facts,
  execute code, inspect images, or access external services.
- Existing automatic Skill selection remains deterministic and selects at most
  three Skills per turn. Failure of the selector cannot fail the main answer.
- A versioned, code-owned catalog is the source for installation. The browser
  must not duplicate or manufacture the canonical instructions.

### R2. Safe Adoption And Assignment

- A truly unconfigured instance may include only the low-risk workflow pack in
  its initial default configuration.
- Loading or normalizing an existing KV or deployment-secret configuration must
  never inject catalog items or mutate assignments.
- Existing instances adopt catalog items through an administrator action that
  carries the current configuration revision, previews additions/conflicts, and
  never overwrites an existing ID.
- Installing an external capability never installs a remote MCP URL, credential,
  or executable tool silently. Search and assisted vision require their own
  reviewed configuration before becoming available.
- Guests receive no Skills, MCP tools, search, or assisted vision. Explicit
  empty assignments remain deny-all, and missing legacy assignment fields keep
  their current inheritance semantics.

### R3. Truthful Capability Model

- Public and administrator projections distinguish model-native capabilities,
  Chatus workflow instructions, Chatus auxiliary Provider work, trusted built-in
  execution, and reviewed MCP execution.
- An augmented text model must never be labeled as natively multimodal.
- Each member-visible capability exposes a bounded source, activation mode,
  availability state, and material latency/cost/privacy disclosure.

### R4. Three-Path Image Understanding

- Image input uses exactly one server-selected path:
  1. native image input when the selected executable route supports images;
  2. a trusted image-inspection tool backed by an administrator-selected native
     vision route when the selected route supports tools but not images;
  3. bounded pre-answer image inspection through that helper route when the
     selected route supports neither images nor tools.
- Generic MCP JSON must not receive raw Base64 image data. The helper consumes
  already-normalized in-scope image parts inside Chatus.
- Assisted inspection produces a strict, bounded description/OCR evidence
  object. It stores no Provider credential, raw Provider response, arbitrary
  remote URL, or hidden reasoning.
- Auxiliary vision uses the existing route/provider plan, capacity, budget,
  credential, cancellation, and Provider-attempt boundaries. It creates a
  distinct `auxiliary_vision` run under the admitted turn.
- If assisted vision fails, the main model receives no unsupported image data.
  The member sees retry, remove-image, and native-model-switch recovery choices.

### R5. Explicit Web Research

- Web research is a member-initiated, per-turn capability. It is excluded from
  automatic Skill selection and is not sent on ordinary turns.
- The administrator binds it only to an enabled, reviewed, read-only MCP tool
  with a compatible query schema and strict structured result contract.
- Results contain at most ten sanitized HTTPS sources with bounded title, URL,
  and optional snippet/date fields. Chatus projects these sources as usable
  citations instead of relying on the model to invent citation metadata.
- Denial, timeout, changed review revision, malformed results, and empty results
  are explicit recoverable states. The main answer must not imply a successful
  fresh search after any such state.

### R6. Member Experience

- The conversation workspace provides one coherent capability surface rather
  than requiring members to infer the relationship among Skills, tools, image
  support, and MCP connections.
- The composer shows explicit per-turn web research control and assisted-image
  disclosure before sending data externally.
- Route options distinguish native image, assisted image, and no-image modes.
  Capability activity is visible as selected, waiting, running, completed,
  unavailable, denied, timed out, or cancelled without exposing Provider IDs or
  raw tool payloads.
- Failure never discards a newer draft. Retry and model-switch paths remain
  keyboard, screen-reader, touch, reduced-motion, and responsive friendly.

### R7. Administrator Experience

- Administrators can inspect catalog source and install status, preview and
  install packs through revision-checked writes, configure the vision helper,
  bind reviewed search tools, assign capabilities, and disable or revoke each
  capability.
- Installation, rename, deletion, and conflict handling preserve unrelated
  configuration fields and explicit assignment semantics.
- Monitoring shows content-free availability and execution outcomes. It never
  exposes member prompts, images, search queries, citations, tool bodies,
  credentials, or conversation identity.

### R8. Execution And Error Recovery

- One user message consumes one quota admission. Selector, auxiliary vision,
  search, fallback, and tool continuation do not consume another message unit.
- Cancellation is authoritative at every pre-answer stage. Late helper, MCP, or
  Provider completion cannot start or alter the main answer.
- External execution obeys bounded time, size, schema, review-revision,
  credential-redaction, and close/cancellation rules.
- Stable public error codes distinguish unavailable configuration, denial,
  timeout, malformed evidence, empty search, budget rejection, and cancellation.

### R9. Privacy And Observability

- Provider-ledger monitoring distinguishes `auxiliary_vision` from selector,
  main-answer, and continuation runs.
- Capability monitoring records only bounded capability ID/kind, terminal
  status, latency bucket, and hourly counts. It contains no member, turn,
  conversation, request, prompt, image, query, citation, credential, or result
  content.
- Export, deletion, branch, backup, and restore behavior is explicit for any
  normalized vision evidence or citation data introduced by the implementation.

### R10. Validation And Delivery Boundaries

- Tests use local fixtures, fake Providers, and fake MCP/OAuth services only.
  They must not contact a live model, MCP server, OAuth issuer, or production
  deployment.
- Do not modify or advance `08-16-chatus-production-release-observation`, PR
  #93, `legacy-api-chat-post-rollout`, `legacy-browser-shell-rollout`,
  `legacy-api-cloud-chats-rollout`, or any legacy rollout gate/evidence.
- Production deployment is out of scope and remains GitHub Actions-only.

## Out Of Scope

- A public plugin marketplace or third-party self-service installation.
- Default code execution, shell access, email, calendar, cloud-drive writes,
  image generation, autonomous multi-agent work, or arbitrary URL fetching.
- Shipping a default third-party MCP endpoint or credential.
- Claiming compatibility with undocumented OpenAI or DeepSeek web internals.
- Production deployment, synthetic production probes, or paid-service acceptance.

## Acceptance Criteria

- [ ] AC1: A new unconfigured instance exposes the five bounded workflow Skills,
  while an existing stored/secret configuration is byte-semantically unchanged
  until a revision-checked install action succeeds.
- [ ] AC2: Guests and explicit deny-all assignments receive no capabilities;
  legacy missing fields retain inheritance; automatic selection never exceeds
  three total per-turn Skills.
- [ ] AC3: Catalog install previews additions and collisions, rejects stale
  revisions, never overwrites an existing ID, and installs no external endpoint
  or credential.
- [ ] AC4: Public route/capability projections and UI distinguish native image,
  tool-assisted image, pre-answer assisted image, and unavailable image modes.
- [ ] AC5: A text-only model can answer about an uploaded image using bounded
  auxiliary evidence; helper failure sends no unsupported image data to the main
  Provider and preserves actionable retry/switch recovery.
- [ ] AC6: Web research runs only after explicit per-turn member activation,
  returns sanitized usable citations, and exposes denial, timeout, drift,
  malformed, and empty-result states without a false freshness claim.
- [ ] AC7: Every external capability obeys assignment, approval, timeout, result
  size, review revision, credential redaction, and cancellation rules.
- [ ] AC8: Member and administrator surfaces expose source, availability,
  execution state, and material cost/privacy implications with keyboard,
  screen-reader, touch, reduced-motion, and five-viewport coverage.
- [ ] AC9: Content-free monitoring distinguishes selector, auxiliary vision,
  web research, tool continuation, and main-answer activity without retaining
  any prohibited identity or content field.
- [ ] AC10: Unit, Worker, Agent, and browser tests cover revocation races,
  configuration conflicts, partial failure, timeout, cancellation, branch and
  deletion behavior, and route fallback with zero live external requests.
- [ ] AC11: `npm run check:frontend`, `npm test`,
  `npm run test:browser:workspace`, `npm run test:browser:agent`,
  `npm run typecheck`, `npx wrangler deploy --dry-run`, and
  `git diff --check` pass in the required serial order.
- [ ] AC12: The implementation and its Trellis artifacts remain isolated from
  PR #93, production observation, legacy rollout tasks/gates/evidence, and
  production deployment.

## References

- OpenAI Docs, MCP and Connectors:
  https://developers.openai.com/api/docs/guides/tools-connectors-mcp
- OpenAI Docs, Skill controls:
  https://learn.chatgpt.com/docs/enterprise/skills
- DeepSeek API Docs, API compatibility and agent-tool integration:
  https://api-docs.deepseek.com/
- Local research summary: `research/product-capability-reference.md`
