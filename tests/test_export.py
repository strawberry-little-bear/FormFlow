"""交付快照与导出测试（第 11 节 / V17 / V23）。"""
from __future__ import annotations

import csv
import io
import json
import zipfile

import pytest

from app import storage
from app.models import Subject
from app.services import decisions as dec
from app.services import export as export_service
from app.services.checks import create_run, execute_run
from app.services.submissions import attach_file, formal_submit, get_or_create_draft
from tests.conftest import make_task, publish_blueprint
from app.schemas import Blueprint, FieldDef, SlotDef


def _setup(db):
    task = make_task(db)
    publish_blueprint(db, task, Blueprint(fields=[FieldDef(id="name", label="姓名")],
        slots=[SlotDef(id="report", label="报告")], rules=[]))
    s1 = Subject(task_id=task.id, kind="individual", display_name="张三")
    s2 = Subject(task_id=task.id, kind="individual", display_name="李四")
    db.add_all([s1, s2])
    db.flush()
    return task, s1, s2


def _formal_with_file(db, task, subject, key, content=b"%PDF-1.4 fake"):
    submission = get_or_create_draft(db, task, subject.id)
    fo = attach_file(db, submission, slot="report", original_name="报告.pdf",
                     content=content, sha256="", mime="application/pdf")
    rev = formal_submit(db, task, submission, fields={"name": subject.display_name},
                        slot_file_ids={"report": [fo.file_id]}, idempotency_key=key)
    run = create_run(db, task, rev)
    execute_run(db, run)  # 无规则蓝图 → 空结果集，run 成功
    return rev, fo


def test_snapshot_excludes_unaccepted(db_session, stub_llm):
    task, s1, s2 = _setup(db_session)
    _formal_with_file(db_session, task, s1, "k1")
    _formal_with_file(db_session, task, s2, "k2")
    dec.record_decision(db_session, task, s1, decision="accept_current", reason="验收通过")
    snap = export_service.create_snapshot(db_session, task, kind="formal")
    manifest = json.loads(snap.manifest_json)
    by_name = {e["name"]: e for e in manifest["entries"]}
    assert by_name["张三"]["included"] is True
    assert by_name["李四"]["included"] is False
    assert "未验收" in by_name["李四"]["excluded_reason"]
    assert manifest["totals"] == {"subjects": 2, "included": 1, "excluded": 1}


def test_snapshot_refuses_to_silently_omit_a_referenced_file_record(db_session, stub_llm):
    task, s1, _ = _setup(db_session)
    _, fo = _formal_with_file(db_session, task, s1, "missing-record")
    dec.record_decision(db_session, task, s1, decision="accept_current", reason="ok")
    db_session.delete(fo)
    db_session.flush()

    with pytest.raises(export_service.ExportIntegrityError, match=fo.file_id):
        export_service.create_snapshot(db_session, task, kind="formal")


@pytest.mark.parametrize("mutation", ["missing", "changed"])
def test_incomplete_snapshot_material_fails_export_without_download_paths(db_session, stub_llm, mutation):
    task, s1, _ = _setup(db_session)
    _, fo = _formal_with_file(db_session, task, s1, f"{mutation}-original")
    dec.record_decision(db_session, task, s1, decision="accept_current", reason="ok")
    snap = export_service.create_snapshot(db_session, task, kind="formal")
    source = storage.file_dir(fo.file_id) / f"original_{fo.safe_name}"
    if mutation == "missing":
        source.unlink()
    else:
        source.write_bytes(b"tampered bytes")

    job = export_service.run_export(db_session, snap)
    assert job.status == "failed"
    assert not job.csv_path and not job.zip_path
    assert fo.file_id in job.error
    assert "未生成交付文件" in job.error


def test_export_zip_and_csv_share_snapshot(db_session, stub_llm):
    task, s1, s2 = _setup(db_session)
    _formal_with_file(db_session, task, s1, "k1", content=b"%PDF-1.4 content-one")
    _formal_with_file(db_session, task, s2, "k2", content=b"%PDF-1.4 content-two")
    dec.record_decision(db_session, task, s1, decision="accept_current", reason="ok")
    snap = export_service.create_snapshot(db_session, task, kind="formal")
    job = export_service.run_export(db_session, snap)

    with zipfile.ZipFile(job.zip_path) as zf:
        names = zf.namelist()
        assert "manifest.json" in names and "original_names.json" in names
        arcs = [n for n in names if n.endswith(".pdf")]
        assert len(arcs) == 1  # 只有已验收的张三
        assert arcs[0].startswith(f"{s1.id:06d}_")  # 稳定 ID 前缀防同名覆盖
        mapping = json.loads(zf.read("original_names.json"))
        assert list(mapping.values())[0]["original_name"] == "报告.pdf"
        # 原件不改写
        assert zf.read(arcs[0]) == b"%PDF-1.4 content-one"

    csv_text = open(job.csv_path, "rb").read().decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(csv_text)))
    assert rows[0][0] == "主体ID"
    assert any("李四" in ",".join(r) for r in rows)


def test_csv_formula_injection_protected():
    """V23：CSV 字段以公式前缀开头必须转义。"""
    from app.services.export import _csv_safe

    assert _csv_safe("=1+1") == "'=1+1"
    assert _csv_safe("@SUM") == "'@SUM"
    assert _csv_safe("正常") == "正常"


def test_snapshot_is_fixed_after_new_submission(db_session, stub_llm):
    """生成期间有新提交：原快照不静默改变。"""
    task, s1, s2 = _setup(db_session)
    _formal_with_file(db_session, task, s1, "k1")
    dec.record_decision(db_session, task, s1, decision="accept_current", reason="ok")
    snap = export_service.create_snapshot(db_session, task, kind="formal")
    before = json.loads(snap.manifest_json)["totals"]["included"]
    _formal_with_file(db_session, task, s2, "k2")  # 快照后新提交
    after = json.loads(export_service.create_snapshot(db_session, task, kind="formal").manifest_json)
    assert before == 1
    assert after["totals"]["included"] == 1  # 新提交未验收，仍排除
    # 重跑同一快照的导出仍读同一快照
    entries = json.loads(snap.manifest_json)["entries"]
    job2 = export_service.run_export(db_session, snap)
    csv_text = open(job2.csv_path, "rb").read().decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(csv_text)))
    assert len(rows) == len(entries) + 1  # 表头 + 快照内主体数，不随后续提交变化
    li_row = next(r for r in rows[1:] if "李四" in ",".join(r))
    assert "无正式提交版本" in ",".join(li_row)  # 快照后的新提交没有静默改写原包


def test_reopened_v2_excluded_from_new_package(db_session, stub_llm):
    """V17：v1 已验收 → 重开 → v2 正式提交 → 新包默认排除，不回退 v1。"""
    task, s1, s2 = _setup(db_session)
    rev1, _ = _formal_with_file(db_session, task, s1, "k1")
    dec.record_decision(db_session, task, s1, decision="accept_current", reason="v1 验收")
    snap1 = json.loads(export_service.create_snapshot(db_session, task, kind="formal").manifest_json)
    assert snap1["entries"][0]["included"] is True

    rev2, _ = _formal_with_file(db_session, task, s1, "k2")
    assert rev2.version == 2
    snap2 = json.loads(export_service.create_snapshot(db_session, task, kind="formal").manifest_json)
    assert snap2["entries"][0]["included"] is False  # v2 未验收，不回退引用 v1
