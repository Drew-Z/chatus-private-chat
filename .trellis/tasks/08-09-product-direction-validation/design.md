# Product direction validation design

## Purpose

This task is a product-value review and priority-calibration gate for the
already approved Chatus strategy. It combines source-backed reference research
with an owner-to-member local acceptance journey. It does not redesign the
runtime, cancel approved roadmap work, or authorize production changes.

## Scope boundary

The validation cohort is one self-hosting owner and a trusted team of 2-10
members. The hands-on run uses one synthetic owner session and at least one
separately authenticated synthetic member. Restricted guest access keeps its
existing regression boundary but is not a primary workflow.

The three workflows form one dependent product experiment rather than three
independent implementation deliverables: onboarding creates the Provider,
logical model, member, permissions, Skill, and MCP configuration consumed by
all later steps, and the roadmap recommendation is valid only after the same
baseline has exercised every workflow. For that reason this remains one Trellis
task. Any resulting runtime fixes become independent follow-up tasks.

## Validation topology

```text
Playwright browser contexts
  owner context
    -> real local Worker + React assets
       -> local KV / Durable Object / R2 / Queue persistence
       -> generated runtime-only secrets
       -> local deterministic fake Provider
  member context
    -> the same configured local instance

Focused Vitest/component contracts
  -> local fake OAuth issuer + MCP protocol fixtures
  -> PKCE, token custody, drift, review, and side-effect confirmation evidence

Codex operator
  -> follows visible UI order
  -> inspects screenshots and visible state
  -> records elapsed time and observations
  -> uses bounded read-only counters/contracts only for hidden invariants
```

The harness should extend the established local Agent Playwright pattern rather
than invent a second product runtime. It generates credentials at runtime,
binds only loopback fake services, uses isolated Wrangler persistence and
artifact directories, redacts generated values from errors, and cleans up
temporary state. It never contacts a live model, remote MCP server, production
origin, or production Cloudflare account.

## Human-order acceptance sequence

### 1. Establish the exact baseline

- Record branch, exact commit, dirty-worktree inventory, Node/npm versions, and
  the validation runner configuration.
- Build the typed client and start the real Worker locally with empty/incomplete
  business configuration, generated admin and encryption secrets, and local
  fake-service URLs.
- Capture the initial admin loading state and six-step setup projection.

### 2. Owner onboarding

The browser must use the visible React admin workflow in this order:

1. authenticate with the generated administrator token;
2. confirm infrastructure health;
3. create a Provider and save a write-only managed credential;
4. create a logical model and offering for that Provider;
5. create the first member and retain the one-time access code only in process
   memory;
6. assign the route, Automatic Skill candidates, and bounded built-in tool;
7. run the model-free setup smoke;
8. confirm the setup status is ready and log out successfully.

The five-minute setup measurement starts when the ready local login page is
available, not while dependencies build. Direct internal mutation APIs may not
bypass these visible steps.

### 3. Member workflow A: programming and project collaboration

- Authenticate in a separate browser context using the generated member code.
- Create a new conversation with Automatic Skill mode and the configured logical
  model.
- Submit a deterministic synthetic project task that causes the fake Provider to
  select an assigned programming/project Skill and return a useful structured
  result in progressive parts.
- Confirm the selected Skill result is visible, the member sees truthful waiting
  and streaming states, the physical Provider and secrets remain hidden, and the
  result is durable after reload.
- Exercise one branch/regenerate or continue action and confirm the original
  result remains recoverable.

### 4. Member workflow B: file-backed analysis

- Upload a synthetic text document plus at least one generated PDF or Office
  document through the file workspace.
- Observe `queued`, `extracting`, and `ready` states without reading internal R2
  keys or parser diagnostics.
- Pin an exact ready version to the conversation, rename or supersede the current
  file, and submit a deterministic analysis request.
- Confirm the fake Provider receives only verified extracted text for the pinned
  version and the visible answer identifies the user-facing source context.
- Exercise a bounded failed-ingest/retry path and confirm no Provider call occurs
  before the exact version becomes ready.

### 5. Member workflow C: assigned Skill with focused OAuth/MCP evidence

- Complete one deterministic operations workflow through the assigned Skill
  and inspect its member-visible result and per-turn Skill provenance.
