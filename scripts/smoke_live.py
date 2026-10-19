# -*- coding: utf-8 -*-
"""线上连通性冒烟：登录演示账号 → 对指定主体发起检查 → 轮询到终态。

验证外部 LLM 网关与整条检查链路在真实环境下可用（不走 pytest 桩）。
前提：API 与 worker 已在运行，且已执行 scripts/seed_demo.py。
用法：python scripts/smoke_live.py [task_id] [subject_id]
"""
import json
import sys
import time
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")
BASE = "http://127.0.0.1:8000"


def call(method, path, token=None, data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(BASE + path, data=body, method=method)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    if body:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


form = "username=demo&password=demo1234".encode()
req = urllib.request.Request(BASE + "/api/auth/login", data=form, method="POST")
req.add_header("Content-Type", "application/x-www-form-urlencoded")
with urllib.request.urlopen(req, timeout=30) as r:
    tok = json.loads(r.read().decode("utf-8"))["token"]

import sys as _sys
TASK = int(_sys.argv[1]) if len(_sys.argv) > 1 else 1
SUBJ = int(_sys.argv[2]) if len(_sys.argv) > 2 else 2
print(f"冒烟目标：task={TASK} subject={SUBJ}")

st, r = call("POST", f"/api/tasks/{TASK}/subjects/{SUBJ}/checks", tok)
print("发起审核:", st, json.dumps(r, ensure_ascii=False)[:200])
run_id = r.get("run_id") or r.get("id")

for i in range(24):
    time.sleep(5)
    st, f = call("GET", f"/api/tasks/{TASK}/subjects/{SUBJ}/findings", tok)
    run = f.get("run") or {}
    print(f"  [{i*5+5}s] run status:", run.get("status"),
          "| llm_calls:", run.get("llm_calls_used"),
          "| pages:", run.get("pages_read"))
    if run.get("status") in ("success", "failed"):
        rules = {x["rule_id"]: x["result"] for x in (f.get("rules") or [])}
        print("最终规则结论:", json.dumps(rules, ensure_ascii=False))
        break
