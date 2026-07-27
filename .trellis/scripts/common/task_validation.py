"""Task archive evidence, repository consistency, and metadata commands."""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from .git import run_git
from .io import read_json, write_json
from .log import Colors, colored
from .paths import DIR_ARCHIVE, FILE_TASK_JSON, get_repo_root, get_tasks_dir
from .task_utils import resolve_task_dir
from .workspace_index import sync_workspace_root_index, validate_workspace_root_index

BASELINE_VALIDATION_COMMANDS = (
    "npm run check:frontend",
    "npm test",
    "npm run typecheck",
    "npx wrangler deploy --dry-run",
    "git diff --check",
)


@dataclass(frozen=True)
class ValidationIssue:
    gate: str
    message: str


@dataclass(frozen=True)
class TaskRecord:
    name: str
    directory: Path
    archived: bool
    data: dict


def validate_task_for_archive(task_dir: Path, repo_root: Path) -> list[ValidationIssue]:
    data = read_json(task_dir / FILE_TASK_JSON)
    if not data:
        return [ValidationIssue("task_metadata", "task.json is missing or invalid")]

    issues = []
    prd_path = task_dir / "prd.md"
    if not prd_path.is_file():
        issues.append(ValidationIssue("acceptance", "prd.md is missing"))
    else:
        prd = prd_path.read_text(encoding="utf-8")
        checkboxes = re.findall(r"^\s*-\s*\[([ xX])\]\s+(.+)$", prd, re.MULTILINE)
        if not checkboxes:
            issues.append(ValidationIssue("acceptance", "prd.md has no acceptance-criteria checkboxes"))
        unchecked = [label for mark, label in checkboxes if mark == " "]
        if unchecked:
            issues.append(ValidationIssue("acceptance", f"unchecked acceptance criteria: {len(unchecked)}"))
        if re.search(r"\bTBD\b", prd, re.IGNORECASE):
            issues.append(ValidationIssue("acceptance", "prd.md still contains TBD"))

    meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
    validations = meta.get("validation") if isinstance(meta.get("validation"), list) else []
    passed_commands = {
        entry.get("command")
        for entry in validations
        if isinstance(entry, dict) and entry.get("status") == "passed" and isinstance(entry.get("command"), str)
    }
    if data.get("branch") and data.get("branch") != data.get("base_branch"):
        missing = [command for command in BASELINE_VALIDATION_COMMANDS if command not in passed_commands]
        if missing:
            issues.append(ValidationIssue("validation", f"missing passed validation records: {', '.join(missing)}"))
        if not _valid_pr_url(data.get("pr_url")):
            issues.append(ValidationIssue("pull_request", "code task is missing a valid pull-request URL"))
    elif not passed_commands:
        issues.append(ValidationIssue("validation", "task has no passed validation record"))

    commit = data.get("commit")
    if not isinstance(commit, str) or not commit.strip():
        issues.append(ValidationIssue("work_commit", "task is missing its work commit"))
    else:
        rc, _, _ = run_git(["cat-file", "-e", f"{commit}^{{commit}}"], cwd=repo_root)
        if rc != 0:
            issues.append(ValidationIssue("work_commit", f"work commit does not resolve: {commit}"))

    records = _load_task_records(repo_root)
    by_name = _records_by_name(records)
    for child in _string_list(data.get("children")):
        matches = by_name.get(child, [])
        if len(matches) != 1 or matches[0].data.get("status") not in ("completed", "done"):
            issues.append(ValidationIssue("children", f"child is not completed: {child}"))

    archive_dest = get_tasks_dir(repo_root) / DIR_ARCHIVE / datetime.now().strftime("%Y-%m") / task_dir.name
    if archive_dest.exists():
        issues.append(ValidationIssue("archive_target", f"archive destination already exists: {archive_dest}"))

    issues.extend(validate_repository(repo_root, include_workspace=True))
    waiver_issues, waived_gates = _validated_waivers(meta)
    issues.extend(waiver_issues)
    return [issue for issue in issues if issue.gate == "waiver" or issue.gate not in waived_gates]


