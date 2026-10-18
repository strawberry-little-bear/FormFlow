"""文档解析：提取文本用于语义检查。

边界（第 16 节）：在隔离环境解析，不执行宏、脚本或上传代码；
损坏/加密/类型伪装文件返回失败原因，不当成资格拒绝。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


class ParseError(Exception):
    """解析失败（损坏/加密/格式不支持）。调用方按技术原因处理。"""


@dataclass
class ParseResult:
    pages: list[str] = field(default_factory=list)
    method: str = "text"            # text / visual / none
    unread_pages: int = 0           # 需要 OCR 但未实现的页
    failed_pages: int = 0
    error: str = ""

    @property
    def total_pages(self) -> int:
        return len(self.pages) + self.unread_pages + self.failed_pages

    @property
    def text_pages(self) -> int:
        return sum(1 for p in self.pages if p.strip())

    @property
    def visual_pages(self) -> int:
        return self.unread_pages

    @property
    def coverage_complete(self) -> bool:
        """关键范围是否完整覆盖。未读/失败页存在时语义结论必须 unknown。"""
        return self.unread_pages == 0 and self.failed_pages == 0


def _parse_pdf(path: Path) -> ParseResult:
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        reader = PdfReader(str(path))
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception as e:
                raise ParseError(f"PDF 已加密，无法读取: {e}") from e
        pages = []
        unread = 0
        for page in reader.pages:
            try:
                text = page.extract_text() or ""
            except Exception:
                text = ""
            if text.strip():
                pages.append(text)
            else:
                unread += 1  # 无文字层：扫描件，需 OCR
        return ParseResult(pages=pages, method="text", unread_pages=unread)
    except PdfReadError as e:
        raise ParseError(f"PDF 损坏或无法解析: {e}") from e


def _parse_docx(path: Path) -> ParseResult:
    import docx

    try:
        d = docx.Document(str(path))
    except Exception as e:
        raise ParseError(f"DOCX 无法解析: {e}") from e
    parts = [p.text for p in d.paragraphs if p.text.strip()]
    for tbl in d.tables:
        for row in tbl.rows:
            parts.append(" | ".join(c.text for c in row.cells))
    if not parts:
        return ParseResult(method="none", failed_pages=1, error="DOCX 无可用文本")
    return ParseResult(pages=["\n".join(parts)], method="text")


def _parse_text(path: Path) -> ParseResult:
    for enc in ("utf-8", "gb18030"):
        try:
            return ParseResult(pages=[path.read_text(encoding=enc)], method="text")
        except UnicodeDecodeError:
            continue
    raise ParseError("文本编码无法识别")


def parse_file(path: str | Path) -> ParseResult:
    """按真实内容判断类型（不只看扩展名），提取文本。"""
    path = Path(path)
    if not path.exists():
        raise ParseError("文件不存在")
    head = path.read_bytes()[:8]
    if head.startswith(b"%PDF"):
        return _parse_pdf(path)
    if head.startswith(b"PK\x03\x04"):
        # zip 容器：DOCX 或伪装格式
        try:
            return _parse_docx(path)
        except ParseError:
            raise ParseError("ZIP 容器不是受支持的 DOCX，按类型伪装处理")
    if head.startswith((b"\xff\xd8\xff", b"\x89PNG", b"GIF8")):
        return ParseResult(method="visual", unread_pages=1, error="图片文件：首版需 OCR，标记未读")
    suffix = path.suffix.lower()
    if suffix in {".txt", ".md", ".csv"}:
        return _parse_text(path)
    raise ParseError(f"不支持的文件类型: {suffix or '未知'}")
