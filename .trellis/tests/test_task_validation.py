from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from common.task_store import cmd_archive  # noqa: E402
from common.task_validation import (  # noqa: E402
    BASELINE_VALIDATION_COMMANDS,
    add_task_waiver,
    record_task_validation,
    set_task_work_commit,
    validate_repository,
    validate_task_for_archive,
)
from common.workspace_index import sync_workspace_root_index, validate_workspace_root_index  # noqa: E402


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2), encoding="utf-8")


def write_task(
    repo: Path,
    name: str,
    *,
    parent: str | None = None,
    children: list[str] | None = None,
    checked: bool = True,
    status: str = "in_progress",
    branch: str | None = "codex/example",
) -> Path:
    task_dir = repo / ".trellis" / "tasks" / name
    task_dir.mkdir(parents=True, exist_ok=True)
    mark = "x" if checked else " "
    (task_dir / "prd.md").write_text(
        f"# Example\n\n## Acceptance Criteria\n\n- [{mark}] AC1. Verified.\n",
        encoding="utf-8",
    )
    write_json(
        task_dir / "task.json",
        {
            "id": name,
            "name": name,
            "title": name,
            "status": status,
            "branch": branch,
            "base_branch": "main",
            "commit": None,
            "pr_url": "https://github.com/example/chatus/pull/1" if branch else None,
            "children": children or [],
            "parent": parent,
            "meta": {"validation": []},
        },
    )
    return task_dir


def init_git_repo(repo: Path) -> str:
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.email", "trellis@example.test"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "Trellis Test"], cwd=repo, check=True)
    marker = repo / "marker.txt"
    marker.write_text("test\n", encoding="utf-8")
    subprocess.run(["git", "add", "marker.txt"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "test"], cwd=repo, check=True)
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()


def write_valid_workspace_index(repo: Path) -> None:
    workspace = repo / ".trellis" / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "index.md").write_text(
        "# Workspace Index\n\n## Active Developers\n\n"
        "<!-- @@@auto:developers -->\n"
        "| Developer | Last Active | Sessions | Active File |\n"
        "|-----------|-------------|----------|-------------|\n"
        "| (none yet) | - | - | - |\n"
        "<!-- @@@/auto:developers -->\n",
        encoding="utf-8",
    )


def make_archive_ready(repo: Path, task_dir: Path, commit: str) -> None:
    set_task_work_commit(task_dir, repo, commit)
    for command in BASELINE_VALIDATION_COMMANDS:
        record_task_validation(task_dir, command, "passed", "test evidence")


