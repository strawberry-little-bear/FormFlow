"""真实文件解析测试（G3：真实解析）。

样本由 scripts/make_samples.py 生成到 data/samples/（gitignore，可重复生成）。
覆盖方案第 16 节与 V05/V07/V11/V12：
- 正常 PDF 文字层提取；扫描件/图片 OCR；DOCX 段落+表格；
- 损坏/加密/类型伪装/旧版格式 → ParseError 或按真实类型判定；
- OCR 缺失绝不写成"未填写"（未读页 -> 语义 unknown 由上层保证）。
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.parsing import ParseError, ocr_available, parse_file  # noqa: E402

SAMPLES = Path(__file__).resolve().parent.parent / "data" / "samples"


@pytest.fixture(scope="module", autouse=True)
def _ensure_samples():
    if not (SAMPLES / "normal.pdf").exists():
        import scripts.make_samples as ms
        ms.main()


def _norm(s: str) -> str:
    return "".join((s or "").split())


def test_normal_pdf_text_layer():
    r = parse_file(SAMPLES / "normal.pdf")
    assert r.detected == "pdf"
    assert r.method == "text"
    assert r.ocr_pages == 0
    assert r.coverage_complete
    text = _norm(r.pages[0])
    for kw in ("张三", "期次", "团课", "收获"):
        assert kw in text


def test_scanned_pdf_ocr():
    r = parse_file(SAMPLES / "scanned.pdf")
    assert r.detected == "pdf"
    assert r.ocr_pages == 1            # 无文字层，经 OCR 读出
    assert r.unread_pages == 0
    assert r.coverage_complete
    assert "张三" in _norm(r.pages[0])


def test_photo_png_ocr():
    r = parse_file(SAMPLES / "photo.png")
    assert r.detected == "image"
    assert r.method == "ocr"
    assert r.coverage_complete
    assert "张三" in _norm(r.pages[0])


def test_docx_paragraphs_and_table():
    r = parse_file(SAMPLES / "report.docx")
    assert r.detected == "docx"
    assert r.coverage_complete
    text = _norm(r.pages[0])
    assert "张三" in text
    assert "期次" in text


def test_corrupt_pdf_raises_parse_error():
    with pytest.raises(ParseError):
        parse_file(SAMPLES / "corrupt.pdf")


def test_disguised_pdf_detected_as_docx():
    """类型伪装：.pdf 扩展名、DOCX 内容——按真实类型识别为 docx（V11）。"""
    r = parse_file(SAMPLES / "disguised.pdf")
    assert r.detected == "docx"


def test_legacy_doc_rejected():
    with pytest.raises(ParseError) as ei:
        parse_file(SAMPLES / "legacy.doc")
    assert "docx" in str(ei.value)


def test_ocr_engine_available():
    """OCR 引擎应可用（rapidocr-onnxruntime 已安装）。"""
    assert ocr_available()


def test_missing_file():
    with pytest.raises(ParseError):
        parse_file(SAMPLES / "not_exist.pdf")
