# Delivery Governance

## 1. Scope / Trigger

Use this contract when changing pull-request CI, main deployment, production acceptance, browser-test artifact handling, Trellis task metadata, task relationships, archive behavior, or workspace journal indexes.

Production remains GitHub-Actions-only. Pull requests use local fixtures and fake Providers; they never run production smoke, production acceptance, or live model probes.

## 2. Signatures

- PR workflow: `.github/workflows/ci.yml`
- Main workflow: `.github/workflows/deploy.yml`
- Production acceptance: `.github/workflows/production-acceptance.yml`
- Path classifier: `node scripts/classify-ci-paths.mjs [--all] --github-output <path> --manifest <path>`
- Exact-main guard: `node scripts/assert-main-tip.mjs` with required `GITHUB_SHA`
- Delivery manifest: `node scripts/write-delivery-manifest.mjs --kind <kind> --status <status> --output <path>`
- Repository consistency: `python ./.trellis/scripts/task.py validate-all [--fix-workspace-index]`
- Task evidence:

```text
python ./.trellis/scripts/task.py record-validation <task> <command> passed <summary>
python ./.trellis/scripts/task.py set-work-commit <task> <commit>
python ./.trellis/scripts/task.py set-pr-url <task> <https-url>
python ./.trellis/scripts/task.py add-waiver <task> <gate> <approver> <reason>
```

## 3. Contracts

PR quality always runs, in order, `npm run check:frontend`, one complete `npm test -- --coverage` Istanbul run, `npm run typecheck`, `npx wrangler deploy --dry-run`, and a base-to-head `git diff --check`. Local `npm test` remains uninstrumented for feedback and performance baselines; PR quality must not run a second complete Vitest suite only for coverage. The Workspace and fake-Provider Agent Playwright jobs keep stable job names and are gated by the shared path classifier. Frontend paths affect both browser suites; Agent/runtime paths affect Agent acceptance; `package.json`, `package-lock.json`, `tsconfig.json`, and `wrangler.jsonc` affect both. Delivery-governance paths (`.github/**`, the classifier, the exact-main guard, and their owning test) affect both browser suites so a gate change exercises the jobs it controls.

Parse all workflow YAML with the declared `yaml` dependency and duplicate-key rejection before inspecting jobs or steps. Structural tests own job names, `needs`, `if`, outputs, step order, artifact inputs, and job timeouts. String checks are insufficient for YAML-owned structure because the same text can exist under the wrong job or mapping.

Every executable job has an explicit upper bound: classification and skip jobs use 5 minutes, PR quality and both browser jobs use 20 minutes, production deploy uses 30 minutes, and production acceptance uses 15 minutes. Official JavaScript actions use the approved Node 24 majors `actions/checkout@v7`, `actions/setup-node@v7`, and `actions/upload-artifact@v7`; tests enumerate every `uses` value and reject older or unapproved references.

Structural source checks normalize CRLF and bare CR to LF at the text-read boundary before exact multi-line assertions. This applies to executable check scripts as well as Vitest raw imports so a Windows checkout cannot fail a source contract that is semantically unchanged. Byte-exact hashing paths must keep the original bytes.

Documentation-only deployment skipping is narrow. Markdown files and approved documentation assets under `docs/**` may skip Worker deployment. Tracked Trellis task/spec/workspace records may skip only when their extension is `.md`, `.json`, or `.jsonl`. Executable `.trellis/scripts/**`, executable or unknown files below record roots, workflows, runtime configuration, and application code are code changes even though they live near documentation. Unknown paths fail closed to deployment.

Delivery artifacts are non-sensitive JSON plus bounded Playwright output. A delivery manifest contains only `schemaVersion`, `kind`, `status`, `commit`, `generatedAt`, `packageLockSha256`, and `publicBundleSha256`. PR coverage retains only the bounded Istanbul `coverage/coverage-summary.json` for 14 days; the source-level HTML tree is local output and must not be uploaded. Never retain runtime credentials, dotenv files, Wrangler persistence, access codes, conversation content, stored memory, or a complete source-view coverage directory. The fake-Provider runner may retain a caller-owned Playwright output directory, but its temporary env and Wrangler state remain in a separately deleted directory. The runner always writes `agent-summary.json` into that directory with only schema version, kind, pass/fail status, commit, generation time, and bounded fake-Provider counters; a successful test must not leave the artifact directory empty.

