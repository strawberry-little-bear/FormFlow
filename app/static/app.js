"use strict";
/* 收齐啦 FormFlow 前端（P01–P05）。纯静态 SPA，直接调用 /api。 */
const ORG_KEY = "ff_org_token", SUB_KEY = "ff_sub_token";
const state = { taskId: null, chat: [], bpId: null, draft: null, requirement: "", answeredDone: false, files: {}, filesMeta: {}, draftVersion: null, me: null, lastJob: null, roster: {}, designEpoch: 0, agentBusy: false, draftStatus: "draft", draftVersionId: null, designTab: "preview", tasks: [], designBlocking: [], designAdvisories: [], designVersions: [], designHistory: [], viewingVersion: null, wbRows: [], wbFilter: "all", reviewRule: null };

const orgToken = () => localStorage.getItem(ORG_KEY) || "";
const subToken = () => localStorage.getItem(SUB_KEY) || "";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function fmtTime(s) {
  if (!s) return "未设置";
  const d = new Date(s);
  if (isNaN(d)) return String(s);
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
async function api(path, opts = {}) {
  const headers = {};
  let body;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form !== undefined) {
    body = new URLSearchParams(opts.form);
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }
  const tok = opts.token !== undefined ? opts.token : (opts.sub ? subToken() : orgToken());
  if (tok) headers["Authorization"] = "Bearer " + tok;
  const r = await fetch(path, { method: opts.method || "GET", headers, body });
  const text = await r.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { detail: text }; }
  if (!r.ok) {
    const detail = data.detail;
    throw new Error(Array.isArray(detail) ? detail.map(x => x.msg || JSON.stringify(x)).join("；")
      : (typeof detail === "string" ? detail : "请求失败，请稍后重试（" + r.status + "）"));
  }
  return data;
}

function setFlash(msg, kind = "err") {
  const el = document.getElementById("flash");
  if (el) el.innerHTML = msg ? `<div class="flash ${kind}">${esc(msg)}</div>` : "";
}
async function guard(fn) {
  try { await fn(); } catch (e) { setFlash(e.message || String(e)); }
}

/* 规则结果徽标与规则卡片：P03 与 P04 共用同一渲染，避免两端说法不一致 */
const RESULT_BADGE = {
  satisfied: '<span class="badge ok">满足</span>',
  issue: '<span class="badge bad">问题</span>',
  unknown: '<span class="badge warn">待确认</span>',
  not_applicable: '<span class="badge">不适用</span>',
  failed: '<span class="badge bad">失败</span>',
};
const resultBadge = (r) => RESULT_BADGE[r] || esc(r);
const METHOD_LABEL = {
  text: "文字层提取", ocr: "OCR 识别", mixed: "文字层+OCR",
  visual: "无可提取文字（图像）", none: "未提取到文字",
};
const coverageCard = (run) => {
  if (!run || !run.coverage) return "";
  const cov = run.coverage;
  const gap = (cov.unread_pages || 0) + (cov.failed_pages || 0);
  return `<div class="card"><h3>材料覆盖情况（提取方法与覆盖缺口）</h3>
    <p class="kv">已读页 ${run.pages_read ?? 0} ｜ 语义模型调用 ${run.llm_calls_used ?? 0}${run.budget_exhausted ? " ｜ 预算已耗尽" : ""}
      ｜ <span class="badge${gap ? " warn" : " ok"}">${cov.complete === false ? "覆盖不完整" : "覆盖完整"}</span></p>
    <table><tr><th>文件</th><th>提取方式</th><th>总页</th><th>已读</th><th>未读</th><th>失败</th></tr>
    ${(cov.files || []).map(f => `<tr><td>${esc(f.name || f.file_id)}</td>
      <td>${esc(METHOD_LABEL[f.method] || f.method || "-")}</td>
      <td>${f.total ?? 0}</td><td>${f.text ?? 0}</td><td>${f.unread ?? 0}</td><td>${f.failed ?? 0}</td></tr>`).join("")}
    </table>
    ${gap ? `<p class="kv" style="margin-top:8px">共 ${gap} 页未能读取：这些页不构成「确认缺失」，相关要素按 unknown 处理，需补充清晰可读的材料或转人工复核。</p>` : ""}
  </div>`;
};
const ruleCard = (r) => `
  <div class="card">
    <h3>${esc(r.rule_id)} ${resultBadge(r.result)}
      <span class="badge">${esc(r.severity || "")}</span></h3>
    ${r.explanation ? `<p>${esc(r.explanation)}</p>` : ""}
    ${r.next_step ? `<p class="kv">下一步：${esc(r.next_step)}</p>` : ""}
    ${r.requirement && r.requirement.statement ?
      `<p class="kv">要求来源：${esc(r.requirement.requirement_source || "")} ｜ ${esc(r.requirement.statement)}</p>` : ""}
    ${(r.evidence || []).map(e => `
      <div class="evidence">[${esc(e.locator || "-")} · ${esc(e.method || "-")}] ${esc(e.quote || "")}</div>
    `).join("") || `<p class="muted">无证据</p>`}
  </div>`;

