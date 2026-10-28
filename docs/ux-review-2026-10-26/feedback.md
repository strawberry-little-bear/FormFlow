# FormFlow 体验走查反馈（2026-10-26）

> 角色：第一次接触这个产品的体验者。目标不是找代码问题，而是"照着 README 走一遍，看看会不会卡住、会不会看不懂"。
> 说明：本轮**只记录、不修复**。所有结论都有可复现路径与截图。

---

## 0. 环境与路径

| 项 | 值 |
| --- | --- |
| 代码版本 | `d78f8464`（`git pull --rebase` 已是最新；本地另有未提交的上一轮改动） |
| 平台 | Windows 11 / Python 3.13.12（`PYTHONUTF8=1`，UTF-8 模式开启） |
| 演示数据 | `scripts/seed_demo.py` 全新种子（5 主体、1 任务） |
| 走查方式 | Playwright 无头 Chromium，1440 / 390 / 320 三档宽度 |
| 截图目录 | `docs/ux-review-2026-10-26/` |
| 脚本 | `scripts/ux_experience_pass.cjs`、`ux_negative_pass.cjs`、`ux_review_stats.cjs`、`ux_reminder_mobile.cjs`、`ux_mobile_actions.cjs`、`ux_deadline_check.cjs` |

**为什么没用一键启动脚本**：`python scripts/start_demo.py` 在当前环境直接崩溃（见问题 1），所以 API / Worker 是手动起的：

```bash
FORMFLOW_DATABASE_URL="sqlite:///E:/FormFlow/data/demo/formflow.db" \
FORMFLOW_STORAGE_DIR="E:/FormFlow/data/demo/storage" \
FORMFLOW_LLM_API_KEY="" python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
FORMFLOW_DATABASE_URL="sqlite:///E:/FormFlow/data/demo/formflow.db" ... python -u -m app.worker
```

---

## 1. 先说结论：哪些是好的

走完全流程，产品给我的整体印象是**克制、诚实、边界清楚**，这在同类工具里少见：

- **全站零控制台报错、零非预期 4xx/5xx**。组织者 6 个页面 + 提交者 8 步全流程，`console error` / `pageerror` / 失败响应全部为空。
- **提交者全流程一次跑通**：凭证登录 → 填写 → 上传 → 存服务器草稿 → 刷新恢复 → 引导自动跳过已上传材料 → 正式提交 → 拿到回执。
- **不假装成功**。没配模型密钥时，语义规则明确显示"检查未完成"而不是"满足"，原文是：
  > 模型服务不可用，语义检查未完成：未配置 FORMFLOW_LLM_API_KEY；没有把未完成的检查当作结论

  这句话把"没检查"和"不合格"分开了，是这条产品线最值钱的地方。
- **错误路径都说人话**：密码错 →「用户名或密码错误」；凭证错 →「凭证无效或已失效…」；访问不存在的任务 →「任务不存在或无权访问」；设计页打不开 →「草案没能加载：任务不存在或无权访问。请重新打开这个页面，以免覆盖已有的设计。」并同时禁用发送按钮。
- **移动端不横向溢出**：390 / 320 下 `scrollWidth == clientWidth`。
- **性能没问题**：首屏 614ms、FCP 128ms、3 个静态资源共 460KB。
- **上一轮的修复确实生效**：时区只在侧栏出现一次（`2026-11-01 01:57 (Asia/Shanghai)`），CSV 的「收件时间」已转成任务时区并带 BOM（Excel 直接打开不乱码）。
- **键盘焦点可见**：输入框聚焦时边框转紫 + 3px 柔光环，按钮 3px 紫色 outline，不是"看不见焦点"的那一类。

---

## 2. 发现的问题（按影响排序）

### P0 · 一键启动脚本在 Windows 上崩溃，而且偏偏是"第二次用"才崩

**现象**：`python scripts/start_demo.py --check` 打印 3 行后抛 Python traceback，退出码 1。

```
Python 依赖：已就绪
演示数据库：已就绪（完整性与演示种子正常）
API 健康检查：HTTP 200 · FormFlow 合同 v1
Exception in thread Thread-1 (_readerthread):
  ...
UnicodeDecodeError: 'utf-8' codec can't decode byte 0xd0 in position 0
Traceback (most recent call last):
  ...
  File "scripts/start_demo.py", line 337, in process_is_running
    return any(len(row) > 1 and row[1] == str(pid) for row in csv.reader(result.stdout.splitlines()))
AttributeError: 'NoneType' object has no attribute 'splitlines'
```

**复现**（关键：`services.json` 必须存在，也就是"启动器跑过一次之后"）：

