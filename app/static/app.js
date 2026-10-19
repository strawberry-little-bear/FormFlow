"use strict";
/* 收齐啦 FormFlow 前端（P01–P05）。纯静态 SPA，直接调用 /api。 */
const ORG_KEY = "ff_org_token", SUB_KEY = "ff_sub_token";
const state = { taskId: null, chat: [], bpId: null, draft: null, requirement: "", answeredDone: false, files: {}, draftVersion: null, me: null, lastJob: null, roster: {} };

const orgToken = () => localStorage.getItem(ORG_KEY) || "";
const subToken = () => localStorage.getItem(SUB_KEY) || "";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

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
  const tok = opts.sub ? subToken() : orgToken();
  if (tok) headers["Authorization"] = "Bearer " + tok;
  const r = await fetch(path, { method: opts.method || "GET", headers, body });
  const text = await r.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { detail: text }; }
  if (!r.ok) throw new Error(data.detail || ("HTTP " + r.status));
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
  unknown: '<span class="badge warn">unknown</span>',
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
  const h = (location.hash || "#/login").replace(/^#/, "");
  const parts = h.split("/").filter(Boolean);
  renderNav();
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

function renderNav() {
  const nav = document.getElementById("nav");
  const org = !!orgToken(), sub = !!subToken();
  document.getElementById("role-label").textContent =
    org ? "组织者已登录" : sub ? "提交者已登录" : "未登录";
  const items = [];
  if (org) {
    items.push(["#/tasks", "任务列表"]);
  }
  if (sub) items.push(["#/submit", "提交空间"]);
  if (!org && !sub) items.push(["#/login", "登录"]);
  nav.innerHTML = items.map(([href, label]) =>
    `<a href="${href}" class="${location.hash === href ? "active" : ""}">${label}</a>`).join("");
}

function logout() {
  localStorage.removeItem(ORG_KEY); localStorage.removeItem(SUB_KEY);
  location.hash = "#/login"; route();
}

/* ---------------------------------------------------------------- 登录 */
function viewLogin() {
  document.getElementById("app").innerHTML = `
  <div class="login-wrap">
    <div class="login-hero">
      <div class="logo"><span class="mark">齐</span><span style="font-size:17px">收齐啦 FormFlow</span></div>
      <h1>把一句要求，变成 everyone 都能交对的问卷</h1>
      <p class="tag">对话式起草 · 证据化核对 · 版本化交付</p>
      <div class="feat"><div class="ic">💬</div><div><b>对话即成问卷</b>
        <span>和组织者助手聊几句，自动生成字段、材料要求与检查规则</span></div></div>
      <div class="feat"><div class="ic">🔍</div><div><b>交上来逐条核对</b>
        <span>每处问题都带原文位置与改法，不把「没读到」说成「确认缺失」</span></div></div>
      <div class="feat"><div class="ic">📦</div><div><b>按正确版本交付</b>
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
    await api("/api/me", { sub: true });   // 校验凭证
    localStorage.setItem(SUB_KEY, cred);
    location.hash = "#/submit"; route();
  } catch (e) { loginErr("凭证无效或已失效：" + (e.message || "")); }
}

/* ---------------------------------------------------------------- 任务列表 */
async function viewTasks() {
  document.getElementById("app").innerHTML = `<div id="flash"></div>
    <div class="card"><h3>新建任务</h3>
      <div class="row">
        <div><label>任务名称</label><input id="tk-name" placeholder="如：2026 秋季第 1 期团课报告"></div>
        <div><label>模式</label><select id="tk-mode">
          <option value="roster">名册制</option><option value="open">开放制</option></select></div>
        <div><label>主体类型</label><select id="tk-kind">
          <option value="individual">个人</option><option value="team">团队</option></select></div>
      </div>
      <button onclick="createTask()">创建任务</button>
    </div>
    <div class="card"><h3>我的任务</h3><div id="task-list"><p class="muted">加载中…</p></div></div>`;
  try {
    const { tasks } = await api("/api/tasks");
    document.getElementById("task-list").innerHTML = tasks.length ? `
      <table><tr><th>ID</th><th>名称</th><th>状态</th><th>模式</th><th>操作</th></tr>
      ${tasks.map(t => `<tr><td>${t.id}</td><td>${esc(t.name)}</td>
        <td><span class="badge info">${esc(t.status)}</span></td><td>${esc(t.mode)}</td>
        <td>
          <a href="#/design/${t.id}">设计台</a> ·
          <a href="#/roster/${t.id}">名单</a> ·
          <a href="#/workbench/${t.id}">工作台</a> ·
          <a href="#/delivery/${t.id}">交付预览</a>
        </td></tr>`).join("")}</table>` : `<p class="muted">还没有任务</p>`;
  } catch (e) { setFlash(e.message); }
}
async function createTask() {
  await guard(async () => {
    const name = document.getElementById("tk-name").value.trim();
    if (!name) throw new Error("请填写任务名称");
    await api("/api/tasks", { method: "POST",
      form: { name, mode: document.getElementById("tk-mode").value,
              subject_kind: document.getElementById("tk-kind").value } });
    await viewTasks();
  });
}

/* ---------------------------------------------------------------- P01 对话式设计台 */
const EXECUTOR_LABEL = { deterministic: "程序校验", semantic: "语义检查", human_only: "仅人工" };
const CAP_BADGE = { supported: '<span class="badge ok">已支持</span>',
                    needs_human: '<span class="badge warn">需人工</span>',
                    needs_clarification: '<span class="badge warn">需澄清</span>' };

async function viewDesign(taskId) {
  state.taskId = taskId;
  document.getElementById("app").innerHTML = `<div id="flash"></div>
  <div class="step-flow">
    <span class="st on" id="st-1"><span class="dot">1</span>对话起草</span><span class="arw"></span>
    <span class="st" id="st-2"><span class="dot">2</span>澄清确认</span><span class="arw"></span>
    <span class="st" id="st-3"><span class="dot">3</span>发布</span>
  </div>
  <div class="grid-chat">
    <div class="card">
      <h3>💬 和小齐聊着把问卷定下来 <span class="sub">对话与右侧结构化草案始终是同一份</span></h3>
      <div class="chat">
        <div class="chat-scroll" id="chat-scroll"></div>
        <div class="chips" id="chat-chips"></div>
        <div class="chat-input">
          <textarea id="chat-in" placeholder="说出你要收什么，或提出修改意见…（Enter 发送，Shift+Enter 换行）"
            onkeydown="if(event.key===String.fromCharCode(13)&&!event.shiftKey){event.preventDefault();chatSend()}"></textarea>
          <button onclick="chatSend()">发送</button>
        </div>
      </div>
    </div>
    <div id="draft-panel"></div>
  </div>`;
  state.chat = []; state.bpId = null; state.draft = null; state.requirement = "";
  agentSay(`你好，我是设计助手<b>小齐</b> 👋
    <div class="mini">把「收什么、交给谁、什么时候交」告诉我就行：我会生成登记字段、材料要求和检查规则。
    拿不准的地方我会先问你——已知信息不重复追问，也绝不暗加你没有提的要求。</div>`);
  renderChips();
  renderDraftPanel();
}

function renderChips() {
  const box = document.getElementById("chat-chips");
  if (!box) return;
  box.innerHTML = state.bpId ? `
      <span class="chip" onclick="fillChat('首次截止改到 11 月 9 日 18:00')">改截止时间</span>
      <span class="chip" onclick="fillChat('材料也接受 Markdown')">加材料格式</span>
      <span class="chip" onclick="fillChat('再加一个登记字段：班级')">加字段</span>`
    : `<span class="chip" onclick="quickTemplate('class_report')">📋 团课报告模板</span>
      <span class="chip" onclick="quickTemplate('contest_signup')">🏆 比赛报名模板</span>
      <span class="kv" style="align-self:center">或直接输入一句话要求</span>`;
}
function fillChat(t) {
  const el = document.getElementById("chat-in");
  el.value = t; el.focus();
}
function chatScrollBottom() {
  const el = document.getElementById("chat-scroll");
  if (el) el.scrollTop = el.scrollHeight;
}
function userSay(text) {
  state.chat.push({ role: "user", html: esc(text).replace(/\n/g, "<br>") });
  paintChat();
}
function agentSay(html, mini) {
  state.chat.push({ role: "agent", html, mini: mini || "" });
  paintChat();
}
function chatTyping(on) {
  const old = document.getElementById("typing-row");
  if (!on) { if (old) old.remove(); return; }
  if (old) return;
  const div = document.createElement("div");
  div.className = "msg agent"; div.id = "typing-row";
  div.innerHTML = `<div class="avatar">🤖</div><div class="body"><span class="typing"><i></i><i></i><i></i></span></div>`;
  document.getElementById("chat-scroll").appendChild(div);
  chatScrollBottom();
}
function paintChat() {
  const box = document.getElementById("chat-scroll");
  if (!box) return;
  box.innerHTML = state.chat.map(m => `
    <div class="msg ${m.role}">
      <div class="avatar">${m.role === "agent" ? "🤖" : "🧑"}</div>
      <div class="body">${m.html}${m.mini ? `<div class="mini">${m.mini}</div>` : ""}</div>
    </div>`).join("");
  const clar = (state.draft && state.draft.clarifications) || [];
  if (state.bpId && clar.length && !state.answeredDone) {
    box.insertAdjacentHTML("beforeend", clarCard(clar));
  }
  chatScrollBottom();
}
function clarCard(clars) {
  return `<div class="msg agent"><div class="avatar">🤖</div><div class="body">
    <b>还有 ${clars.length} 个问题需要你确认：</b>
    ${clars.map((c, i) => `<div style="margin-top:9px">
      <div>${i + 1}. ${esc(c.question)}${c.why ? `<div class="mini">为什么问：${esc(c.why)}</div>` : ""}</div>
      <input id="clar-${i}" placeholder="你的回答（可留空，按默认处理并说明）">
    </div>`).join("")}
    <input id="clar-extra" placeholder="补充修改意见（可选，例：截止改到 11 月 9 日 18:00）" style="margin-top:9px">
    <div class="row" style="margin-top:4px">
      <button class="sm" onclick="submitClarAnswers()">提交回答，更新草案</button>
    </div>
  </div></div>`;
}
async function quickTemplate(tpl) {
  await guard(async () => {
    chatTyping(true);
    try {
      const r = await api(`/api/tasks/${state.taskId}/draft/template`,
                          { method: "POST", form: { template: tpl } });
      state.bpId = r.blueprint_version_id;
      state.draft = { blueprint: r.blueprint, clarifications: [], publish_summary: [], warnings: [] };
      state.answeredDone = true;
      chatTyping(false);
      userSay(`用「${tpl === "class_report" ? "团课报告" : "比赛报名"}」模板生成`);
      agentSay(`已按模板生成草案，右侧可以查看完整结构。
        <div class="mini">模板只是起点——继续告诉我你的具体要求，我会在这份草案上改。</div>`);
      renderChips(); renderDraftPanel();
    } catch (e) { chatTyping(false); setFlash(e.message); }
  });
}

async function chatSend() {
  const el = document.getElementById("chat-in");
  const text = (el.value || "").trim();
  if (!text) return;
  el.value = "";
  userSay(text);
  chatTyping(true);
  try {
    if (!state.bpId) {
      const r = await api(`/api/tasks/${state.taskId}/draft/agent`,
                          { method: "POST", form: { requirement: text } });
      state.bpId = r.blueprint_version_id;
      state.draft = r.draft;
      state.requirement = text;
      state.answeredDone = false;
      chatTyping(false);
      const bp = r.draft.blueprint || {};
      const rules = bp.rules || [];
      const nAuto = rules.filter(x => x.executor !== "human_only").length;
      agentSay(`看懂了，草案生成好了 ✅
        <div class="mini">登记字段 ${(bp.fields || []).length} 项 · 材料槽位 ${(bp.slots || []).length} 个 ·
        检查规则 ${rules.length} 条（自动 ${nAuto} / 人工 ${rules.length - nAuto}）<br>
        右侧是可核对的结构化草案；有拿不准的地方我在下面问你。</div>`);
      renderChips(); renderDraftPanel();
    } else {
      const r = await api(`/api/tasks/${state.taskId}/draft/revise`, {
        method: "POST",
        form: { blueprint_version_id: String(state.bpId),
                requirement: state.requirement || "",
                answered: "{}", instruction: text } });
      state.bpId = r.blueprint_version_id;
      state.draft = r.draft;
      state.answeredDone = false;
      chatTyping(false);
      agentSay(`改好了，已生成新草案版本 v${r.version}。
        <div class="mini">${impactText(r.impact)}</div>`);
      renderDraftPanel();
    }
  } catch (e) { chatTyping(false); setFlash(e.message); }
}

function impactText(im) {
  im = im || {};
  const bits = [];
  for (const k of ["fields", "slots", "rules"]) {
    const c = im[k] || {};
    if (c.added && c.added.length) bits.push(`${k} 增加 ${c.added.length}`);
    if (c.removed && c.removed.length) bits.push(`${k} 移除 ${c.removed.length}`);
    if (c.changed && c.changed.length) bits.push(`${k} 修改 ${c.changed.length}`);
  }
  if (im.time_policy_changed) bits.push("时间策略有变化");
  if (im.manual_acceptance_changed) bits.push("验收设置有变化");
  if (im.eligibility_required_changed) bits.push("资格要求有变化");
  return bits.length ? "本次变化：" + esc(bits.join("；")) : "没有实质变化";
}

async function submitClarAnswers() {
  const clar = (state.draft && state.draft.clarifications) || [];
  const answered = {};
  clar.forEach((c, i) => {
    const v = (document.getElementById("clar-" + i).value || "").trim();
    if (v) answered[c.question] = v;
  });
  const extra = (document.getElementById("clar-extra").value || "").trim();
  await guard(async () => {
    chatTyping(true);
    try {
      const r = await api(`/api/tasks/${state.taskId}/draft/revise`, {
        method: "POST",
        form: { blueprint_version_id: String(state.bpId),
                requirement: state.requirement || "",
                answered: JSON.stringify(answered), instruction: extra } });
      state.bpId = r.blueprint_version_id;
      state.draft = r.draft;
      const left = (r.draft.clarifications || []).length;
      state.answeredDone = !left;
      chatTyping(false);
      agentSay(`收到 ${Object.keys(answered).length} 条回答${extra ? "和补充意见" : ""}，草案已更新 ✅
        <div class="mini">${left ? `仍有 ${left} 个问题待确认，可继续回答。`
          : "没有待澄清问题了，右侧核对无误后即可发布。"}</div>`);
      renderDraftPanel();
    } catch (e) { chatTyping(false); setFlash(e.message); }
  });
}
/* 右侧结构化草案面板：与对话同一份草案，可人工核对每一项 */
function renderDraftPanel() {
  const box = document.getElementById("draft-panel");
  if (!box) return;
  const d = state.draft;
  const has = state.bpId && d && d.blueprint;
  const st2 = document.getElementById("st-2"), st3 = document.getElementById("st-3");
  if (st2) st2.classList.toggle("on", !!has);
  if (st3) st3.classList.toggle("on", !!(has && !(d.warnings || []).length));
  if (!has) {
    box.innerHTML = `<div class="card"><h3>📋 结构化草案</h3>
      <p class="empty">还没有草案。<br>在左侧把要求发给小齐，或点模板快速开始。</p></div>`;
    return;
  }
  const bp = d.blueprint;
  const rules = bp.rules || [];
  const nAuto = rules.filter(x => x.executor !== "human_only").length;
  const tp = bp.time_policy || {};
  const fmtDT = (x) => x ? esc(String(x).replace("T", " ").slice(0, 16)) : "未设置";
  box.innerHTML = `
  <div class="card">
    <h3>📋 结构化草案 <span class="sub">蓝图版本 #${state.bpId} · 与对话同步</span></h3>
    <div class="stat-row">
      <div class="stat"><div class="n">${(bp.fields || []).length}</div><div class="t">登记字段</div></div>
      <div class="stat"><div class="n">${(bp.slots || []).length}</div><div class="t">材料槽位</div></div>
      <div class="stat"><div class="n">${rules.length}</div><div class="t">检查规则（自动 ${nAuto}）</div></div>
      <div class="stat"><div class="n">${(d.clarifications || []).length}</div><div class="t">待澄清</div></div>
    </div>
    ${(d.warnings || []).length ? `<p style="color:var(--bad)"><b>警告（发布前请处理）：</b></p>
      <ul>${d.warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
    ${state.requirement ? `<details style="margin:8px 0"><summary class="kv">查看原始要求</summary>
      <p class="kv" style="white-space:pre-wrap">${esc(state.requirement)}</p></details>` : ""}
  </div>
  <div class="card"><h3>登记字段</h3>
    ${(bp.fields || []).map(f => `<span class="pill"><b>${esc(f.label)}</b>
      ${f.required ? "必填" : "选填"}${f.required_condition ? ` · 条件 ${esc(f.required_condition)}` : ""}
      ${f.visibility === "organizer" ? " · 仅组织者可见" : ""}</span>`).join("") || '<p class="muted">无字段</p>'}
  </div>
  <div class="card"><h3>材料槽位</h3>
    ${(bp.slots || []).map(s => `<span class="pill"><b>${esc(s.label)}</b>
      ${(s.formats || []).map(esc).join("/") || "不限格式"} · 最多 ${s.max_count} 个
      ${s.max_size_mib ? ` · ≤${s.max_size_mib}MiB` : ""}${s.max_pages ? ` · ≤${s.max_pages}页` : ""}
      ${s.required_condition ? ` · 条件 ${esc(s.required_condition)}` : ""}</span>`).join("") || '<p class="muted">无材料槽位</p>'}
  </div>
  <div class="card"><h3>检查规则 <span class="sub">能力如实标注，不把做不到的说成自动</span></h3>
    <table><tr><th>规则</th><th>能力</th><th>执行</th><th>级别</th></tr>
    ${rules.map(r => `<tr><td>${esc(r.statement)}<div class="kv">${esc(r.requirement_source || "")}</div></td>
      <td>${CAP_BADGE[r.capability] || esc(r.capability)}</td>
      <td>${esc(EXECUTOR_LABEL[r.executor] || r.executor)}</td>
      <td>${r.severity === "blocking" ? '<span class="badge bad">阻塞</span>' : '<span class="badge">提醒</span>'}</td></tr>`).join("")}
    </table>
  </div>
  <div class="card"><h3>时间与验收</h3>
    <dl class="kv-list">
      <dt>开放时间</dt><dd>${fmtDT(tp.open_at)}</dd>
      <dt>首次截止</dt><dd>${fmtDT(tp.first_deadline)}</dd>
      <dt>补正截止</dt><dd>${fmtDT(tp.correction_deadline)}</dd>
      <dt>人工验收</dt><dd>${bp.manual_acceptance ? "需要组织者最终人工验收" : "不要求"}</dd>
      <dt>资格核实</dt><dd>${bp.eligibility_required ? "需要" : "不要求"}</dd>
    </dl>
    ${(d.publish_summary || []).length ? `<p class="kv" style="margin-top:10px"><b>发布摘要：</b></p>
      <ul>${d.publish_summary.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    <div class="row" style="margin-top:12px">
      <button onclick="publishBp(${state.taskId})">发布蓝图</button>
    </div>
    <p class="kv" style="margin-top:8px">发布时会逐项程序校验：对象/材料/能力/双截止/验收/交付与数据用途；
      关键冲突会定位到具体项，不会静默放过。</p>
  </div>`;
}

async function publishBp(taskId) {
  await guard(async () => {
    if (!state.bpId) throw new Error("请先生成蓝图草案");
    const r = await api(`/api/tasks/${taskId}/blueprints/${state.bpId}/publish`, { method: "POST" });
    setFlash(`已发布版本 v${r.published_version}，任务状态：${r.task_status}。下一步：导入名单`, "ok");
    agentSay(`蓝图已发布 ✅ 版本 v${r.published_version}，提交者现在可以按这份问卷提交了。
      <div class="mini">别忘了去「名单」页导入应交名单、发放提交凭证。</div>`);
  });
}

/* ---------------------------------------------------------------- 名单管理 */
async function viewRoster(taskId) {
  document.getElementById("app").innerHTML = `<div id="flash"></div>
  <div class="card"><h3>👥 名单管理 <span class="sub" id="roster-task"></span></h3>
    <div class="stat-row" id="roster-stats"></div>
    <p class="kv">名册计数：名册 = 应交 + 有效免交；应交 = 已正式提交 + 未正式提交。
      验收、补正和人工待办都是已提交的子集，不能相加成总人数。</p>
  </div>
  <div class="card"><h3>① 导入名册</h3>
    <p class="kv">每行一条：<b>姓名</b> 或 <b>姓名,备注</b>（中英文逗号或制表符均可；备注建议写学号/班级，用于按班整理与核对）。</p>
    <textarea id="roster-raw" placeholder="张三,一班&#10;李四,一班&#10;王五,二班" style="min-height:110px"></textarea>
    <div class="preview-box" id="roster-preview">输入后这里实时显示解析预览</div>
    <div class="row" style="margin-top:10px"><button onclick="importRoster(${taskId})">导入名册</button></div>
  </div>
  <div class="card"><h3>② 名册与凭证</h3>
    <div class="row" style="margin-bottom:10px">
      <button class="ghost" onclick="issueAllGrants(${taskId})">为全部未发放凭证的主体发放</button>
    </div>
    <div id="roster-table"><p class="muted">加载中…</p></div>
    <div id="grant-out" style="margin-top:12px"></div>
    <p class="kv" style="margin-top:10px">凭证是提交者进入本人提交空间的唯一钥匙，请通过私下渠道发放；
      同名主体只按名复用提交空间，是否同一人请在复核页人工核对，不自动合并。</p>
  </div>
  <div class="card"><h3>③ 接下来</h3>
    <p class="kv">名单就绪后，到 <a href="#/workbench/${taskId}">任务工作台</a> 跟踪谁没交、谁要改、谁等你决定。</p>
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
  document.getElementById("roster-task").textContent = `任务 #${taskId}`;
  document.getElementById("roster-stats").innerHTML = `
    <div class="stat"><div class="n">${d.total}</div><div class="t">名册总数</div></div>
    <div class="stat"><div class="n">${d.granted}</div><div class="t">已发放凭证</div></div>
    <div class="stat"><div class="n">${d.exempt}</div><div class="t">有效免交</div></div>
    <div class="stat"><div class="n">${Math.max(0, d.total - d.granted - d.exempt)}</div><div class="t">待发放</div></div>`;
  document.getElementById("roster-table").innerHTML = d.entries.length ? `
    <table><tr><th>姓名</th><th>备注</th><th>凭证</th><th>提交空间</th><th>操作</th></tr>
    ${d.entries.map(e => `<tr>
      <td>${esc(e.name)}</td><td>${esc(e.ref || "-")}</td>
      <td>${e.granted ? '<span class="badge ok">已发放</span>' : '<span class="badge warn">未发放</span>'}</td>
      <td>${e.exempt ? '<span class="badge info">免交</span>'
        : (e.subject_id ? "已创建" : '<span class="muted">发放凭证时自动创建</span>')}</td>
      <td>${e.granted ? '<span class="muted">可重发以替换旧凭证</span>' : ""}
        <button class="ghost sm" onclick="issueGrant(${taskId},${e.id})">${
          e.granted ? "重发凭证" : "发放凭证"}</button></td>
    </tr>`).join("")}</table>`
    : `<p class="empty">名册还是空的——先在上面粘贴名单导入。</p>`;
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
    <p class="kv">主体「${esc(name)}」的凭证（<b>仅显示这一次</b>，请复制后通过私下渠道发给本人）：</p>
    <div class="cred">${esc(cred)}</div>
    <p class="kv" style="margin-top:6px">重发会生成新凭证；为安全起见，旧凭证仍有效直到被撤销或过期。</p>`;
}
function showCredentialList(list) {
  document.getElementById("grant-out").innerHTML = `
    <p class="kv">已生成 ${list.length} 个凭证（<b>仅显示这一次</b>，请逐一复制发给对应同学）：</p>
    <table><tr><th>姓名</th><th>凭证</th></tr>
    ${list.map(x => `<tr><td>${esc(x.name)}</td><td><div class="cred">${esc(x.credential)}</div></td></tr>`).join("")}
    </table>`;
}

/* ---------------------------------------------------------------- P02 工作台 */
const TASK_STATUS_LABEL = {draft: "草稿", collecting: "收集中", closed: "已关闭",
                           archived: "已归档", cancelled: "已取消"};
const READONLY_STATUSES = ["closed", "archived", "cancelled"];

async function viewWorkbench(taskId) {
  document.getElementById("app").innerHTML = `<div id="flash"></div>
    <div class="card"><h3>P02 任务工作台（任务 #${taskId}）</h3>
    <p class="muted">一行一个主体：谁没交、谁要改、谁等我决定。</p>
    <div id="wb-lifecycle"></div>
    <div id="wb"><p class="muted">加载中…</p></div></div>`;
  try {
    const data = await api(`/api/tasks/${taskId}/workbench`);
    const t = data.task || {};
    const ro = READONLY_STATUSES.includes(t.status);
    const label = TASK_STATUS_LABEL[t.status] || t.status;
    document.getElementById("wb-lifecycle").innerHTML = `
      <p class="kv">任务状态：<span class="badge ${ro ? "warn" : "info"}">${esc(label)}</span>${
        ro ? ' <span class="kv">（只读：提交/上传/检查/修订已停止，历史数据可查可导出）</span>' : ""}</p>
      <div class="row">${lifecycleButtons(t.status, taskId)}</div>`;
    const rows = data.rows || [];
    document.getElementById("wb").innerHTML = rows.length ? `
      <table><tr><th>主体</th><th>当前版本</th><th>状态</th><th>待办</th><th>操作</th></tr>
      ${rows.map(r => {
        const b = r.buckets || {};
        const tags = [
          ...(b.blocking || []).map(x => `<span class="badge bad">阻塞:${esc(x)}</span>`),
          ...(b.unknown || []).map(x => `<span class="badge warn">unknown:${esc(x)}</span>`),
          ...(b.human || []).map(x => `<span class="badge info">人工:${esc(x)}</span>`),
          ...(b.incomplete || []).map(x => `<span class="badge bad">失败:${esc(x)}</span>`),
          ...(b.pending_jobs || []).map(x => `<span class="badge info">${esc(x)}</span>`),
        ].join("");
        const canRetry = !ro && r.run_status === "failed";
        return `<tr><td>${esc(r.name)}</td><td>${r.revision ?? "-"}</td>
          <td>${esc(r.summary)}</td><td>${tags || "-"}</td>
          <td>${ro
            ? `<button class="ghost" disabled title="任务已${esc(label)}，只读状态不能发起检查">检查</button>`
            : `<button class="ghost" onclick="runCheck(${taskId},${r.subject_id})">检查</button>`}
          ${canRetry ? `<button class="ghost" onclick="retryCheck(${taskId},${r.subject_id})" title="上次检查技术失败：重试生成新运行，旧运行标记被取代并保留">重试</button>` : ""}
              <a href="#/review/${taskId}/${r.subject_id}">复核</a></td></tr>`;
      }).join("")}</table>` : `<p class="muted">暂无主体</p>`;
    // 有排队/执行中的检查：3 秒后自动刷新，直到 Worker 跑完（失败可重试，成功即止）
    const pending = rows.some(r => ["queued", "running", "retry_wait"].includes(r.run_status));
    clearTimeout(_wbTimer);
    if (pending) _wbTimer = setTimeout(() => viewWorkbench(taskId), 3000);
  } catch (e) { setFlash(e.message); }
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
    await viewWorkbench(taskId);
  });
}
let _wbTimer = 0;
async function runCheck(taskId, sid) {
  await guard(async () => {
    await api(`/api/tasks/${taskId}/subjects/${sid}/checks`, { method: "POST" });
    setFlash("检查已排队：后台执行中，页面会自动刷新", "ok");
    await viewWorkbench(taskId);
  });
}
async function retryCheck(taskId, sid, back) {
  await guard(async () => {
    const r = await api(`/api/tasks/${taskId}/subjects/${sid}/checks/retry`, { method: "POST" });
    setFlash(`已重新排队：新运行 #${r.run_id} 后台执行中，旧运行 #${r.retried_from} 已标记被取代、历史保留`, "ok");
    if (back === "review") await viewReview(taskId, sid);
    else await viewWorkbench(taskId);
  });
}

/* ---------------------------------------------------------------- P03 证据复核 */
async function viewReview(taskId, sid) {
  document.getElementById("app").innerHTML = `<div id="flash"></div>
    <div class="card"><h3>P03 证据复核（任务 #${taskId} · 主体 #${sid}）</h3>
    <div id="rv"><p class="muted">加载中…</p></div></div>`;
  try {
    const d = await api(`/api/tasks/${taskId}/subjects/${sid}/findings`);
    let html = `<p class="kv">主体：${esc(d.subject.name)}`;
    if (d.revision) html += ` · 当前版本 v${d.revision.version} · 回执 ${esc(d.revision.receipt)}`;
    if (d.run) {
      html += ` · 运行 #${d.run.id}（${esc(d.run.status)}）`;
      if (d.run.status === "failed") {
        html += ` <button class="ghost" onclick="retryCheck(${taskId},${sid},'review')" title="上次检查技术失败：重试生成新运行，旧运行标记被取代并保留">重试检查</button>`;
      }
    }
    html += `</p>`;
    html += coverageCard(d.run);
    if ((d.notes || []).length) {
      html += `<div class="card"><h3>提交者解释 / 复核申诉</h3>
        ${(d.notes || []).map(n => `<p>规则 ${esc(n.rule_id || "整体")}
          <span class="badge${n.handled ? " ok" : " warn"}">${
            n.handled ? "组织者已处理" : "待处理"}</span>
          <span class="kv">${esc(n.content)}，${esc(n.created_at)}</span></p>`).join("")}
        <p class="kv">解释不改变机器结论；请核对原文后再做决定，
          可确认问题、纠正误报或批准有范围的例外。</p>
      </div>`;
    }
    if (d.same_name_subjects && d.same_name_subjects.length) {
      html += `<div class="card"><h3>同名主体待核</h3>
        <p class="kv">${esc(d.same_name_hint || "")}</p>
        ${d.same_name_subjects.map(s => `<p>主体 #${s.id}（${esc(s.name)}）——以主体 ID 为准人工核对，系统不自动合并</p>`).join("")}
      </div>`;
    }

    html += (d.rules || []).map(ruleCard).join("")
      || `<p class="muted">暂无规则结果（可能尚未检查）</p>`;
    html += `
      <div class="card"><h3>人工决定</h3>
        <div class="row">
          <div><label>决定</label><select id="dc-type">
            <option value="confirm_issue">确认问题</option>
            <option value="correct_false_positive">纠正误报</option>
            <option value="approve_exception">批准例外</option>
            <option value="exempt">免交</option>
            <option value="accept_current">验收当前版本</option>
          </select></div>
          <div><label>作用域规则（可空）</label><input id="dc-rule" placeholder="rule_id"></div>
          <div><label>过期时间（可空，ISO）</label><input id="dc-exp" placeholder="2026-12-31T23:59:59+08:00"></div>
        </div>
        <label>理由（必填）</label><input id="dc-reason" placeholder="为什么这样做决定">
        <button onclick="submitDecision(${taskId},${sid})">提交决定</button>
      </div>
      <div class="card"><h3>决定历史（撤销只追加记录，不删历史）</h3>
        ${(d.decisions || []).map(x => `
          <p>#${x.id} <span class="badge${x.revoked ? "" : " info"}">${esc(x.decision)}${x.revoked ? "（已撤销）" : ""}</span>
          <span class="kv">${esc(x.reason)} ${x.scope_rule_id ? "｜作用域:" + esc(x.scope_rule_id) : ""}｜${esc(x.created_at)}</span>
          ${x.revoked ? "" : `<button class="link" onclick="revokeDecision(${taskId},${sid},${x.id})">撤销</button>`}</p>
        `).join("") || `<p class="muted">暂无决定</p>`}
      </div>`;
    document.getElementById("rv").innerHTML = html;
  } catch (e) { setFlash(e.message); }
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

async function viewSubmit() {
  document.getElementById("app").innerHTML = `<div id="flash"></div><div id="sub"><p class="muted">加载中…</p></div>`;
  try {
    const me = await api("/api/me", { sub: true });
    state.me = me;
    const fields = (me.blueprint && me.blueprint.fields) || [];
    const slots = (me.blueprint && me.blueprint.slots) || [];
    const receipt = await api("/api/me/receipt", { sub: true });
    const ro = READONLY_STATUSES.includes(me.task.status);
    let html = `
      <div class="card"><h3>P04 提交与补正</h3>
        <p class="kv">任务：${esc(me.task.name)} ｜ 身份：${esc(me.subject.name)}
          ｜ 状态：${esc(TASK_STATUS_LABEL[me.task.status] || me.task.status)}
          ｜ 首次截止：${esc(me.task.first_deadline || "未设置")}
          ｜ 补正截止：${esc(me.task.correction_deadline || "未设置")}</p>
        ${receipt.formal ? `<p><span class="badge ok">已正式提交 v${receipt.revision}</span>
          <span class="kv">回执 ${esc(receipt.receipt)} ｜ ${esc(receipt.formal_submitted_at)}</span></p>`
          : `<p><span class="badge warn">尚未正式提交</span></p>`}
        ${ro ? `<p><span class="badge warn">任务已${esc(TASK_STATUS_LABEL[me.task.status] || me.task.status)}</span>
             <span class="kv">只读状态：不能保存草稿、上传或正式提交；已提交内容与回执仍可查看、可下载。</span></p>` : ""}
      </div>
      <div class="card"><h3>登记字段</h3>
        ${fields.map(f => `<label>${esc(f.label)}${f.required ? " *" : ""}</label>
          <input data-field="${esc(f.id)}" placeholder="${esc(f.id)}">`).join("") || '<p class="muted">无字段</p>'}
      </div>
      <div class="card"><h3>材料槽位</h3>
        ${slots.map(s => `<div style="margin-bottom:10px">
          <label>${esc(s.label)}（${esc((s.formats || []).join("/"))}，最多 ${s.max_count} 个）${s.required_condition ? `<span class="muted">｜条件：${esc(s.required_condition)}</span>` : ""}</label>
          <input type="file" id="file-${esc(s.id)}">
          <button class="ghost" id="upload-${esc(s.id)}" onclick="uploadSlot('${esc(s.id)}')"${ro ? " disabled" : ""}>上传到该槽位</button>
          <div id="slot-cond-${esc(s.id)}"></div>
          <div id="slot-files-${esc(s.id)}"></div>
        </div>`).join("") || '<p class="muted">无材料槽位</p>'}
      </div>
      <div class="card">
        <div class="row">
          <button class="ghost" onclick="saveDraft()"${ro ? " disabled" : ""}>保存草稿</button>
          <button onclick="doSubmit()"${ro ? " disabled" : ""}>正式提交并检查</button>
        </div>
        <p class="muted">草稿与正式提交是不同操作；正式提交后展示稳定回执与服务端时间。</p>
        <div id="receipt-out" style="margin-top:10px"></div>
      </div>
      <div class="card"><h3>我的检查结果</h3><div id="my-results"><p class="muted">—</p></div></div>`;
    document.getElementById("sub").innerHTML = html;
    document.querySelectorAll("[data-field]").forEach(el =>
      el.addEventListener("input", () => refreshSlotConditions(slots)));
    refreshSlotConditions(slots);
    loadMyResults();
  } catch (e) {
    document.getElementById("sub").innerHTML =
      `<div class="flash err">${esc(e.message)}（请重新用凭证登录）</div>`;
  }
}
async function uploadSlot(slot) {
  await guard(async () => {
    const input = document.getElementById("file-" + slot);
    if (!input.files.length) throw new Error("请先选择文件");
    const fd = new FormData();
    fd.append("slot", slot);
    fd.append("file", input.files[0]);
    const r = await fetch("/api/me/files", {
      method: "POST", headers: { Authorization: "Bearer " + subToken() }, body: fd });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || ("HTTP " + r.status));
    (state.files[slot] = state.files[slot] || []).push(data.file_id);
    document.getElementById("slot-files-" + slot).innerHTML =
      `<p class="kv">已上传：${state.files[slot].map(esc).join("、")}</p>`;
  });
}
async function saveDraft() {
  await guard(async () => {
    const fields = {};
    document.querySelectorAll("[data-field]").forEach(el => { fields[el.dataset.field] = el.value; });
    const r = await api("/api/me/draft", { method: "POST", sub: true,
      json: { fields, expected_version: state.draftVersion } });
    state.draftVersion = r.draft_version;
    setFlash(`草稿已保存（版本 ${r.draft_version}）`, "ok");
  });
}
async function doSubmit() {
  await guard(async () => {
    const fields = {};
    document.querySelectorAll("[data-field]").forEach(el => { fields[el.dataset.field] = el.value; });
    const key = "web-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    const r = await api("/api/me/submit", { method: "POST", sub: true,
      json: { fields, slot_file_ids: state.files, idempotency_key: key } });
    document.getElementById("receipt-out").innerHTML = `
      <div class="flash ok">正式提交成功：回执 ${esc(r.receipt)} ｜ 版本 v${r.revision} ｜ 服务端时间 ${esc(r.formal_submitted_at)}</div>`;
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

/* ---------------------------------------------------------------- P05 交付预览 */
async function viewDelivery(taskId) {
  document.getElementById("app").innerHTML = `<div id="flash"></div>
    <div class="card"><h3>P05 交付预览（任务 #${taskId}）</h3>
      <div class="row">
        <div><label>快照类型</label><select id="snap-kind">
          <option value="formal">正式（仅已验收）</option>
          <option value="preview">整理预览（全部列出）</option></select></div>
      </div>
      <button onclick="createSnapshot(${taskId})">固定快照</button>
      <p class="muted">快照固定后，之后的新提交不会改变原包。</p>
    </div>
    <div id="snap-view"></div>`;
}
async function createSnapshot(taskId) {
  await guard(async () => {
    const kind = document.getElementById("snap-kind").value;
    const r = await api(`/api/tasks/${taskId}/snapshots`,
                        { method: "POST", form: { kind } });
    const m = JSON.parse(r.manifest);
    let html = `<div class="card"><h3>快照 #${r.snapshot_id}（${esc(m.kind)}）</h3>
      <p class="kv">主体 ${m.totals.subjects} ｜ 纳入 ${m.totals.included} ｜ 排除 ${m.totals.excluded}
        ｜ 蓝图版本 #${m.blueprint_version_id}</p>
      <table><tr><th>主体</th><th>版本</th><th>纳入</th><th>排除原因</th><th>材料</th></tr>
      ${m.entries.map(e => `<tr><td>${esc(e.name)}</td><td>${e.revision ?? "-"}</td>
        <td>${e.included ? "是" : "否"}</td><td>${esc(e.excluded_reason || "-")}</td>
        <td>${(e.files || []).length}</td></tr>`).join("")}</table>
      <div style="margin-top:10px">
        <button onclick="runExport(${r.snapshot_id})">生成 CSV + ZIP</button>
        <span id="dl"></span>
      </div></div>`;
    document.getElementById("snap-view").innerHTML = html;
  });
}
async function runExport(snapId) {
  await guard(async () => {
    const r = await api(`/api/snapshots/${snapId}/export`, { method: "POST" });
    state.lastJob = r;
    document.getElementById("dl").innerHTML = `
      <button class="ghost" onclick="downloadFile('/api/exports/${r.job_id}/csv','summary_${r.job_id}.csv')">下载 CSV</button>
      <button class="ghost" onclick="downloadFile('/api/exports/${r.job_id}/zip','materials_${r.job_id}.zip')">下载 ZIP</button>`;
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