/* ---------------------------------------------------------------- 路由 */
function route() {
  state.designEpoch++;
  state.agentBusy = false;
  clearTimeout(_wbTimer);
  state.reviewData = null; state.reviewRule = null;
  document.querySelectorAll("dialog[open]").forEach(d => d.close());
  const h = (location.hash || "#/login").replace(/^#/, "");
  const parts = h.split("/").filter(Boolean);
  document.body.classList.toggle("auth-page", parts[0] === "login");
  document.body.dataset.page = parts[0] || "login";
  renderNav();
  if (parts[0] !== "login" && parts[0] !== "submit" && !orgToken()) {
    location.hash = "#/login"; return;
  }
  const app = document.getElementById("app");
  if (parts[0] === "login") return viewLogin();
  if (parts[0] === "tasks") return viewTasks();
  if (parts[0] === "design") return viewDesign(+parts[1]);
  if (parts[0] === "workbench") return viewWorkbench(+parts[1]);
  if (parts[0] === "review") return viewReview(+parts[1], +parts[2]);
  if (parts[0] === "submit") return viewSubmit();
  if (parts[0] === "delivery") return viewDelivery(+parts[1]);
  if (parts[0] === "roster") return viewRoster(+parts[1]);
  viewLogin();
}
window.addEventListener("hashchange", route);

const ICONS = {
  tasks: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  design: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  roster: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m3 10v-3a6 6 0 0 0-3-5"/>',
  workbench: '<path d="M4 5h16v15H4zM8 2v6m8-6v6M8 12h3m-3 4h7"/>',
  delivery: '<path d="M3 8h18v13H3zM2 3h20v5H2zM9 12h6"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>'
};
function icon(name) { return `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.tasks}</svg>`; }
function renderNav() {
  const nav = document.getElementById("nav");
  const org = !!orgToken(), sub = !!subToken();
  const parts = location.hash.replace(/^#\//, "").split("/");
  document.getElementById("role-label").textContent = org ? "组织者" : sub ? "提交者" : "访客";
  document.getElementById("btn-logout").hidden = !org && !sub;
  let items = org ? [["#/tasks", "我的任务", "tasks"]] : [];
  const taskId = /^\d+$/.test(parts[1] || "") ? Number(parts[1]) : null;
  if (org && taskId) items.push(
    [`#/design/${taskId}`, "需求设计", "design"], [`#/roster/${taskId}`, "名单与凭证", "roster"],
    [`#/workbench/${taskId}`, "收集工作台", "workbench"], [`#/delivery/${taskId}`, "交付与归档", "delivery"]);
  if (sub) items.push(["#/submit", "我的提交", "roster"]);
  nav.innerHTML = '<span class="nav-caption">工作空间</span>' + items.map(([href, label, ic], i) =>
    `${i === 1 && taskId ? '<span class="nav-caption task-caption">当前任务</span>' : ''}<a href="${href}" ${location.hash === href ? 'aria-current="page"' : ''} class="${location.hash === href ? "active" : ""}">${icon(ic)}${label}</a>`).join("");
}

function logout() {
  localStorage.removeItem(ORG_KEY); localStorage.removeItem(SUB_KEY);
  state.chat = []; state.draft = null;
  location.hash = "#/login"; route();
}

/* ---------------------------------------------------------------- 登录 */
function viewLogin() {
  document.getElementById("app").innerHTML = `
  <div class="login-wrap">
    <div class="login-hero">
      <div class="logo"><span class="mark">齐</span><span style="font-size:17px">收齐啦 FormFlow</span></div>
      <h1>材料收集，<br>终于有条不紊。</h1>
      <p class="tag">从一句收集要求，到最后一份材料。<br>把反复催交和核对，留给更清晰的工作流。</p>
      <div class="feat"><div class="ic">✧</div><div><b>对话即成问卷</b>
        <span>和组织者助手聊几句，自动生成字段、材料要求与检查规则</span></div></div>
      <div class="feat"><div class="ic">⌕</div><div><b>交上来逐条核对</b>
        <span>每处问题都带原文位置与改法，不把「没读到」说成「确认缺失」</span></div></div>
      <div class="feat"><div class="ic">▣</div><div><b>按正确版本交付</b>
        <span>正式版本不可篡改，快照固定，历史验收不丢失</span></div></div>
    </div>
    <div class="login-panel">
      <h2>欢迎回来</h2>
      <p class="tip">组织者使用账号；提交者使用组织者发放的凭证。</p>
      <div class="tabs">
        <button id="tab-org" class="on" onclick="switchLoginTab('org')">我是组织者</button>
        <button id="tab-sub" onclick="switchLoginTab('sub')">我是提交者</button>
      </div>
      <div id="login-err" class="flash err" style="display:none"></div>
      <div id="pane-org">
        <label>用户名</label><input id="lg-user" placeholder="请输入用户名" autocomplete="username">
        <label>密码</label><input id="lg-pass" type="password" placeholder="请输入密码"
          autocomplete="current-password" onkeydown="if(event.key==='Enter')doLogin()">
        <div class="row" style="margin-top:12px">
          <button onclick="doLogin()" style="flex:2">登 录</button>
          <button class="ghost" onclick="doRegister()">注册并登录</button>
        </div>
        <p class="kv" style="margin-top:10px">第一次使用可直接「注册并登录」，账号数据仅存本机数据库。</p>
      </div>
      <div id="pane-sub" style="display:none">
        <label>提交凭证</label>
        <textarea id="lg-cred" placeholder="粘贴组织者发放的提交凭证（形如 v9MhIdcn_1_EUt...）"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();doSubLogin()}"></textarea>
        <button onclick="doSubLogin()" style="width:100%">进入我的提交空间</button>
        <p class="kv" style="margin-top:10px">凭证不见了？请联系组织者核验后重发，旧凭证会被撤销。</p>
      </div>
    </div>
  </div>`;
}
function switchLoginTab(which) {
  document.getElementById("tab-org").classList.toggle("on", which === "org");
  document.getElementById("tab-sub").classList.toggle("on", which === "sub");
  document.getElementById("pane-org").style.display = which === "org" ? "" : "none";
  document.getElementById("pane-sub").style.display = which === "sub" ? "" : "none";
  document.getElementById("login-err").style.display = "none";
}
function loginErr(msg) {
  const el = document.getElementById("login-err");
  if (el) { el.textContent = msg; el.style.display = ""; }
}
async function doLogin() {
  const username = document.getElementById("lg-user").value.trim();
  const password = document.getElementById("lg-pass").value;
  if (!username || !password) return loginErr("请输入用户名和密码");
  try {
    const r = await api("/api/auth/login", { method: "POST", form: { username, password } });
    localStorage.setItem(ORG_KEY, r.token);
    location.hash = "#/tasks"; route();
  } catch (e) { loginErr(e.message || "登录失败"); }
}
async function doRegister() {
  const username = document.getElementById("lg-user").value.trim();
  const password = document.getElementById("lg-pass").value;
  if (!username || !password) return loginErr("请输入用户名和密码");
  if (password.length < 8) return loginErr("密码至少 8 位");
  try {
    await api("/api/accounts", { method: "POST", form: { username, password } });
    await doLogin();
  } catch (e) { loginErr(e.message || "注册失败"); }
}
async function doSubLogin() {
  const cred = document.getElementById("lg-cred").value.trim();
  if (!cred) return loginErr("请先粘贴提交凭证");
  try {
    await api("/api/me", { sub: true, token: cred });   // 校验本次输入，而不是上次保存的凭证
    localStorage.setItem(SUB_KEY, cred);
    location.hash = "#/submit"; route();
  } catch (e) { loginErr("凭证无效或已失效：" + (e.message || "")); }
}

/* ---------------------------------------------------------------- 任务列表 */
const TASK_STATUS = { draft: "草稿", collecting: "收集中", closed: "已关闭", archived: "已归档", cancelled: "已取消" };
async function viewTasks() {
  document.getElementById("app").innerHTML = `
    <div class="page-heading"><div><div class="eyebrow">WORKSPACE / 任务管理</div><h1>我的任务<span class="heading-dot">.</span></h1><p>从需求到交付，把每一次收集安排妥当。</p></div>
      <button onclick="document.getElementById('create-dialog').showModal()">${icon("plus")} 新建收集任务</button></div>
    <div id="flash" role="status"></div>
    <section class="workspace-intro"><div class="intro-symbol">${icon("design")}</div><div><h2>不用从一张空表单开始</h2><p>告诉小齐要收什么，一起确认字段、材料和规则，再交给提交者。</p></div><span class="intro-note">你确认，才发布 ${icon("arrow")}</span></section>
    <div id="task-stats" class="overview-stats"></div>
    <section class="card task-section"><div class="section-toolbar"><div class="task-filters" role="group" aria-label="任务状态筛选">
      <button class="filter active" data-filter="all" onclick="filterTasks('all')">全部任务</button>
      <button class="filter" data-filter="collecting" onclick="filterTasks('collecting')">收集中</button>
      <button class="filter" data-filter="draft" onclick="filterTasks('draft')">草稿</button>
      <button class="filter" data-filter="done" onclick="filterTasks('done')">已结束</button></div>
      <label class="search-box">${icon("search")}<input id="task-search" aria-label="搜索任务" placeholder="搜索任务名称…" oninput="paintTasks()"></label></div>
      <div id="task-list" aria-live="polite"><p class="empty">正在读取任务…</p></div></section>
    <p class="workspace-note">${icon("delivery")} 正式提交保留版本记录，交付时按固定快照整理。</p>
    <dialog id="create-dialog"><form onsubmit="event.preventDefault();createTask()">
      <div class="dialog-heading"><div><div class="eyebrow">NEW COLLECTION</div><h2>开始一次新的收集</h2></div><button type="button" class="ghost" aria-label="关闭新建任务" onclick="this.closest('dialog').close()">×</button></div>
      <p class="muted">先起个名字，具体材料和检查要求下一步与小齐一起确认。</p>
      <label for="tk-name">任务名称</label><input id="tk-name" required maxlength="120" placeholder="例如：2026 秋季团课报告收集">
      <div class="row"><div><label for="tk-mode">收集范围</label><select id="tk-mode"><option value="roster">名册制 · 有固定应交名单</option><option value="open">开放制 · 面向报名者</option></select></div>
      <div><label for="tk-kind">提交主体</label><select id="tk-kind"><option value="individual">个人提交</option><option value="team">团队提交</option></select></div></div>
      <div id="create-error" class="inline-error" role="alert"></div>
      <div class="dialog-actions"><button type="button" class="ghost" onclick="this.closest('dialog').close()">取消</button><button id="create-submit" type="submit">创建并设计 ${icon("arrow")}</button></div>
    </form></dialog>`;
  try {
    const { tasks } = await api("/api/tasks");
    if (document.body.dataset.page !== "tasks") return;
    state.tasks = tasks; state.taskFilter = "all";
    const n = status => tasks.filter(t => t.status === status).length;
    document.getElementById("task-stats").innerHTML = [["全部任务", tasks.length, "tasks"], ["正在收集", n("collecting"), "workbench"], ["待完善草稿", n("draft"), "design"], ["已经归档", n("archived"), "delivery"]].map(([label, value, ic]) => `<div class="overview-stat"><span>${label}</span><strong>${value.toString().padStart(2,"0")}</strong><i>${icon(ic)}</i></div>`).join("");
    paintTasks();
  } catch (e) { setFlash(e.message); document.getElementById("task-list").innerHTML = '<div class="empty">暂时无法读取任务。<button class="link" onclick="viewTasks()">重新加载</button></div>'; }
}
function filterTasks(filter) {
  state.taskFilter = filter;
  document.querySelectorAll("[data-filter]").forEach(el => { el.classList.toggle("active", el.dataset.filter === filter); el.setAttribute("aria-pressed", String(el.dataset.filter === filter)); });
  paintTasks();
}
function paintTasks() {
  const q = (document.getElementById("task-search")?.value || "").trim().toLowerCase();
  const tasks = state.tasks.filter(t => t.name.toLowerCase().includes(q) && (state.taskFilter === "all" || (state.taskFilter === "done" ? ["closed","archived","cancelled"].includes(t.status) : t.status === state.taskFilter)));
  document.getElementById("task-list").innerHTML = tasks.length ? `<div class="task-list-head"><span>收集任务</span><span>状态</span><span>创建日期</span><span>操作</span></div>` + tasks.map(t => `<article class="task-item"><div class="task-name-cell"><div class="task-icon ${t.status === 'draft' ? 'draft' : ''}">${icon(t.status === 'draft' ? 'design' : 'workbench')}</div><div><a class="task-name" href="#/${t.status === 'draft' ? 'design' : 'workbench'}/${t.id}">${esc(t.name)}</a><div class="task-meta">${t.mode === 'roster' ? '固定名册' : '开放报名'}<span>·</span>任务 #${t.id}</div></div></div><div><span class="badge ${t.status === 'collecting' ? 'ok' : t.status === 'draft' ? 'warn' : ''}"><span class="badge-dot"></span>${esc(TASK_STATUS[t.status] || t.status)}</span></div><time>${esc((t.created_at || '').slice(0,10) || '—')}</time><a class="task-enter" href="#/${t.status === 'draft' ? 'design' : 'workbench'}/${t.id}">${t.status === 'draft' ? '继续设计' : '进入任务'} ${icon('arrow')}</a></article>`).join('') : `<div class="empty-state"><div class="empty-icon">${icon('tasks')}</div><h3>${q || state.taskFilter !== 'all' ? '没有符合条件的任务' : '你的第一个收集任务，从这里开始'}</h3><p>${q || state.taskFilter !== 'all' ? '试试其他关键词或状态。' : '创建任务后，小齐会协助你整理材料要求。'}</p>${!state.tasks.length ? '<button onclick="document.getElementById(&quot;create-dialog&quot;).showModal()">新建收集任务</button>' : ''}</div>`;
}
async function createTask() {
  const btn = document.getElementById("create-submit");
  if (btn.disabled) return;
  const name = document.getElementById("tk-name").value.trim();
  if (!name) return;
  btn.disabled = true;
  try {
    const r = await api("/api/tasks", { method: "POST", form: { name, mode: document.getElementById("tk-mode").value, subject_kind: document.getElementById("tk-kind").value } });
    document.getElementById("create-dialog").close(); location.hash = `#/design/${r.task_id}`;
  } catch(e) { document.getElementById("create-error").textContent = e.message; }
  finally { btn.disabled = false; }
}

/* ---------------------------------------------------------------- P01 对话式设计台 */
const EXECUTOR_LABEL = { deterministic: "程序校验", semantic: "语义审核", cross_material: "跨材料核对", human_only: "人工判断" };
const CAP_BADGE = { supported: '<span class="badge ok">可自动检查</span>', needs_human: '<span class="badge warn">需人工复核</span>', needs_clarification: '<span class="badge warn">待澄清</span>' };
async function viewDesign(taskId) {
  const epoch = state.designEpoch;
  Object.assign(state, {taskId, chat: [], bpId: null, draft: null, requirement: "", answeredDone: false, draftStatus: "draft", draftVersionId: null, designLoadFailed: false, retryRequest: null, designTab: "preview", agentBusy: false, designBlocking: [], designAdvisories: [], designVersions: [], designHistory: [], viewingVersion: null});
  document.getElementById("app").innerHTML = `<div class="breadcrumb"><a href="#/tasks">我的任务</a><span>/</span><span id="design-name">收集任务 #${taskId}</span></div>
    <div class="page-heading design-heading"><div><div class="eyebrow">COLLECTION DESIGN</div><h1>把要求，变成好用的收集表</h1><p>左边一起梳理需求，右边实时核对。确认无误后再发布。</p></div><span class="badge brand" id="draft-state">正在恢复草案</span></div>
    <div id="flash" role="status" aria-live="polite"></div>
    <div class="step-flow"><span class="st on"><span class="dot">1</span>描述需求</span><span class="arw"></span><span class="st" id="st-2"><span class="dot">2</span>核对与澄清</span><span class="arw"></span><span class="st" id="st-3"><span class="dot">3</span>确认发布</span><span class="step-hint">草案自动保存在当前任务中</span></div>
    <div class="grid-chat"><section class="card agent-panel"><div class="agent-heading"><span class="agent-mark">✧</span><div><h2>小齐 <span>需求设计助手</span></h2><p id="agent-status">正在恢复上下文…</p></div><span class="agent-live"></span></div>
      <div class="chat"><div class="chat-scroll" id="chat-scroll" role="log" aria-label="需求对话" aria-live="polite"></div><div class="composer"><div class="chips" id="chat-chips"></div>
      <label class="sr-only" for="chat-in">告诉小齐你的收集要求</label><textarea id="chat-in" placeholder="例如：收一份团课 PDF 报告，登记姓名和班级…" onkeydown="if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();chatSend()}"></textarea>
      <div class="composer-foot"><span>Enter 发送 · Shift + Enter 换行</span><button id="chat-send" onclick="chatSend()" aria-label="发送需求">发送 ${icon('arrow')}</button></div></div></div>
    </section><section id="draft-panel" aria-label="实时收集表预览"></section></div>
    <dialog id="publish-dialog"><form onsubmit="event.preventDefault();confirmPublish()"><div class="eyebrow">REVIEW & PUBLISH</div><h2>确认这份收集要求</h2><p>发布后，这个版本的字段、材料和规则会被冻结。后续修改将产生新版本。</p><div id="publish-summary"></div><label class="check-label"><input type="checkbox" id="publish-consent" required>我已核对材料要求、规则依据、截止时间和数据用途</label><div class="dialog-actions"><button type="button" class="ghost" onclick="this.closest('dialog').close()">返回核对</button><button type="submit" id="publish-confirm">确认并发布</button></div><div id="publish-error" role="alert" class="inline-error"></div></form></dialog>`;
  setAgentBusy(true, "正在恢复草案"); renderDraftPanel();
  try {
    const r = await api(`/api/tasks/${taskId}/design`);
    if (epoch !== state.designEpoch) return;
    state.task = r.task;
    document.getElementById("design-name").textContent = r.task.name;
    if (r.blueprint_version_id) {
      applyDraft(r); state.requirement = r.source_text || "";
      const when = r.versions && r.versions[0] ? fmtTime(r.versions[0].created_at) : "";
      agentSay(`已恢复这项任务的${r.status === 'published' ? '已发布蓝图' : '最新草案'} v${r.version}。`,
        `${when ? `最后保存于 ${esc(when)}。` : ''}右侧实时预览可以核对；继续告诉我需要调整什么，修改会形成新版本。`);
      if ((r.history || []).length) {
        agentSay('这次任务的修改记录：', r.history.slice(-4).map(h => {
          const label = h.action === 'blueprint.publish' ? `发布 v${h.version}`
            : h.action === 'blueprint.revise_noop' ? '一次修改未形成新版本'
            : `修订 v${h.from_version} → v${h.version}`;
          return `${esc(label)}${h.impact ? `（${esc(h.impact)}）` : ''} · ${esc(fmtTime(h.created_at))}`;
        }).join('<br>'));
      }
      if ((r.blocking || []).length) {
        agentSay('这份草案还不能发布，需要先处理：', r.blocking.map(esc).join('<br>'));
      } else if ((r.advisories || []).length) {
        agentSay('有几项提醒，不影响发布，但建议发布前看一眼：', r.advisories.map(esc).join('<br>'));
      }
    } else {
      agentSay('这次，你想收些什么？', '告诉我收集对象、需要登记的信息和材料。还没想清楚也没关系，我们可以从一份模板开始。');
      agentSay('我会先整理草案，只追问影响收集的关键信息。', '不确定的地方会标出来；未经你确认，不会发布，也不会暗加材料门槛。');
    }
  } catch(e) { if (epoch === state.designEpoch) { state.designLoadFailed = true; setFlash('未能恢复草案：' + e.message + '。请重新打开此页面，以免覆盖已有设计。'); } }
  finally { if (epoch === state.designEpoch) { setAgentBusy(false); renderChips(); renderDraftPanel(); } }
}
function applyDraft(r) {
  state.bpId = r.blueprint_version_id; state.draft = r.draft;
  state.draftVersionId = r.version || state.draftVersionId;
  state.draftStatus = r.status || 'draft';
  state.answeredDone = !(r.draft.clarifications || []).length;
  if (r.blocking) state.designBlocking = r.blocking;
  if (r.advisories) state.designAdvisories = r.advisories;
  if (r.versions) state.designVersions = r.versions;
  if (r.history) state.designHistory = r.history;
}
function setAgentBusy(on, label = "正在整理需求") {
  state.agentBusy = on;
  document.getElementById('chat-send')?.toggleAttribute('disabled', on);
  document.getElementById('chat-in')?.toggleAttribute('disabled', on);
  document.querySelectorAll('#chat-chips button, #clar-card input, #clar-card button, [data-publish]').forEach(x => x.disabled = on);
  const status = document.getElementById('agent-status');
  if (status) status.textContent = on ? label + '，可能需要一点时间…' : '与你一起确认，不代替你做决定';
  const box = document.getElementById('chat-scroll'); if (box) box.setAttribute('aria-busy', String(on));
  chatTyping(on);
}
function renderChips() {
  const box = document.getElementById('chat-chips'); if (!box) return;
  box.innerHTML = state.bpId ? `<button class="chip" onclick="fillChat('我想调整截止时间：')">调整截止</button><button class="chip" onclick="fillChat('我想修改材料格式：')">材料格式</button><button class="chip" onclick="fillChat('增加一个登记字段：')">增加字段</button>` : `<button class="chip" onclick="quickTemplate('class_report')">${icon('workbench')} 团课报告</button><button class="chip" onclick="quickTemplate('contest_signup')">${icon('roster')} 比赛报名</button>`;
  box.querySelectorAll('button').forEach(x => x.disabled = state.agentBusy || state.designLoadFailed);
}
function fillChat(t) { if (state.agentBusy) return; const el = document.getElementById('chat-in'); el.value = t; el.focus(); }
function chatScrollBottom() { const el = document.getElementById('chat-scroll'); if (el) el.scrollTop = el.scrollHeight; }
function userSay(text) { state.chat.push({role: 'user', html: esc(text).replace(/\n/g,'<br>')}); paintChat(); }
function agentSay(html, mini) { state.chat.push({role: 'agent', html, mini: mini || ''}); paintChat(); }
function chatTyping(on) {
  document.getElementById('typing-row')?.remove(); if (!on) return;
  const box = document.getElementById('chat-scroll'); if (!box) return;
  box.insertAdjacentHTML('beforeend', '<div class="msg agent" id="typing-row"><div class="avatar">✧</div><div class="body"><span class="typing"><i></i><i></i><i></i></span><span class="mini">正在处理，草案不会被提前发布</span></div></div>'); chatScrollBottom();
}
function paintChat() {
  const box = document.getElementById('chat-scroll'); if (!box) return;
  box.innerHTML = state.chat.map(m => `<div class="msg ${m.role}"><div class="avatar">${m.role === 'agent' ? '✧' : '我'}</div><div class="body">${m.html}${m.mini ? `<div class="mini">${m.mini}</div>` : ''}</div></div>`).join('');
  const clar = state.draft?.clarifications || [];
  if (state.bpId && clar.length && !state.answeredDone) box.insertAdjacentHTML('beforeend', clarCard(clar));
  chatScrollBottom();
}
function clarCard(clars) {
  const affects = c => (c.affects_rule_ids || []).length
    ? `<p class="field-help">影响规则：${c.affects_rule_ids.map(esc).join("、")}</p>` : "";
  return `<div class="clar-card" id="clar-card"><div class="eyebrow">NEEDS YOUR INPUT</div><h3>有 ${clars.length} 项需要你确认</h3><p class="muted">只回答已确定的内容，留空会保留为待确认，不代表同意默认值。</p>${clars.map((c,i) => `<label for="clar-${i}">${i+1}. ${esc(c.question)}</label>${c.why ? `<p class="field-help">${esc(c.why)}</p>` : ''}${affects(c)}<input id="clar-${i}" placeholder="填写你的决定">`).join('')}<label for="clar-extra">其他修改意见（可选）</label><input id="clar-extra" placeholder="还需要调整什么？"><button onclick="submitClarAnswers()">更新草案 ${icon('arrow')}</button></div>`;
}
async function quickTemplate(tpl) {
  if (state.agentBusy || state.designLoadFailed) return;
  const epoch = state.designEpoch; setAgentBusy(true, '正在准备模板'); setFlash('');
  try {
    const r = await api(`/api/tasks/${state.taskId}/draft/template`, {method: 'POST', form: {template: tpl}});
    if (epoch !== state.designEpoch) return;
    // 模板接口不返回版本列表与时间线，补拉一次设计状态，避免版本下拉只剩占位项
    let fresh = null;
    try { fresh = await api(`/api/tasks/${state.taskId}/design`); } catch (e) { fresh = null; }
    if (epoch !== state.designEpoch) return;
    applyDraft(fresh || {...r, draft: r.draft || {blueprint: r.blueprint, clarifications: [], publish_summary: [], warnings: []}});
    userSay(`以「${tpl === 'class_report' ? '团课报告' : '比赛报名'}」模板开始`);
    agentSay('模板已准备好。这只是起点，不是最终要求。', '请核对材料、时间、审核方式和数据用途。你可以继续输入修改意见。');
  } catch(e) { if (epoch === state.designEpoch) agentSay('模板暂时没有载入，请稍后重试。', esc(e.message)); }
  finally { if (epoch === state.designEpoch) { setAgentBusy(false); renderChips(); renderDraftPanel(); } }
}
function impactText(im = {}) {
  const bits = [];
  for (const [k, label] of [['fields','登记字段'],['slots','材料'],['rules','检查规则']]) {
    const c = im[k] || {};
    for (const [action, word] of [['added','新增'],['removed','移除'],['changed','调整']]) if(c[action]?.length) bits.push(`${label}${word} ${c[action].length} 项`);
  }
  if(im.time_policy_changed) bits.push('截止时间已调整');
  if(im.manual_acceptance_changed) bits.push('验收方式已调整');
  if(im.eligibility_required_changed) bits.push('资格要求已调整');
  return bits.length ? esc(bits.join('；')) : '没有实质变更，沿用原草案。';
}
async function runAgent(text, answered = {}, instruction = '') {
  if (state.agentBusy || state.designLoadFailed) return;
  const epoch = state.designEpoch, previous = state.bpId;
  const clarValues = Array.from(document.querySelectorAll('#clar-card input')).map(el => [el.id, el.value]);
  const el = document.getElementById('chat-in'); if (el) el.value = '';
  userSay(text); setAgentBusy(true, previous ? '正在核对修改影响' : '正在整理字段、材料与规则'); setFlash('');
  try {
    const r = await api(`/api/tasks/${state.taskId}/draft/${previous ? 'revise' : 'agent'}`, {method:'POST', form: previous ? {blueprint_version_id:String(previous), requirement:state.requirement || '', answered:JSON.stringify(answered), instruction} : {requirement:text}});
    if(epoch !== state.designEpoch) return;
    applyDraft(r); if (!previous) state.requirement = text;
    const warnings = r.draft.warnings || [], unchanged = previous === r.blueprint_version_id;
    const bp = r.draft.blueprint || {};
    const empty = !bp.fields?.length && !bp.slots?.length && !bp.rules?.length;
    agentSay(empty ? '这次没有生成可用的收集表。你的要求仍保留在对话中。' : unchanged ? '本次未形成新版本，原草案仍然保留。' : previous ? '草案已更新，请核对右侧的变化。' : '第一份草案已整理好，先一起核对。', previous ? impactText(r.impact) : empty ? '可以重试，或使用模板开始。' : `登记字段 ${bp.fields?.length || 0} 项 · 材料 ${bp.slots?.length || 0} 项 · 检查规则 ${bp.rules?.length || 0} 条`);
    if (warnings.length) agentSay('有些内容还不能直接发布。', warnings.map(esc).join('<br>'));
    if (empty || (unchanged && warnings.length)) {
      state.retryRequest = {text, answered, instruction};
      agentSay('<button class="ghost sm" onclick="retryAgent()">重试这次请求</button>');
    } else state.retryRequest = null;
    renderChips(); renderDraftPanel();
  } catch(e) {
    if(epoch !== state.designEpoch) return;
    state.retryRequest = {text, answered, instruction};
    agentSay('这次请求没有完成，原草案未被替换。', `${esc(e.message)}<br><button class="ghost sm" onclick="retryAgent()">重试这次请求</button>`);
    if(el) el.value = instruction || text;
    clarValues.forEach(([id,value]) => { const input = document.getElementById(id); if(input) input.value = value; });
  } finally { if(epoch === state.designEpoch) { setAgentBusy(false); renderChips(); renderDraftPanel(); } }
}
function retryAgent() { if(state.retryRequest) { const {text,answered,instruction} = state.retryRequest; return runAgent(text, answered, instruction); } }
function chatSend() { const text = (document.getElementById('chat-in')?.value || '').trim(); if (text) return runAgent(text, {}, state.bpId ? text : ''); }
function submitClarAnswers() {
  const answered = {}; (state.draft?.clarifications || []).forEach((c,i) => { const v = document.getElementById(`clar-${i}`)?.value.trim(); if(v) answered[c.question] = v; });
  const instruction = document.getElementById('clar-extra')?.value.trim() || '';
  if (!Object.keys(answered).length && !instruction) { setFlash('请至少回答一项，或填写修改意见。留空不会自动确认。'); return; }
  return runAgent(Object.entries(answered).map(([q,a]) => `${q}：${a}`).concat(instruction ? [instruction] : []).join('\n'), answered, instruction);
}
function setDesignTab(tab) { state.designTab = tab; renderDraftPanel(); }
function renderDraftPanel() {
  const box = document.getElementById('draft-panel'); if(!box) return;
  const d = state.draft, bp = d?.blueprint, has = !!(state.bpId && bp);
  const viewing = state.viewingVersion;
  const label = document.getElementById('draft-state');
  if(label) label.textContent = has
    ? `${viewing ? '只读' : (state.draftStatus === 'published' ? '已发布' : '草案')} v${state.draftVersionId || '—'}`
    : '尚未生成草案';
  document.getElementById('st-2')?.classList.toggle('on',has);
  document.getElementById('st-3')?.classList.toggle('on',state.draftStatus === 'published');
  if(!has) { box.innerHTML = `<div class="preview-empty"><div class="preview-empty-art"><div class="mock-sheet"><span></span><i></i><i></i><b></b></div><span class="floating-spark">✧</span></div><div class="eyebrow">LIVE PREVIEW</div><h2>你的收集表，会在这里成形</h2><p>先告诉小齐你的要求，或选一个模板。<br>字段、材料和检查依据会一起呈现。</p><div class="preview-placeholder-tags"><span>登记信息</span><span>材料上传</span><span>检查规则</span></div></div>`; return; }
  const rules = bp.rules || [], tp = bp.time_policy || {}, clar = d.clarifications || [];
  const scope = bp.task_scope || {}, hasContents = (bp.fields || []).length || (bp.slots || []).length;
  const blocking = state.designBlocking || [], advisories = state.designAdvisories || [];
  const versionOptions = (state.designVersions || []).map(v =>
    `<option value="${v.id}" ${state.bpId === v.id ? 'selected' : ''}>v${v.version} · ${v.status === 'published' ? '已发布' : '草案'}${v.created_at ? ' · ' + esc(fmtTime(v.created_at).slice(5, 16)) : ''}</option>`).join('');
  box.innerHTML = `<div class="draft-toolbar"><div role="tablist" aria-label="草案视图"><button role="tab" aria-selected="${state.designTab === 'preview'}" onclick="setDesignTab('preview')" class="${state.designTab === 'preview' ? 'on' : ''}">提交者预览</button><button role="tab" aria-selected="${state.designTab === 'rules'}" onclick="setDesignTab('rules')" class="${state.designTab === 'rules' ? 'on' : ''}">规则与依据 <span>${rules.length}</span></button></div>
      <label class="version-picker"><span>版本</span><select onchange="loadDesignVersion(this.value)" aria-label="查看历史版本">${versionOptions || `<option>v${state.draftVersionId || 1}</option>`}</select></label></div>
    ${viewing ? `<div class="version-banner" role="status"><div><b>正在查看历史版本 v${viewing.version}</b><span>这是只读快照，发布与修订仍以最新草案为准。</span></div><div class="row-actions"><button class="ghost sm" onclick="useVersionAsBase()">以此为起点修改</button><button class="ghost sm" onclick="backToLatest()">回到最新</button></div></div>` : ''}
    ${blocking.length ? `<div class="draft-warning blocking" role="alert"><b>发布前必须处理 ${blocking.length} 项</b><ul>${blocking.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
    ${advisories.length ? `<div class="draft-warning" role="status"><b>${blocking.length ? '另有' : ''} ${advisories.length} 项提醒（不阻止发布）</b><ul>${advisories.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
    <div class="draft-content" role="tabpanel">${state.designTab === 'preview' ? `<div class="form-preview"><div class="preview-banner"><span>${scope.mode === 'open' ? '开放报名' : '名册收集'}</span><span>填写预览 · 不会提交</span></div><h2>${esc(scope.name || state.task?.name || '收集任务')}</h2><p class="muted">${esc(scope.description || '请按以下要求登记信息并提交材料。')}</p>
      <div class="preview-section-title"><b>01</b> 登记信息</div>${(bp.fields || []).map(f => `<div class="preview-field"><label>${esc(f.label)}${f.required ? '<em> *</em>' : ' <small>选填</small>'}</label>${f.type === 'enum' ? `<select disabled aria-label="${esc(f.label)}"><option>请选择${esc(f.label)}</option>${(f.options || []).map(o => `<option>${esc(o)}</option>`).join('')}</select>` : `<input disabled aria-label="${esc(f.label)}" placeholder="请填写${esc(f.label)}">`}${f.required_condition ? `<p class="field-help">条件：${esc(f.required_condition)}</p>` : ''}${f.purpose ? `<p class="field-help">用途：${esc(f.purpose)}</p>` : ''}</div>`).join('') || '<p class="muted">尚未设置登记字段</p>'}
      <div class="preview-section-title"><b>02</b> 提交材料</div>${(bp.slots || []).map(sl => `<div class="upload-preview">${icon('delivery')}<div><strong>${esc(sl.label)}</strong><p>${(sl.formats || []).map(x=>esc(x.toUpperCase())).join(' / ') || '未限定格式'} · 最多 ${sl.max_count} 份${sl.max_size_mib ? ` · 每份 ≤ ${sl.max_size_mib} MiB` : ''}${sl.max_pages ? ` · ≤ ${sl.max_pages} 页` : ''}</p>${sl.required_condition ? `<p>条件：${esc(sl.required_condition)}</p>` : ''}</div><span>上传区域</span></div>`).join('') || '<p class="muted">尚未设置材料</p>'}
      <div class="preview-section-title"><b>03</b> 时间与验收</div><dl class="kv-list"><dt>时区</dt><dd>${esc(tp.timezone || 'Asia/Shanghai')}</dd><dt>开始收集</dt><dd>${esc(fmtTime(tp.open_at))}</dd><dt>首次截止</dt><dd>${esc(fmtTime(tp.first_deadline))}</dd><dt>补正截止</dt><dd>${esc(fmtTime(tp.correction_deadline))}</dd><dt>最终验收</dt><dd>${bp.manual_acceptance ? '组织者人工确认' : '按规则处理'}</dd></dl></div>` : `<div class="rules-preview"><h2>每条要求，都有依据</h2><p class="muted">程序校验、语义审核与人工判断分别标注，不把不确定的结论当成通过。</p>${rules.map((r,i) => `<article class="rule-preview"><div><span class="rule-number">${String(i+1).padStart(2,'0')}</span>${CAP_BADGE[r.capability] || ''}<span class="badge">${esc(EXECUTOR_LABEL[r.executor] || r.executor)}</span></div><h3>${esc(r.statement)}</h3><blockquote>${esc(r.requirement_source || '模板预置要求，请组织者核对')}</blockquote><p class="field-help">${r.severity === 'blocking' ? '阻塞项 · 未处理时不能验收' : '提醒项'}${r.clarification_question ? ' · ' + esc(r.clarification_question) : ''}</p></article>`).join('') || '<div class="empty">尚未设置检查规则</div>'}<details><summary>原始要求与修订依据</summary><p class="source-text">${esc(state.requirement || '当前使用模板预置要求，尚无自然语言输入。')}</p></details><details><summary>交付与数据治理</summary><pre>${esc(JSON.stringify({delivery:bp.delivery, governance:bp.governance},null,2))}</pre></details></div>`}</div>
    <div class="publish-bar"><div><strong>${viewing ? `历史版本 v${viewing.version}（只读）` : state.draftStatus === 'published' ? '当前版本已发布' : blocking.length ? '发布前还有内容必须处理' : '准备好后，由你确认发布'}</strong><span>${clar.length ? `${clar.length} 项待澄清 · ` : ''}${blocking.length ? `${blocking.length} 项阻塞 · ` : ''}${advisories.length ? `${advisories.length} 项提醒 · ` : ''}${rules.length} 条规则 · 修改将保留版本记录</span></div><button data-publish onclick="publishBp(${state.taskId})" ${state.agentBusy || !hasContents || state.draftStatus === 'published' || blocking.length || viewing ? 'disabled' : ''}>${state.draftStatus === 'published' ? '已发布' : '核对并发布'} ${icon('arrow')}</button></div>`;
}

async function loadDesignVersion(bpId) {
  if (!bpId || state.agentBusy) return;
  const epoch = state.designEpoch;
  try {
    const r = await api(`/api/tasks/${state.taskId}/blueprints/${bpId}`);
    if (epoch !== state.designEpoch) return;
    state.viewingVersion = {id: r.blueprint_version_id, version: r.version, status: r.status};
    state.draft = r.draft;
    state.draftVersionId = r.version;
    state.draftStatus = r.status;
    state.designBlocking = r.blocking || [];
    state.designAdvisories = r.advisories || [];
    renderDraftPanel();
  } catch(e) { setFlash('无法读取该版本：' + e.message); }
}
function backToLatest() {
  state.viewingVersion = null;
  viewDesign(state.taskId);
}
function useVersionAsBase() {
  const v = state.viewingVersion;
  if (!v) return;
  state.bpId = v.id;
  state.viewingVersion = null;
  state.draftStatus = 'draft';
  agentSay(`已切换到 v${v.version} 作为修订起点。`, '接下来的修改会基于这个版本形成新草案，历史版本仍然保留。');
  renderDraftPanel();
}

function publishBp(taskId) {
  if(state.agentBusy || !state.bpId || state.draftStatus === 'published' || (state.designBlocking || []).length) return;
  const bp = state.draft.blueprint;
  const tp = bp.time_policy || {};
  const fields = bp.fields || [], slots = bp.slots || [], rules = bp.rules || [];
  const advisories = state.designAdvisories || [];
  document.getElementById('publish-summary').innerHTML = `<div class="publish-review">
    <div class="publish-group"><div class="eyebrow">收集对象</div><p><b>${esc(bp.task_scope?.name || state.task?.name || '')}</b> · ${bp.task_scope?.mode === 'open' ? '开放报名' : '名册收集'} · ${bp.task_scope?.subject_kind === 'team' ? '团队提交' : '个人提交'}</p></div>
    <div class="publish-group"><div class="eyebrow">登记字段（${fields.length}）</div><p>${fields.map(f => `${esc(f.label)}${f.required ? '*' : ''}${f.required_condition ? `（${esc(f.required_condition)}）` : ''}`).join('、') || '无'}</p></div>
    <div class="publish-group"><div class="eyebrow">材料（${slots.length}）</div><p>${slots.map(s => `${esc(s.label)}：${(s.formats || []).map(x => esc(x.toUpperCase())).join('/') || '不限格式'}，最多 ${s.max_count} 份${s.max_size_mib ? `，≤${s.max_size_mib}MiB` : ''}${s.required_condition ? `，条件 ${esc(s.required_condition)}` : ''}`).join('<br>') || '无'}</p></div>
    <div class="publish-group"><div class="eyebrow">检查规则（${rules.length}）</div><ul class="publish-rules">${rules.map(r => `<li><span class="badge ${r.capability === 'supported' ? 'ok' : 'warn'}">${esc((CAP_BADGE[r.capability] || '').replace(/<[^>]+>/g, ''))}</span>${esc(r.statement)}</li>`).join('') || '<li>无</li>'}</ul></div>
    <div class="publish-group"><div class="eyebrow">时间</div><p>时区 ${esc(tp.timezone || 'Asia/Shanghai')} · 开始 ${esc(fmtTime(tp.open_at))} · 首次截止 ${esc(fmtTime(tp.first_deadline))} · 补正截止 ${esc(fmtTime(tp.correction_deadline))}</p></div>
    ${advisories.length ? `<div class="draft-warning"><b>${advisories.length} 项提醒（不阻止发布）</b><ul>${advisories.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
  </div>`;
  document.getElementById('publish-error').textContent = ''; document.getElementById('publish-consent').checked = false;
  document.getElementById('publish-dialog').showModal();
}
async function confirmPublish() {
  if(state.agentBusy || !document.getElementById('publish-consent').checked) return;
  const epoch = state.designEpoch, taskId = state.taskId, bpId = state.bpId;
  const btn = document.getElementById('publish-confirm'); btn.disabled = true; setAgentBusy(true,'正在校验发布条件');
  try {
    const r = await api(`/api/tasks/${taskId}/blueprints/${bpId}/publish`, {method:'POST'});
    if(epoch !== state.designEpoch) return;
    state.draftStatus = 'published'; document.getElementById('publish-dialog').close();
    agentSay(`版本 v${r.published_version} 已发布。`, `下一步：<a href="#/roster/${taskId}">管理名单与提交凭证 ${icon('arrow')}</a>。没有发放凭证，不代表已通知提交者。`);
    const fresh = await api(`/api/tasks/${taskId}/design`);
    if (epoch === state.designEpoch) applyDraft(fresh);
    renderDraftPanel();
  } catch(e) { if(epoch === state.designEpoch) document.getElementById('publish-error').textContent = e.message; }
  finally { if(epoch === state.designEpoch) { btn.disabled = false; setAgentBusy(false); renderDraftPanel(); } }
}

/* ---------------------------------------------------------------- 名单管理 */
async function viewRoster(taskId) {
  state.rosterTaskId = taskId;
  document.getElementById("app").innerHTML = `
    <div class="breadcrumb"><a href="#/tasks">我的任务</a><span>/</span><span id="roster-name">任务 #${taskId}</span></div>
    <div class="page-heading"><div><div class="eyebrow">ROSTER & CREDENTIALS</div><h1>名单与提交凭证<span class="heading-dot">.</span></h1><p>谁来交、谁免交，以及每个人进入提交空间的唯一钥匙。</p></div><a class="ghost" href="#/workbench/${taskId}">去工作台 ${icon("arrow")}</a></div>
    <div id="flash" role="status" aria-live="polite"></div>
    <div class="overview-stats" id="roster-stats"></div>
    <p class="workspace-note">${icon("roster")} 名册 = 应交 + 有效免交；应交 = 已正式提交 + 未正式提交。验收、补正和人工待办都是已提交的子集，不能相加成总人数。</p>
    <div class="roster-grid">
      <section class="card roster-import"><div class="section-heading"><div><div class="eyebrow">01 / IMPORT</div><h2>导入名册</h2></div></div>
        <p class="muted">每行一条：<b>姓名</b> 或 <b>姓名,备注</b>（中英文逗号或制表符均可；备注建议写学号/班级，用于按班整理与核对）。</p>
        <textarea id="roster-raw" placeholder="张三,一班&#10;李四,一班&#10;王五,二班" aria-label="粘贴名册"></textarea>
        <div class="preview-box" id="roster-preview">输入后这里实时显示解析预览</div>
        <button onclick="importRoster(${taskId})" style="width:100%">导入名册 ${icon("arrow")}</button>
      </section>
      <section class="card roster-list"><div class="section-heading"><div><div class="eyebrow">02 / CREDENTIALS</div><h2>名册与凭证</h2></div><button class="ghost sm" onclick="issueAllGrants(${taskId})">为全部未发放主体发放</button></div>
        <div id="roster-table"><p class="empty">正在读取名册…</p></div>
        <div id="grant-out"></div>
        <p class="field-help">凭证是提交者进入本人提交空间的唯一钥匙，请通过私下渠道发放；同名主体只按名复用提交空间，是否同一人请在复核页人工核对，不自动合并。重发会生成新凭证。</p>
      </section>
    </div>`;
  document.getElementById("roster-raw").addEventListener("input", renderRosterPreview);
  await loadRoster(taskId);
}

function parseRosterText(text) {
  const rows = [], seen = new Set(), dup = [];
  for (const line of (text || "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/[,\t，]/).map(x => x.trim());
    const name = parts[0] || "";
    if (!name) continue;
    if (seen.has(name)) { dup.push(name); continue; }
    seen.add(name);
    rows.push({ name, ref: parts.slice(1).join(",") });
  }
  return { rows, dup };
}

function renderRosterPreview() {
  const { rows, dup } = parseRosterText(document.getElementById("roster-raw").value);
  const box = document.getElementById("roster-preview");
  if (!rows.length && !dup.length) { box.textContent = "输入后这里实时显示解析预览"; return; }
  box.innerHTML = `将导入 <b>${rows.length}</b> 条${dup.length
    ? `，跳过重复 ${dup.length} 条（${esc(dup.join("、"))}）` : ""}
    <table style="margin-top:8px"><tr><th>#</th><th>姓名</th><th>备注</th></tr>
    ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${esc(r.ref || "-")}</td></tr>`).join("")}
    </table>`;
}

async function loadRoster(taskId) {
  const d = await api(`/api/tasks/${taskId}/roster`);
  state.roster = {};
  d.entries.forEach(e => { state.roster[e.id] = e; });
  const nameEl = document.getElementById("roster-name");
  if (nameEl && d.entries.length !== undefined) nameEl.textContent = `任务 #${taskId}`;
  document.getElementById("roster-stats").innerHTML =
    [["名册总数", d.total, "roster"], ["已发放凭证", d.granted, "design"], ["有效免交", d.exempt, "delivery"], ["待发放", Math.max(0, d.total - d.granted - d.exempt), "workbench"]]
      .map(([l, n, ic]) => `<div class="overview-stat"><span>${l}</span><strong>${String(n).padStart(2, "0")}</strong><i>${icon(ic)}</i></div>`).join("");
  document.getElementById("roster-table").innerHTML = d.entries.length ? `
    <div class="roster-head"><span>姓名 / 备注</span><span>凭证</span><span>提交空间</span><span>操作</span></div>
    ${d.entries.map(e => `<article class="roster-row">
      <div class="roster-person"><span class="wb-avatar" aria-hidden="true">${esc((e.name || "?").slice(0, 1))}</span><div><b>${esc(e.name)}</b><span>${esc(e.ref || "未填备注")}</span></div></div>
      <div>${e.granted ? '<span class="badge ok">已发放</span>' : '<span class="badge warn">未发放</span>'}</div>
      <div>${e.exempt ? '<span class="badge info">免交</span>'
        : (e.subject_id ? `<span class="badge">#${e.subject_id}</span>` : '<span class="muted">发放时创建</span>')}</div>
      <div class="roster-actions"><button class="ghost sm" onclick="issueGrant(${taskId},${e.id})">${
          e.granted ? "重发凭证" : "发放凭证"}</button></div>
    </article>`).join("")}`
    : `<div class="empty-state"><div class="empty-icon">${icon("roster")}</div><h3>名册还是空的</h3><p>在左侧粘贴名单导入，系统会按行生成提交主体。</p></div>`;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand("copy"); ta.remove(); return true;
  }
}
async function copyCredential(cred) {
  await copyText(cred);
  setFlash("凭证已复制。请通过私下渠道发给本人。", "ok");
}

async function importRoster(taskId) {
  await guard(async () => {
    const { rows } = parseRosterText(document.getElementById("roster-raw").value);
    if (!rows.length) throw new Error("没有可导入的有效行");
    const r = await api(`/api/tasks/${taskId}/roster`, { method: "POST", json: rows });
    setFlash(`已导入 ${r.imported} 条名册`, "ok");
    document.getElementById("roster-raw").value = "";
    renderRosterPreview();
    await loadRoster(taskId);
  });
}

async function issueGrant(taskId, entryId) {
  await guard(async () => {
    const e = state.roster[entryId];
    if (!e) throw new Error("名册条目不存在，请刷新页面");
    const r = await api(`/api/tasks/${taskId}/grants`, {
      method: "POST",
      form: { subject_name: e.name, roster_entry_id: String(entryId) } });
    showCredential(e.name, r.credential);
    await loadRoster(taskId);
  });
}

async function issueAllGrants(taskId) {
  await guard(async () => {
    const d = await api(`/api/tasks/${taskId}/roster`);
    const todo = d.entries.filter(e => !e.granted && !e.exempt);
    if (!todo.length) { setFlash("所有名册主体都已发放凭证（免交主体不发放）", "ok"); return; }
    if (!window.confirm(`将为 ${todo.length} 个未发放凭证的主体各生成一个凭证，继续？`)) return;
    const out = [];
    for (const e of todo) {
      const r = await api(`/api/tasks/${taskId}/grants`, {
        method: "POST",
        form: { subject_name: e.name, roster_entry_id: String(e.id) } });
      out.push({ name: e.name, credential: r.credential });
    }
    showCredentialList(out);
    await loadRoster(taskId);
  });
}

function showCredential(name, cred) {
  document.getElementById("grant-out").innerHTML = `
    <div class="credential-card">
      <div><span class="eyebrow">NEW CREDENTIAL · 仅显示这一次</span><b>${esc(name)}</b></div>
      <code>${esc(cred)}</code>
      <div class="row-actions"><button class="sm" onclick="copyCredential(this.dataset.cred)" data-cred="${esc(cred)}">复制凭证</button><span class="muted">请通过私下渠道发给本人</span></div>
      <p class="field-help">重发会生成新凭证；为安全起见，旧凭证仍有效直到被撤销或过期。</p>
    </div>`;
}
function showCredentialList(list) {
  document.getElementById("grant-out").innerHTML = `
    <div class="credential-card"><div><span class="eyebrow">NEW CREDENTIALS · 仅显示这一次</span><b>已生成 ${list.length} 个凭证</b></div>
    <p class="field-help">请逐一复制发给对应同学；关闭页面后无法再次查看明文。</p></div>
    <div class="credential-grid">${list.map(x => `<div class="credential-chip"><b>${esc(x.name)}</b><code>${esc(x.credential)}</code><button class="ghost sm" onclick="copyCredential(this.dataset.cred)" data-cred="${esc(x.credential)}">复制</button></div>`).join("")}</div>`;
}

/* ---------------------------------------------------------------- P02 工作台 */
const TASK_STATUS_LABEL = {draft: "草稿", collecting: "收集中", closed: "已关闭",
                           archived: "已归档", cancelled: "已取消"};
const READONLY_STATUSES = ["closed", "archived", "cancelled"];

const WB_BADGE = {
  "未正式提交": "", "排队中": "info", "检查中": "info",
  "待补正": "bad", "待人工": "warn", "检查未完成": "warn",
  "已验收": "ok", "规则通过": "ok", "规则通过（待人工验收）": "info",
};
function viewWorkbench(taskId) {
  state.wbTaskId = taskId; state.wbFilter = state.wbFilter || "all";
  state.wbQuery = "";
  document.getElementById("app").innerHTML = `
    <div class="breadcrumb"><a href="#/tasks">我的任务</a><span>/</span><span id="wb-task-name">任务 #${taskId}</span></div>
    <div class="page-heading"><div><div class="eyebrow">COLLECTION WORKBENCH</div><h1>收集工作台<span class="heading-dot">.</span></h1><p>谁没交、谁要改、谁等你决定，都在这一页。</p></div>
      <div id="wb-lifecycle" class="row-actions"></div></div>
    <div id="flash" role="status" aria-live="polite"></div>
    <div id="wb-readonly"></div>
    <div class="overview-stats wb-summary" id="wb-stats"></div>
    <div class="wb-layout">
      <section class="card wb-panel" aria-label="提交者列表">
        <div class="section-toolbar"><div class="task-filters" role="group" aria-label="提交状态筛选">
          <button class="filter active" data-wbfilter="all" onclick="filterWorkbench('all')">全部</button>
          <button class="filter" data-wbfilter="todo" onclick="filterWorkbench('todo')">待处理</button>
          <button class="filter" data-wbfilter="submitted" onclick="filterWorkbench('submitted')">已提交</button>
          <button class="filter" data-wbfilter="missing" onclick="filterWorkbench('missing')">未提交</button></div>
          <label class="search-box">${icon("search")}<input id="wb-search" aria-label="搜索提交者" placeholder="搜索姓名…" oninput="state.wbQuery=this.value;paintWorkbench()"></label></div>
        <div id="wb-list" aria-live="polite"><p class="empty">正在读取提交情况…</p></div>
      </section>
      <aside class="card remind-panel" id="remind-panel" aria-label="催交">
        <div class="remind-head"><div><div class="eyebrow">REMINDERS</div><h2>催交</h2></div><span class="badge warn" id="remind-count">—</span></div>
        <p class="muted">只生成可复制的通知内容，不宣称已发送。名单每次重算：已提交与免交会自动移出。</p>
        <div id="remind-body"><p class="empty">正在读取催交名单…</p></div>
      </aside>
    </div>`;
  refreshWorkbench();
}

async function refreshWorkbench() {
  const taskId = state.wbTaskId; if (!taskId) return;
  try {
    const [data, notif] = await Promise.all([
      api(`/api/tasks/${taskId}/workbench`),
      api(`/api/tasks/${taskId}/notifications`),
    ]);
    if (state.wbTaskId !== taskId) return;
    state.wbTask = data.task || {}; state.wbRows = data.rows || [];
    state.reminder = {
      view: notif.view || { targets: [], exempt: [], submitted: [], overdue: [] },
      notifications: notif.notifications || [],
      created: state.reminder?.created || null,
      selected: null,
    };
    paintWorkbench();
    paintReminder();
    const pending = state.wbRows.some(r => ["queued", "running", "retry_wait"].includes(r.run_status));
    clearTimeout(_wbTimer);
    if (pending) _wbTimer = setTimeout(refreshWorkbench, 3000);
  } catch (e) { setFlash(e.message); }
}

function wbMatches(r, filter) {
  const hasRevision = r.revision != null && r.summary !== "未正式提交";
  if (filter === "todo") return hasRevision && ["待补正", "待人工", "检查未完成"].includes(r.summary);
  if (filter === "submitted") return hasRevision;
  if (filter === "missing") return !hasRevision;
  return true;
}
function paintWorkbench() {
  const t = state.wbTask || {}, taskId = state.wbTaskId, rows = state.wbRows || [];
  const ro = READONLY_STATUSES.includes(t.status);
  const label = TASK_STATUS_LABEL[t.status] || t.status;
  const nameEl = document.getElementById("wb-task-name"); if (nameEl && t.name) nameEl.textContent = t.name;
  const lc = document.getElementById("wb-lifecycle");
  if (lc) lc.innerHTML = `<span class="badge ${ro ? "warn" : "ok"}"><span class="badge-dot"></span>${esc(label)}</span>${lifecycleButtons(t.status, taskId)}`;
  const roBox = document.getElementById("wb-readonly");
  if (roBox) roBox.innerHTML = ro ? `<div class="notice-warn">任务已${esc(label)}，处于只读状态：提交、上传、检查与修订均已停止；历史数据仍可查看与导出。</div>` : "";

  const count = (pred) => rows.filter(pred).length;
  const metrics = [
    ["应交主体", rows.length, "roster"],
    ["已正式提交", count(r => r.revision != null), "workbench"],
    ["待补正", count(r => r.summary === "待补正"), "design"],
    ["待人工", count(r => r.summary === "待人工"), "review"],
    ["检查中", count(r => ["queued", "running", "retry_wait"].includes(r.run_status)), "delivery"],
  ];
  const stats = document.getElementById("wb-stats");
  if (stats) stats.innerHTML = metrics.map(([label2, value, ic]) =>
    `<div class="overview-stat"><span>${label2}</span><strong>${String(value).padStart(2, "0")}</strong><i>${icon(ic)}</i></div>`).join("");

  const q = (state.wbQuery || "").trim().toLowerCase();
  const visible = rows.filter(r => (r.name || "").toLowerCase().includes(q) && wbMatches(r, state.wbFilter));
  document.querySelectorAll("[data-wbfilter]").forEach(el => {
    const on = el.dataset.wbfilter === state.wbFilter;
    el.classList.toggle("active", on); el.setAttribute("aria-pressed", String(on));
  });
  const box = document.getElementById("wb-list");
  if (!box) return;
  if (!rows.length) {
    box.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon("roster")}</div><h3>还没有提交主体</h3><p>先到 <a href="#/roster/${taskId}">名单与凭证</a> 导入名册或创建提交空间，这里就会显示每个人的进度。</p></div>`;
    return;
  }
  if (!visible.length) { box.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon("search")}</div><h3>没有符合条件的提交者</h3><p>试试其他关键词或筛选条件。</p></div>`; return; }
  box.innerHTML = `<div class="wb-list-head"><span>提交者</span><span>状态</span><span>待办</span><span>操作</span></div>` +
    visible.map(r => {
      const b = r.buckets || {};
      const hasRevision = r.revision != null && r.summary !== "未正式提交";
      const tags = [
        ...(b.blocking || []).map(x => `<span class="badge bad">阻塞 ${esc(x)}</span>`),
        ...(b.unknown || []).map(x => `<span class="badge warn">待确认 ${esc(x)}</span>`),
        ...(b.human || []).map(x => `<span class="badge info">人工 ${esc(x)}</span>`),
        ...(b.incomplete || []).map(x => `<span class="badge bad">失败 ${esc(x)}</span>`),
        ...(b.pending_jobs || []).map(x => `<span class="badge info">${esc(x)}</span>`),
      ].join("");
      const canRetry = !ro && r.run_status === "failed";
      return `<article class="wb-row">
        <div class="wb-person"><span class="wb-avatar" aria-hidden="true">${esc((r.name || "?").slice(0, 1))}</span><div><b>${esc(r.name)}</b><span>主体 #${r.subject_id}${hasRevision ? ` · v${r.revision}` : ""}</span></div></div>
        <div class="wb-state"><span class="badge ${WB_BADGE[r.summary] ?? ""}">${esc(r.summary)}</span>${r.acceptance === "accepted" && r.summary !== "已验收" ? '<span class="badge ok">已验收</span>' : ""}</div>
        <div class="wb-buckets">${tags || `<span class="muted">${hasRevision ? "暂无待办" : "等待提交"}</span>`}</div>
        <div class="wb-actions">${hasRevision ? `<a class="ghost sm" href="#/review/${taskId}/${r.subject_id}">复核 ${icon("arrow")}</a>` : `<button class="ghost sm" onclick="remindTarget(${r.subject_id})">提醒</button>`}
          ${hasRevision && !ro ? `<button class="ghost sm" onclick="runCheck(${taskId},${r.subject_id})">重新检查</button>` : ""}
          ${canRetry ? `<button class="ghost sm" onclick="retryCheck(${taskId},${r.subject_id})" title="上次检查技术失败：重试生成新运行，旧运行标记被取代并保留">重试</button>` : ""}
        </div></article>`;
    }).join("");
}

function filterWorkbench(f) { state.wbFilter = f; paintWorkbench(); }

/* ---- 催交：通知意图（只记录「已复制」，不宣称已发送） ---- */
function paintReminder() {
  const box = document.getElementById("remind-body"), badge = document.getElementById("remind-count");
  const rem = state.reminder; if (!box || !rem) return;
  const v = rem.view, targets = v.targets || [];
  if (badge) badge.textContent = `可催交 ${targets.length}`;
  const selected = rem.selected === null ? targets.map(x => x.subject_id) : rem.selected;
  const chosen = new Set(selected);
  const chips = targets.map(x => `<label class="target-chip"><input type="checkbox" value="${x.subject_id}" ${chosen.has(x.subject_id) ? "checked" : ""} onchange="toggleRemindTarget(${x.subject_id},this.checked)"><span>${esc(x.name)}</span></label>`).join("");
  const muted = [
    ...(v.overdue || []).map(x => `${esc(x.name)}（已过首次截止）`),
    ...(v.submitted || []).map(x => `${esc(x.name)}（已提交）`),
    ...(v.exempt || []).map(x => `${esc(x.name)}（免交）`),
  ];
  const created = rem.created;
  box.innerHTML = `
    <div class="remind-groups">
      <div class="remind-stat"><b>${targets.length}</b><span>可催交</span></div>
      <div class="remind-stat"><b>${(v.submitted || []).length}</b><span>已提交</span></div>
      <div class="remind-stat"><b>${(v.overdue || []).length}</b><span>已逾期</span></div>
      <div class="remind-stat"><b>${(v.exempt || []).length}</b><span>免交</span></div>
    </div>
    ${targets.length ? `<div class="target-list" role="group" aria-label="选择催交对象">${chips}</div>` : `<p class="muted">当前没有可催交对象：已提交、免交或已过首次截止的主体不再催交。</p>`}
    ${muted.length ? `<details class="remind-muted"><summary>不催交的 ${muted.length} 位</summary><p>${muted.join('、')}</p></details>` : ""}
    ${targets.length ? `<label for="remind-content">通知内容</label>
      <textarea id="remind-content" placeholder="例如：请在本周五 18:00 前完成提交，材料要求见任务说明。">${esc(rem.draftContent || defaultRemindText())}</textarea>
      <button class="sm" onclick="createReminder()" ${chosen.size ? "" : "disabled"}>生成催交通知（${chosen.size} 人）</button>` : ""}
    ${created ? `<div class="remind-created"><div class="eyebrow">READY TO COPY</div><p class="remind-content-text">${esc(created.content)}</p><div class="target-tags">${(created.targets || []).map(x => `<span class="pill">${esc(x.name)}</span>`).join("")}</div><div class="row-actions"><button class="sm" onclick="copyReminder(${created.id})">复制并标记已复制</button><span class="muted" id="remind-copy-state">${created.status === "copied" ? "已复制" : "尚未复制"}</span></div></div>` : ""}
    ${(rem.notifications || []).length ? `<details class="remind-history"><summary>历史通知意图（${rem.notifications.length}）</summary>${rem.notifications.map(n => `<div class="remind-history-row"><span class="badge ${n.status === "copied" ? "ok" : ""}">${n.status === "copied" ? "已复制" : "待复制"}</span><span>${(n.targets || []).length} 人 · ${esc(fmtTime(n.created_at))}</span><p>${esc(n.content)}</p></div>`).join("")}</details>` : ""}`;
}
function defaultRemindText() {
  const t = state.wbTask || {};
  return `你好，${t.name || "本次收集"}还差你的材料。请按任务说明完成登记并上传材料，注意提交截止时间。如已提交请忽略。`;
}
function toggleRemindTarget(sid, on) {
  const rem = state.reminder; if (!rem) return;
  const targets = (rem.view.targets || []).map(x => x.subject_id);
  const set = new Set(rem.selected === null ? targets : rem.selected);
  if (on) set.add(sid); else set.delete(sid);
  rem.selected = [...set];
  const input = document.getElementById("remind-content");
  rem.draftContent = input ? input.value : rem.draftContent;
  paintReminder();
}
function remindTarget(sid) {
  const rem = state.reminder; if (!rem) return;
  rem.selected = [sid];
  rem.created = null;
  paintReminder();
  document.getElementById("remind-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
}
async function createReminder() {
  const rem = state.reminder; if (!rem) return;
  const content = (document.getElementById("remind-content")?.value || "").trim();
  if (!content) return setFlash("通知内容不能为空");
  const targets = (rem.view.targets || []).map(x => x.subject_id);
  const ids = rem.selected === null ? targets : rem.selected;
  if (!ids.length) return setFlash("至少选择一位催交对象");
  await guard(async () => {
    const r = await api(`/api/tasks/${state.wbTaskId}/notifications`, {
      method: "POST", form: { content, subject_ids: ids.join(",") } });
    rem.created = { id: r.intent_id, status: r.status, targets: r.targets, content };
    rem.draftContent = content;
    setFlash(`已生成催交通知，目标 ${r.targets.length} 人（尚未发送，复制后请自行发送）`, "ok");
    await refreshWorkbench();
  });
}
async function copyReminder(intentId) {
  const rem = state.reminder; if (!rem || !rem.created) return;
  const text = rem.created.content + "\n\n对象：" + (rem.created.targets || []).map(x => x.name).join("、");
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand("copy"); ta.remove();
  }
  await guard(async () => {
    await api(`/api/notifications/${intentId}/copy`, { method: "POST" });
    rem.created.status = "copied";
    const st = document.getElementById("remind-copy-state"); if (st) st.textContent = "已复制";
    setFlash("已复制到剪贴板，并记录为「已复制」（系统不宣称已发送）", "ok");
  });
}

function lifecycleButtons(status, taskId) {
  if (status === "closed") {
    return `<button class="ghost" onclick="taskLifecycle(${taskId},'reopen')">恢复收集</button>
      <button class="ghost" onclick="taskLifecycle(${taskId},'archive')">归档</button>
      <button class="ghost" onclick="taskLifecycle(${taskId},'cancel')">取消任务</button>`;
  }
  if (status === "archived" || status === "cancelled") {
    return `<span class="muted">终态：数据保留备查，不再恢复或取消。</span>`;
  }
  return `<button class="ghost" onclick="taskLifecycle(${taskId},'close')">关闭任务</button>`;
}

async function taskLifecycle(taskId, action) {
  await guard(async () => {
    const confirms = {
      close: "关闭后停止提交/上传/检查（历史数据保留，之后可恢复），确定关闭？",
      reopen: "恢复收集后提交入口重新开放，确定恢复？",
      archive: "归档为长期保留态（须无未完成检查），确定归档？",
      cancel: "取消将中止收集并释放名册/授权（数据保留备查），确定取消？",
    };
    if (!window.confirm(confirms[action] || "确定执行该操作？")) return;
    await api(`/api/tasks/${taskId}/${action}`, { method: "POST" });
    setFlash("任务状态已更新", "ok");
    await refreshWorkbench();
  });
}
let _wbTimer = 0;
async function runCheck(taskId, sid) {
  await guard(async () => {
    await api(`/api/tasks/${taskId}/subjects/${sid}/checks`, { method: "POST" });
    setFlash("检查已排队：后台执行中，页面会自动刷新", "ok");
    if (state.wbTaskId === taskId && document.getElementById("wb-list")) await refreshWorkbench();
  });
}
async function retryCheck(taskId, sid, back) {
  await guard(async () => {
    const r = await api(`/api/tasks/${taskId}/subjects/${sid}/checks/retry`, { method: "POST" });
    setFlash(`已重新排队：新运行 #${r.run_id} 后台执行中，旧运行 #${r.retried_from} 已标记被取代、历史保留`, "ok");
    if (back === "review") await viewReview(taskId, sid);
    else if (state.wbTaskId === taskId && document.getElementById("wb-list")) await refreshWorkbench();
  });
}

/* ---------------------------------------------------------------- P03 证据复核 */
async function viewReview(taskId, sid) {
  document.getElementById("app").innerHTML = `
    <div class="breadcrumb"><a href="#/tasks">我的任务</a><span>/</span><a href="#/workbench/${taskId}">收集工作台</a><span>/</span><span id="rv-name">证据复核</span></div>
    <div class="page-heading"><div><div class="eyebrow">EVIDENCE REVIEW</div><h1>逐条核对证据<span class="heading-dot">.</span></h1><p>每处判断都附原文位置。解释不改变机器结论，最终由你决定。</p></div><div id="review-retry"></div></div>
    <div id="flash" role="status" aria-live="polite"></div>
    <div id="rv"><p class="empty">正在读取检查结果…</p></div>`;
  try {
    const d = await api(`/api/tasks/${taskId}/subjects/${sid}/findings`);
    state.reviewData = d; state.reviewRule = state.reviewRule || null;
    document.getElementById("rv-name").textContent = d.subject.name;
    paintReview(taskId, sid);
  } catch (e) { setFlash(e.message); }
}

function paintReview(taskId, sid) {
  const d = state.reviewData; if (!d) return;
  const rules = d.rules || [];
  if (!state.reviewRule && rules.length) state.reviewRule = rules.find(r => r.result !== "satisfied" && r.result !== "not_applicable")?.rule_id || rules[0].rule_id;
  const active = rules.find(r => r.rule_id === state.reviewRule) || null;
  const run = d.run, notes = d.notes || [];
  const retry = document.getElementById("review-retry");
  if (retry) retry.innerHTML = run && run.status === "failed"
    ? `<button class="ghost" onclick="retryCheck(${taskId},${sid},'review')" title="上次检查技术失败：重试生成新运行，旧运行标记被取代并保留">${icon("arrow")} 重试检查</button>` : "";

  const counts = { issue: 0, unknown: 0, failed: 0, satisfied: 0 };
  rules.forEach(r => { if (r.result === "issue") counts.issue++; else if (r.result === "unknown") counts.unknown++; else if (r.result === "failed") counts.failed++; else if (r.result === "satisfied") counts.satisfied++; });
  const cov = run && run.coverage ? run.coverage : null;
  const gap = cov ? (cov.unread_pages || 0) + (cov.failed_pages || 0) : 0;

  const meta = `<section class="review-summary card">
    <div class="review-subject"><span class="wb-avatar">${esc((d.subject.name || "?").slice(0, 1))}</span><div><h2>${esc(d.subject.name)}</h2><span>主体 #${d.subject.id}${d.revision ? ` · 当前版本 v${d.revision.version} · 回执 ${esc(d.revision.receipt)}` : ""}${run ? ` · 运行 #${run.id}（${esc(run.status)}）` : ""}</span></div></div>
    <div class="review-metrics">${[["问题", counts.issue, "bad"], ["待确认", counts.unknown, "warn"], ["失败", counts.failed, "bad"], ["满足", counts.satisfied, "ok"]].map(([l, n, c]) => `<div class="review-metric"><strong class="${c}">${n}</strong><span>${l}</span></div>`).join("")}</div>
    ${gap ? `<div class="notice-warn">材料共 ${gap} 页未能读取。这些页不构成「确认缺失」，相关规则按待确认处理；请让提交者补充清晰材料，或人工核对。</div>` : ""}
  </section>`;

  const list = rules.length ? `<div class="review-rules" role="list">${rules.map(r => {
    const on = r.rule_id === state.reviewRule;
    return `<button role="listitem" class="review-rule-item ${on ? "on" : ""}" aria-current="${on}" onclick="selectReviewRule('${esc(r.rule_id)}',${taskId},${sid})">
      <span class="review-rule-id">${esc(r.rule_id)}</span>
      <span class="review-rule-text">${esc((r.requirement && r.requirement.statement) || r.explanation || r.rule_id)}</span>
      <span class="review-rule-side">${resultBadge(r.result)}<span class="badge">${esc(r.severity || "")}</span></span>
    </button>`;
  }).join("")}</div>` : `<div class="empty-state"><div class="empty-icon">${icon("workbench")}</div><h3>暂无规则结果</h3><p>可能尚未检查。回到工作台发起检查，或稍后刷新。</p><p><a class="ghost sm" href="#/workbench/${taskId}">返回工作台</a></p></div>`;

  const evidence = active ? `
    <article class="evidence-detail">
      <header><div><span class="eyebrow">RULE ${esc(active.rule_id)}</span><h2>${esc((active.requirement && active.requirement.statement) || active.rule_id)}</h2></div>${resultBadge(active.result)}</header>
      <div class="evidence-meta">${(active.requirement && active.requirement.executor) ? `<span class="badge">${esc(EXECUTOR_LABEL[active.requirement.executor] || active.requirement.executor)}</span>` : ""}${(active.requirement && active.requirement.capability) ? (CAP_BADGE[active.requirement.capability] || "") : ""}<span class="badge">${esc(active.severity || "未标级别")}</span>${(active.requirement && active.requirement.requirement_source) ? `<span class="source-quote">来源：${esc(active.requirement.requirement_source)}</span>` : ""}</div>
      ${active.explanation ? `<p class="evidence-explanation">${esc(active.explanation)}</p>` : ""}
      ${(active.evidence || []).length ? `<div class="evidence-list">${active.evidence.map(e => `<blockquote class="evidence"><span class="evidence-loc">${esc(e.locator || "未标注位置")} · ${esc(e.method || "-")}</span>${esc(e.quote || "")}</blockquote>`).join("")}</div>` : `<p class="muted">这条规则没有可引用的原文证据。</p>`}
      ${active.next_step ? `<div class="evidence-next"><b>下一步</b><p>${esc(active.next_step)}</p></div>` : ""}
    </article>` : `<article class="evidence-detail"><p class="muted">选择左侧任一规则查看证据。</p></article>`;

  const decision = `<section class="card decision-panel" aria-label="人工决定">
    <div class="section-heading"><div><div class="eyebrow">DECISION</div><h2>人工决定</h2></div><span class="muted">撤销只追加记录，不删历史</span></div>
    <div class="decision-form">
      <div class="grid2"><div><label for="dc-type">决定</label><select id="dc-type">
        <option value="confirm_issue">确认问题</option>
        <option value="correct_false_positive">纠正误报</option>
        <option value="approve_exception">批准例外</option>
        <option value="exempt">免交</option>
        <option value="accept_current">验收当前版本</option></select></div>
        <div><label for="dc-rule">作用域规则（可空）</label><input id="dc-rule" value="${esc(active ? active.rule_id : "")}" placeholder="rule_id"></div></div>
      <label for="dc-exp">过期时间（可空，ISO）</label><input id="dc-exp" placeholder="2026-12-31T23:59:59+08:00">
      <label for="dc-reason">理由（必填）</label><textarea id="dc-reason" placeholder="为什么这样做决定；提交者解释会显示在上方"></textarea>
      <button onclick="submitDecision(${taskId},${sid})">提交决定 ${icon("arrow")}</button>
    </div>
    <div class="decision-history"><h3>决定历史</h3>
      ${(d.decisions || []).map(x => `<div class="decision-row"><div><span class="badge ${x.revoked ? "" : "info"}">${esc(x.decision)}${x.revoked ? "（已撤销）" : ""}</span><span class="muted">${x.scope_rule_id ? "规则 " + esc(x.scope_rule_id) + " · " : ""}${esc(fmtTime(x.created_at))}</span></div><p>${esc(x.reason)}</p>${x.revoked ? "" : `<button class="link" onclick="revokeDecision(${taskId},${sid},${x.id})">撤销</button>`}</div>`).join("") || `<p class="muted">还没有人工决定。</p>`}
    </div>
  </section>`;

  const notesHtml = notes.length ? `<section class="card notes-panel"><div class="section-heading"><div><div class="eyebrow">FROM SUBMITTER</div><h2>提交者解释 / 申诉</h2></div><span class="badge warn">${notes.filter(n => !n.handled).length} 项待处理</span></div>
    ${notes.map(n => `<div class="note-row"><div><b>${esc(n.rule_id || "整体提交")}</b><span class="badge ${n.handled ? "ok" : "warn"}">${n.handled ? "已处理" : "待处理"}</span><span class="muted">${esc(fmtTime(n.created_at))}</span></div><p>${esc(n.content)}</p></div>`).join("")}
    <p class="muted">解释不改变机器结论；请核对原文后再做决定，可确认问题、纠正误报或批准有范围的例外。</p></section>` : "";

  const sameName = (d.same_name_subjects || []).length ? `<section class="card notice-warn"><b>同名主体待核</b><p>${esc(d.same_name_hint || "")}</p>${d.same_name_subjects.map(s => `<p>主体 #${s.id}（${esc(s.name)}）——以主体 ID 为准人工核对，系统不自动合并。</p>`).join("")}</section>` : "";
  const covHtml = coverageCard(run);

  document.getElementById("rv").innerHTML = `${meta}${sameName}
    <div class="review-layout"><div class="review-list-col">${list}</div><div class="review-detail-col">${evidence}${notesHtml}${decision}${covHtml}</div></div>`;
}
function selectReviewRule(ruleId, taskId, sid) {
  state.reviewRule = ruleId;
  paintReview(taskId, sid);
  const box = document.querySelector(".review-layout"); if (box) box.scrollIntoView({block: "nearest"});
}
async function submitDecision(taskId, sid) {
  await guard(async () => {
    const form = {
      decision: document.getElementById("dc-type").value,
      reason: document.getElementById("dc-reason").value.trim(),
      scope_rule_id: document.getElementById("dc-rule").value.trim(),
    };
    const exp = document.getElementById("dc-exp").value.trim();
    if (exp) form.expires_at = exp;
    await api(`/api/tasks/${taskId}/subjects/${sid}/decisions`, { method: "POST", form });
    setFlash("决定已记录", "ok");
    await viewReview(taskId, sid);
  });
}
async function revokeDecision(taskId, sid, did) {
  await guard(async () => {
    const reason = prompt("撤销理由（必填）：");
    if (!reason) return;
    await api(`/api/tasks/${taskId}/subjects/${sid}/decisions/${did}/revoke`,
              { method: "POST", form: { reason } });
    await viewReview(taskId, sid);
  });
}

/* ---------------------------------------------------------------- P04 提交空间 */
/* ---------------------------------------------------------------- 槽位条件预览 */
/* 与后端 app/agents/review_agent._eval_condition 同一语法：
   字段==值 / 字段!=值 及 and/or 连接；返回 true/false，
   形式不受支持时返回 null（不静默当成不满足——提示转人工核验，判定以服务端为准）。 */
function evalSlotCondition(expr, values) {
  if (!expr || !expr.trim()) return true;
  const e = expr.trim();
  if (e.includes(" or ")) {
    const parts = e.split(" or ").map(p => evalSlotCondition(p, values));
    if (parts.some(p => p === null)) return null;
    return parts.some(Boolean);
  }
  if (e.includes(" and ")) {
    const parts = e.split(" and ").map(p => evalSlotCondition(p, values));
    if (parts.some(p => p === null)) return null;
    return parts.every(Boolean);
  }
  let op = null, idx = -1;
  for (const cand of ["==", "!="]) {
    const i = e.indexOf(cand);
    if (i > 0 && (idx < 0 || i < idx)) { idx = i; op = cand; }
  }
  if (!op) return null;
  const fid = e.slice(0, idx).trim();
  let val = e.slice(idx + 2).trim();
  if (val.length >= 2 && ((val[0] === "'" && val[val.length - 1] === "'") ||
                          (val[0] === '"' && val[val.length - 1] === '"'))) {
    val = val.slice(1, -1);
  }
  const c0 = fid.charCodeAt(0);
  const idOk = fid.length > 0 &&
    ((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || c0 === 95) &&
    fid.split("").slice(1).every(ch => {
      const x = ch.charCodeAt(0);
      return (x >= 48 && x <= 57) || (x >= 65 && x <= 90) ||
             (x >= 97 && x <= 122) || x === 95;
    });
  if (!idOk) return null;
  const actual = String(values[fid] ?? "").trim();
  return op === "==" ? actual === val : actual !== val;
}

/* 按当前字段填写刷新槽位条件提示：不适用则禁用上传；不受支持则提示转人工。 */
function refreshSlotConditions(slots) {
  const values = {};
  document.querySelectorAll("[data-field]").forEach(el => {
    values[el.dataset.field] = el.value.trim();
  });
  (slots || []).forEach(s => {
    if (!s.required_condition) return;
    const note = document.getElementById("slot-cond-" + s.id);
    if (!note) return;
    const input = document.getElementById("file-" + s.id);
    const btn = document.getElementById("upload-" + s.id);
    const r = evalSlotCondition(s.required_condition, values);
    if (r === true) {
      note.innerHTML = `<span class="badge ok">当前填写下需要提交</span>`;
      if (input) input.disabled = false;
      if (btn) btn.disabled = false;
    } else if (r === false) {
      note.innerHTML = `<span class="badge">当前填写下不适用</span>`;
      if (input) input.disabled = true;
      if (btn) btn.disabled = true;
    } else {
      note.innerHTML = `<span class="badge warn">条件「${esc(s.required_condition)}」暂不支持自动判定，将转人工核验</span>`;
      if (input) input.disabled = false;
      if (btn) btn.disabled = false;
    }
  });
}

function setFilesFromDraft(slotFileIds) {
  state.files = {}; state.fileMeta = {};
  Object.entries(slotFileIds || {}).forEach(([slot, list]) => {
    state.files[slot] = [];
    (list || []).forEach(f => {
      state.files[slot].push(f.file_id);
      state.fileMeta[f.file_id] = f;
    });
  });
}
function fmtBytes(n) {
  if (n == null) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}
function apiError(data, status) {
  const detail = data && data.detail;
  return new Error(Array.isArray(detail) ? detail.map(x => x.msg || JSON.stringify(x)).join("；")
    : (typeof detail === "string" ? detail : "请求失败，请稍后重试（" + status + "）"));
}
function fileChips(slot, ro) {
  const ids = state.files[slot] || [];
  if (!ids.length) return "";
  return ids.map(fid => {
    const m = state.fileMeta[fid] || { name: fid };
    return `<span class="file-chip">${icon("delivery")}<span class="file-chip-name" title="${esc(m.name)}">${esc(m.name)}</span><span class="file-chip-size">${esc(fmtBytes(m.size))}</span>${ro ? "" : `<button type="button" class="file-chip-x" aria-label="删除 ${esc(m.name)}" onclick="deleteSlotFile('${esc(slot)}','${esc(fid)}')">×</button>`}</span>`;
  }).join("");
}
function paintSlotFiles(slot, ro) {
  const el = document.getElementById("slot-files-" + slot);
  if (el) el.innerHTML = fileChips(slot, ro);
}
function slotMetaText(s) {
  return [`格式 ${(s.formats || []).map(x => x.toUpperCase()).join(" / ") || "不限"}`,
          `最多 ${s.max_count} 份`,
          s.max_size_mib ? `单份 ≤ ${s.max_size_mib} MiB` : "",
          s.max_pages ? `≤ ${s.max_pages} 页` : ""].filter(Boolean).join(" · ");
}
function fieldValueMap() {
  const values = {};
  document.querySelectorAll("[data-field]").forEach(el => { values[el.dataset.field] = el.value.trim(); });
  return values;
}
function requiredSlotMissing(slots) {
  const values = fieldValueMap();
  return (slots || []).filter(s => {
    const cond = s.required_condition ? evalSlotCondition(s.required_condition, values) : true;
    return cond !== false && !(state.files[s.id] || []).length;
  });
}

async function viewSubmit() {
  document.getElementById("app").innerHTML = `<div id="flash" role="status" aria-live="polite"></div><div id="sub"><p class="empty">正在打开你的提交空间…</p></div>`;
  try {
    const [me, draft, receipt] = await Promise.all([
      api("/api/me", { sub: true }),
      api("/api/me/draft", { sub: true }),
      api("/api/me/receipt", { sub: true }),
    ]);
    state.me = me; state.draftVersion = draft.draft_version || null;
    setFilesFromDraft(draft.slot_file_ids);
    const fields = (me.blueprint && me.blueprint.fields) || [];
    const slots = (me.blueprint && me.blueprint.slots) || [];
    const ro = READONLY_STATUSES.includes(me.task.status);
    const done = fields.filter(f => (draft.fields || {})[f.id]).length;
    const uploaded = Object.values(state.files).reduce((n, ids) => n + ids.length, 0);
    const receiptHtml = receipt.formal
      ? `<div class="receipt"><div><span class="eyebrow">RECEIPT</span><b>已正式提交 · v${receipt.revision}</b><span class="receipt-no">${esc(receipt.receipt)}</span></div><div class="receipt-meta"><span>服务端时间</span><b>${esc(fmtTime(receipt.formal_submitted_at))}</b></div></div>`
      : `<div class="receipt pending"><div><span class="eyebrow">RECEIPT</span><b>尚未正式提交</b><span>保存草稿不会形成报名；正式提交后会得到固定回执。</span></div></div>`;

    document.getElementById("sub").innerHTML = `
      <div class="submit-shell">
        <div class="breadcrumb"><span>提交者空间</span><span>/</span><span>${esc(me.subject.name)}</span></div>
        <div class="page-heading"><div><div class="eyebrow">MY SUBMISSION</div><h1>${esc(me.task.name)}<span class="heading-dot">.</span></h1><p>以「${esc(me.subject.name)}」身份提交${me.subject.kind === "team" ? "（团队）" : ""}。草稿随时保存，正式提交后仍可在补正截止前更新。</p></div>
          <span class="badge ${ro ? "warn" : "ok"}"><span class="badge-dot"></span>${esc(TASK_STATUS_LABEL[me.task.status] || me.task.status)}</span></div>
        ${ro ? `<div class="notice-warn">任务已${esc(TASK_STATUS_LABEL[me.task.status] || me.task.status)}，处于只读状态：不能保存草稿、上传或正式提交；已提交内容与回执仍可查看。</div>` : ""}
        <section class="submit-overview">
          <div class="overview-stats">${[["登记字段", `${done}/${fields.length}`, "design"], ["已上传材料", uploaded, "delivery"], ["首次截止", fmtTime(me.task.first_deadline).slice(5), "workbench"], ["补正截止", fmtTime(me.task.correction_deadline).slice(5), "workbench"]].map(([l, v, ic]) => `<div class="overview-stat"><span>${esc(l)}</span><strong class="stat-text">${esc(v)}</strong><i>${icon(ic)}</i></div>`).join("")}</div>
          ${receiptHtml}
        </section>
        <div class="submit-layout">
          <section class="card submit-form-card">
            <div class="submit-card-head"><div><div class="eyebrow">FORM</div><h2>填写与上传</h2></div>
              <div class="tabs" role="tablist" aria-label="填写方式"><button role="tab" id="submode-chat" onclick="setSubMode('chat')" ${ro ? "disabled" : ""}>✧ 逐步填写</button><button role="tab" id="submode-form" onclick="setSubMode('form')">表单填写</button></div></div>
            <div class="card" id="sub-chat-card">
              <div class="step-flow"><span class="st on" id="sub-st-1"><span class="dot">1</span>登记信息</span><span class="arw"></span><span class="st" id="sub-st-2"><span class="dot">2</span>上传材料</span><span class="arw"></span><span class="st" id="sub-st-3"><span class="dot">3</span>核对提交</span></div>
              <div class="chat"><div class="chat-scroll" id="sub-chat-scroll"></div></div>
              <p class="field-help">逐步填写与下方表单是同一份草稿，答案实时同步；向导不调用模型，也不代替材料检查。</p>
            </div>
            <div id="sub-fields-card" hidden>
              <h3>登记信息</h3>
              ${fields.map(f => `<div class="submit-field"><label for="field-${esc(f.id)}">${esc(f.label)}${f.required ? " <em>*</em>" : ' <small>选填</small>'}</label>
                ${f.type === "enum"
                  ? `<select id="field-${esc(f.id)}" data-field="${esc(f.id)}">${["", ...(f.options || [])].map(o => `<option value="${esc(o)}" ${((draft.fields || {})[f.id] || "") === o ? "selected" : ""}>${o ? esc(o) : "请选择"}</option>`).join("")}</select>`
                  : `<input id="field-${esc(f.id)}" data-field="${esc(f.id)}" value="${esc((draft.fields || {})[f.id] || "")}" placeholder="请填写${esc(f.label)}" ${ro ? "disabled" : ""}>`}
                ${f.required_condition ? `<p class="field-help">必填条件：${esc(f.required_condition)}</p>` : ""}
                ${f.purpose ? `<p class="field-help">${esc(f.purpose)}</p>` : ""}</div>`).join("") || '<p class="muted">本次收集没有登记字段。</p>'}
            </div>
            <div class="submit-slots"><h3>提交材料</h3>
              ${slots.map(s => {
                const naNote = s.required_condition ? `<p class="field-help" id="slot-cond-${esc(s.id)}"></p>` : "";
                return `<article class="slot-card" data-slot-card="${esc(s.id)}">
                  <div class="slot-head"><div><b>${esc(s.label)}</b>${s.required_condition ? ` <span class="badge warn">条件必交</span>` : ' <span class="badge bad">必交</span>'}<span class="field-help">${esc(slotMetaText(s))}</span></div>${s.max_count ? `<span class="slot-count" id="slot-count-${esc(s.id)}"></span>` : ""}</div>
                  ${s.required_condition ? `<p class="field-help">条件：${esc(s.required_condition)}</p>` : ""}
                  ${naNote}
                  <div class="file-chips" id="slot-files-${esc(s.id)}">${fileChips(s.id, ro)}</div>
                  ${ro ? "" : `<div class="upload-row"><input type="file" id="file-${esc(s.id)}" aria-label="选择 ${esc(s.label)} 文件" ${(s.formats || []).length ? `accept="${(s.formats || []).map(x => "." + esc(x)).join(",")}"` : ""}><button class="ghost sm" id="upload-${esc(s.id)}" onclick="uploadSlot('${esc(s.id)}')">上传</button></div>`}
                </article>`;
              }).join("") || '<p class="muted">本次收集没有材料要求。</p>'}
            </div>
            <div class="submit-actions">
              <button class="ghost" onclick="saveDraft()" ${ro ? "disabled" : ""}>保存草稿</button>
              <button onclick="doSubmit()" ${ro ? "disabled" : ""}>${receipt.formal ? "提交补正版本并检查" : "正式提交并检查"} ${icon("arrow")}</button>
              <span class="muted" id="draft-hint">${draft.draft_version ? `草稿版本 ${draft.draft_version}` : "尚未保存草稿"}${draft.updated_at ? ` · ${esc(fmtTime(draft.updated_at))}` : ""}</span>
            </div>
            <div id="receipt-out"></div>
          </section>
          <aside class="submit-side">
            <section class="card side-note"><div class="eyebrow">BEFORE YOU SUBMIT</div><h2>提交前核对</h2>
              <ul class="check-list"><li>首次截止：<b>${esc(fmtTime(me.task.first_deadline))}</b></li><li>补正截止：<b>${esc(fmtTime(me.task.correction_deadline))}</b></li><li>正式提交会形成不可篡改的版本；再次提交将形成补正版本。</li><li>上传成功 ≠ 正式提交，记得点击正式提交。</li></ul>
            </section>
            <section class="card side-note"><div class="eyebrow">NEED HELP?</div><h2>提交之后</h2>
              <p class="field-help">检查结果会逐条列出问题、原文位置与改法。对结论有异议可提交解释，组织者核对原文后决定；解释不改变机器结论。</p>
            </section>
          </aside>
        </div>
        <section class="card my-results-card"><div class="section-heading"><div><div class="eyebrow">CHECK RESULTS</div><h2>我的检查结果</h2></div><span class="muted">与组织者复核页使用同一份证据</span></div><div id="my-results"><p class="muted">—</p></div></section>
      </div>`;
    document.querySelectorAll("[data-field]").forEach(el =>
      el.addEventListener("input", () => {
        refreshSlotConditions(slots);
        if (state.sub && state.sub.mode === "chat") syncSubAnswersFromForm();
      }));
    refreshSlotConditions(slots);
    initSubChat(fields, slots, ro, me.subject.name, draft.fields || {});
    setSubMode(ro ? "form" : "chat");
    loadMyResults();
  } catch (e) {
    document.getElementById("sub").innerHTML =
      `<div class="flash err">${esc(e.message)}（请重新用凭证登录）</div>`;
  }
}
async function uploadFile(slot, file) {
  const fd = new FormData();
  fd.append("slot", slot);
  fd.append("file", file);
  const r = await fetch("/api/me/files", {
    method: "POST", headers: { Authorization: "Bearer " + subToken() }, body: fd });
  let data = {};
  try { data = await r.json(); } catch (e) { data = { detail: "服务端返回了无法解析的响应" }; }
  if (!r.ok) throw apiError(data, r.status);
  return data;
}
async function uploadSlot(slot) {
  await guard(async () => {
    const input = document.getElementById("file-" + slot);
    if (!input || !input.files.length) throw new Error("请先选择文件");
    const file = input.files[0];
    const data = await uploadFile(slot, file);
    afterSlotUpload(slot, data.file_id, { name: file.name, size: file.size || data.size });
    input.value = "";
    setFlash(`「${file.name}」已上传（上传成功不等于正式提交）`, "ok");
  });
}
function afterSlotUpload(slot, fileId, meta) {
  (state.files[slot] = state.files[slot] || []).push(fileId);
  state.fileMeta[fileId] = { file_id: fileId, name: (meta && meta.name) || fileId, size: meta && meta.size };
  const ro = state.sub ? state.sub.ro : false;
  paintSlotFiles(slot, ro);
  if (state.sub && state.sub.slots) refreshSlotConditions(state.sub.slots);
  if (state.sub) {
    const i = state.sub.slots.findIndex(s => s.id === slot);
    if (i >= 0) {
      const msg = document.getElementById("sub-slot-msg");
      if (msg && state.sub.mode === "chat") msg.innerHTML = `<div class="flash ok">已上传：${esc((meta && meta.name) || fileId)}</div>`;
      if (state.sub.phase === "done") renderSubStep();
    }
  }
}
async function deleteSlotFile(slot, fileId) {
  await guard(async () => {
    await api(`/api/me/files/${encodeURIComponent(fileId)}`, { method: "DELETE", sub: true });
    state.files[slot] = (state.files[slot] || []).filter(x => x !== fileId);
    delete state.fileMeta[fileId];
    paintSlotFiles(slot, state.sub ? state.sub.ro : false);
    if (state.sub && state.sub.slots) refreshSlotConditions(state.sub.slots);
    setFlash("文件已从草稿中删除", "ok");
  });
}
async function saveDraft() {
  await guard(async () => {
    const fields = {};
    document.querySelectorAll("[data-field]").forEach(el => { fields[el.dataset.field] = el.value; });
    const r = await api("/api/me/draft", { method: "POST", sub: true,
      json: { fields, expected_version: state.draftVersion } });
    state.draftVersion = r.draft_version;
    // 逐步向导与表单共享同一份草稿：保存后两边的答案一起刷新
    if (state.sub) Object.entries(fields).forEach(([k, v]) => {
      if (String(v).trim()) state.sub.answers[k] = v; else delete state.sub.answers[k];
    });
    const hint = document.getElementById("draft-hint");
    if (hint) hint.textContent = `草稿版本 ${r.draft_version} · 刚刚保存`;
    setFlash(`草稿已保存（版本 ${r.draft_version}）。刷新页面后字段与已上传文件都会恢复。`, "ok");
  });
}
async function doSubmit() {
  await guard(async () => {
    const slots = state.sub ? state.sub.slots : [];
    const missing = requiredSlotMissing(slots);
    if (missing.length) {
      setFlash(`还有必交材料没上传：${missing.map(s => s.label).join("、")}。传好后再正式提交。`);
      const first = document.querySelector(`[data-slot-card="${missing[0].id}"]`);
      if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const fields = {};
    document.querySelectorAll("[data-field]").forEach(el => { fields[el.dataset.field] = el.value; });
    const slotFiles = {};
    Object.entries(state.files).forEach(([slot, ids]) => { if (ids.length) slotFiles[slot] = ids; });
    const key = "web-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    const r = await api("/api/me/submit", { method: "POST", sub: true,
      json: { fields, slot_file_ids: slotFiles, idempotency_key: key } });
    document.getElementById("receipt-out").innerHTML = `
      <div class="receipt"><div><span class="eyebrow">SUBMITTED</span><b>正式提交成功 · v${r.revision}</b><span class="receipt-no">${esc(r.receipt)}</span></div><div class="receipt-meta"><span>服务端时间</span><b>${esc(fmtTime(r.formal_submitted_at))}</b></div></div>`;
    setFlash(`正式提交成功，回执 ${r.receipt}（v${r.revision}）`, "ok");
    await loadMyResults();
  });
}
async function loadMyResults() {
  try {
    const r = await api("/api/me/results", { sub: true });
    const b = r.buckets || {};
    let html = `
      <p>状态：<b>${esc(r.summary)}</b>${r.revision ? `（v${r.revision}）` : ""}</p>
      <p>${[
        ...(b.blocking || []).map(x => `<span class="badge bad">阻塞:${esc(x)}</span>`),
        ...(b.unknown || []).map(x => `<span class="badge warn">unknown:${esc(x)}</span>`),
        ...(b.human || []).map(x => `<span class="badge info">人工:${esc(x)}</span>`),
        ...(b.incomplete || []).map(x => `<span class="badge bad">失败:${esc(x)}</span>`),
      ].join("") || '<span class="muted">暂无待办</span>'}</p>`;
    // 覆盖缺口：读不到的页不能算缺失，必须显式告知提交者
    const cov = r.coverage || {};
    const gap = (cov.unread_pages || 0) + (cov.failed_pages || 0);
    if (gap) {
      html += `<div class="flash err">有 ${gap} 页材料未能读取：系统不把没读到的内容判为缺失，`
        + `请补充清晰可读的材料后重新正式提交。</div>`;
    }
    // 规则明细：哪里有问题、怎么改、引用证据、剩余待办
    const details = r.details || [];
    const todo = details.filter(x => x.result === "issue" || x.result === "unknown"
      || x.result === "failed");
    const done = details.filter(x => x.result === "satisfied"
      || x.result === "not_applicable");
    if (todo.length) {
      html += `<h3>待办事项（${todo.length}）</h3>` + todo.map(ruleCard).join("");
    }
    if (done.length) {
      html += `<p class="kv">已通过 ${done.length} 项：`
        + `${done.map(x => esc(x.rule_id)).join("、")}</p>`;
    }
    if (!details.length && r.summary && r.summary !== "未正式提交") {
      html += `<p class="muted">暂无规则明细（可能尚未检查）</p>`;
    }
    // 申诉入口：补交或解释（第 10 节）。解释不改变机器结论。
    if (todo.length) {
      html += `<div class="card"><h3>申诉复核 / 补充说明</h3>
        <p class="kv">解释不改变机器结论，也不替代组织者决定；
          组织者核对原文后再决定。也可以选择直接补交更正材料。</p>
        <div class="row">
          <div><label>作用域规则</label><select id="ap-rule">
            <option value="">整体提交（不指定规则）</option>
            ${todo.map(x => `<option value="${esc(x.rule_id)}">${esc(x.rule_id)}</option>`).join("")}
          </select></div>
        </div>
        <label>说明/理由（必填）</label>
        <textarea id="ap-content" placeholder="例如：姓名与登记一致，报告封面第 2 页写的就是本人姓名"></textarea>
        <button onclick="submitAppeal()">提交解释</button>
      </div>`;
    }
    const appeals = r.appeals || [];
    if (appeals.length) {
      html += `<div class="card"><h3>我的解释与复核申诉</h3>
        ${appeals.map(a => `<p>#${a.id} ${a.rule_id ? esc(a.rule_id) : "整体"}
          <span class="badge${a.status === "withdrawn" ? "" : (a.handled ? " ok" : " warn")}">${
            a.status === "withdrawn" ? "已撤回" : (a.handled ? "组织者已处理" : "待组织者处理")}</span>
          <span class="kv">${esc(a.content)}，${esc(a.created_at)}</span>
          ${a.status === "pending" && !a.handled ?
            `<button class="link" onclick="withdrawAppeal(${a.id})">撤回</button>` : ""}</p>`).join("")}
      </div>`;
    }
    document.getElementById("my-results").innerHTML = html;
  } catch (e) { /* 结果加载失败不打断页面 */ }
}

async function submitAppeal() {
  await guard(async () => {
    const ruleId = document.getElementById("ap-rule").value;
    const content = document.getElementById("ap-content").value.trim();
    if (!content) throw new Error("解释/复核理由不能为空");
    const key = "web-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    const r = await api("/api/me/appeals", { method: "POST", sub: true,
      json: { rule_id: ruleId, content, idempotency_key: key } });
    setFlash(`已提交解释 #${r.note_id}（待组织者处理）；`
      + `解释不改变机器结论`, "ok");
    await loadMyResults();
  });
}
async function withdrawAppeal(noteId) {
  await guard(async () => {
    const r = await api(`/api/me/appeals/${noteId}/withdraw`, { method: "POST", sub: true });
    setFlash(`已撤回解释 #${r.note_id}（只改状态，历史保留）`, "ok");
    await loadMyResults();
  });
}

