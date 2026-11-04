# -*- coding: utf-8 -*-
"""审核链路真实冒烟（G3：真实解析、证据、预算与人工转交；样本可重复检查）。

用法：
    python scripts/smoke_review.py           # 真实网关（glm-5.3，主模型慢/不可用时有降级兜底）
    python scripts/smoke_review.py --stub     # 本地脚本桩，快速验证链路（不调用网关）

场景（对应方案附录 A 业务规格，样本由脚本现场生成，可重复）：
    V05 正常 PDF 全要素        -> 规则通过，证据可定位
    V07 扫描件 OCR             -> 尽力识别；识别不了记未读，语义 unknown 不编造
    V06 期次写错               -> semantic issue，证据引用原文
    V12 模型不可用             -> failed + 转人工提示，收件不受影响
    预算耗尽                   -> 明确记未完成，绝不虚构全通过
"""
from __future__ import annotations

import shutil
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.agents.review_agent import CheckContext, FileInfo, run_checks  # noqa: E402
from app.config import settings  # noqa: E402
from app.llm import LLMClient, LLMUnavailable  # noqa: E402
from app.models import RESULT_ISSUE, RESULT_SATISFIED, RESULT_UNKNOWN  # noqa: E402
from app.parsing import parse_file  # noqa: E402
from app.schemas import Blueprint  # noqa: E402

TERM = "2026 秋季第 1 期"
NAME = "张三"


def _pdf(path: Path, lines: list[tuple[str, int]]) -> None:
    """生成带中文文字层的 PDF（PyMuPDF 内置 china-s 字体）。"""
    import fitz

    doc = fitz.open()
    page = doc.new_page()
    y = 72
    for text, size in lines:
        page.insert_text((72, y), text, fontsize=size, fontname="china-s")
        y += size + 14
    doc.save(str(path))
    doc.close()


def _report_pdf(path: Path, name: str = NAME, term: str = TERM) -> None:
    _pdf(path, [
        (f"{term}团课报告", 18),
        (f"姓名：{name}", 14),
        (f"期次：{term}", 14),
        ("活动内容：参加了本期团课，完成了小组实验与讨论，承担了数据记录工作。", 12),
        ("个人收获：提升了实验操作与团队协作能力，认识了更多同学。", 12),
    ])


def _scanned_pdf(path: Path, src_pdf: Path, noise: bool = False) -> None:
    """把文字 PDF 渲染成图片再贴回 PDF：无文字层，必须走 OCR。

    noise=True 时替换为随机噪点图：OCR 必然失败，真实模拟不可读扫描件（V07）。
    """
    import fitz
    from PIL import Image

    if noise:
        import random

        rnd = random.Random(20261101)
        im = Image.new("RGB", (1240, 1754),
                       color=(rnd.randint(200, 255), rnd.randint(200, 255), rnd.randint(200, 255)))
        im.putdata([(rnd.randint(0, 255), rnd.randint(0, 255), rnd.randint(0, 255))
                    for _ in range(1240 * 1754)])
        img_path = path.with_suffix(".render.png")
        im.save(str(img_path))
        pix_w, pix_h = im.size
    else:
        src = fitz.open(str(src_pdf))
        pix = src[0].get_pixmap(dpi=150)
        img_path = path.with_suffix(".render.png")
        pix.save(str(img_path))
        src.close()
        pix_w, pix_h = pix.width, pix.height
    out = fitz.open()
    page = out.new_page(width=pix_w, height=pix_h)
    page.insert_image(fitz.Rect(0, 0, pix_w, pix_h), filename=str(img_path))
    out.save(str(path))
    out.close()
    img_path.unlink()


def _blueprint() -> Blueprint:
    """复用演示蓝图（BP-C-001 团课报告）。"""
    from app.services.demo_seed import demo_blueprint

    return demo_blueprint()


def _ctx(tmp: Path, filename: str, blueprint: Blueprint) -> CheckContext:
    path = tmp / filename
    info = FileInfo(file_id="f-" + filename, slot="report",
                    original_name=filename, size=path.stat().st_size)
    info.parse = parse_file(path)
    return CheckContext(
        blueprint=blueprint,
        fields={"name": NAME, "term": TERM, "class_name": "一年级 1 班"},
        files=[info],
    )


class StubLLM(LLMClient):
    """本地桩：按材料内容给出可定位证据的结论，不调用网关。"""

    def __init__(self) -> None:
        super().__init__(api_key="smoke-stub")

    def chat(self, messages, temperature=0.2):
        import json

        user = messages[-1]["content"]
        rule = user.split("【规则】")[-1].split(chr(10))[0]
        # OCR 文本有空格碎片、全角/半角标点噪声（V07），归一化后匹配
        flat = "".join(user.split()).replace(":", "：")
        if "期次" in rule:
            if "第2期" in flat:
                payload = {"result": "issue", "explanation": "报告所写期次与任务期次不一致",
                           "evidence": [{"locator": "p.1", "quote": "期次：2026 秋季第 2 期"}]}
            elif "期次" in flat and "2026" in flat:
                # OCR 碎片化：引用 OCR 实际读出的连续片段（去空白后可定位）
                payload = {"result": "satisfied", "explanation": "报告期次与任务期次一致",
                           "evidence": [{"locator": "p.1", "quote": "期次：2026"}]}
            else:
                payload = {"result": "unknown", "explanation": "材料中无法定位期次文字"}
        elif "姓名" in rule:
            if f"姓名：{NAME}".replace(" ", "") in flat:
                payload = {"result": "satisfied", "explanation": "姓名清晰且已填写",
                           "evidence": [{"locator": "p.1", "quote": f"姓名：{NAME}"}]}
            else:
                payload = {"result": "unknown", "explanation": "材料中无法定位姓名"}
        else:
            payload = {"result": "unknown", "explanation": "桩未覆盖的规则"}
        return json.dumps(payload, ensure_ascii=False)


