# -*- coding: utf-8 -*-
"""码点审计：已知坏字形扫描 + 新增汉字扫描。

背景（本项目踩过的坑）：控制台字体缺字形时，诉(U+8BC9) 与 诹(U+8BF9)
显示会互换成对方的形状，肉眼在终端里无法分辨。历史上曾据终端显示把
映射写反，导致源码里 "申诉" 被系统性写成错字 "申诹"(U+8BF9)。
判定标准以 Unicode 为准：诉=U+8BC9、诹=U+8BF9、缺=U+7F3A、缿=U+7F3F。

两类检查：
1. 已知坏字形：改动文件中出现 U+8BF9/U+7F3F 即报错（应分别为 诉/缺）；
2. 新字扫描：改动文件中出现、已提交代码与方案提取文本都没有的汉字，
   需人工复核（多为正常新词，也可能是手滑错字）。

用法：python scripts/audit_codepoints.py
"""
import io
import re
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")

CJK = re.compile(r"[\u4e00-\u9fff]")
# 已知坏字形 -> 正确字
BAD_GLYPHS = {"\u8bf9": "\u8bc9", "\u7f3f": "\u7f3a"}


def sh(*args):
    return subprocess.run(list(args), capture_output=True, text=True,
                          encoding="utf-8").stdout


def chars_of(text):
    return set(CJK.findall(text))


# 语料：方案纯文本 + 已提交的全部源码
corpus = io.open("docs/plan_extracted.txt", encoding="utf-8").read()
for path in sh("git", "ls-files").split():
    try:
        corpus += io.open(path, encoding="utf-8").read()
    except (UnicodeDecodeError, OSError):
        pass  # 二进制/转义路径（如 docx）跳过
known = chars_of(corpus)

# 目标：本次改动/新增的文件（git status）
targets = []
for line in sh("git", "status", "--porcelain").splitlines():
    flag, path = line[:2], line[3:].strip()
    if flag.strip() in ("M", "MM", "??", "A", "AM") and path.endswith(
            (".py", ".js", ".md", ".txt", ".html", ".css")):
        targets.append(path)

bad = False
for t in targets:
    s = io.open(t, encoding="utf-8").read()
    if t.endswith("audit_codepoints.py"):
        continue  # 自身含待检字形，跳过
    for g, fix in BAD_GLYPHS.items():
        if g in s:
            bad = True
            print(f"[坏字形] {t}: {g}(U+{ord(g):04X}) x{s.count(g)}"
                  f" 应为 {fix}(U+{ord(fix):04X})")
    unknown = sorted(c for c in chars_of(s) if c not in known)
    print(t, "-> 新字:", "".join(unknown) if unknown else "(无)")
sys.exit(1 if bad else 0)
