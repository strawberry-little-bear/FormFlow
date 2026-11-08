# FormFlow 部署与模型接入

这份说明针对一台由组织者自己控制的 Linux 或 Windows 主机。当前推荐的部署形态是单机双进程：API 提供网页和业务接口，Worker 串行执行需求整理与提交审核。两者共享同一个数据库、附件目录和本地配置文件。

## 1. 本地配置与密钥边界

复制 `.env.example` 为 `.env`，只在部署主机上填写：

```dotenv
FORMFLOW_ENV=production
FORMFLOW_ALLOW_REGISTRATION=false
FORMFLOW_DATABASE_URL=sqlite:////srv/formflow/data/formflow.db
FORMFLOW_STORAGE_DIR=/srv/formflow/data/storage
FORMFLOW_LLM_BASE_URL=https://your-provider.example/v1
FORMFLOW_LLM_API_KEY=由用户自行填写
FORMFLOW_LLM_MODEL=your-model
FORMFLOW_LLM_INPUT_MODE=auto
```

`.env` 已被 Git 忽略。FormFlow 只在进程启动时读取本机 `.env`、进程环境或部署平台 Secret；不会把 `FORMFLOW_LLM_API_KEY` 写入数据库、审计事件、日志、浏览器响应、Skill 提示词或 MCP 配置。`/api/health` 只返回 provider、模型、输入模式和 `api_key_exposed: false`。

这代表“FormFlow 不代管密钥”，不代表材料不会离开本机。启用真实模型后，原始材料或解析文本可能发送到用户选择的 provider；留存、跨境、计费和训练政策由 provider 决定。正式部署前应由组织者确认 provider 的文件输入政策和数据处理条款。

生产环境默认关闭公开注册。组织者账号应通过受控初始化流程创建；演示和本地开发可使用
`development`/`demo` 保持注册入口。

## 2. 审核输入链路

默认 `FORMFLOW_LLM_INPUT_MODE=auto`，每条语义规则按以下顺序运行：

1. 程序确定性规则先执行。
2. 有原始文件且模型客户端支持文件/图像输入时，直接把 PDF 或图片作为受控模型输入发送。
3. provider 明确拒绝文件输入、文件超过 `FORMFLOW_LLM_MAX_FILE_BYTES`，或没有可用文件时，回退到服务器文字解析。
4. 只有回退路径允许时，扫描页或无文字图片才使用本地 OCR；无法读到的页面记为未读并转 `unknown`/人工复核，不会被判成材料缺失。

模式含义：

- `auto`：直传优先，provider 不支持时允许文字解析和 OCR 兜底。
- `direct`：只允许直传；provider 不支持时将检查标记为未完成。
- `text`：只读服务器已有文字层，禁止 OCR，适合不希望本机执行 OCR 的部署。
- `ocr`：只走服务器解析和 OCR，不把原始文件发送给 provider。

当前客户端使用 OpenAI-compatible `/chat/completions` 的 `file` 与 `image_url` 内容块。不同 provider 的文件格式可能不同；第一次接入应使用授权的脱敏样本验证文件输入、页码证据和失败响应。验证失败时保留 `auto`，让系统按规则降级，或改用 `text`/`ocr`。

如果蓝图声明了 `check.kind=visual_layout`，这条规则只接受原始 PDF/图片直传。没有直传能力时，系统会标记“检查未完成”并转人工，不会用 OCR 或文字层推断标题位置、对齐、页眉页脚等版式事实；模型返回的版式结论还必须带页面 `bbox` 区域，供组织者打开原件核对。

## 3. Skill、Harness 与 MCP 的职责

审核 Skill 是服务端固定的 `review_one_submission`，只允许调用确定性规则和语义规则两个工具。Harness 负责任务/账号范围、工具白名单、调用预算、页数上限、幂等键、超时、结果大小和失败后的人工接手。模型不能自行选择 SQL、文件路径、规则 ID、用户权限或发布动作。

需求整理的 Harness 把调用路径拆开记录：正常路径最多 1 次直传模型调用；只有直传被 provider 拒绝或失败时，`auto` 才最多追加 1 次文字/OCR 降级调用。这里的 2 次是整个请求的上限，不是每次请求都会调用两次。

MCP 是可选的只读 sidecar，提供任务列表、收集汇总、下一步路线和 Agent runtime 合同查询。它复用组织者会话并由 API 再做任务所有权校验；不读取逐人名单、材料正文，也不提供写入工具。MCP 不持有模型 API Key，也不绕过审核 Skill 的 provider 权限。网页内置 Agent 不直接启动外部 MCP sidecar。

## 4. 单机部署

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --require-hashes -r requirements.lock
cp .env.example .env
# 编辑 .env，填写数据库、附件目录和模型配置；生产环境保持公开注册关闭

python scripts/create_account.py --username organizer