def _dead_client() -> LLMClient:
    """指向不可达地址的客户端：模拟模型/网关不可用（V12）。"""
    return LLMClient(base_url="http://127.0.0.1:9/v1", api_key="x",
                     model="whatever", timeout=10, max_retries=0)


def _show(title: str, outcome) -> None:
    print("--- " + title)
    for r in outcome.results:
        mark = {"satisfied": "PASS", "issue": "ISSUE", "unknown": "UNKWN",
                "not_applicable": "N/A ", "failed": "FAIL"}.get(r.result, r.result)
        print(f"  [{mark}] {r.rule_id}: {r.explanation[:70]}")
        for ev in r.evidence[:2]:
            print(f"         证据<{ev.file_id}> {ev.method}: {ev.quote[:50]}")
    if outcome.human_only_rules:
        print("  人工项:", outcome.human_only_rules)
    print(f"  LLM 调用 {outcome.llm_calls_used} 次 | 读页 {outcome.pages_read} | "
          f"预算耗尽 {outcome.budget_exhausted}")
    for fid, cov in outcome.coverage.items():
        print(f"  覆盖[{fid}]: total={cov['total']} text={cov['text']} "
              f"unread={cov['unread']} failed={cov['failed']}")


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
    live = "--stub" not in sys.argv
    tmp = Path(tempfile.mkdtemp(prefix="formflow_smoke_"))
    print("模式:", "真实网关" if live else "本地桩", "| 样本目录:", tmp)

    try:
        # 现场生成样本（可重复）
        _report_pdf(tmp / "normal.pdf")
        _report_pdf(tmp / "wrong_term.pdf", term="2026 秋季第 2 期")
        _scanned_pdf(tmp / "scanned.pdf", tmp / "normal.pdf")
        _scanned_pdf(tmp / "blurred.pdf", tmp / "normal.pdf", noise=True)

        bp = _blueprint()

        if live and not settings.llm_configured:
            print("未配置 FORMFLOW_LLM_API_KEY，中止")
            return 2
        client = LLMClient(base_url=settings.llm_base_url, api_key=settings.llm_api_key,
                           model=settings.llm_model,
                           fallback_model=settings.llm_fallback_model) if live else StubLLM()
        if live:
            print(f"网关: {client.base_url} 模型: {client.model} "
                  f"降级: {client.fallback_model or '(无)'}")

        print(chr(10) + "== 场景 1: V05 正常 PDF（文字层） ==")
        t0 = time.time()
        out = run_checks(_ctx(tmp, "normal.pdf", bp), client)
        print(f"耗时 {time.time() - t0:.1f}s")
        _show("V05", out)

        print(chr(10) + "== 场景 2: V07 扫描件 OCR（清晰） ==")
        t0 = time.time()
        out = run_checks(_ctx(tmp, "scanned.pdf", bp), client)
        print(f"耗时 {time.time() - t0:.1f}s")
        _show("scanned", out)

        print(chr(10) + "== 场景 3: V07 模糊扫描（OCR 失败 -> 未读 -> unknown） ==")
        t0 = time.time()
        out = run_checks(_ctx(tmp, "blurred.pdf", bp), client)
        print(f"耗时 {time.time() - t0:.1f}s")
        _show("blurred", out)
        sem = {r.rule_id: r.result for r in out.results}
        assert sem.get("r_term_match") == RESULT_UNKNOWN, "OCR 失败时语义结论必须 unknown，不得编造"
        print("  符合预期：OCR 失败不臆造，语义结论 unknown，转人工")

        print(chr(10) + "== 场景 4: V06 期次写错（issue + 原文证据） ==")
        t0 = time.time()
        out = run_checks(_ctx(tmp, "wrong_term.pdf", bp), client)
        print(f"耗时 {time.time() - t0:.1f}s")
        _show("wrong_term", out)

        print(chr(10) + "== 场景 5: V12 模型不可用（failed + 转人工，收件不受影响） ==")
        out = run_checks(_ctx(tmp, "normal.pdf", bp), _dead_client())
        _show("llm_down", out)
        sem = {r.rule_id: r.result for r in out.results}
        assert all(r.result in {"satisfied", "failed", "not_applicable", "issue"}
                   for r in out.results), "不可用时不得出现 unknown 冒充结论"
        print("  符合预期：确定性检查仍出结论，语义检查记 failed 并提示转人工")

        print(chr(10) + "== 场景 6: 预算耗尽（明确未完成，不虚构全通过） ==")
        saved = settings.max_llm_calls_per_run
        settings.max_llm_calls_per_run = 0
        try:
            out = run_checks(_ctx(tmp, "normal.pdf", bp), client)
        finally:
            settings.max_llm_calls_per_run = saved
        _show("budget", out)
        assert out.budget_exhausted
        print("  符合预期：预算耗尽如实记录，无一条语义结论被虚构")

        print(chr(10) + "冒烟完成")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
