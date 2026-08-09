# Product Direction Validation Report

## Baseline identity

- Commit under test: `ab57c5ca7ba56d35c995773a683f94e74adc5f40`
- Branch: `main`
- Dirty-worktree fingerprint: `486b977237a2b17782a808ea48437c6a79b5965160e71574433462715f419043`
- Runtime: Node `v24.14.0`
- Browser runner: `npm run test:browser:product-validation`
- Result: passed in 17.1 seconds; setup-ready elapsed time was 2,855 ms.
- Evidence: `evidence/baseline/evidence/run.json`, `steps.jsonl`,
  `observations.md`, and the retained screenshots under
  `evidence/baseline/playwright/`.
- Services: two loopback fake Providers with generated per-run credentials;
  no live model, MCP, production origin, or production Wrangler account.

The focused contract command passed 13 test files and 228 tests covering admin
members/capabilities, Provider administration, workspace files, document
ingest, MCP/OAuth, Worker API, and TeamAgent behavior. The full `npm test` run
then passed 48 test files and 728 tests. Expected synthetic Provider budget
warnings and local Queue DLQ warnings were non-failing test fixtures.

## Quality gate evidence

The final-scope checks completed on the same source tree and all exited zero:

| Command | Result |
| --- | --- |
| `npm run check:frontend` | Client build and frontend structure checks passed; existing chunk-size warning only |
| `npm test` | 48 files / 728 tests passed |
| `npm run typecheck` | Worker, client, and browser TypeScript checks passed |
| `npx wrangler deploy --dry-run` | Wrangler 4.110.0 packaged 19 assets and validated bindings; no deploy |
| `npm run test:browser:workspace` | 90 passed, 55 configured skips, 145 total |
| `npm run test:browser:agent` | 3 passed |
| `npm run test:browser:product-validation` | 1 passed in 16.9s |
| `python ./.trellis/scripts/task.py validate-all` | Repository consistency: OK |
| `git diff --check` | Passed; only existing LF/CRLF conversion warnings |

Evidence scans for `validation-admin-`, `sk-validation-`, and
`ROUTE_KEYS_MASTER_KEY` returned no matches in retained validation artifacts.

## Workflow result

| Workflow | Result | Evidence-backed outcome |
| --- | --- | --- |
| Owner setup | Pass with initial-loading friction | Two Providers, write-only keys, one logical model with two offerings, one member, explicit route/Skill/tool assignment, model-free smoke, and server-confirmed logout completed in under five minutes. |
| Programming/project collaboration | Pass | Automatic selection, progressive output, durable reload, and branch recovery completed. Screenshot `06-project-workflow.png` shows the selected project Skill. |
| File-backed analysis | Pass with transition friction | Text and PDF reached ready, exact versions were selected, a text file was pinned and renamed, analysis used verified extracted content, and invalid PDF ingest failed without a Provider request. The local queue was too fast to retain a queued/extracting screenshot. |
| Provider recovery | Pass | Pre-visible failure used the alternate offering. Post-visible failure showed the partial output and a retry action without splicing a second Provider response. Screenshot `08-provider-recovery.png` is the visual record. |
| Skill/operations | Friction | The operational answer completed and mobile containment plus fail-closed logout retry passed, but the completed response did not show the per-turn Automatic Skill block. The fake Provider counters prove the selector request ran. Screenshot `09-operations-workflow.png` shows the completed answer without that block. |
| OAuth/MCP | Contract evidence only | The member workflow used the assigned Skill. Existing local OAuth/MCP suites cover PKCE, token custody, drift, schema review, and side-effect confirmation. A browser OAuth flow against loopback was intentionally not added because the production SSRF policy rejects private/loopback issuers and endpoints; the test harness does not bypass that boundary. |

## Findings

### F1 - P2 Automatic Skill provenance is not consistent

- Step: `member.workflow.operations`.
- Expected: every completed automatic turn exposes the selected Skill and its
  source/reason to the member.
- Actual: the project turn exposed `项目协作`, while the completed operations
  turn had no `本轮自动 Skill` region even though the fake Provider handled the
  selector request (`selectorRequests: 4` primary and `1` secondary).
- Reproduction: run the ordered validation command, wait for the stop button to
  disappear, then inspect `09-operations-workflow.png`.
- Affected stream: Skill/MCP and Provider governance.
- Handling: recorded only; no runtime fix is included in this task.

