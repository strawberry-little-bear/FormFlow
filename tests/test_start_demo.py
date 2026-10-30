from __future__ import annotations

import json
import sqlite3
import subprocess
from contextlib import closing
from unittest.mock import patch

from scripts import start_demo


def test_check_status_is_read_only(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(start_demo, "DEMO_DIR", tmp_path / "demo")
    monkeypatch.setattr(start_demo, "DEMO_DB", tmp_path / "demo" / "formflow.db")
    monkeypatch.setattr(start_demo, "PID_FILE", tmp_path / "demo" / "services.json")
    monkeypatch.setattr(start_demo, "LOG_DIR", tmp_path / "demo" / "logs")
    monkeypatch.setattr(start_demo, "check_deps", lambda: True)
    monkeypatch.setattr(start_demo, "api_health_status", lambda: ("未监听", False))

    assert not start_demo.check_status()
    assert not (tmp_path / "demo").exists()
    output = capsys.readouterr().out
    assert "尚未初始化" in output
    assert "API 健康检查：未监听 (127.0.0.1:8000/api/health)" in output
    assert "无启动器进程登记" in output
    assert "演示就绪：否" in output


def test_check_status_reports_api_and_registered_process_health(tmp_path, monkeypatch, capsys):
    demo_dir = tmp_path / "demo"
    demo_dir.mkdir()
    pid_file = demo_dir / "services.json"
    pid_file.write_text(json.dumps({"api": 42, "worker": 43}), encoding="utf-8")
    monkeypatch.setattr(start_demo, "DEMO_DIR", demo_dir)
    monkeypatch.setattr(start_demo, "DEMO_DB", demo_dir / "formflow.db")
    monkeypatch.setattr(start_demo, "PID_FILE", pid_file)
    monkeypatch.setattr(start_demo, "LOG_DIR", demo_dir / "logs")
    monkeypatch.setattr(start_demo, "check_deps", lambda: True)
    monkeypatch.setattr(start_demo, "api_health_status", lambda: ("HTTP 200 · FormFlow 合同 v1", True))
    monkeypatch.setattr(start_demo.sys, "platform", "linux")

    def pid_running(pid, sig):
        if pid == 43:
            raise ProcessLookupError
        return None

    monkeypatch.setattr(start_demo.os, "kill", pid_running)

    assert not start_demo.check_status()
    output = capsys.readouterr().out
    assert "API 健康检查：HTTP 200 · FormFlow 合同 v1 (127.0.0.1:8000/api/health)" in output
    assert "api PID 42 运行中" in output
    assert "worker PID 43 已退出" in output


def test_check_status_requires_all_showcase_components(tmp_path, monkeypatch, capsys):
    demo_dir = tmp_path / "demo"
    demo_dir.mkdir()
    monkeypatch.setattr(start_demo, "DEMO_DIR", demo_dir)
    monkeypatch.setattr(start_demo, "DEMO_DB", demo_dir / "formflow.db")
    monkeypatch.setattr(start_demo, "PID_FILE", demo_dir / "services.json")
    monkeypatch.setattr(start_demo, "LOG_DIR", demo_dir / "logs")
    monkeypatch.setattr(start_demo, "check_deps", lambda: True)
    monkeypatch.setattr(start_demo, "demo_database_status", lambda: ("已就绪", True))
    monkeypatch.setattr(start_demo, "api_health_status", lambda: ("HTTP 200 · FormFlow 合同 v1", True))
    monkeypatch.setattr(start_demo, "worker_health_status", lambda: ("Worker PID 42 运行中 · ready", True))
    monkeypatch.setattr(start_demo, "agent_runtime_status", lambda: ("合同 v1 · Skill 已加载 · 工具 4 项", True))
    monkeypatch.setattr(start_demo, "mcp_bridge_status", lambda: ("stdio 只读桥可加载 · 4 项工具", True))
    monkeypatch.setattr(start_demo, "registered_process_status", lambda: "api PID 41 运行中；worker PID 42 运行中")

    assert start_demo.check_status()
    output = capsys.readouterr().out
    assert "演示就绪：是" in output
    assert "Agent runtime：合同 v1" in output
    assert "MCP 只读桥：stdio 只读桥可加载" in output


def test_process_is_running_checks_windows_tasklist(monkeypatch):
    monkeypatch.setattr(start_demo.sys, "platform", "win32")

    def tasklist(command, **kwargs):
        pid = command[2].split("eq ", 1)[1]
        output = (
            '"python.exe","1234","Console","1","51,040 K"\n'
            if pid == "1234" else "INFO: No tasks are running...\n"
        )
        return subprocess.CompletedProcess(args=command, returncode=0, stdout=output, stderr="")

    monkeypatch.setattr(start_demo.subprocess, "run", tasklist)

    assert start_demo.process_is_running(1234)
    assert not start_demo.process_is_running(4321)


def test_process_is_running_accepts_windows_codepage_bytes(monkeypatch):
    monkeypatch.setattr(start_demo.sys, "platform", "win32")
 
    def tasklist(command, **kwargs):
        pid = command[2].split("eq ", 1)[1]
        output = b'"python.exe","1234","Console","1","51,040 K"\r\n'
        if pid != "1234":
            # The fixture represents bytes returned by a Windows command. The
            # text is ASCII, so avoid Python's Windows-only ``mbcs`` codec and
            # keep this test runnable on the Ubuntu CI worker too.
            output = b"INFO: No tasks are running...\r\n"
        return subprocess.CompletedProcess(args=command, returncode=0, stdout=output, stderr=b"")

    monkeypatch.setattr(start_demo.subprocess, "run", tasklist)

    assert start_demo.process_is_running(1234)
    assert not start_demo.process_is_running(4321)


def test_api_health_status_requires_http_200(monkeypatch):
    monkeypatch.setattr(start_demo, "api_listener_status", lambda: True)

    class Response:
        status = 200

        def read(self):
            return b'{"status":"ok","service":"formflow","agent_runtime_contract_version":1}'

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    monkeypatch.setattr(start_demo.urllib.request, "urlopen", lambda *args, **kwargs: Response())
    assert start_demo.api_health_status() == ("HTTP 200 · FormFlow 合同 v1", True)

    def unavailable(*_args, **_kwargs):
        raise start_demo.urllib.error.HTTPError("http://127.0.0.1/api/health", 503, "Unavailable", {}, None)

    monkeypatch.setattr(start_demo.urllib.request, "urlopen", unavailable)
    assert start_demo.api_health_status() == ("HTTP 503", False)


def test_api_health_status_rejects_old_or_unrelated_service(monkeypatch):
    monkeypatch.setattr(start_demo, "api_listener_status", lambda: True)

    class Response:
        status = 200

        def __init__(self, body):
            self.body = body

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return self.body

    monkeypatch.setattr(start_demo.urllib.request, "urlopen", lambda *_a, **_k: Response(
        b'{"status":"ok","service":"formflow"}'))
    assert "合同不匹配" in start_demo.api_health_status()[0]
    assert not start_demo.api_health_status()[1]

    monkeypatch.setattr(start_demo.urllib.request, "urlopen", lambda *_a, **_k: Response(
        b'{"status":"ok","service":"other"}'))
    assert start_demo.api_health_status() == ("端口被其他服务占用", False)


def test_api_health_status_explains_missing_versioned_endpoint(monkeypatch):
    monkeypatch.setattr(start_demo, "api_listener_status", lambda: True)

    def not_found(*_args, **_kwargs):
        raise start_demo.urllib.error.HTTPError(
            "http://127.0.0.1/api/health", 404, "Not Found", {}, None)

    monkeypatch.setattr(start_demo.urllib.request, "urlopen", not_found)
    message, healthy = start_demo.api_health_status()
    assert "不是本版演示 API" in message
    assert not healthy


def test_start_api_binds_to_selected_port(tmp_path, monkeypatch):
    class RunningProcess:
        pid = 123

        def poll(self):
            return None

    process = RunningProcess()
    commands = []
    monkeypatch.setattr(start_demo, "API_PORT", 8010)
    monkeypatch.setattr(start_demo, "LOG_DIR", tmp_path)
    monkeypatch.setattr(start_demo, "_start_process", lambda name, command: commands.append(command) or process)
    monkeypatch.setattr(start_demo, "api_health_status", lambda: ("HTTP 200", True))

    assert start_demo.start_api_bg() is process
    assert commands[0][-2:] == ["--port", "8010"]


def test_valid_port_accepts_available_range_and_rejects_invalid_values():
    assert start_demo.valid_port("8010") == 8010
    for value in ("0", "65536", "port"):
        try:
            start_demo.valid_port(value)
        except start_demo.argparse.ArgumentTypeError:
            pass
        else:
            raise AssertionError(f"expected invalid port to be rejected: {value}")


def test_main_uses_requested_port_for_startup_and_url(monkeypatch, capsys):
    class RunningProcess:
        def __init__(self):
            self.terminated = False
            self.interrupted = False

        def wait(self, timeout=None):
            if not self.interrupted:
                self.interrupted = True
                raise KeyboardInterrupt
            return 0

        def poll(self):
            return None

        def terminate(self):
            self.terminated = True

    api_process = RunningProcess()
    api_process.pid = 101
    worker_process = RunningProcess()
    worker_process.pid = 102
    worker_process.interrupted = True
    monkeypatch.setattr(start_demo.sys, "argv", ["start_demo.py", "--port", "8010"])
    monkeypatch.setattr(start_demo, "API_PORT", 8000)
    monkeypatch.setattr(start_demo, "check_deps", lambda: True)
    checked_ports = []
    monkeypatch.setattr(start_demo, "port_available", lambda port: checked_ports.append(port) or port == 8010)
    monkeypatch.setattr(start_demo, "prepare_demo_data", lambda reset=False: False)
    monkeypatch.setattr(start_demo, "start_api_bg", lambda: api_process)
    monkeypatch.setattr(start_demo, "start_worker_bg", lambda: worker_process)
    monkeypatch.setattr(start_demo, "write_processes", lambda _processes: None)
    monkeypatch.setattr(start_demo, "PID_FILE", start_demo.Path("unused-services.json"))
    monkeypatch.setattr(start_demo.Path, "unlink", lambda *_args, **_kwargs: None)

    assert start_demo.main() == 0
    assert checked_ports == [8010]
    output = capsys.readouterr().out
    assert "访问地址: http://127.0.0.1:8010/" in output
    assert api_process.terminated and worker_process.terminated

def test_check_status_validates_demo_seed_without_writing(tmp_path, monkeypatch, capsys):
    demo_dir = tmp_path / "demo"
    demo_dir.mkdir()
    db_file = demo_dir / "formflow.db"
    with closing(sqlite3.connect(db_file)) as db:
        db.executescript("""
            CREATE TABLE accounts (username TEXT);
            CREATE TABLE tasks (id INTEGER);
            CREATE TABLE subjects (id INTEGER);
            INSERT INTO accounts VALUES ('demo');
            INSERT INTO tasks VALUES (1);
            INSERT INTO subjects VALUES (1);
        """)
    before = (db_file.read_bytes(), db_file.stat().st_mtime_ns)
    monkeypatch.setattr(start_demo, "DEMO_DIR", demo_dir)
    monkeypatch.setattr(start_demo, "DEMO_DB", db_file)
    monkeypatch.setattr(start_demo, "SEED_MARKER", demo_dir / "seeded.json")
    monkeypatch.setattr(start_demo, "PID_FILE", demo_dir / "services.json")
    monkeypatch.setattr(start_demo, "LOG_DIR", demo_dir / "logs")
    monkeypatch.setattr(start_demo, "check_deps", lambda: True)
    monkeypatch.setattr(start_demo, "api_health_status", lambda: ("未监听", False))

    assert not start_demo.check_status()
    assert "完整性与演示种子正常" in capsys.readouterr().out
    assert (db_file.read_bytes(), db_file.stat().st_mtime_ns) == before


def test_check_status_rejects_incomplete_demo_seed(tmp_path, monkeypatch, capsys):
    demo_dir = tmp_path / "demo"
    demo_dir.mkdir()
    db_file = demo_dir / "formflow.db"
    with closing(sqlite3.connect(db_file)) as db:
        db.executescript("""
            CREATE TABLE accounts (username TEXT);
            CREATE TABLE tasks (id INTEGER);
            CREATE TABLE subjects (id INTEGER);
            INSERT INTO tasks VALUES (1);
            INSERT INTO subjects VALUES (1);
        """)
    monkeypatch.setattr(start_demo, "DEMO_DIR", demo_dir)
    monkeypatch.setattr(start_demo, "DEMO_DB", db_file)
    monkeypatch.setattr(start_demo, "SEED_MARKER", demo_dir / "seeded.json")
    monkeypatch.setattr(start_demo, "PID_FILE", demo_dir / "services.json")
    monkeypatch.setattr(start_demo, "LOG_DIR", demo_dir / "logs")
    monkeypatch.setattr(start_demo, "check_deps", lambda: True)

    assert not start_demo.check_status()
    assert "演示账号、任务或主体种子不完整" in capsys.readouterr().out


def test_check_status_reports_corrupt_database(tmp_path, monkeypatch, capsys):
    demo_dir = tmp_path / "demo"
    demo_dir.mkdir()
    db_file = demo_dir / "formflow.db"
    db_file.write_bytes(b"not a sqlite database")
    monkeypatch.setattr(start_demo, "DEMO_DIR", demo_dir)
    monkeypatch.setattr(start_demo, "DEMO_DB", db_file)
    monkeypatch.setattr(start_demo, "SEED_MARKER", demo_dir / "seeded.json")
    monkeypatch.setattr(start_demo, "PID_FILE", demo_dir / "services.json")
    monkeypatch.setattr(start_demo, "LOG_DIR", demo_dir / "logs")
    monkeypatch.setattr(start_demo, "check_deps", lambda: True)

    assert not start_demo.check_status()
    assert "无法只读打开或检查" in capsys.readouterr().out


def test_install_deps_uses_hashed_lockfile(monkeypatch):
    calls = []
    monkeypatch.setattr(start_demo, "run", lambda cmd, **kwargs: (
        calls.append(cmd) or subprocess.CompletedProcess(args=cmd, returncode=0)
    ))
    monkeypatch.setattr(start_demo, "check_deps", lambda: True)

    assert start_demo.install_deps()
    assert calls == [[
        start_demo.sys.executable, "-m", "pip", "install", "-q",
        "--require-hashes", "-r", "requirements.lock",
    ]]


def test_seed_failure_prints_output_and_returns_false(monkeypatch, capsys):
    monkeypatch.setattr(start_demo, "run", lambda *a, **k: subprocess.CompletedProcess(
        args=a[0], returncode=2, stdout="seed trace", stderr="seed error"))

    assert not start_demo.seed_demo()
    output = capsys.readouterr()
    assert "seed trace" in output.out
    assert "seed error" in output.err
    assert "退出码 2" in output.out


def test_stop_demo_only_targets_recorded_demo_pids(tmp_path, monkeypatch, capsys):
    pid_file = tmp_path / "services.json"
    pid_file.write_text(json.dumps({"api": 123, "worker": 456, "other": 789}), encoding="utf-8")
    monkeypatch.setattr(start_demo, "PID_FILE", pid_file)
    monkeypatch.setattr(start_demo.sys, "platform", "linux")
    monkeypatch.setattr(start_demo, "process_is_running", lambda pid: True)
    with patch.object(start_demo.os, "kill") as kill:
        start_demo.stop_demo()

    assert [call.args for call in kill.call_args_list] == [
        (123, start_demo.signal.SIGTERM), (456, start_demo.signal.SIGTERM)]
    assert not pid_file.exists()
    assert capsys.readouterr().out.strip() == "演示进程状态：API 已停止；Worker 已停止"


def test_stop_demo_reports_already_exited_processes(tmp_path, monkeypatch, capsys):
    pid_file = tmp_path / "services.json"
    pid_file.write_text(json.dumps({"api": 123, "worker": 456}), encoding="utf-8")
    monkeypatch.setattr(start_demo, "PID_FILE", pid_file)
    monkeypatch.setattr(start_demo.sys, "platform", "linux")
    monkeypatch.setattr(start_demo, "process_is_running", lambda pid: pid == 456)
    with patch.object(start_demo.os, "kill") as kill:
        start_demo.stop_demo()

    assert [call.args for call in kill.call_args_list] == [(456, start_demo.signal.SIGTERM)]
    assert capsys.readouterr().out.strip() == "演示进程状态：API 已退出；Worker 已停止"


def test_reset_demo_data_is_limited_to_demo_directory(tmp_path, monkeypatch):
    root = tmp_path / "project"
    demo_dir = root / "data" / "demo"
    (demo_dir / "storage" / "nested").mkdir(parents=True)
    (demo_dir / "logs").mkdir()
    (demo_dir / "storage" / "nested" / "file.txt").write_text("demo", encoding="utf-8")
    (demo_dir / "formflow.db").write_text("db", encoding="utf-8")
    (demo_dir / "services.json").write_text("{}", encoding="utf-8")
    (demo_dir / "seeded.json").write_text("initialized", encoding="utf-8")
    keep = root / "data" / "keep.txt"
    keep.parent.mkdir(parents=True, exist_ok=True)
    keep.write_text("keep", encoding="utf-8")

    monkeypatch.setattr(start_demo, "ROOT", root)
    monkeypatch.setattr(start_demo, "DEMO_DIR", demo_dir)
    monkeypatch.setattr(start_demo, "DEMO_DB", demo_dir / "formflow.db")
    monkeypatch.setattr(start_demo, "DEMO_STORAGE", demo_dir / "storage")
    monkeypatch.setattr(start_demo, "LOG_DIR", demo_dir / "logs")
    monkeypatch.setattr(start_demo, "PID_FILE", demo_dir / "services.json")
    monkeypatch.setattr(start_demo, "SEED_MARKER", demo_dir / "seeded.json")

    start_demo.reset_demo_data()
    assert not (demo_dir / "formflow.db").exists()
    assert not (demo_dir / "storage").exists()
    assert not (demo_dir / "logs").exists()
    assert keep.read_text(encoding="utf-8") == "keep"


def test_prepare_demo_data_preserves_existing_database(tmp_path, monkeypatch):
    demo_dir = tmp_path / "demo"
    demo_dir.mkdir()
    db_file = demo_dir / "formflow.db"
    db_file.write_bytes(b"existing")
    monkeypatch.setattr(start_demo, "DEMO_DIR", demo_dir)
    monkeypatch.setattr(start_demo, "DEMO_DB", db_file)
    monkeypatch.setattr(start_demo, "DEMO_STORAGE", demo_dir / "storage")
    monkeypatch.setattr(start_demo, "SEED_MARKER", demo_dir / "seeded.json")
    monkeypatch.setattr(start_demo, "seed_demo", lambda: (_ for _ in ()).throw(AssertionError("seeded")))

    assert not start_demo.prepare_demo_data()
    assert db_file.read_bytes() == b"existing"
    assert (demo_dir / "storage").is_dir()


def test_prepare_demo_data_retries_interrupted_seed(tmp_path, monkeypatch):
    demo_dir = tmp_path / "demo"
    demo_dir.mkdir()
    db_file = demo_dir / "formflow.db"
    db_file.write_bytes(b"partial")
    marker = demo_dir / "seeded.json"
    marker.write_text("pending\n", encoding="utf-8")
    monkeypatch.setattr(start_demo, "DEMO_DIR", demo_dir)
    monkeypatch.setattr(start_demo, "DEMO_DB", db_file)
    monkeypatch.setattr(start_demo, "DEMO_STORAGE", demo_dir / "storage")
    monkeypatch.setattr(start_demo, "SEED_MARKER", marker)
    monkeypatch.setattr(start_demo, "seed_demo", lambda: True)

    assert start_demo.prepare_demo_data()
    assert marker.read_text(encoding="utf-8") == "initialized\n"


def test_prepare_demo_data_reports_seed_failure(tmp_path, monkeypatch):
    demo_dir = tmp_path / "demo"
    monkeypatch.setattr(start_demo, "DEMO_DIR", demo_dir)
    monkeypatch.setattr(start_demo, "DEMO_DB", demo_dir / "formflow.db")
    monkeypatch.setattr(start_demo, "DEMO_STORAGE", demo_dir / "storage")
    monkeypatch.setattr(start_demo, "SEED_MARKER", demo_dir / "seeded.json")
    monkeypatch.setattr(start_demo, "seed_demo", lambda: False)

    assert start_demo.prepare_demo_data() is None
    assert (demo_dir / "seeded.json").read_text(encoding="utf-8") == "pending\n"


def test_start_worker_waits_for_fresh_ready_marker(tmp_path, monkeypatch, capsys):
    log_dir = tmp_path / "logs"
    log_dir.mkdir()
    log_path = log_dir / "worker.log"
    log_path.write_bytes(b"[worker] ready\n")

    class RunningProcess:
        def poll(self):
            return None

    process = RunningProcess()

    def start(name, command):
        assert command[1:4] == ["-u", "-m", "app.worker"]
        with log_path.open("ab") as log:
            log.write(b"[worker] ready\n")
        return process

    monkeypatch.setattr(start_demo, "LOG_DIR", log_dir)
    monkeypatch.setattr(start_demo, "_start_process", start)

    assert start_demo.start_worker_bg(timeout=1) is process
    assert "Worker 已就绪" in capsys.readouterr().out


def test_start_worker_times_out_and_stops_process(tmp_path, monkeypatch, capsys):
    class RunningProcess:
        stopped = False

        def poll(self):
            return None

        def terminate(self):
            self.stopped = True

        def wait(self, timeout):
            return 0

    process = RunningProcess()
    clock = iter([0.0, 0.5, 1.0, 1.5, 2.0])
    monkeypatch.setattr(start_demo, "LOG_DIR", tmp_path / "logs")
    monkeypatch.setattr(start_demo, "_start_process", lambda *args: process)
    monkeypatch.setattr(start_demo.time, "monotonic", lambda: next(clock))
    monkeypatch.setattr(start_demo.time, "sleep", lambda _: None)

    assert start_demo.start_worker_bg(timeout=1.5) is None
    assert process.stopped
    assert "就绪超时" in capsys.readouterr().out


def test_start_worker_reports_early_exit(tmp_path, monkeypatch, capsys):
    class ExitedProcess:
        def poll(self):
            return 2

    monkeypatch.setattr(start_demo, "LOG_DIR", tmp_path / "logs")
    monkeypatch.setattr(start_demo, "_start_process", lambda *args: ExitedProcess())

    assert start_demo.start_worker_bg(timeout=1) is None
    assert "Worker 启动失败" in capsys.readouterr().out