uvicorn app.main:app --host 127.0.0.1 --port 8000
# 另开终端，使用同一 .env、数据库和附件目录
python -m app.worker
```

Windows PowerShell 使用 `.venv\Scripts\Activate.ps1`，其余命令相同。启动后先检查：

```bash
curl http://127.0.0.1:8000/api/health
curl http://127.0.0.1:8000/api/ready
```

`/health` 只表示进程还活着；`/api/ready` 会检查数据库连接和附件目录，失败时返回 HTTP 503，
适合反向代理、容器或进程管理器的就绪探针。Worker 仍需由独立进程管理器保持运行。

组织者退出时，浏览器会清理本地凭证，并请求服务端撤销当前登录会话；网络暂时不可用时仍会先退出当前浏览器，恢复网络后不要继续使用旧页面。

公网访问时，将 Uvicorn 绑定在 `127.0.0.1`，前面放 Caddy、Nginx 或云负载均衡，终止 HTTPS 并转发到 8000。API 和 Worker 必须使用同一份配置；不要使用 `--reload`、演示种子、演示账号或共享的开发数据库。

SQLite 文件和 `FORMFLOW_STORAGE_DIR` 必须位于持久磁盘。备份应同时覆盖数据库和附件，并定期在新目录做恢复演练。需要多 Worker 或多 API 实例前，先把 SQLite 换成受支持的共享数据库，并为队列任务增加领取锁/租约；当前执行模型按单 Worker 设计。

生产 SQLite 可使用与 API/Worker 相同的 `.env` 做一致性备份。执行前应停止 API 和 Worker，或由进程管理器保证没有写入：

```bash
python scripts/backup_runtime.py create
# 将输出的 zip 复制到独立备份位置
python scripts/backup_runtime.py verify /srv/formflow/backups/formflow-20261107T120000Z.zip
```

恢复不会覆盖现有目录，只能恢复到新目录，校验通过后再按部署平台切换数据目录：

```bash
python scripts/backup_runtime.py restore /srv/formflow/backups/formflow-20261107T120000Z.zip \
  --target /srv/formflow/restore-check
```

当前工具只支持 SQLite；使用 PostgreSQL 等共享数据库时，应使用数据库供应商的原生备份，并单独备份附件目录。

### Docker Compose（可选）

仓库提供 `deploy/docker-compose.yml`，用于把 API 和 Worker 固定在同一份配置、数据库和附件卷中：

Docker 构建上下文通过根目录 `.dockerignore` 排除本地 `.env`、数据库、附件、Git 历史、测试和走查文档；`.env.example` 保留为非密钥配置模板。

```bash
cp .env.example .env
# 编辑 .env，填写 provider、模型和非敏感运行配置
# 有真实模型时，把密钥单独放到仓库外文件；没有密钥时创建空文件，仍可运行离线/人工流程
touch .formflow_llm_api_key
# 将 API Key 写入 .formflow_llm_api_key，并限制文件权限（Linux：chmod 600 .formflow_llm_api_key）
docker compose -f deploy/docker-compose.yml up -d --build
curl http://127.0.0.1:8000/api/ready
docker compose -f deploy/docker-compose.yml logs -f api worker
```

Windows PowerShell 创建同一个空文件使用：

```powershell
New-Item -ItemType File -Path .formflow_llm_api_key -Force
docker compose -f deploy/docker-compose.yml up -d --build
Invoke-WebRequest http://127.0.0.1:8000/api/ready
docker compose -f deploy/docker-compose.yml logs -f api worker
```

Compose 通过文件型 Secret 把 `.formflow_llm_api_key` 只读挂载到 API 和 Worker；密钥不会进入容器环境变量，也不会出现在 `docker compose config` 的展开结果中。Compose 只把 API 绑定到本机回环地址，公网访问仍应由 Caddy、Nginx 或云负载均衡终止 HTTPS 后转发。
`formflow_data` 卷同时保存 SQLite 和附件；升级前先停服务并完成备份，不能把演示数据库挂到生产卷。

Compose 首次创建账号时，在 API 容器启动前执行一次：

```bash
docker compose -f deploy/docker-compose.yml run --rm api \
  python scripts/create_account.py --username organizer
docker compose -f deploy/docker-compose.yml up -d --build
```

脚本通过交互式输入读取密码，不会把密码写进命令行参数或日志。

## 5. 上线前检查

- 用 `FORMFLOW_LLM_API_KEY` 为空的环境确认收件、程序规则和人工接手仍可用。
- 用授权脱敏的 PDF、图片和扫描件验证直传、provider 拒绝后的降级、页码证据和预算耗尽。
- 检查应用日志、反向代理日志和备份文件中没有 API Key、材料正文或会话 token。
- 确认 provider 的文件留存、跨境、训练和费用政策，并设置调用、页数、文件大小和 OCR 预算。
- 完成 HTTPS、账户密码策略、附件访问控制、备份保留和恢复演练后，再开放公网。

模型质量、真实材料评估、真实 provider 兼容性和公网安全验收仍需要单独的授权测试，不能由虚构种子或离线演示结果代替。