/* ------------------------------------------------ P04 逐步填写引擎（提交者侧） */
function initSubChat(fields, slots, ro, subjectName, initialAnswers) {
  state.sub = { fields: fields || [], slots: slots || [], ro: !!ro,
                mode: "chat", msgs: [], phase: "fields", fIdx: 0, sIdx: 0,
                answers: { ...(initialAnswers || {}) }, doneSlots: {} };
  document.querySelectorAll("[data-field]").forEach(el => {
    if (el.value.trim()) state.sub.answers[el.dataset.field] = el.value.trim();
  });
  if (state.sub.fields.length) {
    const firstEmpty = state.sub.fields.findIndex(f => !state.sub.answers[f.id]);
    state.sub.fIdx = firstEmpty < 0 ? state.sub.fields.length : firstEmpty;
    if (state.sub.fIdx >= state.sub.fields.length) state.sub.phase = "slots";
  } else { state.sub.phase = "slots"; }
  const uploaded = Object.values(state.files).reduce((n, ids) => n + ids.length, 0);
  subAgent(`你好${esc(subjectName)}，这里是<b>逐步填写向导</b>
    <div class="mini">这份问卷共 ${state.sub.fields.length} 项登记信息、${state.sub.slots.length} 项材料。
    ${state.sub.answers && Object.keys(state.sub.answers).length ? `已从你的草稿恢复 ${Object.keys(state.sub.answers).length} 项答案${uploaded ? `与 ${uploaded} 份已上传材料` : ""}。` : "我会一题一题问你：必填项会提醒，选填可以跳过；材料题会讲清格式和大小要求。"}
    你在这里答的每一题，都会实时写进表单——两边是同一份页面草稿。填写向导不会调用模型，也不代表材料已通过检查；请主动保存草稿。</div>`);
  renderSubStep();
}
function subAgent(html) { state.sub.msgs.push({ role: "agent", html }); paintSubChat(); }
function subUser(html) { state.sub.msgs.push({ role: "user", html }); }
function paintSubChat() {
  const box = document.getElementById("sub-chat-scroll");
  if (!box) return;
  box.innerHTML = state.sub.msgs.map(m => `
    <div class="msg ${m.role}">
      <div class="avatar">${m.role === "agent" ? "✧" : "我"}</div>
      <div class="body">${m.html}</div>
    </div>`).join("");
  box.scrollTop = box.scrollHeight;
}
function setSubStep(n) {
  [1, 2, 3].forEach(i => {
    const el = document.getElementById("sub-st-" + i);
    if (el) el.classList.toggle("on", i <= n);
  });
}
function setSubMode(m) {
  if (!state.sub) return;
  state.sub.mode = m;
  const bc = document.getElementById("submode-chat"), bf = document.getElementById("submode-form");
  if (bc) { bc.classList.toggle("on", m === "chat"); bc.setAttribute("aria-selected", String(m === "chat")); }
  if (bf) { bf.classList.toggle("on", m === "form"); bf.setAttribute("aria-selected", String(m === "form")); }
  const cc = document.getElementById("sub-chat-card"), fc = document.getElementById("sub-fields-card");
  if (cc) cc.hidden = m !== "chat";
  if (fc) fc.hidden = m !== "form";
  if (m === "chat") { syncSubAnswersFromForm(); renderSubStep(); }
}
function syncSubAnswersFromForm() {
  document.querySelectorAll("[data-field]").forEach(el => {
    const v = el.value.trim();
    if (v) state.sub.answers[el.dataset.field] = v;
    else delete state.sub.answers[el.dataset.field];
  });
}
function formValues() {
  const v = {};
  document.querySelectorAll("[data-field]").forEach(el => { v[el.dataset.field] = el.value.trim(); });
  return v;
}
function renderSubStep() {
  paintSubChat();
  const box = document.getElementById("sub-chat-scroll");
  if (!box || !state.sub) return;
  if (state.sub.phase === "fields") box.insertAdjacentHTML("beforeend", subFieldCard(state.sub.fIdx));
  else if (state.sub.phase === "slots") box.insertAdjacentHTML("beforeend", subSlotCard(state.sub.sIdx));
  else box.insertAdjacentHTML("beforeend", subDoneCard());
  box.scrollTop = box.scrollHeight;
}

