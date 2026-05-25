"""Pipeline version marker for Colab sync verification."""

from __future__ import annotations

import subprocess
from pathlib import Path

# Minimum commit that includes the edges fix (pass4 vector floor + pass3 synthetic targets).
EDGES_FIX_COMMIT = "385e1dd"

_PIPELINE_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _PIPELINE_DIR.parents[1]


def _git_describe() -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(_REPO_ROOT), "describe", "--tags", "--always", "--dirty"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if result.returncode == 0:
            value = result.stdout.strip()
            return value or None
    except (OSError, subprocess.SubprocessError):
        pass
    return None


def _git_short_head() -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(_REPO_ROOT), "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if result.returncode == 0:
            value = result.stdout.strip()
            return value or None
    except (OSError, subprocess.SubprocessError):
        pass
    return None


def _git_contains(commit: str) -> bool | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(_REPO_ROOT), "merge-base", "--is-ancestor", commit, "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if result.returncode == 0:
            return True
        if result.returncode == 1:
            return False
    except (OSError, subprocess.SubprocessError):
        pass
    return None


PIPELINE_VERSION = _git_describe() or _git_short_head() or EDGES_FIX_COMMIT


def edges_fix_present() -> bool:
    contained = _git_contains(EDGES_FIX_COMMIT)
    if contained is not None:
        return contained
    # Fallback when git metadata is unavailable (e.g. shallow export).
    return PIPELINE_VERSION.startswith(EDGES_FIX_COMMIT) or PIPELINE_VERSION >= EDGES_FIX_COMMIT


def print_version_banner() -> None:
    fix = "YES" if edges_fix_present() else "NO"
    print(f"ScholarPulse pipeline v{PIPELINE_VERSION} - edges fix: {fix}")


def verify_critical_files() -> None:
    """Exit with a clear error if edge-fix source files are missing or stale."""
    pass4 = _PIPELINE_DIR / "stages" / "pass4_rerank.py"
    if not pass4.is_file():
        raise SystemExit(
            f"STALE REPO: missing {pass4.relative_to(_REPO_ROOT)}. "
            f"Run `git fetch origin && git reset --hard origin/main` then restart runtime."
        )
    source = pass4.read_text(encoding="utf-8")
    if "kept_via_vector_floor" not in source:
        raise SystemExit(
            "STALE REPO: pass4_rerank.py lacks kept_via_vector_floor (edges fix). "
            f"Need commit >= {EDGES_FIX_COMMIT}. "
            "Run `git fetch origin && git reset --hard origin/main` then restart runtime."
        )

    pass3 = _PIPELINE_DIR / "stages" / "pass3_candidate_search.py"
    if not pass3.is_file():
        raise SystemExit(
            f"STALE REPO: missing {pass3.relative_to(_REPO_ROOT)}. "
            f"Run `git fetch origin && git reset --hard origin/main` then restart runtime."
        )
    pass3_source = pass3.read_text(encoding="utf-8")
    if "synthetic_targets_created" not in pass3_source:
        raise SystemExit(
            "STALE REPO: pass3_candidate_search.py lacks synthetic target logic. "
            f"Need commit >= {EDGES_FIX_COMMIT}. "
            "Run `git fetch origin && git reset --hard origin/main` then restart runtime."
        )

    run_script = _REPO_ROOT / "colab" / "scripts" / "run_and_ingest.py"
    if run_script.is_file():
        run_source = run_script.read_text(encoding="utf-8")
        if "resolved_doi_count" not in run_source:
            raise SystemExit(
                "STALE REPO: run_and_ingest.py lacks resolved_doi_count in summary. "
                f"Need commit >= 5c31d6b. "
                "Run `git fetch origin && git reset --hard origin/main` then restart runtime."
            )
