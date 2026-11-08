"""Smoke scripts must expose safe, non-networking help commands."""
from __future__ import annotations

from pathlib import Path
import subprocess
import sys


def test_smoke_llm_help_does_not_start_a_gateway_call():
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [sys.executable, "scripts/smoke_llm.py", "--help"],
        cwd=root,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )

    assert result.returncode == 0
    assert "usage:" in result.stdout.lower()
    assert "真实网关冒烟" in result.stdout


def test_smoke_review_help_does_not_start_a_gateway_call():
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [sys.executable, "scripts/smoke_review.py", "--help"],
        cwd=root,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )

    assert result.returncode == 0
    assert "usage:" in result.stdout.lower()
    assert "--stub" in result.stdout