class TaskValidationTests(unittest.TestCase):
    def test_archive_ready_task_passes(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            repo = Path(raw)
            commit = init_git_repo(repo)
            write_valid_workspace_index(repo)
            task_dir = write_task(repo, "07-27-ready")
            make_archive_ready(repo, task_dir, commit)

            self.assertEqual(validate_task_for_archive(task_dir, repo), [])

    def test_unchecked_acceptance_blocks_archive_without_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            repo = Path(raw)
            commit = init_git_repo(repo)
            write_valid_workspace_index(repo)
            task_dir = write_task(repo, "07-27-blocked", checked=False)
            make_archive_ready(repo, task_dir, commit)
            before = (task_dir / "task.json").read_text(encoding="utf-8")

            with patch("common.task_store.get_repo_root", return_value=repo):
                result = cmd_archive(argparse.Namespace(name=task_dir.name, no_commit=True))

            self.assertEqual(result, 1)
            self.assertTrue(task_dir.is_dir())
            self.assertEqual((task_dir / "task.json").read_text(encoding="utf-8"), before)
            self.assertFalse((repo / ".trellis" / "tasks" / "archive").exists())

    def test_structured_waiver_is_persisted_and_scoped_to_one_gate(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            repo = Path(raw)
            commit = init_git_repo(repo)
            write_valid_workspace_index(repo)
            task_dir = write_task(repo, "07-27-waived", checked=False)
            make_archive_ready(repo, task_dir, commit)
            add_task_waiver(
                task_dir,
                gate="acceptance",
                reason="Approved legacy acceptance migration",
                approver="release-owner",
                at=datetime.now(timezone.utc).isoformat(),
            )

            self.assertEqual(validate_task_for_archive(task_dir, repo), [])
            data = json.loads((task_dir / "task.json").read_text(encoding="utf-8"))
            self.assertEqual(data["meta"]["waivers"][0]["gate"], "acceptance")
            self.assertNotIn("validation", data["meta"]["waivers"][0]["gate"])

    def test_invalid_waiver_cannot_waive_the_waiver_gate(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            repo = Path(raw)
            commit = init_git_repo(repo)
            write_valid_workspace_index(repo)
            task_dir = write_task(repo, "07-27-invalid-waiver")
            make_archive_ready(repo, task_dir, commit)
            data = json.loads((task_dir / "task.json").read_text(encoding="utf-8"))
            data["meta"]["waivers"] = [
                {
                    "gate": "waiver",
                    "reason": "Attempt to bypass waiver validation",
                    "approver": "release-owner",
                    "at": "not-an-iso-timestamp",
                }
            ]
            write_json(task_dir / "task.json", data)

            issues = validate_task_for_archive(task_dir, repo)

            self.assertEqual({issue.gate for issue in issues}, {"waiver"})
            self.assertIn("invalid timestamp", issues[0].message)

    def test_archive_requires_validation_commit_pr_children_and_free_destination(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            repo = Path(raw)
            commit = init_git_repo(repo)
            write_valid_workspace_index(repo)
            child = write_task(repo, "07-27-child", parent="07-27-parent", status="in_progress", branch=None)
            parent = write_task(repo, "07-27-parent", children=[child.name])
            make_archive_ready(repo, parent, commit)

            data = json.loads((parent / "task.json").read_text(encoding="utf-8"))
            data["commit"] = None
            data["pr_url"] = None
            data["meta"]["validation"] = []
            write_json(parent / "task.json", data)
            archive_target = repo / ".trellis" / "tasks" / "archive" / datetime.now().strftime("%Y-%m") / parent.name
            archive_target.mkdir(parents=True)

            issues = validate_task_for_archive(parent, repo)
            gates = {issue.gate for issue in issues}
            self.assertTrue({"validation", "work_commit", "pull_request", "children", "archive_target"}.issubset(gates))

    def test_repository_validation_detects_orphans_duplicates_and_cycles(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            repo = Path(raw)
            write_task(repo, "07-27-a", parent="07-27-b", children=["07-27-b", "07-27-b"], branch=None)
            write_task(repo, "07-27-b", parent="07-27-a", children=["07-27-a"], branch=None)
            write_task(repo, "07-27-orphan", parent="07-27-missing", branch=None)
            write_task(repo, "07-27-cycle-c", parent="07-27-cycle-d", children=["07-27-cycle-d"], branch=None)
            write_task(repo, "07-27-cycle-d", parent="07-27-cycle-c", children=["07-27-cycle-c"], branch=None)
            archived = repo / ".trellis" / "tasks" / "archive" / "2026-07" / "07-27-a"
            archived.mkdir(parents=True)
            write_json(archived / "task.json", {"name": "07-27-a", "status": "completed", "children": [], "parent": None})

            issues = validate_repository(repo, include_workspace=False)
            gates = {issue.gate for issue in issues}
            messages = "\n".join(issue.message for issue in issues)
            self.assertIn("task_tree", gates)
            self.assertIn("duplicate", messages.lower())
            self.assertIn("cycle", messages.lower())
            self.assertIn("missing parent", messages.lower())


class WorkspaceRootIndexTests(unittest.TestCase):
    def test_sync_repairs_root_index_and_validation_detects_drift(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            repo = Path(raw)
            workspace = repo / ".trellis" / "workspace"
            developer = workspace / "zhang"
            developer.mkdir(parents=True)
            (developer / "index.md").write_text(
                "# Workspace Index - zhang\n\n"
                "<!-- @@@auto:current-status -->\n"
                "- **Active File**: `journal-2.md`\n"
                "- **Total Sessions**: 21\n"
                "- **Last Active**: 2026-07-27\n"
                "<!-- @@@/auto:current-status -->\n",
                encoding="utf-8",
            )
            root_index = workspace / "index.md"
            root_index.write_text(
                "# Workspace Index\n\n## Active Developers\n\n"
                "<!-- @@@auto:developers -->\n"
                "| Developer | Last Active | Sessions | Active File |\n"
                "|-----------|-------------|----------|-------------|\n"
                "| stale | - | 0 | - |\n"
                "<!-- @@@/auto:developers -->\n",
                encoding="utf-8",
            )

            self.assertTrue(validate_workspace_root_index(repo))
            sync_workspace_root_index(repo)
            self.assertEqual(validate_workspace_root_index(repo), [])
            self.assertIn("| zhang | 2026-07-27 | 21 | `journal-2.md` |", root_index.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