- Keep Authorization Code + PKCE, server-side token custody, schema drift,
  administrator review, and per-invocation side-effect confirmation in the
  existing focused OAuth/MCP suites.
- Do not add a test-only SSRF bypass. The production policy correctly rejects
  loopback/private OAuth issuers and MCP endpoints, so a browser OAuth journey
  requires a separately reviewed non-loopback test topology before it can be
  valid product evidence.

### 6. Cross-cutting failure and recovery

- Force a pre-visible failure on the first Provider offering and verify bounded
  fallback, truthful progress, one user-message quota charge, and correlated
  attempt/run evidence.
- Verify post-visible failure does not splice a second Provider response into the
  answer and exposes a stable recovery action/reference.
- Reload during a resumable response, stop one response, and verify a subsequent
  turn remains usable.
- Confirm admin and member logout only leave their workspaces after server-side
  success; a synthetic failure preserves the current session and offers retry.

## Evidence contract

Each run stores an artifact directory outside committed product data containing:

- `run.json`: exact commit, dirty-state fingerprint, tool versions, start/end
  timestamps, fake-service scenario IDs, and overall status;
- `steps.jsonl`: step ID, actor, visible route, elapsed milliseconds,
  pass/blocked/friction result, request/run reference when available, and a
  secret-safe note;
- screenshots for setup milestones, each workflow outcome, failures, recovery,
  desktop, and 390px containment;
- no Playwright trace/video, because those broad captures can retain generated
  credentials; use bounded error context only after a secret scan, plus
  bounded fake-service counters;
- `observations.md`: Codex's human-style evaluation of clarity, confidence,
  recovery, and willingness to use the workflow repeatedly.

Artifacts must never include access codes, admin tokens, Provider/MCP tokens,
raw prompts containing private data, conversation exports, R2 object keys, or
stored memory content. Generated synthetic prompts may be identified by stable
scenario IDs instead of copied into metadata.

## Scoring and finding model

Every step receives one status:

- `pass`: outcome is complete and understandable without internal knowledge;
- `friction`: outcome is recoverable but requires avoidable interpretation or
  extra navigation;
- `blocked`: the intended useful result cannot be completed;
- `invalid`: evidence is contaminated, secret-bearing, or bypassed the visible
  product path and must be rerun.

Findings use these severities:

- `P0`: secret exposure, authorization failure, destructive data corruption, or
  another safety violation; stop immediately;
- `P1`: workflow blocker or unrecoverable product failure; stop only when later
  steps cannot produce valid evidence;
- `P2`: confusing or inefficient but recoverable experience;
- `P3`: polish or consistency issue with no workflow impact.

The final recommendation is not a numeric popularity score. It combines the
three workflow outcomes, setup time, repeated friction, and safety evidence into
no more than three next-cycle product outcomes. Each existing roadmap stream
receives an advisory `continue`, `change`, or `stop` recommendation with a cited
finding. Existing task status changes only after a later explicit approval.

## Reference-project use

`research/reference-project-adoption-map.md` is the source-linked comparison.
Reference projects provide product patterns and boundary checks, not a backlog
to clone. Source-code reuse is excluded from this task. LobeHub code requires a
file-level community-license review; DEEIX-Chat code requires Apache-2.0 notice,
copyright, and modification compliance. Secondary projects require their own
current license check before any future code reuse.

## Compatibility, rollback, and cleanup

- No production state or approved roadmap artifact is mutated.
- Validation-only scripts/tests may be reverted as one isolated change if they
  destabilize normal tests; observations and source-linked research remain
  usable documentation.
- Temporary local credentials, Wrangler persistence, R2 objects, Queue state,
  OAuth tokens, browser profiles, and fake-service state are removed after the
  run. Artifact cleanup preserves only the secret-safe evidence contract.
- A failed setup or workflow does not trigger an inline product fix. Record the
  stop/finding and create a separate task after review.

## Planning risks

- A deterministic fake Provider proves workflow contracts, not answer quality.
- Codex can evaluate clarity consistently but is not a substitute for several
  independent team members; the result should be treated as a strong baseline,
  not market validation.
- A single ordered end-to-end test can be fragile. Keep hidden invariants in
  focused tests and use the ordered browser journey only for user-visible
  product evidence.
- Browser automation can accidentally bypass a UX problem through selectors.
  Codex must inspect screenshots and visible labels at each milestone, not rely
  only on assertions.
