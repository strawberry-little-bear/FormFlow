#!/usr/bin/env python
"""Build the curated static artifact used by GitHub Pages."""
from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import sys


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "docs"
DEFAULT_OUTPUT = ROOT / "_site"

# Keep the public showcase small and explicit. Internal review archives and
# editable design documents stay in the repository but are not published.
SHOWCASE_FILES = (
    Path(".nojekyll"),
    Path("index.html"),
    Path("site.css"),
    Path("site.js"),
    Path("robots.txt"),
    Path("sitemap.xml"),
    Path("formflow-showcase-captioned.webm"),
    Path("ux-review-2026-10-30/showcase-home-current.png"),
    Path("ux-review-2026-10-23/design.png"),
    Path("ux-review-2026-10-23/review-s2.png"),
    Path("ux-review-2026-10-23/delivery.png"),
)


def configure_output_encoding() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")


def build_showcase(source: Path, output: Path) -> tuple[Path, ...]:
    source = source.expanduser().resolve()
    output = output.expanduser().resolve()
    protected = {source, source.parent, ROOT.resolve()}
    if output in protected:
        raise ValueError("展示页输出目录必须是独立目录，不能覆盖仓库或源目录")

    missing = [relative for relative in SHOWCASE_FILES if not (source / relative).is_file()]
    if missing:
        names = ", ".join(str(path).replace("\\", "/") for path in missing)
        raise FileNotFoundError(f"展示页资源缺失：{names}")

    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True, exist_ok=True)
    copied: list[Path] = []
    for relative in SHOWCASE_FILES:
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / relative, destination)
        copied.append(relative)
    return tuple(copied)


def main(argv: list[str] | None = None) -> int:
    configure_output_encoding()
    parser = argparse.ArgumentParser(description="构建 GitHub Pages 的白名单展示产物")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args(argv)
    try:
        copied = build_showcase(args.source, args.output)
    except (OSError, ValueError) as exc:
        print(f"展示页构建失败：{exc}", file=sys.stderr)
        return 1
    print(f"展示页构建完成：{len(copied)} 个白名单文件 -> {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