def validate_repository(repo_root: Path, *, include_workspace: bool = True) -> list[ValidationIssue]:
    records = _load_task_records(repo_root)
    by_name = _records_by_name(records)
    issues = []

    for name, matches in by_name.items():
        if len(matches) > 1:
            locations = ", ".join(str(record.directory) for record in matches)
            issues.append(ValidationIssue("task_tree", f"duplicate task {name}: {locations}"))

    unique = {name: matches[0] for name, matches in by_name.items() if len(matches) == 1}
    for name, record in unique.items():
        parent = record.data.get("parent")
        children = _string_list(record.data.get("children"))
        if len(children) != len(set(children)):
            issues.append(ValidationIssue("task_tree", f"duplicate child reference in {name}"))
        if parent == name or name in children:
            issues.append(ValidationIssue("task_tree", f"self-reference in {name}"))
        if parent:
            parent_record = unique.get(parent)
            if not parent_record:
                issues.append(ValidationIssue("task_tree", f"missing parent {parent} for {name}"))
            elif name not in _string_list(parent_record.data.get("children")):
                issues.append(ValidationIssue("task_tree", f"parent {parent} does not reference child {name}"))
        for child in children:
            child_record = unique.get(child)
            if not child_record:
                issues.append(ValidationIssue("task_tree", f"missing child {child} referenced by {name}"))
            elif child_record.data.get("parent") != name:
                issues.append(ValidationIssue("task_tree", f"child {child} does not reference parent {name}"))

    issues.extend(_cycle_issues(unique))
    if include_workspace:
        issues.extend(ValidationIssue("workspace_index", message) for message in validate_workspace_root_index(repo_root))
    return _dedupe_issues(issues)


def record_task_validation(task_dir: Path, command: str, status: str, summary: str) -> bool:
    if status not in ("passed", "failed") or not command.strip() or not summary.strip():
        return False
    data = read_json(task_dir / FILE_TASK_JSON)
    if not data:
        return False
    meta = data.get("meta")
    if not isinstance(meta, dict):
        meta = {}
        data["meta"] = meta
    entries = meta.setdefault("validation", [])
    if not isinstance(entries, list):
        entries = []
        meta["validation"] = entries
    entries[:] = [entry for entry in entries if not isinstance(entry, dict) or entry.get("command") != command]
    entries.append({
        "command": command,
        "status": status,
        "summary": summary,
        "at": datetime.now(timezone.utc).isoformat(),
    })
    return write_json(task_dir / FILE_TASK_JSON, data)


def set_task_work_commit(task_dir: Path, repo_root: Path, commit: str) -> bool:
    rc, output, _ = run_git(["rev-parse", "--verify", f"{commit}^{{commit}}"], cwd=repo_root)
    if rc != 0:
        return False
    data = read_json(task_dir / FILE_TASK_JSON)
    if not data:
        return False
    data["commit"] = output.strip()
    return write_json(task_dir / FILE_TASK_JSON, data)


def set_task_pr_url(task_dir: Path, url: str) -> bool:
    if not _valid_pr_url(url):
        return False
    data = read_json(task_dir / FILE_TASK_JSON)
    if not data:
        return False
    data["pr_url"] = url
    return write_json(task_dir / FILE_TASK_JSON, data)


def add_task_waiver(task_dir: Path, *, gate: str, reason: str, approver: str, at: str | None = None) -> bool:
    if not all(value.strip() for value in (gate, reason, approver)):
        return False
    data = read_json(task_dir / FILE_TASK_JSON)
    if not data:
        return False
    meta = data.get("meta")
    if not isinstance(meta, dict):
        meta = {}
        data["meta"] = meta
    waivers = meta.setdefault("waivers", [])
    if not isinstance(waivers, list):
        waivers = []
        meta["waivers"] = waivers
    waivers.append({
        "gate": gate,
        "reason": reason,
        "approver": approver,
        "at": at or datetime.now(timezone.utc).isoformat(),
    })
    return write_json(task_dir / FILE_TASK_JSON, data)


def cmd_validate_all(args: argparse.Namespace) -> int:
    repo_root = get_repo_root()
    if getattr(args, "fix_workspace_index", False) and not sync_workspace_root_index(repo_root):
        print(colored("Error: could not repair workspace root index", Colors.RED), file=sys.stderr)
        return 1
    issues = validate_repository(repo_root)
    return _print_issues(issues, "Repository consistency")


def cmd_record_validation(args: argparse.Namespace) -> int:
    repo_root = get_repo_root()
    task_dir = resolve_task_dir(args.dir, repo_root)
    if not record_task_validation(task_dir, args.validation_command, args.status, args.summary):
        print(colored("Error: invalid validation record", Colors.RED), file=sys.stderr)
        return 1
    print(colored(f"Recorded validation: {args.validation_command} ({args.status})", Colors.GREEN))
    return 0


def cmd_set_work_commit(args: argparse.Namespace) -> int:
    repo_root = get_repo_root()
    task_dir = resolve_task_dir(args.dir, repo_root)
    if not set_task_work_commit(task_dir, repo_root, args.commit):
        print(colored(f"Error: work commit does not resolve: {args.commit}", Colors.RED), file=sys.stderr)
        return 1
    print(colored(f"Recorded work commit: {args.commit}", Colors.GREEN))
    return 0


