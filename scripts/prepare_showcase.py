#!/usr/bin/env python
"""Build the curated static artifact used by GitHub Pages."""
from __future__ import annotations

import argparse
from html.parser import HTMLParser
from pathlib import Path
import re
import shutil
import sys
from urllib.parse import unquote, urlsplit


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
CSS_URL_PATTERN = re.compile(r"""url\(\s*(['"]?)(.*?)\1\s*\)""", re.IGNORECASE)


class _AssetReferenceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.references: set[str] = set()

    def _record(self, value: str | None) -> None:
        if not value:
            return
        parsed = urlsplit(value.strip())
        if parsed.scheme or parsed.netloc or not parsed.path or parsed.path.startswith("/"):
            return
        self.references.add(unquote(parsed.path).replace("\\", "/"))

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for name, value in attrs:
            if name in {"href", "src"}:
                self._record(value)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)


def referenced_assets(source: Path) -> set[Path]:
    """Collect local assets referenced by the public HTML and stylesheet."""
    parser = _AssetReferenceParser()
    parser.feed((source / "index.html").read_text(encoding="utf-8"))
    references = set(parser.references)
    css = (source / "site.css").read_text(encoding="utf-8")
    for match in CSS_URL_PATTERN.finditer(css):
        value = match.group(2).strip()
        parsed = urlsplit(value)
        if parsed.scheme or parsed.netloc or not parsed.path or parsed.path.startswith("/"):
            continue
        references.add(unquote(parsed.path).replace("\\", "/"))
    return {Path(value) for value in references}


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

    referenced = referenced_assets(source)
    unknown = sorted(referenced - set(SHOWCASE_FILES))
    if unknown:
        names = ", ".join(str(path).replace("\\", "/") for path in unknown)
        raise ValueError(f"页面引用了未列入白名单的资源：{names}")

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