### F2 - P2 First-use readiness mixes legacy route shape with the new offering model

- Step: `owner.setup.initial` and `owner.setup.logical-model`.
- Expected: the Logical model/offering step is ready only when the visible
  administrator model has a usable Provider offering.
- Actual: the initial setup projection reports Logical model/offering ready for
  the synthetic `bootstrap` route while the visible logical-model editor shows
  `Bootstrap route` with `0` Provider exits. The later configured model is
  correct, but the initial projection is misleading.
- Evidence: `01-setup-initial.png` and `03-logical-model-ready.png`.
- Affected stream: legacy cleanup and first-use/admin coherence.
- Handling: recorded only; the approved legacy task tree remains unchanged.

### F3 - P2 Provider recovery lacks a member-visible correlation reference

- Step: `member.recovery.provider`.
- Expected: a failed or partially visible run exposes a stable request/run
  reference that an owner can correlate with bounded audit evidence.
- Actual: the retry action and generic error are visible, but the screenshot
  does not show a request/run identifier.
- Evidence: `08-provider-recovery.png` plus the bounded Provider counters in
  `run.json`.
- Affected stream: Provider governance and daily Agent trust.
- Handling: recorded only; no runtime fix is included in this task.

### F4 - P3 Local ingest transitions are not visually retainable

- Step: `member.workflow.files`.
- Expected: queued, extracting, and ready states can be observed in a repeatable
  local run.
- Actual: ready and failed-ingest states are stable, but the deterministic local
  queue completes too quickly to retain an intermediate screenshot.
- Evidence: `steps.jsonl` marks this step `friction`; `07-files-ready.png` and
  `07-file-workflow.png` retain the stable states.
- Affected stream: file ingestion UX.
- Handling: this is a validation limitation unless independent users report the
  same lack of progress visibility; no artificial delay was added.

No P0 security, authorization, secret-exposure, data-loss, or evidence-
contamination stop condition occurred. Generated access codes and keys were
held in process memory, the evidence scan found no known credential prefixes,
and no OAuth token was persisted in the browser or artifacts.

## Roadmap recommendations

These are advisory decisions only. Existing Trellis task statuses are not
changed by this report.

| Roadmap stream | Recommendation | Rationale |
| --- | --- | --- |
| Legacy cleanup | Continue, with a coherence gate | F2 shows the legacy bootstrap representation still changes the meaning of the new setup projection. Retire or isolate it only through the existing per-surface rollout tasks. |
| ACL | Continue, narrowly | Member isolation and explicit route/Skill boundaries support the approved stable-principal and sharing work; do not expand to enterprise RBAC or broad collaboration parity. |
| Provider governance | Continue, change emphasis | Bounded fallback works. Next work should make request/run correlation and fallback outcome visible, not add Provider breadth for its own sake. |
| File ingestion | Continue, change toward repeatable progress | The useful file workflow passed. Improve user-visible progress and recovery evidence only after confirming the transition friction with real operators. |
| Skill/MCP | Continue, change toward provenance and review | Skill execution is useful but per-turn provenance is inconsistent. Keep OAuth/MCP server-side custody, drift review, and side-effect confirmation as the gate before adding integrations. |
| Broader platform breadth | Stop as a parity goal | Do not start marketplace, Agent Groups, public proxy, enterprise billing, or a new deployment/database architecture without a new validated need. |

## Next-cycle outcomes (maximum three)

1. **Trustworthy run trace:** make every automatic turn display selected Skill
   provenance, logical-model/fallback outcome, and a stable request/run
   reference that maps to redacted owner evidence.
2. **Truthful first-use configuration:** reconcile the setup projection with the
   canonical Provider/model/offering representation and isolate the bootstrap
   legacy shape so an owner can reach a ready member workflow without
   contradictory status.
3. **Repeatable work capability packs:** preserve the file-backed project flow
   and reviewed Skill/MCP boundaries while improving progress/retry visibility;
   require local deterministic evidence for any new reviewed tool or parser.

## Later separately reviewed documentation changes

This validation task does not rewrite product strategy artifacts outside its
own directory. A later approved documentation task should consider:

- a README thesis centered on a private, auditable multi-Provider workspace for
  trusted small teams;
- three user-observable workflow examples and explicit non-goals;
- a short explanation that `/legacy/` and `/admin.html` are rollback surfaces,
  not parallel product paths; and
- links from the roadmap to the three outcomes above and the evidence rubric.
