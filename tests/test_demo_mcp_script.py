from __future__ import annotations

from urllib.parse import parse_qs

from scripts import demo_mcp


def test_collection_progress_output_includes_eligibility_pending_for_both_modes(capsys):
    roster_counts = {
        "roster": 5,
        "exempt": 1,
        "required": 4,
        "submitted": 2,
        "unsubmitted": 2,
        "eligibility_pending": 1,
        "accepted": 1,
    }
    open_counts = {"registered": 3, "submitted": 2, "accepted": 1, "eligibility_pending": 2}

    roster_output = demo_mcp.format_collection_progress(roster_counts, "roster")
    open_output = demo_mcp.format_collection_progress(open_counts, "open")
    legacy_output = demo_mcp.format_collection_progress({"registered": 1}, "open")

    assert "资格待核 1" in roster_output
    assert "资格待核 2" in open_output
    assert "资格待核 0" in legacy_output


def test_demo_mcp_url_policy_only_allows_https_or_loopback_http():
    assert demo_mcp.validate_api_url("http://127.0.0.1:8000/") == "http://127.0.0.1:8000"
    assert demo_mcp.validate_api_url("https://formflow.example/") == "https://formflow.example"
    for url in ("http://formflow.example", "file:///tmp/api", "ftp://127.0.0.1"):
        try:
            demo_mcp.validate_api_url(url)
        except ValueError as exc:
            assert "HTTPS" in str(exc)
        else:
            raise AssertionError(f"unsafe API URL accepted: {url}")


def test_login_urlencodes_credentials_and_returns_only_token(monkeypatch):
    captured = {}

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return b'{"token":"session-secret"}'

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["body"] = parse_qs(request.data.decode("utf-8"))
        captured["timeout"] = timeout
        return Response()

    monkeypatch.setattr(demo_mcp, "urlopen", fake_urlopen)
    token = demo_mcp.login("http://127.0.0.1:8000", "组织者", "p&ss=word")
    assert token == "session-secret"
    assert captured == {
        "url": "http://127.0.0.1:8000/api/auth/login",
        "body": {"username": ["组织者"], "password": ["p&ss=word"]},
        "timeout": 10,
    }


def test_choose_task_id_selects_requested_task_from_multiple_tasks():
    tasks = [{"id": 4}, {"id": 9}]
    prompts = []

    selected = demo_mcp.choose_task_id(
        tasks,
        input_fn=lambda prompt: (prompts.append(prompt), "9")[1],
        output_fn=lambda _message: None,
    )

    assert selected == 9
    assert prompts == ["任务编号 [#4]: "]


def test_choose_task_id_accepts_explicit_task_without_prompt():
    prompts = []

    selected = demo_mcp.choose_task_id(
        [{"id": 4}, {"id": 9}],
        requested_id=9,
        input_fn=lambda prompt: prompts.append(prompt),
        output_fn=lambda _message: None,
    )

    assert selected == 9
    assert prompts == []


def test_choose_task_id_rejects_explicit_task_outside_organizer_scope():
    try:
        demo_mcp.choose_task_id([{"id": 4}], requested_id=9)
    except ValueError as exc:
        assert "任务 #9" in str(exc)
    else:
        raise AssertionError("out-of-scope task should fail clearly")


def test_choose_task_id_reprompts_on_invalid_and_unknown_ids():
    tasks = [{"id": 4}, {"id": 9}]
    answers = iter(("abc", "3", "9"))
    messages = []

    selected = demo_mcp.choose_task_id(
        tasks,
        input_fn=lambda _prompt: next(answers),
        output_fn=messages.append,
    )

    assert selected == 9
    assert messages.count("请输入列表中的数字任务编号。") == 1
    assert messages.count("这个任务不在当前账号的任务列表中，请重新选择。") == 1


def test_choose_task_id_defaults_to_first_task_on_enter():
    tasks = [{"id": 4}, {"id": 9}]

    selected = demo_mcp.choose_task_id(
        tasks,
        input_fn=lambda _prompt: "",
        output_fn=lambda _message: None,
    )

    assert selected == 4


def test_choose_task_id_skips_prompt_for_single_task():
    prompts = []

    selected = demo_mcp.choose_task_id(
        [{"id": 12}],
        input_fn=lambda prompt: prompts.append(prompt),
        output_fn=lambda _message: None,
    )

    assert selected == 12
    assert prompts == []


def test_choose_task_id_reports_empty_task_list():
    try:
        demo_mcp.choose_task_id([])
    except ValueError as exc:
        assert "没有可展示的任务" in str(exc)
    else:
        raise AssertionError("empty task list should fail clearly")
