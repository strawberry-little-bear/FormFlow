"""通过 GitHub REST API 推送提交（git 协议被网络阻断时的备用通道）。

用法:
    python scripts/push_via_api.py            # 推送 origin/main..HEAD(或状态文件记录位置)..HEAD
    python scripts/push_via_api.py <sha>...   # 推送指定提交(按给定顺序, 旧->新)

依赖 gh CLI 已登录(gh auth status)。已在 .git/formflow_api_push.json 记录
上次推送位置, 避免重复创建提交。仅创建/更新仓库 git 数据, 不改动本地库。
"""
import base64
import json
import os
import subprocess
import sys

REPO = "strawberry-little-bear/FormFlow"
BRANCH = "main"
STATE_FILE = os.path.join(".git", "formflow_api_push.json")


def git(*args, binary=False):
    r = subprocess.run(["git"] + list(args), capture_output=True)
    if r.returncode != 0:
        raise SystemExit("git %s failed:\n%s" % (args, r.stderr.decode("utf-8", "replace")))
    return r.stdout if binary else r.stdout.decode("utf-8")


def gh_api(method, path, body=None):
    cmd = ["gh", "api", "--method", method, path]
    if body is not None:
        cmd += ["--input", "-"]
    r = subprocess.run(cmd, input=json.dumps(body) if body is not None else None,
                       capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        raise SystemExit("gh api %s %s failed:\n%s" % (method, path, r.stderr))
    out = r.stdout.strip()
    return json.loads(out) if out else None


def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


def save_state(local_sha, remote_sha):
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump({"last_local": local_sha, "last_remote": remote_sha}, f)


def ls_tree(commit):
    d = {}
    for line in git("ls-tree", "-r", commit).splitlines():
        meta, path = line.split("\t", 1)
        mode, typ, sha = meta.split()
        if typ == "blob":
            d[path] = (mode, sha)
    return d


def create_blob(blob_sha):
    data = git("cat-file", "blob", blob_sha, binary=True)
    b64 = base64.b64encode(data).decode("ascii")
    res = gh_api("POST", "repos/%s/git/blobs" % REPO, {"content": b64, "encoding": "base64"})
    return res["sha"]


def push_commits(commits):
    state = load_state()
    remote_head = gh_api("GET", "repos/%s/git/ref/heads/%s" % (REPO, BRANCH))["object"]["sha"]
    if state and state.get("last_remote") and state["last_remote"] != remote_head:
        print("WARNING: 远端 head 与状态文件记录不一致, 请先核对远端是否有外部推送", file=sys.stderr)
    print("remote head: %s" % remote_head[:8])
    parent_commit = remote_head
    for c in commits:
        fields = git("show", "-s", "--format=%an%x01%ae%x01%aI%x01%cn%x01%ce%x01%cI%x01%B", c)
        an, ae, ad, cn, ce, cd, rest = fields.split("\x01", 6)
        message = rest.strip()
        parent = git("rev-parse", c + "^").strip()
        cur, old = ls_tree(c), ls_tree(parent)
        entries = []
        for path, (mode, sha) in cur.items():
            if old.get(path, (None, None))[1] != sha:
                entries.append({"path": path, "mode": mode, "type": "blob",
                                "sha": create_blob(sha)})
        for path in old:
            if path not in cur:
                entries.append({"path": path, "mode": "100644", "type": "blob", "sha": None})
        parent_tree = gh_api("GET", "repos/%s/git/commits/%s" % (REPO, parent_commit))["tree"]["sha"]
        tree = gh_api("POST", "repos/%s/git/trees" % REPO,
                      {"tree": entries, "base_tree": parent_tree})
        commit = gh_api("POST", "repos/%s/git/commits" % REPO, {
            "message": message,
            "tree": tree["sha"],
            "parents": [parent_commit],
            "author": {"name": an, "email": ae, "date": ad},
            "committer": {"name": cn, "email": ce, "date": cd},
        })
        gh_api("PATCH", "repos/%s/git/refs/heads/%s" % (REPO, BRANCH),
               {"sha": commit["sha"], "force": False})
        print("pushed %s -> %s  %s" % (c[:8], commit["sha"][:8], message.splitlines()[0]))
        parent_commit = commit["sha"]
        save_state(c, commit["sha"])
    print("done, remote head now %s" % parent_commit[:8])


if __name__ == "__main__":
    args = sys.argv[1:]
    if args:
        commits = args
    else:
        state = load_state()
        base = state["last_local"] if state else "origin/main"
        commits = git("log", "--format=%H", "%s..HEAD" % base).split()
        commits.reverse()
        if not commits:
            print("nothing to push")
            sys.exit(0)
    push_commits(commits)
