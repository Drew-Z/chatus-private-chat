# Delivery Governance

## 1. Scope / Trigger

Use this contract when changing pull-request CI, main deployment, production acceptance, browser-test artifact handling, Trellis task metadata, task relationships, archive behavior, or workspace journal indexes.

Production remains GitHub-Actions-only. Pull requests use local fixtures and fake Providers; they never run production smoke, production acceptance, or live model probes.

## 2. Signatures

- PR workflow: `.github/workflows/ci.yml`
- Main workflow: `.github/workflows/deploy.yml`
- Production acceptance: `.github/workflows/production-acceptance.yml`
- Path classifier: `node scripts/classify-ci-paths.mjs [--all] --github-output <path> --manifest <path>`
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

PR quality always runs, in order, `npm run check:frontend`, `npm test`, `npm run typecheck`, `npx wrangler deploy --dry-run`, and a base-to-head `git diff --check`. The Workspace and fake-Provider Agent Playwright jobs keep stable job names and are gated by the shared path classifier. Frontend paths affect both browser suites; Agent/runtime paths affect Agent acceptance; `package.json`, `package-lock.json`, `tsconfig.json`, and `wrangler.jsonc` affect both.

Documentation-only deployment skipping is narrow. `docs/**`, Markdown files, and tracked Trellis task/spec/workspace records may skip Worker deployment. Executable `.trellis/scripts/**`, workflows, runtime configuration, and application code are code changes even though they live near documentation.

Delivery artifacts are non-sensitive JSON plus bounded Playwright output. A delivery manifest contains only `schemaVersion`, `kind`, `status`, `commit`, `generatedAt`, `packageLockSha256`, and `publicBundleSha256`. Never retain runtime credentials, dotenv files, Wrangler persistence, access codes, conversation content, or stored memory. The fake-Provider runner may retain a caller-owned Playwright output directory, but its temporary env and Wrangler state remain in a separately deleted directory. The runner always writes `agent-summary.json` into that directory with only schema version, kind, pass/fail status, commit, generation time, and bounded fake-Provider counters; a successful test must not leave the artifact directory empty.

Main deployment preserves the early and late remote-main SHA guards and the non-canceling production-mutation concurrency group. The deploy job checks out full history before comparing `GITHUB_SHA^` to `GITHUB_SHA`; the default one-commit checkout makes the parent revision ambiguous and must not be used with this gate. Documentation/Trellis-record-only commits publish explicit path-classification evidence and a skip summary. A real deploy and manual production acceptance each retain an exact-SHA manifest.

Trellis archive validates before any state or directory mutation. A code task requires checked acceptance criteria with no `TBD`, passed records for the five baseline commands, a resolving `task.json.commit`, a valid HTTPS `task.json.pr_url`, completed children, a free archive destination, repository-wide parent/child consistency, and a current workspace root index.

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
| PR has whitespace errors in committed diff | Base-to-head `git diff --check` fails |
| Deploy checkout cannot resolve `GITHUB_SHA^` | Deployment stops before preparing secrets or mutating production |
| Browser suite fails | Upload retained trace/screenshot output without runtime secrets |
| Task has unchecked AC or `TBD` | Archive rejects before mutation |
| Validation command is missing or failed | Archive rejects unless the exact `validation` gate has a valid waiver |
| Work commit does not resolve | Archive rejects |
| Code task lacks a valid PR URL | Archive rejects |
| Child is active/incomplete or task graph is inconsistent | Archive rejects |
| Workspace root projection is stale | `validate-all` fails; `--fix-workspace-index` regenerates it |
| Waiver is malformed | Archive rejects under the non-waivable `waiver` gate |

## 5. Good / Base / Bad Cases

- Good: a frontend PR runs baseline quality plus both browser suites, retains exact-SHA manifests and fake-only traces, merges to main, deploys the same SHA, then archives only after task evidence is recorded.
- Base: a task/spec-only commit runs PR quality if it uses a PR, skips Worker deployment after merge, and retains the path-classification artifact.
- Bad: classify every `.trellis/**` path as documentation, causing executable archive-script changes to bypass the deployment decision.
- Bad: run `git diff --check` with no revisions on a clean PR checkout; it checks only working-tree changes and cannot detect whitespace already committed in the PR.
- Bad: archive first and validate afterward, or use a note such as `waived` without structured approver/timestamp evidence.

## 6. Tests Required

- Unit-test path classification for frontend, Agent, shared runtime, docs/Trellis records, mixed changes, and executable Trellis scripts.
- Parse all workflow YAML and statically assert stable PR jobs, the five baseline commands, base-to-head diff checking, conditional browser commands, upload-artifact steps, main skip classification, full-history deploy checkout, stale-SHA guards, and production-acceptance SHA restrictions.
- Normalize imported workflow and source text from CRLF or CR to LF at the test read boundary before exact multi-line structural assertions. Do not normalize files that are read for byte-exact hashing.
- Run the manifest writer under Node and assert a 0.x package line, exact commit, SHA-256 lockfile/bundle fields, and the bounded key set. Assert the fake-Provider runner writes a bounded summary into its caller-owned artifact directory even when Playwright produces no screenshot or trace.
- Run `.trellis/tests` for checked/unchecked AC, missing validation, missing work commit, missing PR URL, incomplete children, occupied archive target, structured waiver scope, duplicates, cycles, orphans, fail-before-mutate, and workspace-index repair.
- Run `python ./.trellis/scripts/task.py validate-all` against the real repository.
- Before shipping, run both browser suites and all commands in `frontend/quality-guidelines.md`.

## 7. Wrong vs Correct

### Wrong

```yaml
- uses: actions/checkout@v5
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
- uses: actions/checkout@v5
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
