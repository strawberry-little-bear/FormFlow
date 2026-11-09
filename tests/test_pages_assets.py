from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


class _LocalReferenceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.references: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for name, value in attrs:
            if name in {"href", "src"} and value:
                self.references.append(value)


def test_pages_index_references_only_existing_local_assets():
    root = Path(__file__).resolve().parents[1]
    docs = root / "docs"
    html = (docs / "index.html").read_text(encoding="utf-8")
    parser = _LocalReferenceParser()
    parser.feed(html)

    local_paths: list[Path] = []
    for reference in parser.references:
        parsed = urlsplit(reference)
        if parsed.scheme or parsed.netloc or reference.startswith("#"):
            continue
        path = unquote(parsed.path)
        if not path:
            continue
        local_paths.append(docs / path.lstrip("/"))

    missing = sorted(str(path.relative_to(root)) for path in local_paths if not path.is_file())
    assert not missing, f"GitHub Pages has missing local assets: {missing}"
    assert (docs / "robots.txt").is_file()
    assert (docs / "sitemap.xml").is_file()
    assert 'class="video-transcript"' in html
    assert "document.documentElement.classList.add('js')" in html
    assert html.count('loading="lazy"') == 3

    css = (docs / "site.css").read_text(encoding="utf-8")
    assert "[data-reveal]{opacity:1" in css
    assert ".js [data-reveal]{opacity:0" in css
    assert "@media(max-width:520px){.hero{min-height:920px}.hero-scroll{bottom:2px}}" in css
    assert "@media(max-width:360px){.hero{min-height:1010px}}" in css
    assert ".section,.deploy-cta{scroll-margin-top:88px}" in css