Main deployment preserves the early and late remote-main SHA guards and the non-canceling production-mutation concurrency group. Both guards call `scripts/assert-main-tip.mjs`, which accepts only a lowercase 40-character `GITHUB_SHA`, requires exactly one valid `refs/heads/main` result, compares by exact equality, and emits bounded errors without command output. The early guard runs after Node setup but before provisioning or secret preparation; the late guard is the step immediately before `Deploy Worker`. The deploy job checks out full history before comparing `GITHUB_SHA^` to `GITHUB_SHA`; the default one-commit checkout makes the parent revision ambiguous and must not be used with this gate. Documentation/Trellis-record-only commits publish explicit path-classification evidence and a skip summary. A real deploy and manual production acceptance each retain an exact-SHA manifest.

Trellis archive validates before any state or directory mutation. A code task requires checked acceptance criteria with no `TBD`, passed records for the five baseline commands, a resolving `task.json.commit`, a valid HTTPS `task.json.pr_url`, completed children, a free archive destination, repository-wide parent/child consistency, and a current workspace root index.

A parent task's final integration review must also reconcile the exact `task.json.children` set with every child count/list stated in `prd.md`, `design.md`, and `implement.md`. For each child, record its archived status, checked AC set, resolving work commit, PR evidence, and completed delivery checklist. `validate-all` proves the machine-readable graph and workspace projection; it cannot prove that prose still says the right child count or that an archived child's human execution checklist was fully closed.

Validation entries and waivers live under `task.json.meta`:

```json
{
  "validation": [
    { "command": "npm test", "status": "passed", "summary": "380 tests", "at": "2026-07-27T00:00:00+00:00" }
  ],
  "waivers": [
    { "gate": "acceptance", "reason": "legacy migration", "approver": "release-owner", "at": "2026-07-27T00:00:00+00:00" }
  ]
}
```

A waiver applies only to its exact gate and is invalid without non-blank `gate`, `reason`, `approver`, and ISO timestamp. Invalid waiver data is never self-waivable. Free-form task notes do not waive anything.

The root `.trellis/workspace/index.md` developer table is a projection of every personal workspace index between `@@@auto:developers` markers. Developer initialization and session recording update the projection; `validate-all` detects drift, and `--fix-workspace-index` repairs it from personal indexes.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| PR changes frontend or shared runtime files | Run Workspace and fake-Provider Agent Playwright |
| PR changes Agent/provider runtime only | Run fake-Provider Agent Playwright |
| Main commit changes only docs/Trellis records | Skip Worker deploy and retain classification evidence |
| Change includes `.trellis/scripts/**` | Treat as code, not a record-only skip |
| Trellis record root contains an executable or unknown extension | Treat as code; never grant docs-only skip |
| Workflow YAML is invalid, has a duplicate key, or wires a field under the wrong job | Structured governance test fails |
| Executable workflow job lacks its approved timeout | Structured governance test fails |
| Official action uses an unapproved or pre-Node-24 major | Structured governance test fails |
| PR has whitespace errors in committed diff | Base-to-head `git diff --check` fails |
| Deploy checkout cannot resolve `GITHUB_SHA^` | Deployment stops before preparing secrets or mutating production |
| Browser suite fails | Upload retained trace/screenshot output without runtime secrets |
| Coverage suite completes or fails after producing a summary | Retain only `coverage/coverage-summary.json`; never upload HTML/source views |
| Task has unchecked AC or `TBD` | Archive rejects before mutation |
| Validation command is missing or failed | Archive rejects unless the exact `validation` gate has a valid waiver |
| Work commit does not resolve | Archive rejects |
| Code task lacks a valid PR URL | Archive rejects |
| Child is active/incomplete or task graph is inconsistent | Archive rejects |
| Parent prose or delivery matrix disagrees with `task.json.children` | Final integration review remains incomplete until the records are reconciled |
| Workspace root projection is stale | `validate-all` fails; `--fix-workspace-index` regenerates it |
| Waiver is malformed | Archive rejects under the non-waivable `waiver` gate |

