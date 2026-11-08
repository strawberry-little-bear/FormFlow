from __future__ import annotations

from pathlib import Path
import subprocess
import sys

from scripts.prepare_showcase import SHOWCASE_FILES


ROOT = Path(__file__).resolve().parents[1]


def test_showcase_builder_publishes_only_allowlisted_files(tmp_path):
    output = tmp_path / "site"
    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "prepare_showcase.py"),
            "--output",
            str(output),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )

    assert result.returncode == 0, result.stderr
    published = tuple(sorted(path.relative_to(output) for path in output.rglob("*") if path.is_file()))
    assert published == tuple(sorted(SHOWCASE_FILES))
    assert not (output / "deployment.md").exists()
    assert not (output / "收齐啦产品设计方案_v0.3.docx").exists()


def test_pages_workflow_uploads_curated_output():
    workflow = (ROOT / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")
    assert "scripts/prepare_showcase.py" in workflow
    assert "path: _site" in workflow
    assert "path: docs" not in workflow


def test_showcase_builder_rejects_repository_or_source_directory():
    script = ROOT / "scripts" / "prepare_showcase.py"
    for output in (ROOT, ROOT / "docs"):
        result = subprocess.run(
            [sys.executable, str(script), "--output", str(output)],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        assert result.returncode == 1
        assert "独立目录" in result.stderr