```bash
printf '{"api": 999999, "worker": 999998}' > data/demo/services.json
python scripts/start_demo.py --check   # 退出码 1 + traceback
rm -f data/demo/services.json
python scripts/start_demo.py --check   # 正常，退出码 0
```

**根因**：`process_is_running()`（`scripts/start_demo.py:331`）用
`subprocess.run(["tasklist", ...], text=True)`。中文 Windows 的 `tasklist.exe` 输出是 GBK（cp936），
而本机 `PYTHONUTF8=1`，`text=True` 会按 UTF-8 解码 → 读取线程抛 `UnicodeDecodeError` →
`result.stdout` 变成 `None` → 下一行 `.splitlines()` 直接 `AttributeError`。

**为什么说"偏偏第二次"**：没有 `services.json` 时走的是「无启动器进程登记」分支，根本不会调 `process_is_running()`，
所以**首次体验一切正常**，第二次想 `--check` / `--stop` / `--reset` 才炸。这种"第一次好第二次坏"最容易让人以为是自己环境坏了。

**影响**：
- README 第 79 行明确写"执行 `--check` 可只读检查……退出码仍由依赖和数据库检查决定"——实际在依赖和数据库都正常时返回 1。
- `--reset` 会先调 `stop_demo()`，`stop_demo()` 里的 `taskkill`（同样是 `text=True`）走同一条解码路径，`--reset` 一并受影响。
- `stop_demo()` 的 `taskkill` 解码失败后仍会把进程名加进 `stopped` 列表并打印「已停止登记的演示进程：api, worker」，即使一个都没停掉。

**建议方向**：所有调用 Windows 原生工具的地方显式指定编码，例如
`subprocess.run(..., text=True, encoding="utf-8", errors="replace")`（或对 `tasklist`/`taskkill` 用 `encoding="mbcs"`），
并对 `result.stdout` 做 `None` 兜底。

---

### P1 · 移动端提交者的三个操作按钮挤成一行，主按钮文字断成 3–5 行

**现象**（`#/login?role=sub` 登录后，表单底部操作区）：

| 宽度 | 重新加载服务器草稿 | 保存草稿 | 提交材料并开始核对（主按钮） |
| --- | --- | --- | --- |
| 390px | 95 × 50px（3 行） | 105 × 43px（2 行） | 103 × **82px**（"提交材料 / 并开始核 / 对"） |
| 320px | 71 × 70px（4 行） | 81 × 64px（3 行） | 79 × **124px**（5–6 行） |

截图：`submitter-actions-390.png`、`submitter-actions-320.png`

**为什么是问题**：
- 主按钮被压成三行，视觉高度最高但**最窄**，读起来像被截断的乱码（"并开始核 / 对"）。
- 三个按钮高度 43 / 50 / 82 各不相同，底部不齐，像没排版。
- 移动端最该好按的"正式提交"反而被挤在右侧最窄的位置。

**建议方向**：窄屏（≤480px）下让主按钮独占一行（`flex: 1 1 100%`），
次要动作（"重新加载服务器草稿"）降级为文字链或收进"更多"，保证主次分明。

---

### P2 · 标题的装饰句号在窄屏单独掉到下一行

**现象**：390px 下提交者页 `<h1>` 显示为

```
2026 秋季第 1 期团课报告（演
示）  。
```

紫色装饰句号"。"孤零零占了一行。截图：`submitter-title-390.png`

**建议方向**：把句号用 `white-space: nowrap` 绑到前一个字，或改用 `::after` 伪元素并设置 `word-break: keep-all`。

---

### P2 · 复核页"满足"和"阻塞验收"并排，读起来自相矛盾

**现象**：复核页每条规则都渲染"结果徽章 + 严重度徽章"，于是出现：

```
姓名已填写        满足   阻塞验收
已提交团课报告材料  满足   阻塞验收
材料数量/格式符合   满足   阻塞验收
```

截图：`rule-list-badges.png`

**为什么是问题**：
- 两个徽章**同为灰色**，看不出哪个是"这条现在怎么样"、哪个是"这条的规则属性"。
- 在「已满足」分组里出现"阻塞验收"，第一反应是"满足了为什么还阻塞"。
- 严重度是规则属性（"不通过会阻塞验收"），不是当前状态，现在被当状态展示了。

**建议方向**：已满足时省略严重度徽章；或把文案改成"不通过会阻塞验收"并弱化成纯文字；两个徽章用不同视觉重量区分。

---

### P2 · 凭证错误提示自我重复

**现象**：输入错误凭证，提示是

> 凭证无效或已失效：凭证无效或已撤销