## 5. Good / Base / Bad Cases

- Good: a frontend PR runs baseline quality plus both browser suites, retains exact-SHA manifests and fake-only traces, merges to main, deploys the same SHA, then archives only after task evidence is recorded.
- Base: a task/spec-only commit runs PR quality if it uses a PR, skips Worker deployment after merge, and retains the path-classification artifact.
- Bad: classify every `.trellis/**` path as documentation, causing executable archive-script changes to bypass the deployment decision.
- Bad: run `git diff --check` with no revisions on a clean PR checkout; it checks only working-tree changes and cannot detect whitespace already committed in the PR.
- Bad: archive first and validate afterward, or use a note such as `waived` without structured approver/timestamp evidence.
- Bad: report a parent as complete because `validate-all` passes while its PRD/design still says seven children for an eight-child task graph or an archived child retains an unchecked delivery item.

## 6. Tests Required

- Unit-test path classification for frontend, Agent, shared runtime, governance-control paths, normalization/deduplication, empty input, docs assets, each allowed Trellis record extension, mixed changes, and executable/unknown Trellis files.
- Parse all workflow YAML with duplicate-key rejection and structurally assert stable jobs, bounded timeouts, the five baseline commands in order, the single coverage-enabled Vitest run, the exact JSON-summary artifact path/retention, exact browser `needs`/`if` wiring, approved Node 24 actions, exact-SHA artifact inputs, main skip classification, full-history deploy checkout, stale-SHA guard ordering, and production-acceptance SHA restrictions.
- Unit-test the exact-main helper for match, mismatch, empty, ambiguous, invalid expected/remote SHA, and command failure. Assert arbitrary command errors are not propagated.
- Statically assert `scripts/check-frontend.mjs` normalizes every structural text read from CRLF or CR to LF before exact multi-line assertions, and normalize workflow/source raw imports at the Vitest read boundary. Do not normalize files that are read for byte-exact hashing.
- Run the manifest writer under Node and assert a 0.x package line, exact commit, SHA-256 lockfile/bundle fields, and the bounded key set. Assert the fake-Provider runner writes a bounded summary into its caller-owned artifact directory even when Playwright produces no screenshot or trace.
- Run `.trellis/tests` for checked/unchecked AC, missing validation, missing work commit, missing PR URL, incomplete children, occupied archive target, structured waiver scope, duplicates, cycles, orphans, fail-before-mutate, and workspace-index repair.
- Run `python ./.trellis/scripts/task.py validate-all` against the real repository.
- For a parent task, compare its exact `task.json.children` set with every child list/count in the planning artifacts, then inspect each resolved active/archive child for completed AC, work commit, PR evidence, and final delivery checklist state.
- Before shipping, run both browser suites and all commands in `frontend/quality-guidelines.md`.

## 7. Wrong vs Correct

### Wrong

```yaml
- uses: actions/checkout@v7
- run: git diff --check
```

On a clean PR checkout this ignores whitespace errors already stored in commits. Even with explicit revisions, the default shallow checkout cannot resolve a merge commit's parent.

```python
data["status"] = "completed"
move_to_archive(task_dir)
validate(task_dir)
```

The validator runs after the evidence and source path have already changed.

### Correct

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 0
- run: git diff --check "$BASE_SHA" "$HEAD_SHA"
```

```python
issues = validate_task_for_archive(task_dir, repo_root)
if issues:
    return 1
data["status"] = "completed"
move_to_archive(task_dir)
```

The exact PR diff is checked, and archive rejection leaves task metadata and paths unchanged.