function subFieldReq(f) {
  if (!f.required) return false;
  if (!f.required_condition) return true;
  return evalSlotCondition(f.required_condition, formValues()) !== false;
}
function subFieldCard(i) {
  const f = state.sub.fields[i];
  if (!f) return subDoneCard();
  const req = subFieldReq(f);
  const val = state.sub.answers[f.id] || "";
  const opts = f.options && f.options.length ? `
    <div class="chips">${f.options.map((o, k) =>
      `<span class="chip" onclick="subPickOption(${i}, ${k}, this)">${esc(o)}</span>`).join("")}</div>` : "";
  return `<div class="msg agent"><div class="avatar">✧</div><div class="body">
    <b>第 ${i + 1}/${state.sub.fields.length} 题 · ${esc(f.label)}</b>
    ${req ? '<span class="badge bad">必填</span>' : '<span class="badge">选填</span>'}
    ${f.purpose ? `<div class="mini">${esc(f.purpose)}</div>` : ""}
    ${opts}
    <input id="sub-ans" placeholder="请输入${esc(f.label)}" value="${esc(val)}"
      onkeydown="if(event.key===String.fromCharCode(13)&&!event.isComposing){event.preventDefault();subAnswerField(${i})}">
    <div class="row">
      <button class="sm" onclick="subAnswerField(${i})">${i + 1 === state.sub.fields.length ? "填好了，去上传材料" : "下一题"}</button>
      ${req ? "" : `<button class="ghost sm" onclick="subSkipField(${i})">跳过</button>`}
    </div>
    <div id="sub-ans-err"></div>
  </div></div>`;
}
function subPickOption(i, k, el) {
  const f = state.sub.fields[i];
  const input = document.getElementById("sub-ans");
  if (input) input.value = f.options[k];
  el.parentElement.querySelectorAll(".chip").forEach(c => c.classList.remove("on"));
  el.classList.add("on");
}
function subAnswerField(i) {
  const f = state.sub.fields[i];
  const el = document.getElementById("sub-ans");
  const v = (el.value || "").trim();
  const req = subFieldReq(f);
  if (req && !v) {
    document.getElementById("sub-ans-err").innerHTML =
      `<div class="flash err" style="margin:6px 0">这题是必填的，填好才能继续</div>`;
    return;
  }
  state.sub.answers[f.id] = v;
  const inp = document.querySelector('[data-field="' + f.id + '"]');
  if (inp) { inp.value = v; refreshSlotConditions(state.sub.slots); }
  subUser(v ? `${esc(f.label)}：${esc(v)}` : `（${esc(f.label)}：跳过）`);
  state.sub.fIdx = i + 1;
  if (state.sub.fIdx < state.sub.fields.length) renderSubStep();
  else {
    state.sub.phase = "slots"; state.sub.sIdx = 0;
    setSubStep(2);
    if (!state.sub.slots.length) { state.sub.phase = "done"; setSubStep(3); }
    renderSubStep();
  }
}
function subSkipField(i) {
  const f = state.sub.fields[i];
  delete state.sub.answers[f.id];
  const inp = document.querySelector('[data-field="' + f.id + '"]');
  if (inp) inp.value = "";
  subUser(`（${esc(f.label)}：跳过）`);
  state.sub.fIdx = i + 1;
  if (state.sub.fIdx < state.sub.fields.length) renderSubStep();
  else {
    state.sub.phase = "slots"; state.sub.sIdx = 0; setSubStep(2);
    if (!state.sub.slots.length) { state.sub.phase = "done"; setSubStep(3); }
    renderSubStep();
  }
}