前端 `app.js:838` 拼了前缀「凭证无效或已失效：」，后端 `routes.py:183` 返回的 detail 是「凭证无效或已撤销」，
两段语义完全重叠。截图：`err-wrong-credential.png`

**建议方向**：后端 detail 存在时直接用 detail，前缀只作为兜底。

---

### P3 · 导出的 ZIP 里，材料文件时间戳是 1980-01-01

**现象**：

```
000001_fb746e4e_张三_报告.txt   date=(1980, 1, 1, 0, 0, 0)   ← 材料原件
manifest.json                   date=(2026, 10, 26, 1, 12, 2)  ← 正常
original_names.json             date=(2026, 10, 26, 1, 12, 2)  ← 正常
```

**根因**：`app/services/export.py:214` 用 `zf.open(archive_name, "w")` 写入，没有传 `ZipInfo`，
条目时间回落到 ZIP 纪元 1980-01-01。

**为什么值得改**：交付包通常会被归档/二次分发，Windows 资源管理器里材料显示"1980 年 1 月 1 日"，
既像坏文件，也丢了"这份材料什么时候收上来的"这条信息——而这恰好是收集类产品最该保住的东西。

**建议方向**：构造 `zipfile.ZipInfo(arc, date_time=...)` 再 `zf.open(zinfo, "w")`，
时间取快照里的 `formal_submitted_at` 或原件 mtime。

（补充：中文文件名没问题，UTF-8 标志位 bit 11 已正确置位，Windows 资源管理器能正常显示；
只有 `unzip` 命令行工具会显示乱码，那是工具本身的问题，不算缺陷。）

---

### P3 · 截止时间卡片省略年份，跨年任务会歧义

**现象**：提交者页顶部卡片显示 `11-01 01:57`、`11-08 01:57`，不带年份；右侧侧栏才有完整的
`2026-11-01 01:57 (Asia/Shanghai)`。

对 10 月底发起的任务没问题，但如果任务在 12 月发起、截止到次年 1 月，`11-01` 这种写法就需要读者自己推断年份。

**建议方向**：卡片时间与当前年份不同时补上年份，或统一带年份（卡片宽度够）。

---

### P3 · 无模型密钥时，组织者不知道该去哪儿补

**现象**：没配 `FORMFLOW_LLM_API_KEY` 时，复核页两条语义规则是"检查未完成"，
文案本身很好（见"好的部分"），但**复核页里没有任何指向"如何配置模型"的入口**。
提示只在任务列表页顶部出现过一次（"当前没有配置 AI 模型密钥…"）。

体验者在这个页面的真实反应是："我知道没检查完了，然后呢？"

**建议方向**：复核页的"检查未完成"空态里加一行轻量说明 + 一个指向配置说明的链接。

---

## 3. 我特意去试、但没试出问题的路径

记录下来，免得下一轮重复劳动：

| 场景 | 结果 |
| --- | --- |
| 组织者密码输错 | 「用户名或密码错误」，输入框保留，无报错堆栈 |
| 提交者凭证伪造 | 「凭证无效或已失效…」，停在登录页 |
| 访问 `#/workbench/9999` | 「任务不存在或无权访问」，页面不崩 |
| 访问 `#/design/9999` | 「草案没能加载：任务不存在或无权访问」，发送按钮被禁用 |
| 复核页缺 `subjectId`（`#/review/1`） | 显示「先选一位提交者」空态，不发请求 |
| 重复上传同一槽位 | 「「团课报告」最多 1 份，请先删除多余文件再上传」——正确拦截 |
| 催交生成 | 正确排除已提交/免交主体，文案含时区转换后的截止时间，且明说"不宣称已发送" |
| 快照 → 导出 | CSV 5 行齐全，排除原因清楚（"当前版本未验收" / "有效免交（不等于材料验收）"） |
| 390 / 320 横向溢出 | 无 |
| 键盘 Tab 顺序 | 组织者/提交者切换 → 用户名 → 密码 → 登录 → 注册 → 演示入口，焦点环可见 |

---

## 4. 如果只修三件事

1. **修 `start_demo.py` 的编码问题**（P0）——它是 README 首推入口，坏在这里，后面的好都体验不到。
2. **移动端提交者操作区重排**（P1）——"正式提交"是转化点，现在被挤成 3 行字。
3. **复核页"满足 + 阻塞验收"并排**（P2）——这是产品最核心的页面，一句话读不通会削弱整套"证据链"的可信度。

其余（句号孤行、凭证提示重复、ZIP 时间戳、年份、无密钥引导）都是低成本可顺手改的。
