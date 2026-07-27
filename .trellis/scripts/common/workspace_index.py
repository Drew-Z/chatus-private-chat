"""Root workspace-index projection and consistency checks."""

from __future__ import annotations

import re
from pathlib import Path

from .paths import DIR_WORKFLOW, DIR_WORKSPACE

START_MARKER = "<!-- @@@auto:developers -->"
END_MARKER = "<!-- @@@/auto:developers -->"


def sync_workspace_root_index(repo_root: Path) -> bool:
    """Rewrite the root developer table from personal workspace indexes."""
    root_index = repo_root / DIR_WORKFLOW / DIR_WORKSPACE / "index.md"
    if not root_index.is_file():
        return False
    content = root_index.read_text(encoding="utf-8")
    block = _expected_block(repo_root)
    pattern = re.compile(
        rf"{re.escape(START_MARKER)}.*?{re.escape(END_MARKER)}",
        re.DOTALL,
    )
    if not pattern.search(content):
        return False
    updated = pattern.sub(block, content, count=1)
    if updated != content:
        root_index.write_text(updated, encoding="utf-8")
    return True


def validate_workspace_root_index(repo_root: Path) -> list[str]:
    """Return drift errors for the root workspace index."""
    root_index = repo_root / DIR_WORKFLOW / DIR_WORKSPACE / "index.md"
    if not root_index.is_file():
        return ["workspace root index is missing"]
    content = root_index.read_text(encoding="utf-8")
    expected = _expected_block(repo_root)
    if START_MARKER not in content or END_MARKER not in content:
        return ["workspace root index is missing developer projection markers"]
    if expected not in content:
        return ["workspace root index developer projection is stale"]
    return []


def _expected_block(repo_root: Path) -> str:
    rows = _developer_rows(repo_root)
    table = [
        START_MARKER,
        "| Developer | Last Active | Sessions | Active File |",
        "|-----------|-------------|----------|-------------|",
    ]
    if rows:
        table.extend(rows)
    else:
        table.append("| (none yet) | - | - | - |")
    table.append(END_MARKER)
    return "\n".join(table)


def _developer_rows(repo_root: Path) -> list[str]:
    workspace = repo_root / DIR_WORKFLOW / DIR_WORKSPACE
    if not workspace.is_dir():
        return []
    rows = []
    for directory in sorted(workspace.iterdir()):
        index_file = directory / "index.md"
        if not directory.is_dir() or directory.name.startswith(".") or not index_file.is_file():
            continue
        status = _read_personal_status(index_file)
        rows.append(
            f"| {directory.name} | {status['last_active']} | {status['sessions']} | `{status['active_file']}` |"
        )
    return rows


def _read_personal_status(index_file: Path) -> dict[str, str]:
    content = index_file.read_text(encoding="utf-8")

    def read(pattern: str, fallback: str) -> str:
        match = re.search(pattern, content, re.MULTILINE)
        return match.group(1).strip() if match else fallback

    return {
        "active_file": read(r"^- \*\*Active File\*\*: `([^`]+)`$", "-"),
        "sessions": read(r"^- \*\*Total Sessions\*\*: (\d+)$", "0"),
        "last_active": read(r"^- \*\*Last Active\*\*: (.+)$", "-"),
    }