function subSlotReq(s) {
  if (!s.required_condition) return true;
  return evalSlotCondition(s.required_condition, formValues()) !== false;
}
function subSlotCard(i) {
  const s = state.sub.slots[i];
  const req = subSlotReq(s);
  const done = (state.files[s.id] || []).length;
  const na = s.required_condition && !req
    ? `<div class="mini">按你刚才填的内容，这项材料<b>不适用</b>（条件：${esc(s.required_condition)}），可以直接跳过。</div>` : "";
  return `<div class="msg agent"><div class="avatar">✧</div><div class="body">
    <b>第 ${i + 1}/${state.sub.slots.length} 项材料 · ${esc(s.label)}</b>
    ${req ? '<span class="badge bad">必交</span>' : '<span class="badge">选交</span>'}
    <div class="mini">${esc(slotMetaText(s))}</div>
    ${na}
    ${done ? `<div class="file-chips">${fileChips(s.id, false)}</div>` : ""}
    <div class="row">
      <input type="file" id="sub-file" style="max-width:260px" ${(s.formats || []).length ? `accept="${(s.formats || []).map(x => "." + esc(x)).join(",")}"` : ""}>
      <button class="sm" onclick="subUploadSlot(${i})">上传</button>
      ${req ? `<button class="ghost sm" onclick="setSubMode('form')" title="留到表单区再传">稍后传</button>`
            : `<button class="ghost sm" onclick="subSkipSlot(${i})">跳过</button>`}
    </div>
    <div id="sub-slot-msg"></div>
  </div></div>`;
}
async function subUploadSlot(i) {
  const s = state.sub.slots[i];
  const input = document.getElementById("sub-file");
  const msg = document.getElementById("sub-slot-msg");
  if (!input.files.length) {
    msg.innerHTML = `<div class="flash err" style="margin:6px 0">先选择文件再上传</div>`;
    return;
  }
  const file = input.files[0];
  msg.innerHTML = `<span class="muted">上传中…</span>`;
  try {
    const data = await uploadFile(s.id, file);
    msg.innerHTML = "";
    afterSlotUpload(s.id, data.file_id, { name: file.name, size: file.size || data.size });
    subUser(`上传了「${esc(s.label)}」：${esc(file.name)}`);
    advanceSlot(i);
  } catch (e) {
    msg.innerHTML = `<div class="flash err" style="margin:6px 0">${esc(e.message)}</div>`;
  }
}
function advanceSlot(i) {
  state.sub.sIdx = i + 1;
  if (state.sub.sIdx < state.sub.slots.length) renderSubStep();
  else { state.sub.phase = "done"; setSubStep(3); renderSubStep(); }
}
function subSkipSlot(i) {
  const s = state.sub.slots[i];
  subUser(`（「${esc(s.label)}」跳过）`);
  advanceSlot(i);
}
function subDoneCard() {
  const ans = state.sub.fields.map(f =>
    `<tr><td>${esc(f.label)}</td><td>${esc(state.sub.answers[f.id] || "—")}</td></tr>`).join("");
  const files = state.sub.slots.map(s =>
    `<tr><td>${esc(s.label)}</td><td>${(state.files[s.id] || []).length
      ? `<span class="badge ok">${state.files[s.id].length} 个</span>`
      : (subSlotReq(s) ? '<span class="badge bad">未上传</span>' : '<span class="muted">未传（不适用/选交）</span>')}</td></tr>`).join("");
  const missing = state.sub.slots.filter(s => subSlotReq(s) && !(state.files[s.id] || []).length);
  return `<div class="msg agent"><div class="avatar">✧</div><div class="body">
    <b>核对一下再提交 ✅</b>
    ${state.sub.fields.length ? `<table style="margin-top:8px"><tr><th>登记信息</th><th>内容</th></tr>${ans}</table>` : ""}
    ${state.sub.slots.length ? `<table style="margin-top:8px"><tr><th>材料</th><th>状态</th></tr>${files}</table>` : ""}
    ${missing.length ? `<div class="flash err" style="margin-top:8px">还有必交材料没上传：${esc(missing.map(s => s.label).join("、"))}。
      传好后（或到表单区上传）再提交；未传齐就提交会被系统拦下。</div>` : ""}
    <div class="row" style="margin-top:8px">
      <button class="sm" onclick="saveDraft()">保存草稿</button>
      <button onclick="doSubmit()">正式提交并检查</button>
    </div>
    <div class="mini">提交成功会拿到稳定回执；检查结果出来后，我会在这里告诉你要不要改、怎么改。</div>
  </div></div>`;
}