def cmd_set_pr_url(args: argparse.Namespace) -> int:
    repo_root = get_repo_root()
    task_dir = resolve_task_dir(args.dir, repo_root)
    if not set_task_pr_url(task_dir, args.url):
        print(colored("Error: pull-request URL must be HTTPS and contain /pull/<number>", Colors.RED), file=sys.stderr)
        return 1
    print(colored(f"Recorded pull request: {args.url}", Colors.GREEN))
    return 0


def cmd_add_waiver(args: argparse.Namespace) -> int:
    repo_root = get_repo_root()
    task_dir = resolve_task_dir(args.dir, repo_root)
    if not add_task_waiver(task_dir, gate=args.gate, reason=args.reason, approver=args.approver):
        print(colored("Error: waiver fields must be non-blank", Colors.RED), file=sys.stderr)
        return 1
    print(colored(f"Recorded waiver for gate: {args.gate}", Colors.GREEN))
    return 0


def _load_task_records(repo_root: Path) -> list[TaskRecord]:
    tasks_dir = get_tasks_dir(repo_root)
    records = []
    if not tasks_dir.is_dir():
        return records
    for task_dir in sorted(tasks_dir.iterdir()):
        if task_dir.is_dir() and task_dir.name != DIR_ARCHIVE:
            data = read_json(task_dir / FILE_TASK_JSON)
            if data:
                records.append(TaskRecord(task_dir.name, task_dir, False, data))
    archive = tasks_dir / DIR_ARCHIVE
    if archive.is_dir():
        for month in sorted(archive.iterdir()):
            if not month.is_dir():
                continue
            for task_dir in sorted(month.iterdir()):
                if not task_dir.is_dir():
                    continue
                data = read_json(task_dir / FILE_TASK_JSON)
                if data:
                    records.append(TaskRecord(task_dir.name, task_dir, True, data))
    return records


def _records_by_name(records: list[TaskRecord]) -> dict[str, list[TaskRecord]]:
    result: dict[str, list[TaskRecord]] = {}
    for record in records:
        result.setdefault(record.name, []).append(record)
    return result


def _cycle_issues(records: dict[str, TaskRecord]) -> list[ValidationIssue]:
    issues = []
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(name: str, path: list[str]) -> None:
        if name in visiting:
            start = path.index(name) if name in path else 0
            issues.append(ValidationIssue("task_tree", f"task cycle: {' -> '.join(path[start:] + [name])}"))
            return
        if name in visited:
            return
        visiting.add(name)
        path.append(name)
        for child in _string_list(records[name].data.get("children")):
            if child in records:
                visit(child, path)
        path.pop()
        visiting.remove(name)
        visited.add(name)

    for name in sorted(records):
        visit(name, [])
    return issues


def _validated_waivers(meta: dict) -> tuple[list[ValidationIssue], set[str]]:
    waivers = meta.get("waivers") if isinstance(meta.get("waivers"), list) else []
    issues = []
    gates = set()
    for index, waiver in enumerate(waivers):
        if not isinstance(waiver, dict):
            issues.append(ValidationIssue("waiver", f"waiver {index + 1} is not an object"))
            continue
        values = [waiver.get(field) for field in ("gate", "reason", "approver", "at")]
        if not all(isinstance(value, str) and value.strip() for value in values):
            issues.append(ValidationIssue("waiver", f"waiver {index + 1} is missing gate/reason/approver/at"))
            continue
        try:
            datetime.fromisoformat(str(waiver["at"]).replace("Z", "+00:00"))
        except ValueError:
            issues.append(ValidationIssue("waiver", f"waiver {index + 1} has an invalid timestamp"))
            continue
        gates.add(str(waiver["gate"]))
    return issues, gates


def _valid_pr_url(value: object) -> bool:
    if not isinstance(value, str):
        return False
    parsed = urlsplit(value)
    return parsed.scheme == "https" and bool(parsed.netloc) and re.search(r"/pull/\d+/?$", parsed.path) is not None


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str) and item]


def _dedupe_issues(issues: list[ValidationIssue]) -> list[ValidationIssue]:
    return list(dict.fromkeys(issues))


def _print_issues(issues: list[ValidationIssue], label: str) -> int:
    if not issues:
        print(colored(f"{label}: OK", Colors.GREEN))
        return 0
    print(colored(f"{label}: FAILED", Colors.RED), file=sys.stderr)
    for issue in issues:
        print(f"  - [{issue.gate}] {issue.message}", file=sys.stderr)
    return 1