/* ---------------------------------------------------------------- 交付与归档 */
async function viewDelivery(taskId) {
  state.deliveryTaskId = taskId;
  document.getElementById("app").innerHTML = `
    <div class="breadcrumb"><a href="#/tasks">我的任务</a><span>/</span><span>交付与归档</span></div>
    <div class="page-heading"><div><div class="eyebrow">DELIVERY & ARCHIVE</div><h1>交付与归档<span class="heading-dot">.</span></h1><p>先固定一份快照，再导出。之后的新提交不会改变已固定的包。</p></div>
      <a class="ghost" href="#/workbench/${taskId}">回工作台 ${icon("arrow")}</a></div>
    <div id="flash" role="status" aria-live="polite"></div>
    <div class="delivery-layout">
      <section class="card snapshot-panel"><div class="eyebrow">01 / SNAPSHOT</div><h2>固定快照</h2>
        <label for="snap-kind">快照类型</label>
        <select id="snap-kind"><option value="formal">正式（仅已验收）</option><option value="preview">整理预览（全部列出）</option></select>
        <p class="field-help">${icon("delivery")} 正式快照只纳入已验收版本；预览快照列出全部主体并标明排除原因。快照固定后不可追加。</p>
        <button onclick="createSnapshot(${taskId})">固定快照 ${icon("arrow")}</button>
      </section>
      <section class="card delivery-note"><div class="eyebrow">02 / EXPORT</div><h2>导出说明</h2>
        <ul class="check-list"><li>CSV 汇总每个主体的登记信息、版本、回执与验收状态。</li><li>ZIP 按交付命名规则打包材料原件。</li><li>导出基于快照，不在导出时读取最新数据。</li></ul>
      </section>
    </div>
    <div id="snap-view"></div>`;
}
async function createSnapshot(taskId) {
  await guard(async () => {
    const kind = document.getElementById("snap-kind").value;
    const r = await api(`/api/tasks/${taskId}/snapshots`,
                        { method: "POST", form: { kind } });
    const m = JSON.parse(r.manifest);
    const excluded = (m.entries || []).filter(e => !e.included);
    document.getElementById("snap-view").innerHTML = `<section class="card snapshot-result">
      <div class="section-heading"><div><div class="eyebrow">SNAPSHOT #${r.snapshot_id}</div><h2>${m.kind === "formal" ? "正式快照" : "整理预览快照"}</h2></div><span class="badge ${m.kind === "formal" ? "ok" : "info"}">已固定</span></div>
      <div class="overview-stats">${[["主体总数", m.totals.subjects], ["纳入", m.totals.included], ["排除", m.totals.excluded], ["蓝图版本", "#" + m.blueprint_version_id]].map(([l, v]) => `<div class="overview-stat"><span>${l}</span><strong>${v}</strong><i>${icon("delivery")}</i></div>`).join("")}</div>
      <div class="table-wrap"><table><thead><tr><th>主体</th><th>版本</th><th>纳入</th><th>排除原因</th><th>材料</th></tr></thead>
      <tbody>${(m.entries || []).map(e => `<tr><td>${esc(e.name)}</td><td>${e.revision ?? "-"}</td>
        <td>${e.included ? '<span class="badge ok">是</span>' : '<span class="badge">否</span>'}</td><td>${esc(e.excluded_reason || "—")}</td>
        <td>${(e.files || []).length}</td></tr>`).join("")}</tbody></table></div>
      ${excluded.length ? `<p class="field-help">有 ${excluded.length} 个主体未纳入：正式快照只包含已验收版本，可在工作台逐个人工验收后重新固定。</p>` : ""}
      <div class="row-actions snapshot-actions"><button onclick="runExport(${r.snapshot_id})">生成 CSV + ZIP ${icon("arrow")}</button><span id="dl" class="row-actions"></span></div>
    </section>`;
    setFlash(`快照 #${r.snapshot_id} 已固定`, "ok");
  });
}
async function runExport(snapId) {
  await guard(async () => {
    const r = await api(`/api/snapshots/${snapId}/export`, { method: "POST" });
    state.lastJob = r;
    document.getElementById("dl").innerHTML = `
      <button class="ghost sm" onclick="downloadFile('/api/exports/${r.job_id}/csv','summary_${r.job_id}.csv')">下载 CSV</button>
      <button class="ghost sm" onclick="downloadFile('/api/exports/${r.job_id}/zip','materials_${r.job_id}.zip')">下载 ZIP</button>`;
    setFlash(`导出作业 #${r.job_id} 已生成`, "ok");
  });
}
async function downloadFile(url, filename) {
  const r = await fetch(url, { headers: { Authorization: "Bearer " + orgToken() } });
  if (!r.ok) throw new Error("下载失败 HTTP " + r.status);
  const blob = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

route();
