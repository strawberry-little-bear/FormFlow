"use strict";
/* 收齐啦 FormFlow 前端（P01–P05）。纯静态 SPA，直接调用 /api。 */
const ORG_KEY = "ff_org_token", SUB_KEY = "ff_sub_token", PRESENTATION_KEY = "ff_tasks_presentation", DEMO_ENTRY_KEY = "ff_demo_entry";
const state = { taskId: null, chat: [], bpId: null, draft: null, requirement: "", answeredDone: false, files: {}, filesMeta: {}, draftVersion: null, me: null, lastJob: null, roster: {}, rosterEntries: [], rosterFilter: "all", designEpoch: 0, agentBusy: false, agentRequest: null, agentRequestPollTimer: 0, agentResumeStarted: false, agentRequestDisplayedId: null, draftStatus: "draft", draftVersionId: null, designTab: "preview", tasks: [], llmConfigured: null, agentRuntime: null, mcpSnapshot: null, mcpSnapshotLoading: false, mcpSnapshotRunning: false, mcpReplayIndex: null, mcpReplayTimer: 0, demoTaskId: null, designBlocking: [], designAdvisories: [], designVersions: [], designHistory: [], viewingVersion: null, viewingPublished: null, viewingImpact: null, wbRows: [], wbFilter: "all", reviewRule: null, reviewFilter: "all", reviewTraceFilter: "all", presentationMode: false, presentationStartAligned: false };

const orgToken = () => localStorage.getItem(ORG_KEY) || "";
const subToken = () => localStorage.getItem(SUB_KEY) || "";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function fmtTime(s, timeZone = "Asia/Shanghai") {
  if (!s) return "未设置";
  const raw = String(s);
  const d = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : raw + "Z");
  if (isNaN(d)) return raw;
  const options = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  try {
    return new Intl.DateTimeFormat("sv-SE", { ...options, timeZone }).format(d) + " " + timeZone;
  } catch (error) {
    if (error?.name !== "RangeError") throw error;
    return new Intl.DateTimeFormat("sv-SE", { ...options, timeZone: "UTC" }).format(d) + " UTC";
  }
}
/* 时区已在页面上单独标注时，日期就不再重复带一遍时区后缀 */
function fmtTimeShort(s, timeZone = "Asia/Shanghai") {
  const full = fmtTime(s, timeZone);
  return full.endsWith(" " + timeZone) ? full.slice(0, -(timeZone.length + 1)) : full;
}
function designReadinessHtml(bp, draft, blocking = [], advisories = [], viewing = null) {
  const scope = bp?.task_scope || {}, tp = bp?.time_policy || {};
  const fields = bp?.fields || [], slots = bp?.slots || [], rules = bp?.rules || [];
  const deterministic = rules.filter(r => r.executor === "deterministic").length;
  const semantic = rules.filter(r => ["semantic", "cross_material"].includes(r.executor)).length;
  const human = rules.filter(r => r.executor === "human_only").length;
  const mode = scope.mode === "open" ? "开放报名" : "固定名册";
  const subject = scope.subject_kind === "team" ? "团队提交" : "个人提交";
  const delivery = bp?.delivery || {}, governance = bp?.governance || {};
  const purpose = governance.purpose || governance.use || "";
  const retention = governance.retention || governance.retention_policy || "";
  const model = governance.model_processing || governance.ai_processing || "";
  const disclosureGaps = [
    !delivery.group_by && "确认交付分组与命名",
    !purpose && "补充收集用途",
    semantic > 0 && !model && "说明语义规则的模型处理范围",
    !retention && "补充留存与删除安排",
  ].filter(Boolean);
  const readinessAdvisories = [...new Set([...advisories, ...disclosureGaps])];
  const status = blocking.length ? "待处理" : readinessAdvisories.length ? "可发布 · 有提醒" : "可发布";
  const statusTone = blocking.length ? "warn" : readinessAdvisories.length ? "info" : "ok";
  const summary = (draft?.publish_summary || []).filter(Boolean).slice(0, 4);
  const item = (label, value, note = "") => `<div class="readiness-item"><span>${esc(label)}</span><b>${esc(value)}</b>${note ? `<small>${esc(note)}</small>` : ""}</div>`;
  const boundary = (label, value, fallback) => `<p class="readiness-boundary"><span>${esc(label)}</span><b class="${value ? "" : "readiness-missing"}">${esc(value || fallback)}</b></p>`;
  const modelFallback = semantic ? `未填写模型处理说明（${semantic} 条语义审核规则）` : "本版本没有语义审核规则，不会调用语义模型";
  const deliverySummary = delivery.group_by
    ? `按${delivery.group_by}整理，命名规则 ${delivery.naming || "由系统生成"}。`
    : "";
  return `<section class="design-readiness ${viewing ? "readonly" : ""}" aria-label="发布前核对">
    <div class="readiness-head"><div><div class="eyebrow">PUBLISH READINESS</div><h2>发布前核对</h2><p>把提交者要做的事、系统会检查的范围和你要确认的边界放在一张清单里。</p></div><span class="badge ${statusTone}">${esc(status)}</span></div>
    <div class="readiness-grid">
      <div class="readiness-group"><span class="readiness-label">谁来交</span>${item("对象", scope.name || "这项收集", `${mode} · ${subject}`)}${item("收集说明", scope.description || "按下方字段和材料要求提交", "提交者只会看到已发布版本")}</div>
      <div class="readiness-group"><span class="readiness-label">要交什么</span>${item("登记字段", `${fields.length} 项`, fields.filter(f => f.required).length ? `${fields.filter(f => f.required).length} 项必填` : "没有必填字段")}${item("材料槽位", `${slots.length} 个`, slots.length ? slots.map(s => s.label).slice(0, 2).join("、") : "暂未设置材料")}</div>
      <div class="readiness-group"><span class="readiness-label">什么时候交</span>${item("首次截止", fmtTimeShort(tp.first_deadline, tp.timezone), tp.timezone || "Asia/Shanghai")}${item("补正截止", fmtTimeShort(tp.correction_deadline, tp.timezone), "仅已正式提交者可用")}</div>
      <div class="readiness-group"><span class="readiness-label">怎么核对</span>${item("规则分工", `${deterministic} 程序 · ${semantic} 语义 · ${human} 人工`, "不确定或失败会停在待处理")}${item("最终验收", bp.manual_acceptance ? "组织者人工确认" : "按规则处理", bp.eligibility_required ? "另需单独核对资格" : "未启用独立资格")}</div>
    </div>
    <div class="readiness-foot"><div><span class="readiness-label">交付与数据边界</span>${boundary("交付安排", deliverySummary, "未设置分组与命名；发布后仍可固定快照并导出清单。")}${boundary("收集用途", purpose, "未填写用途")}${boundary("模型处理", model, modelFallback)}${boundary("留存与删除", retention, "未填写留存与删除安排")}</div>${summary.length ? `<div class="readiness-summary"><span class="readiness-label">这次整理摘要</span><ul>${summary.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}</div>
    ${blocking.length ? `<div class="readiness-alert warn"><b>发布前要处理 ${blocking.length} 项</b><span>${esc(blocking[0])}${blocking.length > 1 ? `，另有 ${blocking.length - 1} 项` : ""}</span></div>` : readinessAdvisories.length ? `<div class="readiness-alert info"><b>发布前建议看一眼</b><span>${esc(readinessAdvisories[0])}${readinessAdvisories.length > 1 ? `，另有 ${readinessAdvisories.length - 1} 项提醒` : ""}</span></div>` : ""}
  </section>`;
}
function publishGovernanceHtml(bp) {
  const governance = bp?.governance || {}, delivery = bp?.delivery || {};
  const semanticRules = (bp?.rules || []).filter(rule => ["semantic", "cross_material"].includes(rule.executor)).length;
  const item = (label, value, fallback) => `<div class="publish-governance-item"><b>${esc(label)}</b><p class="${value ? "" : "publish-disclosure-missing"}">${esc(value || fallback)}</p></div>`;
  const modelFallback = semanticRules
    ? `未填写。此蓝图有 ${semanticRules} 条语义审核规则；请说明送入模型的内容和部署使用的模型服务。`
    : "当前版本没有语义审核规则，材料核对不会调用语义模型。";
  const deliveryText = delivery.group_by
    ? `按${delivery.group_by}整理；命名规则：${delivery.naming || "系统生成"}。`
    : "发布后可生成固定快照并导出清单；未填写分组与命名方式。";
  return `<section class="publish-group publish-governance" aria-label="数据用途与处理说明">
    <div class="eyebrow">用途与数据处理</div>
    <div class="publish-governance-grid">
      ${item("收集用途", governance.purpose || governance.use, "未填写。请说明收集这些信息的具体用途。")}
      ${item("模型处理", governance.model_processing || governance.ai_processing, modelFallback)}
      ${item("留存与删除", governance.retention || governance.retention_policy, "未填写留存期限或删除安排。请按实际处理方式补充。")}
      <div class="publish-governance-item"><b>交付安排</b><p>${esc(deliveryText)}</p></div>
    </div>
    <p class="field-help">以上为当前蓝图中保存的说明；“未填写”不代表系统替你设定了处理政策。请按部署环境和实际约定核对后再发布。</p>
  </section>`;
}
function navigate(hash) {
  if (location.hash === hash) route(); else location.hash = hash;
}
function readPresentationMode() {
  try { return sessionStorage.getItem(PRESENTATION_KEY) === "1"; } catch (e) { return false; }
}
function showcaseReturnHtml(label = "当前页面") {
  if (!readPresentationMode() || !orgToken()) return "";
  return `<div class="showcase-context-bar" role="status"><div><span class="eyebrow">SHOWCASE PATH</span><strong>正在查看 ${esc(label)}</strong><small>沿证据链继续讲解，或回到展示路线选择下一站。</small></div><a class="ghost sm" href="#/tasks">回到展示路线 ${icon("arrow")}</a></div>`;
}
function syncPresentationDetails(details, active) {
  if (!details) return;
  const summary = details.querySelector?.("summary");
  const compactViewport = document.documentElement?.clientWidth <= 600;
  // The showcase starts with its summary rail visible; full Agent evidence is on demand.
  // Keep an explicitly opened walkthrough open across viewport changes, but close only
  // an auto-expanded state from older sessions when leaving presentation mode.
  if (active && compactViewport && details.dataset?.presentationOpened === "1") {
    details.open = false;
    if (details.dataset) delete details.dataset.presentationOpened;
  } else if (!active && details.dataset?.presentationOpened === "1") {
    details.open = false;
    if (details.dataset) delete details.dataset.presentationOpened;
  }
  summary?.setAttribute?.("aria-expanded", String(!!details.open));
  if (!details.dataset?.presentationBound && details.addEventListener) {
    details.addEventListener("toggle", () => summary?.setAttribute?.("aria-expanded", String(!!details.open)));
    if (details.dataset) details.dataset.presentationBound = "1";
  }
}
function applyPresentationMode(focus = false) {
  const active = !!state.presentationMode && document.body?.dataset?.page === "tasks";
  document.body?.classList?.toggle("presentation-mode", active);
  paintTaskHomeHeading();
  const button = document.getElementById("presentation-toggle");
  syncPresentationDetails(document.querySelector?.(".agent-tour details"), active);
  if (!button) return;
  button.setAttribute("aria-pressed", String(active));
  button.setAttribute("aria-label", active ? "退出展示视图" : "进入展示视图");
  button.title = active ? "退出展示视图（Esc）" : "进入展示视图";
  button.innerHTML = `${icon(active ? "collapse" : "expand")} ${active ? "退出展示视图" : "进入展示视图"}`;
  if (focus) {
    const target = active
      ? document.querySelector?.(".demo-route-focus .button-link")
        || document.querySelector?.(".demo-route-step.current")
        || button
      : button;
    target?.focus?.();
  }
}
function setPresentationMode(on, persist = true) {
  state.presentationMode = !!on;
  if (persist) {
    try {
      if (state.presentationMode) sessionStorage.setItem(PRESENTATION_KEY, "1");
      else sessionStorage.removeItem(PRESENTATION_KEY);
    } catch (e) { /* storage is an enhancement; the page still works in memory */ }
  }
  applyPresentationMode(true);
}
function togglePresentationMode() { setPresentationMode(!state.presentationMode); }
function showTaskListFromPresentation() {
  setPresentationMode(false);
  const target = document.querySelector?.('.task-section');
  if (!target) return;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  requestAnimationFrame?.(() => {
    target.scrollIntoView?.({behavior: reduceMotion ? 'auto' : 'smooth', block: 'start'});
    target.focus?.({preventScroll: true});
  });
}
function openDemoEvidenceFold() {
  const details = document.querySelector?.(".demo-route-evidence-fold");
  if (!details) return;
  details.open = true;
  details.querySelector?.("summary")?.setAttribute?.("aria-expanded", "true");
}
document.addEventListener?.("toggle", event => {
  const details = event.target?.matches?.(".demo-route-evidence-fold") ? event.target : null;
  if (!details) return;
  details.querySelector?.("summary")?.setAttribute?.("aria-expanded", String(details.open));
  const mark = details.querySelector?.(".demo-route-evidence-fold-mark");
  if (mark) mark.firstChild.textContent = details.open ? "已展开" : "展开";
}, true);
function paintTaskHomeHeading() {
  if (document.body?.dataset?.page !== "tasks") return;
  const presentationHeading = !!state.presentationMode;
  const pageEyebrow = presentationHeading ? "FORMFLOW / 评委展示" : "WORKSPACE / 任务管理";
  const pageTitle = presentationHeading ? "从要求到有证据的交付" : "我的任务";
  const pageLead = presentationHeading
    ? "受限 Agent 负责整理与取证，人工确认后才进入可交付快照。"
    : "从需求到交付，把每一次收集安排妥当。";
  const eyebrow = document.getElementById("task-home-eyebrow");
  const title = document.getElementById("task-home-title");
  const lead = document.getElementById("task-home-lead");
  if (eyebrow) eyebrow.textContent = pageEyebrow;
  if (title) title.innerHTML = `${pageTitle}<span class="heading-dot">.</span>`;
  if (lead) lead.textContent = pageLead;
}
function jumpToAgentTour() {
  openDemoEvidenceFold();
  const section = document.querySelector?.(".agent-tour");
  if (!section) return;
  const details = section.querySelector?.("details");
  if (details) {
    details.open = true;
    details.querySelector?.("summary")?.setAttribute?.("aria-expanded", "true");
  }
  section.tabIndex = -1;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  section.scrollIntoView?.({behavior: reduceMotion ? "auto" : "smooth", block: "start"});
  section.focus?.({preventScroll: true});
}
function jumpToMcpSnapshot() {
  openDemoEvidenceFold();
  const target = document.querySelector?.(".mcp-snapshot");
  if (!target) return;
  const details = target.closest?.("details");
  if (details) {
    details.open = true;
    details.querySelector?.("summary")?.setAttribute?.("aria-expanded", "true");
  }
  target.tabIndex = -1;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  target.scrollIntoView?.({behavior: reduceMotion ? "auto" : "smooth", block: "start"});
  target.focus?.({preventScroll: true});
}
function jumpToRunStage(stage) {
  openDemoEvidenceFold();
  const signal = (demoRouteTask(state.tasks)?.demo_route || demoRouteTask(state.tasks)?.route)?.review_signal || null;
  const evidence = document.querySelector?.(".demo-route-signal");
  const stageDetail = document.querySelector?.("#demo-route-stage-detail");
  const tour = document.querySelector?.(".agent-tour");
  const reviewAction = stage === "human" ? evidence?.querySelector?.(".demo-route-signal-action") : null;
  const target = stageDetail || reviewAction || evidence || tour;
  if (!target) return;
  const detailHtml = runStageReplayHtml(stage, signal);
  if (stageDetail && detailHtml) stageDetail.innerHTML = detailHtml;
  document.querySelectorAll?.("[data-run-stage]")?.forEach?.(button => {
    const selected = button.dataset?.runStage === stage;
    button.setAttribute?.("aria-current", selected ? "step" : "false");
    button.closest?.("li")?.classList?.toggle?.("selected", selected);
  });
  const details = evidence?.closest?.("details");
  if (details) {
    details.open = true;
    details.querySelector?.("summary")?.setAttribute?.("aria-expanded", "true");
  }
  target.tabIndex = -1;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  target.scrollIntoView?.({behavior: reduceMotion ? "auto" : "smooth", block: "center"});
  target.focus?.({preventScroll: true});
  if (!signal && stage === "human") tour?.querySelector?.("summary")?.focus?.();
}
function jumpToDesignSection(id) {
  const target = document.getElementById(id);
  if (!target) return;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  target.scrollIntoView?.({behavior: reduceMotion ? "auto" : "smooth", block: "start"});
}
window.addEventListener("keydown", event => {
  if (event.key === "Escape" && state.presentationMode && document.body?.dataset?.page === "tasks") {
    event.preventDefault();
    setPresentationMode(false);
  }
});
window.addEventListener("resize", () => {
  syncSubmitDockViewport();
  if (state.presentationMode && document.body?.dataset?.page === "tasks") applyPresentationMode();
});
function syncSubmitDockViewport() {
  const viewport = window.visualViewport;
  if (!viewport || !document.documentElement?.style) return;
  const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
  document.documentElement.style.setProperty("--submit-dock-viewport-inset", `${Math.round(inset)}px`);
}
window.visualViewport?.addEventListener("resize", syncSubmitDockViewport);
window.visualViewport?.addEventListener("scroll", syncSubmitDockViewport);
window.addEventListener("online", () => {
  if (state.agentRequest?.status === "checking") return checkAgentRequestNow();
  if (state.me?.subject && subToken() && location.hash.startsWith("#/submit")) return loadMyResults();
});
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
  const fetchOptions = { method: opts.method || "GET", headers, body };
  if (opts.cache) fetchOptions.cache = opts.cache;
  const r = await fetch(path, fetchOptions);
  const text = await r.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { detail: text }; }
  if (!r.ok) {
    const detail = data.detail;
    const error = new Error(Array.isArray(detail) ? detail.map(x => humanizeValidation(x)).join("；")
      : (typeof detail === "string" ? humanizeValidation({ msg: detail }) : detail?.message || "出了点问题，请稍后再试（" + r.status + "）"));
    error.status = r.status;
    error.issues = Array.isArray(detail?.issues) ? detail.issues : [];
    throw error;
  }
  return data;
}

async function openReviewFile(event, url) {
  event?.preventDefault();
  const popup = window.open("", "_blank");
  try {
    const response = await fetch(url, { headers: { Authorization: "Bearer " + orgToken() } });
    if (!response.ok) {
      let detail = "原件暂时打不开，请刷新后再试";
      try {
        const payload = await response.json();
        if (typeof payload.detail === "string") detail = payload.detail;
      } catch (e) { /* keep the plain-language fallback */ }
      throw new Error(detail);
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    if (popup && !popup.closed) {
      popup.location.href = objectUrl;
      popup.addEventListener("pagehide", () => URL.revokeObjectURL(objectUrl), { once: true });
    } else {
      window.location.href = objectUrl;
    }
  } catch (error) {
    if (popup && !popup.closed) popup.close();
    setFlash(error.message || "原件暂时打不开，请刷新后再试");
  }
  return false;
}

/* 把框架层校验报错翻成人话，别让英文原文直接出现在界面上 */
const VALIDATION_HINTS = [
  [/valid integer|parse string as an integer|int_parsing/i, "链接里的编号不太对，请回到上一页重新进入"],
  [/field required|missing/i, "还缺少必要的信息，请补全后再试"],
  [/string_too_long|too long/i, "内容太长了，请精简一些"],
  [/string_too_short|too short/i, "内容太短了，请补充一些"],
  [/valid string|string_type/i, "这里应该填写文字"],
  [/valid list|list_type/i, "这里应该是一组内容"],
  [/valid dict|dict_type/i, "这里的数据格式不对"],
  [/greater than|less than|valid number|float_parsing/i, "数值超出了允许范围"],
];
function humanizeValidation(item) {
  const raw = typeof item === "string" ? item : (item?.msg || "");
  if (!raw) return "这次操作没成功，请稍后再试";
  // 只翻译框架层的参数校验话术；业务侧自己的报错原样保留
  for (const [re, zh] of VALIDATION_HINTS) if (re.test(raw)) return zh;
  return raw;
}

function setFlash(msg, kind = "err") {
  const el = document.getElementById("flash");
  if (!el) return;
  const urgent = kind === "err" || kind === "bad";
  el.setAttribute?.("role", urgent ? "alert" : "status");
  el.setAttribute?.("aria-live", urgent ? "assertive" : "polite");
  el.innerHTML = msg ? `<div class="flash ${kind}">${esc(msg)}</div>` : "";
}
function focusPageHeading() {
  const app = document.getElementById("app");
  if (!app) return;
  const heading = app.querySelector?.("h1,h2,[data-page-title]");
  const target = heading || app;
  if (!target.hasAttribute?.("tabindex")) target.setAttribute?.("tabindex", "-1");
  target.focus?.({preventScroll: true});
}
function openDialog(id, opener = document.activeElement) {
  const dialog = document.getElementById(id);
  if (!dialog) return;
  if (!dialog.dataset.focusWired) {
    dialog.addEventListener("keydown", event => {
      if (event.key !== "Tab") return;
      const focusable = [...(dialog.querySelectorAll?.(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) || [])].filter(node => !node.hidden && node.getAttribute?.("aria-hidden") !== "true");
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus?.({preventScroll: true});
        return;
      }
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus?.({preventScroll: true});
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus?.({preventScroll: true});
      }
    });
    dialog.addEventListener("close", () => {
      const previous = dialog.__formflowOpener;
      dialog.__formflowOpener = null;
      if (previous && previous.isConnected !== false && typeof previous.focus === "function") previous.focus();
    });
    dialog.dataset.focusWired = "true";
  }
  dialog.setAttribute?.("aria-modal", "true");
  dialog.__formflowOpener = opener && opener !== document.body ? opener : null;
  dialog.showModal();
  const first = dialog.querySelector?.("[autofocus], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])");
  (first || dialog).focus?.({preventScroll: true});
}
async function guard(fn, isCurrent = () => true) {
  try { await fn(); } catch (e) { if (isCurrent()) setFlash(e.message || String(e)); }
}
function isSubmitterNetworkFailure(error) {
  return (typeof navigator !== "undefined" && navigator.onLine === false)
    || (!error?.status && /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(error?.message || ""));
}
function submitterNetworkError(error, action) {
  if (!isSubmitterNetworkFailure(error)) return error;
  const messages = {
    load: "网络连接暂时不可用。提交空间没有重新加载；恢复连接后可重试，不需要重新登录。",
    upload: "网络已断开，尚未确认上传成功。已选文件仍保留在本页，恢复联网后可以重试。",
    draft: "网络已断开，服务器草稿尚未确认保存。填写仍在本标签页暂存，恢复联网后可以再次保存。",
    submit: "网络已断开，提交结果尚未确认。填写仍在本标签页暂存；恢复联网后再次提交会复用同一请求编号。",
  };
  return new Error(messages[action] || "网络已断开，请恢复连接后重试。");
}

/* 规则结果徽标与规则卡片：P03 与 P04 共用同一渲染，避免两端说法不一致 */
const RESULT_BADGE = {
  satisfied: '<span class="badge ok">满足</span>',
  issue: '<span class="badge bad">问题</span>',
  unknown: '<span class="badge warn">待确认</span>',
  not_applicable: '<span class="badge">不适用</span>',
  failed: '<span class="badge info">检查未完成</span>',
  manual_pending: '<span class="badge info">人工核对</span>',
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
  return `<div class="card"><h3>材料读取明细</h3>
    <p class="kv">已读 ${run.pages_read ?? 0} 页${gap ? ` · ${gap} 页未能读取` : " · 页面覆盖完整"}
      ｜ <span class="badge${gap ? " warn" : " ok"}">${cov.complete === false ? "覆盖不完整" : "覆盖完整"}</span></p>
    <table><tr><th>文件</th><th>读取方式</th><th>总页</th><th>已读</th><th>未读</th><th>失败</th></tr>
    ${(cov.files || []).map(f => `<tr><td>${esc(f.name || f.file_id)}</td>
      <td>${esc(METHOD_LABEL[f.method] || f.method || "-")}</td>
      <td>${f.total ?? 0}</td><td>${f.text ?? 0}</td><td>${f.unread ?? 0}</td><td>${f.failed ?? 0}</td></tr>`).join("")}
    </table>
    ${gap ? `<p class="kv" style="margin-top:8px">未读页不等于材料缺失；相关结论会停在待确认，补充清晰材料或转人工核对即可。</p>` : ""}
  </div>`;
};
const agentRunCard = (run, rules, toolTrace = [], taskId = null, subjectId = null) => {
  if (!run) return "";
  const counts = {deterministic: 0, semantic: 0, cross_material: 0, human_only: 0};
  (rules || []).forEach(r => {
    const executor = r.requirement?.executor;
    if (Object.hasOwn(counts, executor)) counts[executor]++;
  });
  const files = run.coverage?.files || [];
  const methods = [...new Set(files.map(f => METHOD_LABEL[f.method] || f.method).filter(Boolean))];
  const status = ({queued: "排队中", running: "检查中", retry_wait: "等待重试", success: "检查完成", failed: "运行失败", superseded: "已被新运行取代"})[run.status] || run.status;
  const runState = run.status === "success" ? "ok" : ["failed", "retry_wait"].includes(run.status) ? "warn" : "info";
  const durationMs = Number(run.duration_ms);
  const duration = Number.isFinite(durationMs) && durationMs > 0
    ? durationMs < 1000 ? `${durationMs} 毫秒` : `${(durationMs / 1000).toFixed(1)} 秒`
    : ["queued", "running", "retry_wait"].includes(run.status) ? "进行中" : "未记录";
  const retry = run.retry || {};
  const attempt = Number(retry.attempt) > 1 ? `第 ${retry.attempt} 次运行` : "首次运行";
  const origin = retry.retried_from ? `${attempt} · 由 #${retry.retried_from} 重试` : attempt;
  const budget = run.budget || {};
  const pageBudget = budget.pages || {};
  const semanticBudget = budget.semantic_calls || {};
  const pageLimit = Number.isFinite(Number(pageBudget.limit)) && Number(pageBudget.limit) > 0
    ? Number(pageBudget.limit) : null;
  const semanticLimit = Number.isFinite(Number(semanticBudget.limit)) && Number(semanticBudget.limit) > 0
    ? Number(semanticBudget.limit) : Math.max(1, counts.semantic + counts.cross_material);
  const pageUsage = `${Number(pageBudget.used ?? run.pages_read ?? 0)}${pageLimit ? ` / ${pageLimit}` : ""} 页`;
  const semanticUsage = `${Number(semanticBudget.used ?? run.llm_calls_used ?? 0)} / ${semanticLimit} 次`;
  // Keep this summary aligned with the effective review state after a human
  // decision. The stored run summary only contains the machine's first pass.
  const resultSummary = (rules || []).length
    ? (rules || []).reduce((out, rule) => {
      const key = rule.decision?.resolves
        ? "satisfied"
        : rule.decision?.decision === "confirm_issue"
          ? "issue"
          : rule.result || "unknown";
      out[key] = (out[key] || 0) + 1;
      return out;
    }, {})
    : (Object.keys(run.result_summary || {}).length ? run.result_summary : {});
  const resultLabels = {satisfied: "已满足", issue: "需处理", unknown: "待人工", failed: "未完成", manual_pending: "人工项", not_applicable: "不适用"};
  const resultHtml = Object.entries(resultLabels)
    .filter(([key]) => Number(resultSummary[key]) > 0)
    .map(([key, label]) => `<span class="agent-result-chip ${key === "satisfied" || key === "not_applicable" ? "ok" : key === "issue" ? "warn" : "info"}">${label} <b>${Number(resultSummary[key])}</b></span>`).join("")
    || `<span class="agent-result-empty">${["queued", "running", "retry_wait"].includes(run.status) ? "结果将在运行完成后出现" : "暂无逐规则结果"}</span>`;
  const runMeta = `<div class="agent-run-meta" role="group" aria-label="检查运行摘要">
    <div><span>运行编号</span><b>#${esc(run.id ?? "—")}</b></div>
    <div><span>正式版本</span><b>${run.revision_version ? `v${esc(run.revision_version)}` : "未记录"}</b></div>
    <div><span>耗时</span><b>${esc(duration)}</b></div>
    <div><span>运行关系</span><b>${esc(origin)}</b></div>
    <div class="agent-run-result"><span>结果摘要</span><div>${resultHtml}</div></div>
  </div>`;
  const failure = run.failure || null;
  const failureHtml = run.status === "failed" && failure
    ? `<div class="agent-run-failure" role="alert"><b>${esc(failure.title || "这次检查没有完成")}</b><span>${esc(failure.detail || "系统没有形成可靠的完整结论。")}</span><strong>下一步：${esc(failure.action || "组织者可以重试或人工核对。")}</strong></div>`
    : "";
  const numericTaskId = Number(taskId), numericSubjectId = Number(subjectId);
  const failureActions = run.status === "failed" && Number.isInteger(numericTaskId) && Number.isInteger(numericSubjectId)
    ? `<div class="agent-run-failure-actions"><button class="ghost sm" type="button" onclick="retryCheck(${numericTaskId},${numericSubjectId},'review')">重新排队检查 ${icon("arrow")}</button><a class="ghost sm" href="#/review/${numericTaskId}/${numericSubjectId}">进入人工复核 ${icon("arrow")}</a></div>`
    : "";
  const stages = [
    {label: "读取材料", detail: files.length ? `${files.length} 份材料${methods.length ? ` · ${methods.join(" / ")}` : ""}` : "尚无可读取材料", count: files.length ? `${run.pages_read ?? 0} 页` : "—", tone: files.length ? "ok" : "neutral"},
    {label: "程序核验", detail: counts.deterministic ? "格式、必填项等确定性检查" : "本版本没有程序规则", count: `${counts.deterministic} 项`, tone: "tool"},
    {label: "语义审核", detail: "只按已确认规则找原文依据", count: `${counts.semantic + counts.cross_material} 项规则 · 预算占用 ${run.llm_calls_used ?? 0}`, tone: "agent"},
    {label: "人工接手", detail: counts.human_only ? "不确定或需判断的事项留给组织者" : "资格与最终验收仍由组织者决定", count: `${counts.human_only} 项规则`, tone: "human"},
  ];
  const ruleById = new Map((rules || []).map(r => [r.rule_id, r]));
  const traceStatus = {satisfied: "找到符合依据", issue: "发现需处理", unknown: "待人工确认", failed: "本次检查未完成", not_applicable: "当前不适用"};
  const traceItems = (toolTrace || []).slice(-64);
  const traceFilter = ["all", "deterministic", "semantic", "human"].includes(state.reviewTraceFilter)
    ? state.reviewTraceFilter : "all";
  const traceMatches = item => traceFilter === "all"
    || traceFilter === "deterministic" && item.tool === "review.deterministic_rule"
    || traceFilter === "semantic" && item.tool === "review.semantic_rule"
    || traceFilter === "human" && ["unknown", "failed"].includes(item.status);
  const visibleTrace = traceItems.filter(traceMatches);
  const traceFilters = [
    ["all", "全部", traceItems.length],
    ["deterministic", "程序规则", traceItems.filter(item => item.tool === "review.deterministic_rule").length],
    ["semantic", "语义审核", traceItems.filter(item => item.tool === "review.semantic_rule").length],
    ["human", "需人工", traceItems.filter(item => ["unknown", "failed"].includes(item.status)).length],
  ];
  const traceAction = Number.isFinite(taskId) && Number.isFinite(subjectId)
    ? (filter => `setReviewTraceFilter('${filter}',${taskId},${subjectId})`) : null;
  const traceFilterHtml = traceFilters.map(([key, label, count]) =>
    `<button type="button" class="agent-trace-filter ${traceFilter === key ? "active" : ""}" data-trace-filter="${key}" aria-pressed="${traceFilter === key}"${traceAction ? ` onclick="${traceAction(key)}"` : ""}>${label}<span>${count}</span></button>`).join("");
  const traceRows = visibleTrace.map(item => {
    const rule = ruleById.get(item.rule_id);
    const title = rule?.requirement?.statement || item.rule_id || "核对步骤";
    const toolLabel = item.tool === "review.deterministic_rule" ? "程序规则"
      : item.tool === "review.semantic_rule" && item.simulation === true ? "离线演示结果"
      : item.tool === "review.semantic_rule" && item.simulation === false ? "材料理解"
      : item.tool === "review.semantic_rule" ? "模式未记录" : "核对工具";
    const elapsed = item.duration_ms < 10 ? "即时返回"
      : item.duration_ms < 1000 ? `${item.duration_ms} 毫秒` : `${(item.duration_ms / 1000).toFixed(1)} 秒`;
    const label = traceStatus[item.status] || "已记录";
    const tone = ["issue", "failed"].includes(item.status) ? "warn" : item.status === "unknown" ? "info" : "ok";
    const toolIcon = item.tool === "review.deterministic_rule" ? "check" : item.tool === "review.semantic_rule" ? "design" : "review";
    const sequence = Number(item.sequence) > 0 ? `第 ${item.sequence} 步` : "运行步骤";
    const version = item.tool_version ? ` · ${item.tool_version}` : "";
    const correlation = item.correlation_id ? ` · ${item.correlation_id}` : "";
    return `<li class="agent-trace-row"><span class="agent-trace-kind ${tone}">${icon(toolIcon)}<span>${esc(toolLabel)}</span></span><div><b>${esc(title)}</b><span class="agent-trace-meta"><strong>${esc(sequence)}</strong><span>${esc(label)} · 用时 ${esc(elapsed)}${esc(version)}${esc(correlation)}</span></span></div></li>`;
  }).join("");
  const traceSimulation = (toolTrace || []).some(item => item.simulation === true);
  const traceModeUnknown = (toolTrace || []).some(item =>
    item.tool === "review.semantic_rule" && item.simulation !== true && item.simulation !== false);
  const runtimeTools = [
    {name: "review.deterministic_rule", scope: "review:deterministic", desc: "程序规则核验"},
    {name: "review.semantic_rule", scope: "review:semantic", desc: "语义证据核验"},
  ];
  const runtimeHtml = `<details class="agent-runtime-info">
    <summary><span class="eyebrow">Agent 运行时</span><small>skill · harness · 审计边界</small></summary>
    <div class="runtime-grid">
      <div class="runtime-item"><label>Skill</label><b>review_one_submission</b><span>按已发布蓝图逐条核验，不自行决定规则</span></div>
      <div class="runtime-item"><label>授权范围</label><code>review:deterministic</code> <code>review:semantic</code><span>不授予 SQL、文件路径、网络或用户管理权限</span></div>
      <div class="runtime-item"><label>工具白名单</label>${runtimeTools.map(t => `<code>${esc(t.name)}</code>`).join("")}<span>只能调用已注册的核验工具，不能自己选别的</span></div>
      <div class="runtime-item"><label>页数预算</label><b>${esc(pageUsage)}</b><span>只读取当前正式提交；超出范围会停下来转人工</span></div>
      <div class="runtime-item"><label>语义调用预算</label><b>${esc(semanticUsage)}</b><span>预算用完后转人工，不会编造结果</span></div>
      <div class="runtime-item"><label>步数上限</label><b>128 步</b><span>超出会自动停下来交给组织者</span></div>
      <div class="runtime-item"><label>人工接手</label><b>不确定 / 失败 → 人工</b><span>拿不准或出问题时不会停在"通过"，而是交给组织者</span></div>
      <div class="runtime-item"><label>结果上限</label><b>16 KB / 条</b><span>每条工具输出有截断，防止注入超长内容</span></div>
      <div class="runtime-item"><label>审计记录</label><code>rule_result</code><span>每步记录工具名、范围、状态和耗时，不含原始材料</span></div>
    </div>
    <p class="runtime-foot">这个 skill 是单体应用内的受限运行时，不使用外部 MCP Server，不增加网络工具。模型不能自己选工具名、规则 ID、文件路径或授权主体。</p>
  </details>`;
  const traceSummary = traceFilter === "all" ? `${visibleTrace.length} 项` : `${visibleTrace.length}/${traceItems.length} 项`;
  const traceHtml = traceItems.length
    ? `<details class="agent-trace"><summary>本次运行记录（${traceSummary}）</summary><div class="agent-trace-filters" role="group" aria-label="运行记录筛选">${traceFilterHtml}</div>${traceRows ? `<ol>${traceRows}</ol>` : '<p class="agent-trace-empty">当前筛选没有匹配的运行步骤。</p>'}<p>记录绑定当前检查运行和版本；这里只展示工具类别与结果摘要，不包含隐藏推理内容。关联编号用于把同一运行的调用串起来。</p>${traceSimulation ? '<div class="agent-simulation-note">演示模式：语义结果由离线脚本按样例生成，没有调用实时模型；真实任务会按当前配置调用模型。</div>' : ''}${traceModeUnknown ? '<div class="agent-simulation-note">这次历史记录没有保存语义检查模式，无法判断是否使用实时模型。</div>' : ''}</details>`
    : `<p class="agent-trace-empty">这次检查没有逐项工具记录（例如升级前的历史运行）；现有检查结论和证据仍可照常查看。</p>`;
  const runOpen = run.status === "failed" || (run.status === "success" && traceItems.length) ? " open" : "";
  return `<details class="card agent-run-card"${runOpen}>
    <summary><span><span class="eyebrow">检查是怎么完成的</span><b>按规则分工，不让模型包办</b><small class="agent-run-hint">展开查看程序、Agent 与人工的分工</small></span><span class="badge ${runState}">${esc(status)}</span></summary>
    <p class="agent-run-intro">程序先处理能明确判断的规则，需要理解材料时才调用语义审核。每个判断都回到原文证据，资格和最终验收由人来把关。</p>
    ${runMeta}
    ${failureHtml}
    ${failureActions}
    <ol class="agent-run-steps">${stages.map((s, i) => `<li class="${esc(s.tone)}"><span class="agent-step-index">0${i + 1}</span><div><b>${esc(s.label)}</b><span>${esc(s.detail)}</span></div><em>${esc(s.count)}</em></li>`).join("")}</ol>
    <p class="agent-run-foot">${run.budget_exhausted ? "这次模型检查的预算用完了，没完成的项会保留为待处理，不会当成通过。" : "模型不可用或证据不足时会停下来转人工，检查结果不会自行发布、认定资格或完成验收。"}</p>
    ${runtimeHtml}
    ${traceHtml}
    ${run.coverage ? `<div class="agent-run-more">${esc(methods.length ? `材料处理：${methods.join("、")}` : "材料读取记录见下方")}${run.llm_calls_used ? ` · 语义检查预算使用 ${run.llm_calls_used} 次` : " · 本次未使用语义检查预算"}</div>` : ""}
  </details>`;
};
function submitterGuidance(r) {
  if (r.decision) return r.decision.resolves
    ? r.result === "unknown"
      ? "系统当时还不能确认这一项，组织者已经人工核对过了，原始意见和后续处理分开展示。"
      : "组织者已记录处理结果，原始检查意见和人工决定会分开展示。"
    : "组织者确认这项还需要处理，可以按下方建议补充或核对。";
  if (r.result === "issue") return "这项材料还需要核对；只针对这条收集要求，不是在评价你本人。";
  if (r.result === "unknown") return "目前还没能从材料中找到足够清楚、可核对的依据；这不代表缺失，组织者可以帮你确认。";
  if (r.result === "failed") return "这次检查没能完成，材料已经收到；这不代表不合格。你可以稍后再看，组织者也可以重试或人工核对。";
  if (r.result === "manual_pending") return "这一项由组织者来确认，你暂时不用修改材料。";
  if (r.result === "satisfied") return "这一项已经按任务要求核对完成。";
  if (r.result === "not_applicable") return "按你当前填写的信息，这项要求不适用。";
  return "检查状态已更新；如有疑问，可以请组织者一起核对。";
}
function submitterExplanation(r) {
  if (["satisfied", "manual_pending", "not_applicable", "failed"].includes(r.result)) return "";
  if (r.result === "unknown" && r.decision?.resolves) return "原始检查当时缺少足够清楚、可定位的依据；上方是组织者后续人工核对结果。";
  if (r.result === "unknown") return "暂时无法确认是否满足这一项；不会把没读到或证据不足当成缺失。";
  return r.explanation || "";
}
function submitterNextStep(r) {
  if (r.result === "satisfied") return "";
  if (r.decision?.resolves) return "组织者已处理这一项，无需重复提交。";
  const raw = String(r.next_step || "").trim();
  if (r.result === "unknown" && (!raw || /转人工|人工复核|模型结论|无法判断/.test(raw)))
    return "请联系组织者帮你确认；如果方便，也可以补一份更清晰的材料。";
  if (r.result === "failed") return "稍后刷新查看；如果赶截止时间，请联系组织者协助核对。";
  if (r.result === "manual_pending") return "";
  return raw;
}
function submitterSeverity(value) {
  return value === "blocking" ? "验收前需要处理" : value === "advisory" ? "给你提个醒" : severityLabel(value);
}
function submitterRequirementSource(value) {
  const source = String(value || "").replace(/^(?:原始要求|原始输入|任务要求)\s*[：:]\s*/, "").trim();
  return source || "任务说明";
}
function submitterEvidenceMethod(value) {
  return ({llm: "模型核对", program: "程序核对", manual: "人工核对",
    text: "文字提取", ocr: "OCR 识别", coverage: "读取范围记录", parse: "文件读取"})[value] || value || "检查记录";
}
function submitterSummary(value) {
  return ({
    "待补正": "有材料需要补充或更正",
    "待人工": "有几项需要组织者确认",
    "检查未完成": "检查暂时没有完成",
    "检查中": "材料正在核对",
    "排队中": "材料已收到，正在等待核对",
    "规则通过（待人工验收）": "材料检查已完成，等待组织者验收",
    "规则通过": "材料检查已完成",
    "已验收": "本版本已验收",
    "未正式提交": "还没有正式提交",
  })[value] || value || "正在更新进度";
}
function submitterNextStepHtml({formal = false, readOnly = false, issues = [], summary = "", buckets = {}, runStatus = "", revision = null, resultsUnavailable = false} = {}) {
  const pendingJobs = (buckets.pending_jobs || []).length || ["queued", "running", "retry_wait"].includes(runStatus);
  const blocking = (buckets.blocking || []).length;
  const human = (buckets.unknown || []).length + (buckets.human || []).length;
  const incomplete = (buckets.incomplete || []).length;
  let tone = "info", kicker = "现在先做", title = "继续完成这份提交", detail = "填写和上传会先保存在草稿里，正式提交后才会开始核对。", badge = "进行中";
  if (readOnly) {
    tone = "neutral"; kicker = "当前状态"; title = formal ? "查看已提交版本与核对记录" : "这项任务已结束";
    detail = formal ? "页面已只读；回执、版本和组织者给出的核对记录仍可查看。" : "不能再保存或提交，但已有内容仍可查看。";
    badge = "只读";
  } else if (!formal && issues.length) {
    tone = "warn"; kicker = "现在先做"; title = "完成登记并上传材料";
    detail = `还有 ${issues.length} 项需要核对；填写和附件会保留在本页，完成后再点正式提交。`;
    badge = "尚未提交";
  } else if (!formal) {
    tone = "ok"; kicker = "下一步"; title = "核对内容后正式提交";
    detail = "当前填写和材料已具备提交条件；点击“提交材料并开始核对”后才会生成正式版本。";
    badge = "可以提交";
  } else if (resultsUnavailable) {
    tone = "warn"; kicker = "暂时无法更新"; title = "当前核对结果暂时读不到";
    detail = "回执和已提交材料仍保留；恢复联网后会自动重试，也可以点下方按钮重新加载结果。";
    badge = "等待恢复";
  } else if (summary === "已验收") {
    tone = "ok"; kicker = "已完成"; title = "这份提交已经验收";
    detail = "当前正式版本已完成组织者验收；如需查看文件或回执，可在下方展开。"; badge = "已验收";
  } else if (blocking || summary === "待补正") {
    tone = "warn"; kicker = "现在先做"; title = "处理需要更正的事项";
    detail = blocking
      ? `有 ${blocking} 项需要补充或更正；打开下方核对记录可以看到原文位置和建议做法。`
      : "当前检查记录显示有材料需要补充或更正；打开下方核对记录可以看到原文位置和建议做法。";
    badge = "需要更正";
  } else if (human || summary === "待人工") {
    kicker = "等待确认"; title = "组织者核对中，你无需重复提交";
    detail = human
      ? "当前正式版本和回执已保留；页面打开时每 30 秒检查核对进度，完成后会显示下一步。"
      : "当前检查记录需要组织者确认；正式版本和回执已保留，你不需要重复提交。";
    badge = "组织者核对";
  } else if (incomplete || summary === "检查未完成") {
    tone = "warn"; kicker = "检查未完成"; title = "先等检查完成，再决定是否补交";
    detail = "这不代表材料不合格；如果临近截止时间，可以联系组织者协助核对。"; badge = "待更新";
  } else if (pendingJobs || ["排队中", "检查中"].includes(summary)) {
    kicker = "正在处理"; title = "等待材料核对完成";
    detail = `第 ${revision || "当前"} 版已经收到，检查完成后这里会自动更新。`; badge = "核对中";
  } else if (summary === "规则通过（待人工验收）") {
    tone = "ok"; kicker = "最后一步"; title = "等待组织者最终验收";
    detail = "页面打开时每 30 秒检查核对进度；组织者确认验收后这里会更新，你无需重复提交。"; badge = "待验收";
  } else if (summary === "规则通过") {
    tone = "ok"; kicker = "已完成"; title = "材料检查已完成";
    detail = "当前版本没有需要你处理的事项；如任务需要人工验收，组织者会继续确认。"; badge = "检查完成";
  } else if (formal) {
    kicker = "正在读取"; title = "正在读取这份提交的核对结果";
    detail = "回执已经生成，正在读取当前版本的检查状态；已提交内容不会丢失。"; badge = "读取中";
  }
  return `<section class="submit-next-step ${tone}" aria-live="polite"><div><span class="eyebrow">${esc(kicker)}</span><h2>${esc(title)}</h2><p>${esc(detail)}</p></div>${formal ? `<button class="ghost sm" type="button" onclick="jumpToSubmitResults()">查看核对记录 ${icon("arrow")}</button>` : ""}<span class="badge ${tone === "warn" ? "warn" : tone === "ok" ? "ok" : ""}">${esc(badge)}</span></section>`;
}
function jumpToSubmitResults() {
  const target = document.getElementById("my-results-card");
  if (!target) return;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  target.scrollIntoView?.({behavior: reduceMotion ? "auto" : "smooth", block: "start"});
  target.focus?.({preventScroll: true});
}
const ruleCard = (r) => {
  const explanation = submitterExplanation(r), nextStep = submitterNextStep(r);
  const evidence = (r.evidence || []).map(e =>
    `<div class="evidence">[${esc(e.locator || "未标位置")} · ${esc(submitterEvidenceMethod(e.method))}] ${esc(e.quote || "")}</div>`).join("");
  const noEvidence = ["manual_pending", "failed"].includes(r.result) ? ""
    : `<p class="muted">这条结果暂时没有可展示的原文位置。</p>`;
  return `<div class="card result-rule-card">
    <h3>${esc(r.requirement?.statement || r.rule_id)} ${resultBadge(r.result)}
      <span class="badge">${esc(submitterSeverity(r.severity))}</span></h3>
    <p class="result-human-note">${esc(submitterGuidance(r))}</p>
    ${r.decision ? `<div class="notice-warn"><b>${esc(DECISION_LABEL[r.decision.decision] || r.decision.decision)}</b><p>${esc(r.decision.reason)}</p><span>人工决定与原始检查结论分开保留。</span></div>` : ""}
    ${explanation ? `<p>${esc(explanation)}</p>` : ""}
    ${nextStep ? `<div class="result-next-step"><b>${r.decision ? "组织者记录的后续建议" : "可以这样处理"}</b><p>${esc(nextStep)}</p></div>` : ""}
    ${r.requirement && r.requirement.statement ?
      `<p class="kv">对应要求：${esc(submitterRequirementSource(r.requirement.requirement_source))}</p>` : ""}
    ${evidence || noEvidence}
  </div>`;
};

/* ---------------------------------------------------------------- 路由 */
function route() {
  window.scrollTo?.({top: 0, left: 0, behavior: "instant"});
  cacheSubmissionDraft();
  cacheReviewDraft();
  cacheDesignInputs();
  state.routeEpoch = (state.routeEpoch || 0) + 1;
  clearTimeout(state.agentRequestPollTimer);
  state.agentRequestPollTimer = 0;
  state.agentResumeStarted = false;
  state.agentRequest = null;
  state.reviewConflict = false;
  state.reviewDraft = null;
  state.designEpoch++;
  state.agentBusy = false;
  clearTimeout(_wbTimer);
  clearTimeout(_resultsTimer);
  state.reviewData = null; state.reviewRule = null; state.reviewFilter = "all"; state.reviewTraceFilter = "all"; state.reviewContext = null;
  document.querySelectorAll("dialog[open]").forEach(d => d.close());
  const h = (location.hash || "#/login").replace(/^#/, "");
  const [path, queryString = ""] = h.split("?");
  const parts = path.split("/").filter(Boolean);
  const query = new URLSearchParams(queryString);
  document.body.classList.toggle("auth-page", parts[0] === "login");
  document.body.dataset.page = parts[0] || "login";
  state.presentationMode = parts[0] === "tasks" && readPresentationMode();
  state.presentationStartAligned = false;
  document.body.classList.toggle("presentation-mode", state.presentationMode);
  renderNav();
  if (parts[0] !== "login" && parts[0] !== "submit" && !orgToken()) {
    location.hash = "#/login"; return;
  }
  const app = document.getElementById("app");
  const render = result => { setTimeout(focusPageHeading, 0); return result; };
  if (parts[0] === "login") return render(viewLogin(
    query.get("role") === "sub" ? "sub" : "org",
    query.get("notice") === "credential-expired"
      ? "当前提交凭证已失效，请联系组织者重新发放，再用新凭证登录。"
      : ""
  ));
  if (parts[0] === "tasks") return render(viewTasks());
  if (parts[0] === "design") return render(viewDesign(+parts[1]));
  if (parts[0] === "workbench") return render(viewWorkbench(+parts[1]));
  if (parts[0] === "review") return render(viewReview(+parts[1], +parts[2]));
  if (parts[0] === "submit") return render(viewSubmit());
  if (parts[0] === "delivery") return render(viewDelivery(+parts[1]));
  if (parts[0] === "roster") return render(viewRoster(+parts[1]));
  return render(viewLogin());
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
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  review: '<path d="M4 4h11l5 5v11H4z"/><path d="M15 4v5h5"/><path d="m8.5 14.5 2 2 4-4"/>',
  expand: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
  collapse: '<path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6"/>',
  sparkle: '<path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7Z"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7Z"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>'
};
function icon(name) { return `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.tasks}</svg>`; }
function renderNav() {
  const nav = document.getElementById("nav");
  const org = !!orgToken(), sub = !!subToken();
  const parts = location.hash.replace(/^#\//, "").split("/");
  const submitting = parts[0] === "submit";
  document.getElementById("role-label").textContent = submitting && sub ? "提交者" : org ? "组织者" : sub ? "提交者" : "访客";
  document.getElementById("btn-logout").textContent = org && sub ? "退出所有身份" : "退出";
  document.getElementById("btn-logout").hidden = !org && !sub;
  let items = org && !submitting ? [["#/tasks", "我的任务", "tasks"]] : [];
  const taskId = /^\d+$/.test(parts[1] || "") ? Number(parts[1]) : null;
  if (org && !submitting && taskId) items.push(
    [`#/design/${taskId}`, "需求设计", "design"], [`#/roster/${taskId}`, "名单与凭证", "roster"],
    [`#/workbench/${taskId}`, "收集工作台", "workbench"], [`#/delivery/${taskId}`, "交付与归档", "delivery"]);
  if (sub) items.push(["#/submit", submitting ? "我的提交" : "切换到提交者", "roster"]);
  else if (org && !submitting) items.push(["#/login?role=sub", "提交者入口", "roster"]);
  if (submitting && org) items.push(["#/tasks", "切换到组织者", "tasks"]);
  const activeHash = parts[0] === "review" ? `#/workbench/${taskId}` : location.hash;
  nav.innerHTML = '<span class="nav-caption">工作空间</span>' + items.map(([href, label, ic], i) =>
    `${i === 1 && taskId ? '<span class="nav-caption task-caption">当前任务</span>' : ''}<a href="${href}" ${activeHash === href ? 'aria-current="page"' : ''} class="${activeHash === href ? "active" : ""}">${icon(ic)}${label}</a>`).join("");
  const activeLink = nav.querySelector("a.active");
  if (activeLink && nav.scrollWidth > nav.clientWidth) activeLink.scrollIntoView({block: "nearest", inline: "nearest"});
}

function logout() {
  cacheDesignInputs();
  try {
    sessionStorage.removeItem(REVIEW_DRAFT_KEY);
    sessionStorage.removeItem(PRESENTATION_KEY);
    sessionStorage.removeItem(DEMO_ENTRY_KEY);
  } catch (e) {}
  localStorage.removeItem(ORG_KEY); localStorage.removeItem(SUB_KEY);
  state.chat = []; state.draft = null; state.reviewDrafts = {}; state.reviewContext = null; state.reminder = null;
  navigate("#/login");
}

/* ---------------------------------------------------------------- 登录 */
function viewLogin(initialTab = "org", notice = "") {
  const submitterTab = initialTab === "sub";
  const organizerReturn = localStorage.getItem(ORG_KEY)
    ? '<p class="kv" style="margin-top:10px"><a href="#/tasks">返回组织者任务列表</a></p>'
    : "";
  document.getElementById("app").innerHTML = `
  <div class="login-wrap">
    <div class="login-hero">
      <div class="logo"><span class="mark">齐</span><span style="font-size:17px">收齐啦 FormFlow</span></div>
      <h1>材料收集，<br>终于有条不紊。</h1>
      <p class="tag">从一句收集要求，到最后一份材料。<br>把反复催交和核对，留给更清晰的工作流。</p>
      <div class="hero-flow" role="group" aria-label="FormFlow Agent 工作边界">
        <div class="hero-flow-head"><span class="eyebrow">CONTROLLED AGENT FLOW</span><span>人始终在回路中</span></div>
        <div class="hero-flow-steps">
          <span><b>01</b><strong>原始要求</strong><em>你说清楚要收什么</em></span>
          <i aria-hidden="true">→</i>
          <span><b>02</b><strong>受限 Skill</strong><em>按规则调用白名单工具</em></span>
          <i aria-hidden="true">→</i>
          <span><b>03</b><strong>原文证据</strong><em>逐条定位，不编造结论</em></span>
          <i aria-hidden="true">→</i>
          <span><b>04</b><strong>人工确认</strong><em>资格、补正、验收由你决定</em></span>
        </div>
        <p class="hero-flow-note">模型负责整理与取证；发布、资格和最终验收不会自动完成。</p>
      </div>
      <div class="feat"><div class="ic">${icon("design")}</div><div><b>智能起草，先确认再发布</b>
        <span>配置模型密钥后，助手可将收集要求整理为字段、材料要求与检查规则；发布前由组织者确认</span></div></div>
      <div class="feat"><div class="ic">${icon("search")}</div><div><b>交上来逐条核对</b>
        <span>每处问题都带原文位置和改法，不把「没读到」说成「确认缺失」</span></div></div>
      <div class="feat"><div class="ic">${icon("delivery")}</div><div><b>按正确版本交付</b>
        <span>正式版本不可篡改，快照固定，历史验收不丢失</span></div></div>
    </div>
    <div class="login-panel">
      <h2>你好，开始吧</h2>
      <p class="tip">组织者用账号登录；提交者用组织者发放的凭证。</p>
      <div class="tabs" role="tablist" aria-label="登录身份">
        <button id="tab-org" class="${submitterTab ? "" : "on"}" role="tab" aria-selected="${submitterTab ? "false" : "true"}" aria-controls="pane-org" tabindex="${submitterTab ? "-1" : "0"}" onkeydown="moveLoginTab(event)" onclick="switchLoginTab('org')">我是组织者</button>
        <button id="tab-sub" class="${submitterTab ? "on" : ""}" role="tab" aria-selected="${submitterTab ? "true" : "false"}" aria-controls="pane-sub" tabindex="${submitterTab ? "0" : "-1"}" onkeydown="moveLoginTab(event)" onclick="switchLoginTab('sub')">我是提交者</button>
      </div>
      <div id="login-err" class="flash err" role="alert" aria-live="assertive" style="display:none"></div>
      <div id="pane-org" role="tabpanel" aria-labelledby="tab-org"${submitterTab ? " hidden" : ""}>
        <div class="demo-hint" id="demo-hint" style="display:none">
          <button class="ghost sm demo-btn" onclick="fillDemoCred()">体验演示环境 →</button>
          <span class="demo-note">演示账号 demo / demo1234，含虚构种子数据</span>
        </div>
        <label for="lg-user">用户名</label><input id="lg-user" placeholder="请输入用户名" autocomplete="username">
        <label for="lg-pass">密码</label><input id="lg-pass" type="password" placeholder="请输入密码"
          autocomplete="current-password" onkeydown="if(event.key==='Enter')doLogin()">
        <div class="row" style="margin-top:12px">
          <button onclick="doLogin()" style="flex:2">登录</button>
          <button class="ghost" onclick="doRegister()">注册并登录</button>
        </div>
        <p class="kv" style="margin-top:10px">第一次使用？直接点「注册并登录」就好，数据只存在你本机。</p>
      </div>
      <div id="pane-sub" role="tabpanel" aria-labelledby="tab-sub"${submitterTab ? "" : " hidden"}>
        <label for="lg-cred">提交凭证</label>
        <textarea id="lg-cred" placeholder="粘贴组织者发放的提交凭证（形如 v9MhIdcn_1_EUt...）"
          oninput="cacheSubmissionDraft()" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();doSubLogin()}"></textarea>
        <button onclick="doSubLogin()" style="width:100%">进入我的提交空间</button>
        <p class="kv" style="margin-top:10px">体验本机演示时，首次初始化显示的提交凭证在启动器终端中。找不到凭证了？联系组织者重新发一份；新凭证发出后，旧凭证会失效。</p>
        ${organizerReturn}
      </div>
    </div>
  </div>`;
  if (notice) loginErr(notice);
  checkDemoUser();
}
function switchLoginTab(which) {
  const org = which === "org";
  const tabOrg = document.getElementById("tab-org"), tabSub = document.getElementById("tab-sub");
  const paneOrg = document.getElementById("pane-org"), paneSub = document.getElementById("pane-sub");
  tabOrg.classList.toggle("on", org); tabSub.classList.toggle("on", !org);
  tabOrg.setAttribute?.("aria-selected", String(org)); tabSub.setAttribute?.("aria-selected", String(!org));
  tabOrg.setAttribute?.("tabindex", org ? "0" : "-1"); tabSub.setAttribute?.("tabindex", org ? "-1" : "0");
  paneOrg.hidden = !org; paneSub.hidden = org;
  paneOrg.style.display = org ? "" : "none"; paneSub.style.display = org ? "none" : "";
  document.getElementById("login-err").style.display = "none";
}
function moveLoginTab(event) {
  if (!event || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [document.getElementById("tab-org"), document.getElementById("tab-sub")].filter(Boolean);
  const current = tabs.indexOf(event.currentTarget);
  if (current < 0) return;
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next].focus?.();
  tabs[next].click?.();
}
function loginErr(msg) {
  const el = document.getElementById("login-err");
  if (el) { el.textContent = msg; el.style.display = ""; }
}
function fillDemoCred() {
  document.getElementById("lg-user").value = "demo";
  document.getElementById("lg-pass").value = "demo1234";
  try { sessionStorage.setItem(DEMO_ENTRY_KEY, "1"); } catch (e) { /* storage is optional */ }
  return doLogin();
}
async function checkDemoUser() {
  try {
    const r = await api("/api/auth/check-demo");
    if (r.exists) document.getElementById("demo-hint")?.style.setProperty("display", "");
  } catch (e) { /* endpoint may not exist; silently skip */ }
}
async function doLogin() {
  const username = document.getElementById("lg-user").value.trim();
  const password = document.getElementById("lg-pass").value;
  if (!username || !password) return loginErr("请输入用户名和密码");
  try {
    const r = await api("/api/auth/login", { method: "POST", form: { username, password } });
    localStorage.setItem(ORG_KEY, r.token);
    let demoEntry = false;
    try {
      demoEntry = sessionStorage.getItem(DEMO_ENTRY_KEY) === "1";
      if (demoEntry) sessionStorage.removeItem(DEMO_ENTRY_KEY);
      if (demoEntry) sessionStorage.setItem(PRESENTATION_KEY, "1");
    } catch (e) { /* session storage is an enhancement; login still works */ }
    navigate("#/tasks");
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
    navigate("#/submit");
  } catch (e) { loginErr((e.message || "").trim() || "凭证无效或已失效"); }
}

/* ---------------------------------------------------------------- 任务列表 */
const TASK_STATUS = { draft: "草稿", collecting: "收集中", closed: "已关闭", archived: "已归档", cancelled: "已取消" };
function runtimeToolNames(runtime, skill = null) {
  const allowed = skill?.allowed_tools;
  return (runtime?.tools || []).filter(tool => !Array.isArray(allowed) || allowed.includes(tool.name))
    .map(tool => `<code>${esc(tool.name).replace(/\./g, ".<wbr>")}</code>`).join(" ") || '<span class="muted">当前 Skill 不直接调用工具</span>';
}
const AGENT_RUNTIME_CONTRACT_VERSION = 1;
let agentRuntimeContractWarning = "";
function agentRuntimeContractIssue(runtime) {
  return runtime?.contract_version === AGENT_RUNTIME_CONTRACT_VERSION
    ? ""
    : "\u670d\u52a1\u7aef API \u4e0e\u5f53\u524d\u9875\u9762\u7248\u672c\u4e0d\u4e00\u81f4\uff1b\u8bf7\u91cd\u542f API \u670d\u52a1\u540e\u5237\u65b0\u9875\u9762\u3002\u8fd0\u884c\u65f6\u6e05\u5355\u672a\u52a0\u8f7d\uff0c\u4ee5\u4e0b\u4e3a\u9759\u6001\u8bf4\u660e\u3002";
}
function paintAgentRuntimeContractIssue(issue) {
  agentRuntimeContractWarning = issue || "";
  if (!agentRuntimeContractWarning) return;
  for (const id of ["workspace-agent-status", "agent-runtime-status"]) {
    const status = document.getElementById(id);
    if (status) status.textContent = agentRuntimeContractWarning;
  }
  const tourStatus = document.getElementById("agent-tour-availability");
  if (tourStatus) tourStatus.textContent = "运行时清单版本不匹配，架构说明使用静态内容。";
  for (const id of ["workspace-agent-mode", "agent-tour-mode", "agent-runtime-mode"]) {
    const mode = document.getElementById(id);
    if (mode) {
      mode.className = "runtime-mode warning";
      mode.textContent = "\u7248\u672c\u4e0d\u5339\u914d";
    }
  }
}
function runtimeReviewSkill(runtime) {
  return (runtime?.skills || []).find(skill => skill.name === "review_one_submission") || {};
}
function runtimeSelfTestSummary(runtime) {
  const test = runtime?.contract_self_test;
  if (!test) return "合同自测未加载";
  const passed = Number(test.passed) || 0;
  const total = Number(test.total) || 0;
  return `合同自测 ${passed}/${total} ${test.status === "passed" ? "通过" : "需关注"}`;
}
function runtimeSelfTestHtml(runtime = null) {
  const test = runtime?.contract_self_test;
  if (!test) {
    return `<details class="runtime-self-test runtime-self-test-missing"><summary><span><b>合同自测未加载</b><small>服务端未返回逐项运行合同检查</small></span><span class="runtime-self-test-toggle">查看说明 ${icon("arrow")}</span></summary><p class="runtime-self-test-empty">运行时清单恢复后会显示 Skill、工具边界、预算、人工接手和 MCP 只读范围的检查结果。</p></details>`;
  }
  const passed = Number(test.passed) || 0;
  const total = Number(test.total) || 0;
  const checks = Array.isArray(test.checks) ? test.checks : [];
  const tone = test.status === "passed" ? "passed" : "attention";
  const rows = checks.map(check => {
    const ok = check?.passed === true;
    return `<li class="${ok ? "passed" : "attention"}"><span class="runtime-self-test-mark" aria-label="${ok ? "通过" : "需关注"}">${icon(ok ? "check" : "close")}</span><span><b>${esc(check?.label || check?.id || "合同检查")}</b><small>${esc(check?.detail || "服务端未提供说明")}</small></span></li>`;
  }).join("");
  return `<details class="runtime-self-test ${tone}"><summary><span><b>${esc(runtimeSelfTestSummary(runtime))}</b><small>只验证运行合同，不调用模型</small></span><span class="runtime-self-test-toggle">查看 ${checks.length || total} 项 ${icon("arrow")}</span></summary>${rows ? `<ul class="runtime-self-test-list" aria-label="Agent 运行合同检查">${rows}</ul>` : `<p class="runtime-self-test-empty">服务端未返回逐项检查。</p>`}<p class="runtime-self-test-foot">${esc(test.note || "这些检查不读取材料，也不代表模型准确率。")}</p></details>`;
}
const MCP_TOOL_META = {
  list_my_tasks: {label: "任务索引", detail: "确认组织者可见的任务范围", icon: "tasks"},
  get_task_collection_progress: {label: "收集进度", detail: "读取阶段聚合计数", icon: "workbench"},
  get_task_next_step: {label: "流程下一步", detail: "定位当前展示路线", icon: "arrow"},
  get_task_agent_runtime: {label: "Agent runtime", detail: "读取 Skill 与工具合同", icon: "sparkle"},
};
function mcpSnapshotHtml(snapshot = state.mcpSnapshot) {
  const loading = state.mcpSnapshotLoading;
  const running = state.mcpSnapshotRunning;
  if (snapshot?.error) {
    return `<div class="mcp-snapshot-body"><div class="mcp-snapshot-state error" role="alert"><b>只读快照暂时没有读到</b><p class="mcp-snapshot-error">${esc(snapshot.error)}</p><small>这不会阻塞任务路线；重新读取只读快照即可再次确认 Agent 边界。</small></div><button class="ghost sm" type="button" onclick="loadMcpSnapshot()">重新读取</button></div>`;
  }
  if (!snapshot) {
    return `<div class="mcp-snapshot-body"><div class="mcp-snapshot-state pending" role="status"><b>${loading ? "正在读取只读快照" : "还没有读取只读快照"}</b><p>只展示当前组织者账号有权看到的聚合结果，不展开逐人名单、材料正文或审核证据。</p></div><button class="ghost sm" type="button" onclick="loadMcpSnapshot()"${loading ? " disabled" : ""}>${loading ? "读取中…" : "读取只读快照"}</button></div>`;
  }
  const replay = snapshot.execution?.replay || [];
  const replayActive = Number.isInteger(state.mcpReplayIndex) && state.mcpReplayIndex >= 0;
  const visibleCount = replayActive ? Math.min(state.mcpReplayIndex, (snapshot.calls || []).length) : (snapshot.calls || []).length;
  const calls = (snapshot.calls || []).slice(0, visibleCount).map((call, index) => {
    const meta = MCP_TOOL_META[call.tool] || {label: "只读工具", detail: "返回受限聚合结果", icon: "check"};
    const detail = call.tool === "get_task_collection_progress"
      ? Object.entries(call.counts || {}).map(([key, value]) => `${key} ${value}`).join(" · ")
      : call.tool === "get_task_next_step"
        ? `${call.current?.title || "无当前步骤"} → ${call.next?.title || "已到末站"}`
        : call.tool === "get_task_agent_runtime"
          ? `${(call.skills || []).join("、") || "无 Skill"} · 工具 ${call.tool_count ?? 0} 项`
          : `${call.task_count ?? 0} 个任务`;
    const status = call.status || "ok";
    const statusLabel = status === "ok" ? "已返回" : status;
    return `<li><span class="mcp-call-index">${String(index + 1).padStart(2, "0")}</span><span class="mcp-call-icon">${icon(meta.icon)}</span><div class="mcp-call-copy"><div class="mcp-call-head"><b>${esc(meta.label)}</b><span class="mcp-call-status ${status === "ok" ? "ok" : "warn"}">${esc(statusLabel)}</span></div><code>${esc(call.tool)}</code><small>${esc(call.summary || detail || meta.detail)}</small>${call.summary ? `<em>${esc(detail || meta.detail)}</em>` : ""}</div></li>`;
  }).join("");
  const runtime = snapshot.runtime || {};
  const captured = snapshot.captured_at ? fmtTimeShort(snapshot.captured_at) : "刚刚";
  const execution = snapshot.execution || {};
  const intent = snapshot.intent || {};
  const executionStatus = replayActive && running
    ? `回放中 · ${visibleCount}/${replay.length || (snapshot.calls || []).length}`
    : execution.status === "completed" ? "已完成" : (execution.status || "待运行");
  const executionTone = replayActive && running ? "warn" : execution.status === "completed" ? "ok" : "warn";
  const replayNote = replayActive && replay[visibleCount]
    ? `<div class="mcp-replay-note" role="status"><span class="mcp-replay-dot"></span><b>下一步：${esc(replay[visibleCount].label || replay[visibleCount].tool)}</b><span>${esc(replay[visibleCount].detail || "受限工具调用")}</span></div>`
    : replayActive && visibleCount >= (replay.length || (snapshot.calls || []).length)
      ? `<div class="mcp-replay-note complete" role="status"><span class="mcp-replay-dot"></span><b>回放完成</b><span>四项只读调用已返回，人工确认仍是最后一道门。</span></div>`
      : "";
  const budget = execution.replay_budget || {};
  const budgetText = budget.max_tool_calls ? `工具 ${budget.tool_calls ?? 0}/${budget.max_tool_calls} · 语义模型 ${budget.semantic_model_calls ?? 0} 次上限 · 材料 ${budget.parsed_pages ?? 0} 页上限` : "工具调用按 Harness 预算执行";
  const refreshNote = loading ? `<div class="mcp-snapshot-refresh" role="status"><span class="mcp-replay-dot"></span><b>正在刷新只读快照</b><span>上一次结果仍保留在这里。</span></div>` : "";
  return `<div class="mcp-snapshot-body"><div class="mcp-snapshot-meta"><span>任务 #${esc(snapshot.task?.id)} · ${esc(snapshot.task?.name || "当前任务")}</span><time>${esc(captured)}</time></div>${refreshNote}<div class="mcp-run-summary"><div><b>Agent 只读意图</b><span>${esc(intent.goal || "定位当前任务下一步并读取受限聚合进度")}</span></div><div><b>运行状态</b><span class="mcp-run-status ${executionTone}">${esc(executionStatus)}</span></div>${execution.correlation_id ? `<div><b>correlation id</b><code>${esc(execution.correlation_id)}</code></div>` : ""}</div>${replayNote}<ol class="mcp-snapshot-calls" aria-label="MCP 工具调用账本">${calls || `<li class="mcp-call-pending"><span class="mcp-replay-dot"></span><div><b>等待第一项只读调用</b><small>Agent 先确认任务范围，再逐步读取聚合信息。</small></div></li>`}</ol><div class="mcp-snapshot-foot"><span>只读 · 服务端脱敏投影 · 合同 v${esc(runtime.contract_version ?? "—")} · ${esc(budgetText)}</span><span class="mcp-snapshot-actions"><button class="ghost sm" type="button" onclick="runMcpDemo()"${running ? " disabled" : ""}>${running ? "回放中…" : "运行 Agent 导览"}</button><button class="ghost sm" type="button" onclick="loadMcpSnapshot()"${loading || running ? " disabled" : ""}>${loading ? "读取中…" : "刷新快照"}</button></span></div><p class="mcp-snapshot-boundary">${esc(execution.human_gate || snapshot.boundary || "不返回逐人名单、材料正文、审核证据或会话 token")}</p></div>`;
}
function paintMcpSnapshot() {
  const body = document.getElementById("mcp-snapshot-body");
  if (body) body.innerHTML = mcpSnapshotHtml(state.mcpSnapshot).replace(/^<div class="mcp-snapshot-body">|<\/div>$/g, "");
  paintAgentArchitecture();
  paintAgentShowcase();
}
async function loadMcpSnapshot(taskId = state.demoTaskId) {
  if (!Number.isFinite(Number(taskId))) return;
  clearMcpReplay();
  state.mcpReplayIndex = null;
  state.demoTaskId = Number(taskId);
  state.mcpSnapshotLoading = true;
  paintMcpSnapshot();
  try {
    state.mcpSnapshot = await api(`/api/tasks/${state.demoTaskId}/mcp-snapshot`);
  } catch (error) {
    state.mcpSnapshot = {error: error.message || "MCP 快照暂时不可用，请确认组织者会话仍有效。"};
  } finally {
    state.mcpSnapshotLoading = false;
    paintMcpSnapshot();
  }
}
function clearMcpReplay() {
  if (state.mcpReplayTimer) clearTimeout(state.mcpReplayTimer);
  state.mcpReplayTimer = 0;
}
function scheduleMcpReplay(snapshot) {
  clearMcpReplay();
  const total = (snapshot?.execution?.replay || snapshot?.calls || []).length;
  state.mcpReplayIndex = 0;
  const advance = () => {
    state.mcpReplayIndex = Math.min(total, (state.mcpReplayIndex || 0) + 1);
    paintMcpSnapshot();
    if (state.mcpReplayIndex < total) {
      state.mcpReplayTimer = setTimeout(advance, 520);
      return;
    }
    state.mcpReplayTimer = setTimeout(() => {
      state.mcpReplayIndex = null;
      state.mcpSnapshotRunning = false;
      paintMcpSnapshot();
      clearMcpReplay();
    }, 760);
  };
  paintMcpSnapshot();
  state.mcpReplayTimer = setTimeout(advance, 280);
}
async function runMcpDemo() {
  if (!Number.isFinite(Number(state.demoTaskId)) || state.mcpSnapshotRunning) return;
  clearMcpReplay();
  state.mcpSnapshotRunning = true;
  paintMcpSnapshot();
  try {
    state.mcpSnapshot = await api(`/api/tasks/${state.demoTaskId}/mcp-demo`, {method: "POST"});
    scheduleMcpReplay(state.mcpSnapshot);
  } catch (error) {
    state.mcpSnapshot = {error: error.message || "Agent 导览暂时不可用，请确认组织者会话仍有效。"};
    state.mcpSnapshotRunning = false;
    paintMcpSnapshot();
  } finally {
    if (state.mcpSnapshot?.error) {
      state.mcpSnapshotRunning = false;
      state.mcpReplayIndex = null;
      clearMcpReplay();
      paintMcpSnapshot();
    }
  }
}
function agentTourRuntimeHtml(runtime = null) {
  if (!runtime) return `<div id="agent-tour-runtime-contract"><div class="agent-tour-guardrail"><b>审核 Agent · Harness 工具护栏</b><span><code>review_one_submission</code> 的工具调用受白名单、任务范围、运行预算、幂等键和结果上限约束；<code>requirements_draft</code> 由应用服务处理，按任务、账号和请求编号恢复，并在版本冲突时拒绝写入。</span></div>${runtimeSelfTestHtml()}<div class="agent-tour-boundary" aria-label="工具、MCP 与人工决策边界"><div class="agent-boundary-tools"><b>网页内工具</b><span><code>review.deterministic_rule</code><code>review.semantic_rule</code><br>网页 Agent 只通过当前任务白名单访问工具。</span></div><div class="agent-boundary-mcp"><b>独立只读 MCP sidecar</b><span><code>list_my_tasks</code><code>get_task_collection_progress</code><code>get_task_next_step</code><code>get_task_agent_runtime</code><br>需组织者会话授权；仅返回任务导航、适用的收集阶段聚合计数和 Agent runtime，不读取逐人名单、材料正文或审核结果，也不供网页 Agent 调用。</span></div><div class="agent-boundary-human"><b>组织者确认</b><span>蓝图发布、补正处理和最终验收由组织者决定；证据不足时 Agent 停在待确认。</span></div></div>${mcpSnapshotPanelHtml()}</div>`;
  const reviewSkill = runtimeReviewSkill(runtime);
  const requirements = (runtime?.skills || []).find(skill => skill.name === "requirements_draft") || {};
  const harness = runtime?.harness;
  const tools = runtimeToolNames(runtime, reviewSkill);
  const budget = harness
    ? `最多 ${harness.max_invocations} 次工具调用 · ${harness.semantic_model_calls_per_run} 次语义模型调用 · ${harness.parsed_pages_per_run} 页材料 · 单结果 ≤${harness.result_limit_bytes} B`
    : "白名单、任务范围、运行预算、幂等键和结果上限共同约束调用";
  const requirementBoundary = requirements.request_idempotency
    ? `由应用服务处理，按 ${requirements.request_idempotency === "task_account_request_id" ? "任务、账号和请求编号" : requirements.request_idempotency} 恢复；版本冲突 ${requirements.version_conflict === "fail_closed" ? "拒绝写入" : "按服务端策略处理"}，${requirements.human_gate || "由组织者确认后生效"}`
    : "由应用服务处理并等待组织者确认，不直接发布规则或时间策略";
  const mcp = runtime?.mcp;
  const mcpTools = (mcp?.adapters || []).flatMap(adapter => adapter.tools || []);
  const mcpBoundary = mcp?.boundary || "网页内置 Agent 不调用外部 MCP；独立 sidecar 仅提供组织者只读能力。";
  const mcpToolList = mcpTools.map(name => `<code>${esc(name)}</code>`).join("");
  const human = (runtime?.human_control || []).map(item => esc(item)).join("；") || "蓝图发布、补正处理和最终验收由组织者决定";
  return `<div id="agent-tour-runtime-contract"><div class="agent-tour-guardrail"><b>审核 Agent · Harness 工具护栏</b><span><code>${esc(reviewSkill.name || "review_one_submission")}</code> · ${esc(budget)}；需求 Agent ${esc(requirementBoundary)}。</span></div>${runtimeSelfTestHtml(runtime)}<div class="agent-tour-boundary" aria-label="工具、MCP 与人工决策边界"><div class="agent-boundary-tools"><b>网页内工具白名单</b><span>${tools}</span></div><div class="agent-boundary-mcp"><b>独立只读 MCP sidecar</b><span>${mcpToolList}${mcpToolList ? "<br>" : ""}${esc(mcpBoundary)}</span></div><div class="agent-boundary-human"><b>组织者最终决定</b><span>${human}</span></div></div>${mcpSnapshotPanelHtml()}</div>`;
}
function mcpSnapshotPanelHtml() {
  return `<section class="mcp-snapshot" aria-label="MCP 只读快照"><div class="mcp-snapshot-head"><div><span class="eyebrow">LIVE MCP EVIDENCE</span><b>Agent → MCP 只读导览</b><small>由服务端桥接执行四个白名单读取；浏览器不会接触 MCP 会话 token。</small></div><span class="badge brand">4 个工具</span></div><div id="mcp-snapshot-body">${mcpSnapshotHtml()}</div></section>`;
}
function taskRuntimeHtml(runtime = null) {
  const skill = runtimeReviewSkill(runtime);
  const mode = runtime?.model?.label || "读取任务边界…";
  const scope = runtime?.scope || {};
  const tools = runtimeToolNames(runtime, skill);
  const mcp = runtime?.mcp?.boundary || "可选 stdio sidecar 提供任务列表、收集汇总、流程下一步和 Agent runtime，不读取逐人名单或材料。";
  const budget = runtime?.harness ? `工具 ${runtime.harness.max_invocations} 次 · 语义模型 ${runtime.harness.semantic_model_calls_per_run} 次 · 材料 ${runtime.harness.parsed_pages_per_run} 页 · 单结果 ≤${runtime.harness.result_limit_bytes} B` : "按当前蓝图和运行配置计算";
  return `<section id="workspace-agent-runtime" class="workspace-runtime-strip" aria-label="FormFlow Agent runtime">
    <details>
      <summary>
        <div class="runtime-strip-lead">
          <div class="runtime-strip-head"><div class="eyebrow">FORMFLOW AGENT RUNTIME</div><span id="workspace-agent-mode" class="runtime-mode">${esc(mode)}</span></div>
          <h2>运行时边界与安全护栏</h2>
          <p id="workspace-agent-status" role="status" aria-live="polite">${runtime ? `当前任务 ${scope.published_blueprint ? "已发布蓝图" : "尚未发布蓝图"}；运行时边界由服务端清单提供。` : "正在读取当前任务的运行时边界；已有任务和程序流程仍可查看。"}</p>
          <p class="runtime-agent-roles">需求 Agent 整理待确认蓝图；审核 Agent 按规则逐条取证。</p>
        </div>
        <span class="runtime-strip-expand">查看工具与安全边界 ${icon("arrow")}</span>
      </summary>
      <div class="runtime-strip-grid">
        <div class="runtime-skill"><span class="runtime-strip-icon">${icon("sparkle")}</span><b>审核 Skill</b><span><code>${esc(skill.name || "review_one_submission")}</code> 按当前规则逐条取证</span></div>
        <div class="runtime-tools"><span class="runtime-strip-icon">${icon("tasks")}</span><b>工具白名单</b><span>${tools}</span></div>
        <div class="runtime-harness"><span class="runtime-strip-icon">${icon("review")}</span><b>Harness</b><span>scope、预算、幂等键、结果上限与审计 · ${esc(budget)}</span>${runtimeSelfTestHtml(runtime)}</div>
        <div class="runtime-mcp"><span class="runtime-strip-icon">${icon("expand")}</span><b>MCP 边界</b><span>${esc(mcp)}</span></div>
        <div class="runtime-human"><span class="runtime-strip-icon">${icon("workbench")}</span><b>人来决定</b><span>${esc((runtime?.human_control || ["不确定、失败与最终验收交给组织者"])[0])}</span></div>
      </div>
    </details>
  </section>`;
}
function designRuntimeHtml(runtime = null) {
  const mode = runtime?.model?.label || "受限运行时";
  const skill = (runtime?.skills || []).find(item => item.name === "requirements_draft") || {};
  const tools = runtimeToolNames(runtime, skill);
  const mcp = runtime?.mcp?.boundary || "网页内置 Agent 不调用外部 MCP；只读 sidecar 提供任务列表、收集汇总、流程下一步和 Agent runtime，不读取逐人名单或材料。";
  const execution = skill.request_idempotency
    ? "持久请求队列 · 同请求幂等恢复 · 版本冲突拒绝"
    : "scope、预算、幂等键、结果上限与审计在边界内检查";
  return `<details id="design-agent-runtime" class="agent-runtime-card" aria-label="智能协作边界">
    <summary class="runtime-card-summary">
      <span class="runtime-card-summary-main"><span class="eyebrow">AGENT RUNTIME</span><b>小齐的协作边界</b><small>Skill 需求整理 · 受限工具与预算 · 发布由组织者确认</small></span>
      <span class="runtime-mode" id="agent-runtime-mode">${esc(mode)}</span>
      <span class="runtime-card-toggle">查看运行边界 ${icon("arrow")}</span>
    </summary>
    <div class="runtime-card-content">
      <div class="runtime-card-grid">
        <div class="runtime-card-item runtime-skill"><span class="runtime-card-icon">${icon("sparkle")}</span><div><b>Skill · 需求整理</b><span><code>${esc(skill.name || "requirements_draft")}</code> ${esc(skill.description || "把原始要求整理成待确认草案")}</span></div></div>
        <div class="runtime-card-item runtime-tools"><span class="runtime-card-icon">${icon("tasks")}</span><div><b>工具边界</b><span>${tools}</span></div></div>
        <div class="runtime-card-item runtime-harness"><span class="runtime-card-icon">${icon("review")}</span><div><b>执行与恢复</b><span>${execution} · 发布需组织者确认</span>${runtimeSelfTestHtml(runtime)}</div></div>
        <div class="runtime-card-item runtime-mcp"><span class="runtime-card-icon">${icon("expand")}</span><div><b>MCP 边界</b><span>${esc(mcp)}</span></div></div>
        <div class="runtime-card-item runtime-human"><span class="runtime-card-icon">${icon("workbench")}</span><div><b>人工确认</b><span>${esc((runtime?.human_control || ["不确定内容、材料门槛和最终发布由组织者决定"])[2] || "发布前必须由组织者确认")}</span></div></div>
      </div>
      <p class="runtime-card-foot" id="agent-runtime-status">${runtime ? "这份边界来自当前任务的服务端运行时清单。" : "正在读取当前任务的服务端运行时清单。"}</p>
      <div id="offline-replay-action"></div>
    </div>
  </details>`;
}
function designProgressHtml() {
  // `designPublished` is also the comparison baseline for newer drafts. It can
  // remain populated while the currently selected draft is still unpublished.
  const published = state.draftStatus === "published";
  const hasDraft = !!state.bpId;
  const clarificationCount = (state.designQuestions || []).length;
  const blockingCount = (state.designBlocking || []).length;
  const publishReady = canPublishDesign();
  const modelOffline = state.llmConfigured === false;
  const steps = [
    {number:"01", label:"描述需求", tone:hasDraft ? "done" : "current", text:hasDraft ? "已有一份可继续核对的蓝图" : "先写下要收什么、交什么"},
    {number:"02", label:"核对与澄清", tone:!hasDraft ? "pending" : clarificationCount || blockingCount ? "current" : "done", text:!hasDraft ? "生成草案后会出现在这里" : clarificationCount ? `${clarificationCount} 项待补充说明` : blockingCount ? `${blockingCount} 项需要先处理` : "字段、材料和规则已具备"},
    {number:"03", label:"确认发布", tone:published ? "done" : publishReady ? "ready" : "pending", text:published ? `当前版本 v${state.draftVersionId || "—"} 已发布` : publishReady ? "组织者确认后才会生效" : "发布按钮会在核对完成后开放"},
  ];
  const status = published ? "已发布" : state.agentBusy ? "Agent 正在整理" : modelOffline ? "离线可演示" : blockingCount ? "需要处理" : clarificationCount ? "等待澄清" : publishReady ? "等待确认" : "准备中";
  return `<section id="design-progress" class="design-progress" aria-label="需求设计进度">
    <div class="design-progress-head"><div><span class="eyebrow">CURRENT RUN</span><b>这份需求现在走到哪一步</b></div><span class="badge ${published ? "ok" : blockingCount || modelOffline ? "warn" : "brand"}">${status}</span></div>
    <ol class="design-progress-steps">${steps.map(step => `<li class="${step.tone}"><span class="design-progress-index">${step.number}</span><div><b>${step.label}</b><span>${step.text}</span></div></li>`).join("")}</ol>
    <p class="design-progress-boundary"><span>${icon("workbench")}</span>${published ? "发布后的字段和规则已冻结；后续修改会形成新版本。" : "Agent 只整理和取证，字段生效、发布与最终责任仍由组织者确认。"}</p>
  </section>`;
}
function paintDesignProgress() {
  const box = document.getElementById("design-progress");
  if (box) box.outerHTML = designProgressHtml();
}
async function loadAgentRuntime(taskId) {
  if (!Number.isFinite(Number(taskId))) return;
  try {
    const runtime = await api(`/api/tasks/${taskId}/agent-runtime`);
    const contractIssue = agentRuntimeContractIssue(runtime);
    if (contractIssue) {
      state.agentRuntime = null;
      paintAgentRuntimeContractIssue(contractIssue);
      return;
    }
    state.agentRuntime = runtime;
    const taskStrip = document.getElementById("workspace-agent-runtime");
    if (taskStrip) taskStrip.outerHTML = taskRuntimeHtml(runtime);
    const tourContract = document.getElementById("agent-tour-runtime-contract");
    if (tourContract) tourContract.outerHTML = agentTourRuntimeHtml(runtime);
    const harnessNote = document.querySelector("#workspace-agent-runtime .runtime-harness > span:last-child");
    if (harnessNote) {
      const recoveryNote = runtime.harness?.recovery_note;
      if (recoveryNote) harnessNote.textContent = `${harnessNote.textContent} · ${recoveryNote}`;
    }
    const designCard = document.getElementById("design-agent-runtime");
    if (designCard) designCard.outerHTML = designRuntimeHtml(runtime);
    paintWorkspaceAgentStatus();
    paintAgentRuntime();
    paintAgentArchitecture();
    paintAgentShowcase();
  } catch (e) {
    // The existing static fallback remains usable if the read-only manifest is unavailable.
  }
}
async function viewTasks() {
  const presentationHeading = state.presentationMode;
  const pageEyebrow = presentationHeading ? "FORMFLOW / 评委展示" : "WORKSPACE / 任务管理";
  const pageTitle = presentationHeading ? "从要求到有证据的交付" : "我的任务";
  const pageLead = presentationHeading
    ? "受限 Agent 负责整理与取证，人工确认后才进入可交付快照。"
    : "从需求到交付，把每一次收集安排妥当。";
  document.getElementById("app").innerHTML = `
    <div class="page-heading"><div><div id="task-home-eyebrow" class="eyebrow">${pageEyebrow}</div><h1 id="task-home-title">${pageTitle}<span class="heading-dot">.</span></h1><p id="task-home-lead">${pageLead}</p></div>
      <div class="page-heading-actions"><button class="ghost presentation-agent-jump" onclick="jumpToAgentTour()">${icon("sparkle")} 查看 Agent 架构</button><button id="presentation-toggle" class="ghost presentation-toggle" aria-pressed="false" onclick="togglePresentationMode()">${icon("expand")} 进入展示视图</button><button onclick="openDialog('create-dialog', this)">${icon("plus")} 新建收集任务</button></div></div>
    <div id="flash" role="status"></div>
    <div id="task-stats" class="overview-stats"></div>
    <section class="card task-section" tabindex="-1" aria-label="我的任务列表"><div class="section-toolbar"><div class="task-filters" role="group" aria-label="任务状态筛选">
      <button class="filter active" data-filter="all" onclick="filterTasks('all')">全部任务</button>
      <button class="filter" data-filter="collecting" onclick="filterTasks('collecting')">收集中</button>
      <button class="filter" data-filter="draft" onclick="filterTasks('draft')">草稿</button>
      <button class="filter" data-filter="done" onclick="filterTasks('done')">已结束</button></div>
      <label class="search-box">${icon("search")}<input id="task-search" aria-label="搜索任务" placeholder="搜索任务名称…" oninput="paintTasks()"></label></div>
      <div id="task-list" aria-live="polite"><p class="empty">正在读取任务…</p></div></section>
    <p class="workspace-note">${icon("delivery")} 正式提交保留版本记录，交付时按固定快照整理。</p>
    <div id="demo-route" aria-live="polite"></div>
    <section class="workspace-intro"><div class="intro-symbol">${icon("design")}</div><div><h2>不用从一张空表单开始</h2><p>告诉小齐要收什么，一起确认字段、材料和规则，再交给提交者。</p></div><span class="intro-note">你确认，才发布 ${icon("arrow")}</span></section>
    ${taskRuntimeHtml()}
    ${agentTourHtml()}
    <dialog id="create-dialog"><form onsubmit="event.preventDefault();createTask()">
      <div class="dialog-heading"><div><div class="eyebrow">NEW COLLECTION</div><h2>开始一次新的收集</h2></div><button type="button" class="ghost icon-only" aria-label="关闭新建任务" title="关闭新建任务" onclick="this.closest('dialog').close()">${icon("close")}</button></div>
      <p class="muted">先起个名字，具体材料和检查要求下一步与小齐一起确认。</p>
      <label for="tk-name">任务名称</label><input id="tk-name" required maxlength="120" placeholder="例如：2026 秋季团课报告收集">
      <div class="row"><div><label for="tk-mode">收集范围</label><select id="tk-mode"><option value="roster">名册制 · 有固定应交名单</option><option value="open">开放制 · 面向报名者</option></select></div>
      <div><label for="tk-kind">提交主体</label><select id="tk-kind"><option value="individual">个人提交</option><option value="team">团队提交</option></select></div></div>
      <div id="create-error" class="inline-error" role="alert"></div>
      <div class="dialog-actions"><button type="button" class="ghost" onclick="this.closest('dialog').close()">取消</button><button id="create-submit" type="submit">创建并设计 ${icon("arrow")}</button></div>
    </form></dialog>`;
  applyPresentationMode();
  try {
    const { tasks } = await api("/api/tasks");
    if (document.body.dataset.page !== "tasks") return;
    state.tasks = tasks; state.taskFilter = "all";
    setEmptyTaskHome(tasks.length === 0);
    checkWorkspaceLLMStatus();
    renderDemoRoute(tasks);
    const routeTask = demoRouteTask(tasks);
    if (routeTask) {
      state.demoTaskId = routeTask.id;
      loadDemoRoute(routeTask);
      loadAgentRuntime(routeTask.id);
      loadMcpSnapshot(routeTask.id);
    }
    const n = status => tasks.filter(t => t.status === status).length;
    document.getElementById("task-stats").innerHTML = [["全部任务", tasks.length, "tasks"], ["正在收集", n("collecting"), "workbench"], ["待完善草稿", n("draft"), "design"], ["已经归档", n("archived"), "delivery"]].map(([label, value, ic]) => `<div class="overview-stat"><span>${label}</span><strong>${value.toString().padStart(2,"0")}</strong><i>${icon(ic)}</i></div>`).join("");
    paintTasks();
  } catch (e) { setFlash(e.message); document.getElementById("task-list").innerHTML = '<div class="empty">暂时无法读取任务。<button class="link" onclick="viewTasks()">重新加载</button></div>'; }
}
function setEmptyTaskHome(isEmpty) {
  document.getElementById("app")?.classList.toggle("task-home-empty", isEmpty);
}
function demoRouteTask(tasks = []) {
  return tasks.find(t => t.status === "collecting")
    || tasks.find(t => t.status === "draft")
    || tasks.find(t => !["archived", "cancelled", "closed"].includes(t.status))
    || tasks[0]
    || null;
}
function agentTourHtml(llmConfigured = state.llmConfigured) {
  const mode = llmConfigured === false ? "离线演示" : llmConfigured === true ? "模型已接入" : "运行状态读取中";
  const modeClass = llmConfigured === false ? "offline" : llmConfigured === true ? "online" : "";
  const availability = llmConfigured === false
    ? "当前没有模型密钥：程序规则、已有结果和人工接手仍可完整演示。"
    : llmConfigured === true
      ? "当前已配置模型密钥；语义审核仍受工具白名单、预算和证据约束。"
      : "正在读取模型配置；已有任务和程序流程仍可查看。";
  const steps = [
    ["输入", "从一句要求开始", "先锁定任务和收集范围，原始要求保留供组织者核对。", "input"],
    ["需求 Skill", "requirements_draft", "整理有来源的待确认蓝图，不直接发布规则或时间策略。", "skill"],
    ["蓝图确认", "组织者核对并发布", "确认字段、规则与时间策略后冻结版本，再进入正式收件。", "approval"],
    ["审核 Skill", "review_one_submission", "基于已发布规则逐条检查，整理证据引用与材料覆盖情况。", "review"],
    ["人工接手", "组织者做最终决定", "处理不确定项、补正和最终验收；模型不会自行认定通过。", "human"],
  ];
  return `<section class="agent-tour" aria-label="Agent 工作导览"><details><summary aria-expanded="false"><span><span class="eyebrow">现场演示 · AGENT WALKTHROUGH</span><b>两个 Agent 怎样从要求走到可交付证据</b><small>按需展开蓝图确认、审核 Skill、执行护栏与人工接手点</small></span><span class="agent-tour-summary"><span id="agent-tour-mode" class="runtime-mode ${modeClass}">${esc(mode)}</span><span class="agent-tour-chevron">${icon("arrow")}</span></span></summary><div class="agent-tour-body"><div class="agent-tour-intro"><p id="agent-tour-availability">${esc(availability)}</p><span>审核运行可在复核页查看证据和工具记录</span></div><ol class="agent-tour-flow" aria-label="需求整理与审核的五个业务阶段">${steps.map(([label, title, detail, tone], i) => `<li class="agent-tour-step ${tone}"><span class="agent-tour-index">0${i + 1}</span><div><b>${esc(label)}</b><strong>${esc(title)}</strong><span>${esc(detail)}</span></div></li>`).join("")}</ol>${agentTourRuntimeHtml(state.agentRuntime)}</div></details></section>`;
}
const DEMO_ROUTE_STATUS = {done: "已完成", current: "现在处理", upcoming: "下一步", blocked: "先完成前置"};
const DEMO_ROUTE_ICONS = {design: "design", roster: "roster", review: "review", delivery: "delivery"};
const DEMO_ROUTE_TALK_TRACK = {
  design: "先看一句自然语言如何变成可核对蓝图；发布前仍由组织者确认，Agent 不会替人发布规则。",
  roster: "这里展示权限边界：凭证只把人带到自己的提交空间，保存草稿和正式提交是两件事。",
  review: "这里看证据链：程序规则、语义检查和人工判断分开，缺证据就停在待处理。",
  delivery: "最后只从已验收的正式快照生成 CSV 和 ZIP，交付不会覆盖过程记录。",
};
const DEMO_ROUTE_STAGE_META = {
  design: {boundary: "组织者确认", evidence: "原始要求 + 蓝图", finish: "规则和时间策略已冻结", goal: "冻结字段、材料与验收规则"},
  roster: {boundary: "程序执行", evidence: "名单 + 凭证记录", finish: "提交者进入自己的空间", goal: "让每位提交者拿到独立且可撤销的入口"},
  review: {boundary: "Agent 取证 · 人确认", evidence: "规则结论 + 原文位置", finish: "不确定项停在人工处理", goal: "把每条结论落到原文证据，未完成就转人工"},
  delivery: {boundary: "程序快照", evidence: "验收结果 + 正式版本", finish: "只导出已验收材料", goal: "只从已验收正式快照生成可追溯交付包"},
};
function demoRouteStageMeta(step) {
  const key = step?.key || "";
  if (DEMO_ROUTE_STAGE_META[key]) return DEMO_ROUTE_STAGE_META[key];
  const title = step?.title || "";
  if (title.includes("要求")) return DEMO_ROUTE_STAGE_META.design;
  if (title.includes("凭证")) return DEMO_ROUTE_STAGE_META.roster;
  if (title.includes("检查") || title.includes("复核")) return DEMO_ROUTE_STAGE_META.review;
  if (title.includes("交付")) return DEMO_ROUTE_STAGE_META.delivery;
  return {boundary: "按当前流程确认", evidence: "当前站的授权记录", finish: "完成后进入下一站", goal: "完成当前站的授权动作并留下可回看的记录"};
}
const DEMO_ROUTE_EVIDENCE = {
  design: {label: "打开蓝图", suffix: "design"},
  roster: {label: "打开名单与凭证", suffix: "roster"},
  review: {label: "打开规则证据", suffix: "review"},
  delivery: {label: "打开验收快照", suffix: "delivery"},
};
function demoRouteEvidence(step, taskId) {
  const key = step?.key || "";
  const fallback = DEMO_ROUTE_EVIDENCE[key];
  if (!fallback || taskId == null) return null;
  return {
    label: fallback.label,
    href: key === "review" && step?.href ? step.href : `#/${fallback.suffix}/${encodeURIComponent(taskId)}`,
  };
}
const REVIEW_RUN_STATUS = {queued: "排队中", running: "检查中", retry_wait: "等待重试", success: "检查完成", failed: "运行失败", superseded: "已被新运行取代"};
const REVIEW_RUN_SOURCE = {
  simulation: {label: "离线演示结果", detail: "本次语义结论由演示脚本生成，没有调用实时模型。", tone: "offline"},
  live: {label: "实时模型结果", detail: "本次语义结论来自实时模型，并受当前工具白名单、预算和证据校验约束。", tone: "online"},
  mixed: {label: "混合来源", detail: "本次运行同时包含离线演示与实时语义结果，按每步运行记录分别查看。", tone: "info"},
  deterministic: {label: "仅程序规则", detail: "本次运行没有语义模型步骤，结论来自确定性程序核验。", tone: "info"},
  unknown: {label: "来源待确认", detail: "当前运行没有足够的模式记录，不能据配置状态推断结果来源。", tone: "warn"},
};
function demoRouteSignalHtml(signal) {
  if (!signal) return "";
  const status = REVIEW_RUN_STATUS[signal.status] || signal.status || "状态未知";
  const tone = signal.status === "success" ? "ok" : ["failed", "retry_wait"].includes(signal.status) ? "warn" : "info";
  const coverage = signal.coverage_complete
    ? "材料覆盖完整"
    : `${signal.coverage_gaps || 0} 页未读或失败，结论会停在待确认`;
  const run = signal.run_id ? `运行 #${signal.run_id}` : "检查已排队";
  const source = REVIEW_RUN_SOURCE[signal.run_source] || REVIEW_RUN_SOURCE.unknown;
  const failure = signal.failure || null;
  const budget = signal.budget || {};
  const pageBudget = budget.pages || {};
  const semanticBudget = budget.semantic_calls || {};
  const budgetMetric = (label, metric, fallbackUsed) => {
    const usedValue = Number(metric.used ?? fallbackUsed ?? 0);
    const limitValue = Number(metric.limit);
    const used = Number.isFinite(usedValue) ? Math.max(0, usedValue) : 0;
    const hasLimit = Number.isFinite(limitValue) && limitValue > 0;
    const limit = hasLimit ? limitValue : null;
    const ratio = hasLimit ? Math.min(1, Math.max(0, used / limitValue)) : 0;
    const tone = ratio >= .9 ? "warn" : ratio >= .7 ? "caution" : "ok";
    const value = `${used} / ${limit == null ? "—" : limit}`;
    return `<div class="demo-route-signal-budget-item ${tone}"><span><b>${esc(label)}</b><em>${esc(value)}</em></span><i role="progressbar" aria-label="${esc(`${label}预算 ${value}`)}" aria-valuemin="0" aria-valuemax="${esc(limit ?? 0)}" aria-valuenow="${esc(used)}"><i style="width:${ratio * 100}%"></i></i></div>`;
  };
  const budgetHtml = (pageBudget.limit != null || semanticBudget.limit != null)
    ? `<div class="demo-route-signal-budget" aria-label="Harness 预算"><span class="eyebrow">Harness 预算</span>${budgetMetric("页数", pageBudget, signal.pages_read)}${budgetMetric("语义调用", semanticBudget, signal.llm_calls_used)}</div>`
    : "";
  const focus = signal.focus_rule;
  const chain = [
    { icon: "delivery", label: "读取材料", value: `${signal.pages_read || 0} 页`, detail: signal.coverage_complete ? "材料覆盖完整" : `${signal.coverage_gaps || 0} 页未读或失败`, tone: signal.coverage_complete ? "ok" : "warn" },
    { icon: "check", label: "程序核验", value: `${signal.deterministic_rules || 0} 项`, detail: "格式、必填项等确定性检查", tone: "tool" },
    { icon: "sparkle", label: "语义审核", value: `${signal.semantic_rules || 0} 项`, detail: signal.llm_calls_used ? `${source.label} · ${signal.llm_calls_used} 次调用` : source.label, tone: source.tone },
    { icon: "workbench", label: "人工接手", value: `${signal.pending_rules || 0} 项待处理`, detail: `${signal.human_rules || 0} 项人工规则`, tone: signal.pending_rules ? "warn" : "human" },
  ];
  const chainHtml = chain.map(stage => `<div class="demo-route-chain-step ${stage.tone}"><span class="demo-route-chain-icon">${icon(stage.icon)}</span><div><b>${esc(stage.label)}</b><strong>${esc(stage.value)}</strong><span>${esc(stage.detail)}</span></div></div>`).join("");
  const trace = Array.isArray(signal.trace) ? signal.trace : [];
  const traceStatus = {satisfied: "已完成", issue: "需处理", unknown: "待人工", failed: "未完成", not_applicable: "不适用"};
  const traceRows = trace.map(item => {
    const tool = item.tool === "review.deterministic_rule" ? "程序规则"
      : item.tool === "review.semantic_rule" && item.simulation === true ? "离线语义"
      : item.tool === "review.semantic_rule" && item.simulation === false ? "语义模型"
      : "语义步骤";
    const tone = ["issue", "failed"].includes(item.status) ? "warn"
      : item.status === "unknown" ? "info" : "ok";
    const duration = Number(item.duration_ms) < 10 ? "<10 毫秒"
      : Number(item.duration_ms) < 1000 ? `${Number(item.duration_ms)} ms`
      : `${(Number(item.duration_ms) / 1000).toFixed(1)} s`;
    const step = Number(item.sequence) > 0 ? `0${item.sequence}`.slice(-2) : "·";
    const attempt = Number(item.execution_attempt) > 1 ? ` · 第 ${Number(item.execution_attempt)} 次` : "";
    const version = item.tool_version ? ` · ${esc(item.tool_version)}` : "";
    return `<li class="demo-route-trace-row"><span class="demo-route-trace-index">${esc(step)}${esc(attempt)}</span><span class="demo-route-trace-kind ${tone}">${esc(tool)}${version}</span><span class="demo-route-trace-status">${esc(traceStatus[item.status] || "已记录")} · ${esc(duration)}</span></li>`;
  }).join("");
  const retry = signal.retry || {};
  const runContext = [
    signal.blueprint_version ? `蓝图 v${signal.blueprint_version}` : "",
    signal.revision_version ? `提交 v${signal.revision_version}` : "",
    Number(retry.attempt) > 1 ? `第 ${retry.attempt} 次运行 · 由 #${retry.retried_from} 重试` : "首次运行",
  ].filter(Boolean).join(" · ");
  const recovered = trace.some(item => Number(item.execution_attempt) > 1);
  const traceHtml = trace.length
    ? `<details class="demo-route-trace"><summary><span><b>运行回放</b><small>skill / harness 已记录 ${trace.length} 步</small></span><span>${esc(source.label)}</span></summary><ol>${traceRows}</ol><p>展示工具类别、状态和耗时；原文、参数与结果仍只在授权的复核页查看。</p>${recovered ? '<p class="agent-simulation-note">Worker 恢复后重新执行过未完成检查；崩溃前已发出的模型请求可能重复，幂等缓存不跨进程保留。</p>' : ''}</details>`
    : "";
  const focusHtml = focus
    ? `<div class="demo-route-signal-focus"><span class="eyebrow">建议先处理</span><strong>${esc(focus.statement || focus.rule_id || "待处理规则")}</strong><span>${esc(focus.status || "待确认")}${focus.executor ? ` · ${esc(EXECUTOR_LABEL[focus.executor] || focus.executor)}` : ""}</span></div>`
    : "";
  const failureHtml = signal.status === "failed" && failure
    ? `<div class="demo-route-signal-failure" role="alert"><b>${esc(failure.title || "这次检查没有完成")}</b><span>${esc(failure.detail || "系统没有形成可靠的完整结论。")}</span><strong>下一步：${esc(failure.action || "组织者可以重试或人工核对。")}</strong></div>`
    : "";
  const reviewAction = signal.review_href
    ? `<a class="demo-route-signal-action" href="${esc(signal.review_href)}" aria-label="打开${esc(signal.subject_name || "当前主体")}的证据复核">打开本次证据复核 ${icon("arrow")}</a>`
    : "";
  return `<details class="demo-route-signal" aria-label="最近复核运行摘要"><summary class="demo-route-signal-summary"><span class="demo-route-signal-head"><span><span class="eyebrow">最近复核运行</span><strong>${esc(run)} · ${esc(signal.subject_name || "当前主体")}</strong></span></span><span class="demo-route-signal-summary-side"><span class="runtime-mode ${tone}">${esc(status)}</span><span class="demo-route-signal-toggle">查看运行详情 ${icon("arrow")}</span></span></summary><div class="demo-route-signal-body"><div class="demo-route-signal-provenance"><span class="eyebrow">本次运行来源</span><strong class="runtime-mode ${esc(source.tone)}">${esc(source.label)}</strong><span>${esc(source.detail)}</span><small>${esc(runContext)}</small></div>${failureHtml}<p class="demo-route-signal-origin">摘要来自当前正式提交的检查运行；完整证据和原文位置只在授权的复核页查看。</p>${reviewAction}<div class="demo-route-signal-chain" aria-label="复核执行链">${chainHtml}</div>${budgetHtml}<p>${esc(coverage)} · 程序 ${signal.deterministic_rules || 0} · 语义 ${signal.semantic_rules || 0}${signal.llm_calls_used ? ` · 语义调用 ${signal.llm_calls_used} 次` : ""}</p>${traceHtml}${focusHtml}</div></details>`;
}
function demoRouteCueHtml(step) {
  const cue = step?.talk_track || DEMO_ROUTE_TALK_TRACK[step?.key] || "沿着当前路线查看状态、证据和人工确认边界。";
  return `<div class="demo-route-cue"><div><span class="eyebrow">现场讲解</span><p>${esc(cue)}</p></div><button class="ghost sm" type="button" data-cue="${esc(cue)}" onclick="copyDemoRouteCue(this)">${icon("copy")}<span>复制讲解</span></button></div>`;
}
function agentArchitectureNodeState(task = null) {
  const runtime = state.agentRuntime;
  const skills = Array.isArray(runtime?.skills) ? runtime.skills : [];
  const hasSkill = name => skills.some(skill => skill?.name === name);
  const signal = task?.demo_route?.review_signal || task?.route?.review_signal || null;
  const snapshot = state.mcpSnapshot;
  return {
    requirements: runtime
      ? hasSkill("requirements_draft")
        ? {label: "已登记", tone: "ok", detail: "服务端 Skill 清单"}
        : {label: "未登记", tone: "warn", detail: "服务端清单未提供"}
      : {label: "读取中", tone: "info", detail: "等待 runtime 清单"},
    review: signal?.review_href
      ? {label: "证据已授权", tone: "ok", detail: "主体复核入口已返回"}
      : runtime && hasSkill("review_one_submission")
        ? {label: "等待提交", tone: "warn", detail: "有提交后才生成主体入口"}
        : {label: "读取中", tone: "info", detail: "等待 Skill 清单"},
    harness: runtime?.harness
      ? {label: `${runtime.harness.max_invocations ?? "—"} 次上限`, tone: "ok", detail: "预算来自服务端清单"}
      : {label: "读取中", tone: "info", detail: "等待 Harness 清单"},
    mcp: snapshot?.error
      ? {label: "需重试", tone: "warn", detail: "只读快照暂时不可用"}
      : snapshot?.execution?.status === "completed"
        ? {label: "已回放", tone: "ok", detail: "四项只读调用已返回"}
        : snapshot
          ? {label: "已读取", tone: "info", detail: "服务端脱敏投影"}
          : {label: "读取中", tone: "info", detail: "等待只读快照"},
  };
}
function paintAgentArchitecture(task = demoRouteTask(state.tasks)) {
  const statuses = agentArchitectureNodeState(task);
  for (const [key, node] of Object.entries(statuses)) {
    const status = document.getElementById(`architecture-${key}-status`);
    const detail = document.getElementById(`architecture-${key}-state`);
    if (status) {
      status.className = `demo-route-architecture-status ${node.tone}`;
      status.textContent = node.label;
    }
    if (detail) detail.textContent = node.detail;
  }
}
function agentArchitectureRailHtml(task = null) {
  const mode = state.llmConfigured === false ? "离线演示" : state.llmConfigured === true ? "模型已接入" : "受限运行时";
  const dataBoundary = state.llmConfigured === false
    ? "当前走离线演示路径，不调用实时模型。网页显示服务端脱敏投影；外部 MCP sidecar 需在终端单独授权，浏览器不持有 sidecar token。"
    : "网页显示服务端脱敏投影；外部 MCP sidecar 需在终端单独授权，浏览器不持有 sidecar token。材料正文和最终决定仍留在授权复核路径。";
  const taskId = task?.id;
  const reviewSignal = task?.demo_route?.review_signal || task?.route?.review_signal || null;
  const designHref = taskId == null ? "#" : `#/design/${encodeURIComponent(taskId)}`;
  const workbenchHref = taskId == null ? "#" : `#/workbench/${encodeURIComponent(taskId)}`;
  const nodeStates = agentArchitectureNodeState(task);
  const items = [
    ["01", "需求 Skill", "requirements_draft", "先整理，再让人确认", "skill", "requirements", `<a href="${esc(designHref)}">打开需求设计 ${icon("arrow")}</a>`],
    ["02", "审核 Skill", "review_one_submission", reviewSignal?.review_href ? "逐条取证，不替人验收" : "等待授权提交后进入主体复核", "review", "review", reviewSignal?.review_href
    ? `<a href="${esc(reviewSignal.review_href)}">打开证据复核 ${icon("arrow")}</a>`
      : `<a href="${esc(workbenchHref)}">等待授权提交 ${icon("arrow")}</a>`],
    ["03", "Harness", "scope · budget · replay", "失败停下，结果可追溯", "harness", "harness", `<button type="button" onclick="jumpToAgentTour()">查看运行边界 ${icon("arrow")}</button>`],
    ["04", "MCP sidecar", "4 read-only tools", "终端单独调用，只读导航与聚合快照", "mcp", "mcp", `<button type="button" onclick="jumpToMcpSnapshot()">查看只读回放 ${icon("arrow")}</button>`],
  ];
  const flow = items.map(([index, label, code, detail, tone, key, action]) => `<li class="demo-route-architecture-step ${tone}"><span class="demo-route-architecture-index">${index}</span><div><b>${esc(label)}</b><code>${esc(code)}</code><small>${esc(detail)}</small><span id="architecture-${key}-status" class="demo-route-architecture-status ${nodeStates[key].tone}">${esc(nodeStates[key].label)}</span><small id="architecture-${key}-state" class="demo-route-architecture-state">${esc(nodeStates[key].detail)}</small>${action}</div></li>`).join("");
  return `<div class="demo-route-architecture" role="group" aria-label="Agent 架构信号"><div class="demo-route-architecture-lead"><span class="eyebrow">AGENT CONTROL PLANE</span><strong>一条证据链，四个边界</strong><small>从自然语言到固定交付，每一步都有可见的 Skill、工具和人工接手点。</small></div><ol class="demo-route-architecture-flow">${flow}</ol><span class="runtime-mode ${state.llmConfigured === false ? "offline" : "info"}">${esc(mode)}</span><div class="demo-route-architecture-foot"><span class="eyebrow">数据边界</span><span>${esc(dataBoundary)}</span></div></div>`;
}
function agentShowcaseState(task, current) {
  const contract = state.agentRuntime?.contract_self_test;
  const contractPassed = contract?.status === "passed" && Number.isFinite(Number(contract.passed)) && Number.isFinite(Number(contract.total))
    ? (Number(contract.passed) + "/" + Number(contract.total) + " 合同通过")
    : "";
  const runtimeLabel = state.llmConfigured === false ? (contractPassed || "离线可演示")
    : state.llmConfigured === true ? "模型已接入" : "读取中";
  const runtimeTone = state.llmConfigured === false ? "offline" : state.llmConfigured === true ? "online" : "info";
  const runtimeDetail = state.llmConfigured === false
    ? (contractPassed ? "离线演示 · 不调用实时模型" : "模板、程序规则与已有结果可继续演示")
    : state.llmConfigured === true ? "语义审核仍受 Harness 与证据约束" : "正在确认当前模型配置";
  const execution = state.mcpSnapshot?.execution || {};
  const mcpLabel = state.mcpSnapshotRunning ? "回放中"
    : state.mcpSnapshot?.error ? "需重试"
      : execution.status === "completed" ? "已完成" : state.mcpSnapshot ? "已读取" : "读取中";
  const mcpTone = state.mcpSnapshotRunning ? "warn" : state.mcpSnapshot?.error ? "warn" : execution.status === "completed" ? "ok" : "info";
  const mcpDetail = state.mcpSnapshotRunning
    ? `只读调用 ${Math.min(state.mcpReplayIndex || 0, 4)}/4`
    : state.mcpSnapshot?.error ? "组织者只读快照暂时不可用" : execution.status === "completed" ? "四个工具调用已回放" : "服务端脱敏投影";
  const route = task?.demo_route || task?.route;
  const routeLabel = route?.completed === route?.total ? "闭环完成" : (current?.title || "准备进入路线");
  const routeDetail = route?.completed === route?.total ? "四站均已走过，可回看任一证据" : `完成后进入${(route?.next?.title || "下一站")}`;
  return {
    runtimeLabel, runtimeTone, runtimeDetail, mcpLabel, mcpTone, mcpDetail,
    routeLabel, routeDetail,
    humanLabel: "组织者确认", humanDetail: "发布、补正与最终验收停在人手中",
  };
}
function runStageReplayHtml(stage, signal) {
  const current = signal || {};
  const source = REVIEW_RUN_SOURCE[current.run_source] || REVIEW_RUN_SOURCE.unknown;
  const status = REVIEW_RUN_STATUS[current.status] || (signal ? "状态未知" : "尚未运行");
  const trace = Array.isArray(current.trace) ? current.trace : [];
  const deterministicTrace = trace.filter(item => String(item?.step || item?.tool || "").includes("deterministic")).length;
  const semanticTrace = trace.filter(item => String(item?.step || item?.tool || "").includes("semantic")).length;
  const pages = Number(current.pages_read) || 0;
  const gaps = Number(current.coverage_gaps) || 0;
  const pending = Number(current.pending_rules) || 0;
  const content = {
    materials: {
      label: "读取材料",
      title: pages ? `${pages} 页材料已进入检查范围` : signal ? "本次没有形成可用材料覆盖" : "等待读取运行摘要",
      detail: current.coverage_complete ? "覆盖完整，后续规则只引用已读材料。" : gaps ? `${gaps} 页未读或失败，系统不会把未读内容猜成通过。` : "先确认页数和覆盖状态，再进入程序核验。",
      next: current.coverage_complete ? "下一步：程序核验格式与必填项。" : "下一步：组织者补齐材料或转人工确认。",
    },
    deterministic: {
      label: "程序核验",
      title: `${Number(current.deterministic_rules) || 0} 项确定性规则已记录`,
      detail: `工具记录 ${deterministicTrace} 步；只检查格式、必填项和可计算条件，不替语义审核下结论。`,
      next: "下一步：把需要理解原文的规则交给语义审核或人工接手。",
    },
    semantic: {
      label: "语义审核",
      title: `${Number(current.semantic_rules) || 0} 项语义规则已记录`,
      detail: `${source.label}；工具记录 ${semanticTrace} 步，模型调用次数以运行账本为准。`,
      next: current.status === "success" ? "下一步：打开主体复核，逐条查看原文位置。" : "下一步：等待运行完成，或由组织者进入人工复核。",
    },
    human: {
      label: "人工接手",
      title: pending ? `${pending} 项需要组织者决定` : current.status === "failed" ? "本次运行需要人工接手" : "组织者保留最终决定权",
      detail: current.failure?.detail || (pending ? "待处理规则不会被自动标成通过。" : "发布、补正和最终验收始终由组织者确认。"),
      next: current.failure?.action || "下一步：进入证据复核，确认后再固定交付快照。",
    },
  }[stage] || {
    label: "运行阶段",
    title: status,
    detail: "当前阶段没有可用摘要。",
    next: "下一步：回到运行证据查看最近一次结果。",
  };
  return `<div class="demo-route-stage-replay-inner"><div><span class="eyebrow">${esc(content.label)} · ${esc(status)}</span><strong>${esc(content.title)}</strong><p>${esc(content.detail)}</p></div><span class="demo-route-stage-replay-next">${esc(content.next)}</span></div>`;
}
function agentQuickReadHtml(task, current, followUp) {
  const s = agentShowcaseState(task, current);
  const currentHref = current?.href || "#/tasks";
  const nextTitle = followUp?.title || current?.title || "当前路线";
  const nextDetail = followUp?.detail || "从当前站继续";
  const item = (step, tone, label, value, detail, id, action = "") => `<div class="demo-route-quick-item ${tone} ${id}"><span class="demo-route-quick-index" aria-hidden="true">${step}</span><span class="eyebrow">${esc(label)}</span><strong id="${id}-value">${esc(value)}</strong><small id="${id}-detail">${esc(detail)}</small>${action}</div>`;
  const runtimeAction = `<button class="demo-route-quick-link" type="button" onclick="jumpToAgentTour()">查看 Skill 与 Harness ${icon("arrow")}</button>`;
  const mcpAction = `<button class="demo-route-quick-link" type="button" onclick="jumpToMcpSnapshot()">查看只读账本 ${icon("arrow")}</button>`;
  return `<div class="demo-route-quick-read" role="group" aria-label="首屏快速读"><div class="demo-route-quick-lead"><span class="eyebrow">FIRST LOOK</span><strong>现在看什么</strong><small>按 01 → 04 读四个信号，再进入对应证据。</small></div>${item("01", "route", "当前焦点", s.routeLabel, s.routeDetail, "quick-route")}${item("02", s.runtimeTone, "Agent runtime", s.runtimeLabel, s.runtimeDetail, "quick-runtime", runtimeAction)}${item("03", s.mcpTone, "MCP 回放", s.mcpLabel, s.mcpDetail, "quick-mcp", mcpAction)}<div class="demo-route-quick-next"><span class="demo-route-quick-index" aria-hidden="true">04</span><span class="eyebrow">下一步</span><strong>${esc(nextTitle)}</strong><small>${esc(nextDetail)}</small><a href="${esc(currentHref)}">进入${esc(current?.title || nextTitle)} ${icon("arrow")}</a></div></div>`;
}
function demoRouteRoleSummaryHtml(id) {
  const path = (items) => items.map((label, i) => `${i ? `<i aria-hidden="true">${icon("arrow")}</i>` : ""}<span>${esc(label)}</span>`).join("");
  return `<div class="demo-route-role-summary" role="group" aria-label="双角色快速路径"><div class="demo-route-role-summary-head"><span class="eyebrow">两条体验路径</span><strong>评委可以先看哪一条？</strong><small>推荐顺序：先看组织者工作台，再回到这里看 Agent 运行证据，最后打开提交者回执。</small></div><div class="demo-route-role-summary-grid"><a class="demo-route-role-card organizer" href="#/workbench/${id}"><span class="demo-route-role-card-main"><span class="demo-route-role-icon">${icon("workbench")}</span><span><b>组织者</b><small>从要求到交付</small></span></span><span class="demo-route-role-path" aria-label="组织者路径">${path(["设计", "发凭证", "复核", "交付"])}</span><span class="demo-route-role-open">打开工作台 ${icon("arrow")}</span></a><a class="demo-route-role-card submitter" href="#/login?role=sub"><span class="demo-route-role-card-main"><span class="demo-route-role-icon">${icon("roster")}</span><span><b>提交者</b><small>从登录到回执</small></span></span><span class="demo-route-role-path" aria-label="提交者路径">${path(["登录", "填写", "正式提交", "核对"])}</span><span class="demo-route-role-open">打开提交者入口 ${icon("arrow")}</span></a></div></div>`;
}
function agentShowcaseHtml(task, current) {
  const s = agentShowcaseState(task, current);
  const signal = (task?.demo_route || task?.route)?.review_signal || null;
  const signalSource = REVIEW_RUN_SOURCE[signal?.run_source] || REVIEW_RUN_SOURCE.unknown;
  const signalStatus = REVIEW_RUN_STATUS[signal?.status] || (signal ? "状态未知" : "等待读取");
  const signalTone = signal?.status === "success" ? "ok" : signal?.status && ["failed", "retry_wait"].includes(signal.status) ? "warn" : "info";
  const failure = signal?.failure || null;
  const traceCount = Array.isArray(signal?.trace) ? signal.trace.length : 0;
  const runValue = signal?.run_id ? `运行 #${signal.run_id}` : "尚未形成运行";
  const runDetail = signal
    ? `${signalStatus} · ${failure?.title || signal.subject_name || "当前主体"}`
    : "等待服务端提供最近运行摘要";
  const sourceValue = signal ? signalSource.label : "尚未读取";
  const sourceDetail = signal ? signalSource.detail : "展示页不会根据配置状态猜测运行来源";
  const traceValue = signal ? `${traceCount} 步工具记录` : "等待工具记录";
  const traceDetail = signal
    ? `程序 ${signal.deterministic_rules || 0} · 语义 ${signal.semantic_rules || 0} · 待人工 ${signal.pending_rules || 0}`
    : "Skill / Harness 状态将在运行摘要到达后显示";
  const reviewAction = signal?.review_href
    ? `<a class="demo-route-live-proof-action" href="${esc(signal.review_href)}">${signal.status === "success" ? "打开" : signal.status === "failed" ? "进入人工复核" : "查看"}${signal.status === "failed" ? "" : esc(signal.subject_name || "当前主体")}${signal.status === "success" ? "复核" : signal.status === "failed" ? "" : "运行状态"} ${icon("arrow")}</a>`
    : `<span class="demo-route-live-proof-empty">主体级入口将在有授权提交后出现</span>`;
  const currentHref = current?.href || "#/tasks";
  const item = (step, tone, iconName, label, value, detail, id, action = "") => `<div class="demo-route-live-item ${tone}"><span class="demo-route-live-step" aria-hidden="true">${step}</span><span class="demo-route-live-icon">${icon(iconName)}</span><div><span class="eyebrow">${esc(label)}</span><strong id="${id}-value">${esc(value)}</strong><small id="${id}-detail">${esc(detail)}</small>${action}</div></div>`;
  const routeAction = `<a class="demo-route-live-action" href="${esc(currentHref)}">进入当前站 ${icon("arrow")}</a>`;
  const runtimeAction = `<button class="demo-route-live-action" type="button" onclick="jumpToAgentTour()">查看运行边界 ${icon("arrow")}</button>`;
  const mcpAction = `<button class="demo-route-live-action" type="button" onclick="jumpToMcpSnapshot()">查看回放 ${icon("arrow")}</button>`;
  const humanAction = `<button class="demo-route-live-action" type="button" onclick="jumpToAgentTour()">查看接管边界 ${icon("arrow")}</button>`;
  const chain = [
    ["01", "route", "arrow", "当前路线", s.routeLabel, s.routeDetail, "showcase-route", routeAction],
    ["02", s.runtimeTone, "sparkle", "Agent runtime", s.runtimeLabel, s.runtimeDetail, "showcase-runtime", runtimeAction],
    ["03", s.mcpTone, "expand", "MCP 只读回放", s.mcpLabel, s.mcpDetail, "showcase-mcp", mcpAction],
    ["04", "human", "workbench", "人工接管", s.humanLabel, s.humanDetail, "showcase-human", humanAction],
  ];
  const activeRun = ["queued", "running", "retry_wait"].includes(signal?.status);
  const failedRun = signal?.status === "failed";
  const stageAction = signal?.status === "success" ? "查看对应证据" : failedRun ? "查看失败详情" : "查看运行状态";
  const runStages = signal ? [
    {key: "materials", label: "读取材料", value: signal.pages_read ? `${signal.pages_read} 页已读` : activeRun ? (signal.status === "retry_wait" ? "等待重试" : "排队中") : failedRun ? "未完成" : "尚未读取", tone: signal.pages_read ? "done" : failedRun ? "failed" : "waiting", detail: signal.coverage_complete && signal.status === "success" ? "覆盖完整" : signal.coverage_gaps ? `${signal.coverage_gaps} 页待确认` : activeRun ? "运行摘要尚未到达" : "没有可用覆盖摘要"},
    {key: "deterministic", label: "程序核验", value: signal.deterministic_rules ? `${signal.deterministic_rules} 项已记` : activeRun ? "等待运行" : "无程序规则", tone: signal.deterministic_rules ? "done" : failedRun ? "failed" : "waiting", detail: activeRun ? "运行完成后确认格式与必填项" : "格式与必填项"},
    {key: "semantic", label: "语义审核", value: signal.semantic_rules ? `${signal.semantic_rules} 项已记` : activeRun ? (signal.status === "retry_wait" ? "等待重试" : "等待运行") : failedRun ? "未完成" : "尚未执行", tone: signal.semantic_rules ? (signalSource.tone === "offline" ? "offline" : "done") : failedRun ? "failed" : "waiting", detail: signal.semantic_rules ? signalSource.label : activeRun ? "Skill 尚未返回语义结果" : failedRun ? "本次运行没有完成" : "等待 Skill 运行"},
    {key: "human", label: "人工接手", value: signal.pending_rules ? `${signal.pending_rules} 项待处理` : activeRun ? "运行结束后确认" : failedRun ? "先处理运行失败" : "可继续交付", tone: signal.pending_rules ? "handoff" : activeRun || failedRun ? "waiting" : "done", detail: signal.pending_rules ? "结论停在人手中" : activeRun ? "运行完成后再决定是否交付" : failedRun ? (failure?.action || "组织者决定重试或进入复核") : "没有未决规则"},
  ] : [
    {key: "materials", label: "读取材料", value: "等待运行", tone: "waiting", detail: "服务端摘要到达后显示"},
    {key: "deterministic", label: "程序核验", value: "等待运行", tone: "waiting", detail: "服务端摘要到达后显示"},
    {key: "semantic", label: "语义审核", value: "等待运行", tone: "waiting", detail: "不根据配置猜测结果"},
    {key: "human", label: "人工接手", value: "由组织者决定", tone: "handoff", detail: "发布与验收始终在人手中"},
  ];
  const initialStage = signal?.status === "failed" ? "human" : "materials";
  const timeline = `<div class="demo-route-live-timeline" role="group" aria-label="当前复核运行阶段"><div class="demo-route-live-timeline-head"><span class="eyebrow">RUN STAGES</span><small>${signal ? esc(`${signalStatus} · 四段执行链`) : "等待最近运行摘要"}</small></div><ol>${runStages.map((stage, index) => `<li class="${stage.tone}${stage.key === initialStage ? " selected" : ""}"><button type="button" data-run-stage="${esc(stage.key)}" onclick="jumpToRunStage('${stage.key}')" aria-current="${stage.key === initialStage ? "step" : "false"}"><span class="demo-route-live-timeline-index">0${index + 1}</span><span class="demo-route-live-timeline-copy"><b>${esc(stage.label)}</b><strong>${esc(stage.value)}</strong><small>${esc(stage.detail)}</small><span class="demo-route-live-timeline-action">${esc(stageAction)} ${icon("arrow")}</span></span></button></li>`).join("")}</ol><div id="demo-route-stage-detail" class="demo-route-stage-replay" role="status" aria-live="polite" data-stage="${initialStage}">${runStageReplayHtml(initialStage, signal)}</div></div>`;
  const proof = `<div class="demo-route-live-proof" role="group" aria-label="当前运行证据"><div class="demo-route-live-proof-lead"><span class="eyebrow">RUN EVIDENCE PULSE</span><strong>真实运行证据</strong><small>只读聚合当前服务端摘要；原文和参数仍留在授权复核页。</small></div><div class="demo-route-live-proof-cell ${signalTone}"><span>当前 run</span><b>${esc(runValue)}</b><small>${esc(runDetail)}</small></div><div class="demo-route-live-proof-cell"><span>来源</span><b>${esc(sourceValue)}</b><small>${esc(sourceDetail)}</small></div><div class="demo-route-live-proof-cell"><span>Skill / Harness</span><b>${esc(traceValue)}</b><small>${esc(traceDetail)}</small></div><div class="demo-route-live-proof-cell action"><span>证据入口</span>${reviewAction}</div></div>`;
  return `<section class="demo-route-live" aria-label="现场 Agent 运行链"><div class="demo-route-live-head"><span class="eyebrow">LIVE SHOWCASE STATE</span><strong>一条运行链</strong><button class="link" type="button" onclick="jumpToAgentTour()">展开 Agent 导览 ${icon("arrow")}</button></div><div class="demo-route-live-grid">${chain.map(args => item(...args)).join("")}</div>${timeline}${proof}</section>`;
}
function paintAgentShowcase() {
  const task = demoRouteTask(state.tasks);
  const route = task?.demo_route || task?.route;
  const steps = route?.steps || [];
  const current = route?.current || steps.find(s => s.status === "current") || steps.find(s => s.status !== "done") || steps[0];
  const s = agentShowcaseState(task, current);
  const values = {
    "showcase-route": [s.routeLabel, s.routeDetail],
    "showcase-runtime": [s.runtimeLabel, s.runtimeDetail],
    "showcase-mcp": [s.mcpLabel, s.mcpDetail],
    "showcase-human": [s.humanLabel, s.humanDetail],
  };
  for (const [id, [value, detail]] of Object.entries(values)) {
    const valueEl = document.getElementById(`${id}-value`);
    const detailEl = document.getElementById(`${id}-detail`);
    if (valueEl) valueEl.textContent = value;
    if (detailEl) detailEl.textContent = detail;
  }
  const quickValues = {
    "quick-route": [s.routeLabel, s.routeDetail],
    "quick-runtime": [s.runtimeLabel, s.runtimeDetail],
    "quick-mcp": [s.mcpLabel, s.mcpDetail],
  };
  for (const [id, [value, detail]] of Object.entries(quickValues)) {
    const valueEl = document.getElementById(`${id}-value`);
    const detailEl = document.getElementById(`${id}-detail`);
    if (valueEl) valueEl.textContent = value;
    if (detailEl) detailEl.textContent = detail;
  }
  const quickTone = document.querySelector?.(".demo-route-quick-item.quick-runtime");
  if (quickTone) quickTone.className = `demo-route-quick-item quick-runtime ${s.runtimeTone}`;
  const quickMcpTone = document.querySelector?.(".demo-route-quick-item.quick-mcp");
  if (quickMcpTone) quickMcpTone.className = `demo-route-quick-item quick-mcp ${s.mcpTone}`;
}
function demoRouteHtml(task) {
  if (!task || task.id == null) return "";
  const id = encodeURIComponent(task.id);
  const fallback = [
    {key: "design", title: "整理要求", detail: "把一句话变成可核对蓝图", owner: "Agent + 人确认", ownerTone: "agent", href: `#/design/${id}`, icon: "design", tone: "route-design"},
    {key: "roster", title: "发放凭证", detail: "安排提交对象与访问边界", owner: "程序执行", ownerTone: "system", href: `#/roster/${id}`, icon: "roster", tone: "route-roster"},
    {key: "review", title: "检查并接手", detail: "看证据，必要时人工判断", owner: "Agent → 人", ownerTone: "human", href: `#/workbench/${id}`, icon: "review", tone: "route-review"},
    {key: "delivery", title: "固定交付", detail: "只导出已验收的正式版本", owner: "程序快照", ownerTone: "system", href: `#/delivery/${id}`, icon: "delivery", tone: "route-delivery"},
  ];
  const route = task.demo_route || task.route;
  const steps = (route?.steps || fallback).map((s, i) => ({...fallback[i], ...s,
    icon: s.icon || DEMO_ROUTE_ICONS[s.key] || fallback[i].icon,
    owner: s.owner || fallback[i].owner,
    ownerTone: s.ownerTone || fallback[i].ownerTone,
    tone: s.tone || `route-${s.key}`, status: s.status || "upcoming"}));
  const routeProgress = route ? `${route.completed}/${route.total} 站已完成` : "按顺序查看四站";
  const next = route?.next || steps.find(s => s.status !== "done") || steps[0];
  const routeCurrent = route?.current;
  const current = routeCurrent
    ? {...routeCurrent, key: routeCurrent.key || steps.find(s => s.href === routeCurrent.href || s.title === routeCurrent.title)?.key}
    : steps.find(s => s.status === "current") || next;
  const followUp = steps.find(s => s.status === "upcoming") || steps.find(s => s.status === "blocked") || current;
  const completed = route ? Math.max(0, Math.min(Number(route.completed) || 0, Number(route.total) || steps.length)) : 0;
  const total = route ? Math.max(1, Number(route.total) || steps.length) : steps.length;
  const progressPct = Math.round((completed / total) * 100);
  const focusLabel = route && route.completed === route.total ? "闭环已完成" : `现在处理：${current.title}`;
  const fallbackNotice = task.demo_route_source === "fallback"
    ? `<div class="demo-route-notice" role="status"><span>${esc(task.demo_route_error || "实时路线状态暂时不可用，下面保留已加载的展示路径。")}</span><button class="link" type="button" onclick="viewTasks()">重新读取状态</button></div>`
    : "";
  const audienceHtml = `<div class="demo-route-audience" role="group" aria-label="双角色体验"><div class="demo-route-audience-head"><span class="eyebrow">双角色体验</span><strong>同一任务，两个入口</strong><span>组织者看状态与证据，提交者完成材料与回执。</span></div><div class="demo-route-lanes"><article class="demo-route-lane organizer"><div class="demo-route-lane-top"><span class="demo-route-lane-icon">${icon("workbench")}</span><span class="demo-route-lane-kicker">组织者</span></div><strong>从要求到交付</strong><p>设计蓝图、发放凭证、复核证据，最后固定 CSV + ZIP。</p><span class="demo-route-lane-flow">设计 → 凭证 → 复核 → 交付</span><a href="#/workbench/${id}">回到组织者工作台 ${icon("arrow")}</a></article><article class="demo-route-lane submitter"><div class="demo-route-lane-top"><span class="demo-route-lane-icon">${icon("roster")}</span><span class="demo-route-lane-kicker">提交者</span></div><strong>从凭证到回执</strong><p>打开提交空间，保存草稿，正式提交后查看回执和补正。</p><span class="demo-route-lane-flow">登录 → 填写 → 提交 → 核对</span><a href="#/login?role=sub">打开提交者入口 ${icon("arrow")}</a></article></div></div>`;
  const focusMeta = demoRouteStageMeta(current);
  const evidence = demoRouteEvidence(current, task.id);
  const evidenceHtml = evidence
    ? `<a class="demo-route-focus-evidence" href="${esc(evidence.href)}">${esc(focusMeta.evidence)} ${icon("arrow")}<span>${esc(evidence.label)}</span></a>`
    : `<strong>${esc(focusMeta.evidence)}</strong>`;
  const focusHtml = `<div class="demo-route-focus demo-route-command"><div class="demo-route-focus-main"><span class="eyebrow">从这里开始 · 当前焦点</span><strong>${esc(current.title)}</strong><p>${esc(current.detail || "从这里继续查看任务状态")}</p><span class="demo-route-focus-goal"><b>这一站要做到</b>${esc(focusMeta.goal)}</span></div><div class="demo-route-focus-next"><span class="eyebrow">完成后</span><strong>${esc(followUp.title)}</strong><span>${esc(followUp.detail || "继续下一站")}</span></div><a class="button-link" href="${current.href}">进入${esc(current.title)} ${icon("arrow")}</a><div class="demo-route-focus-meta" role="group" aria-label="当前站职责与证据"><div><span>决定边界</span><strong>${esc(focusMeta.boundary)}</strong></div><div><span>证据入口</span>${evidenceHtml}</div><div><span>完成标志</span><strong>${esc(focusMeta.finish)}</strong></div></div>${demoRouteCueHtml(current)}</div>`;
  const stepsHtml = `<div class="demo-route-steps">${steps.map((s, i) => `<a class="demo-route-step ${s.tone} ${s.status}" href="${s.href}" aria-current="${s.status === "current" ? "step" : "false"}"><span class="demo-route-index">${String(i + 1).padStart(2, "0")}</span><span class="demo-route-icon">${s.status === "done" ? icon("check") : icon(s.icon)}</span><span class="demo-route-copy"><b>${esc(s.title)} <em>${esc(DEMO_ROUTE_STATUS[s.status] || s.status)}</em></b><span>${esc(s.detail)}</span><small class="demo-route-owner ${esc(s.ownerTone || "system")}">${esc(s.owner || "流程")}</small></span><span class="demo-route-arrow">${icon("arrow")}</span></a>`).join("")}</div>`;
  const taskContext = `<div class="presentation-task-context" role="group" aria-label="当前演示任务"><div class="presentation-task-main"><span class="eyebrow">当前演示任务</span><strong>${esc(task.name)}</strong><span>任务 #${esc(task.id)} · ${esc(task.mode === "open" ? "开放报名" : "固定名册")}</span></div><div class="presentation-task-focus"><span class="eyebrow">现在处理</span><strong>${esc(current.title)}</strong><span>${esc(current.detail || "沿当前路线继续")}</span></div><div class="presentation-task-actions"><a class="button-link" href="${current.href}">进入当前站 ${icon("arrow")}</a><button class="link" type="button" aria-label="退出展示视图并查看我的任务" onclick="showTaskListFromPresentation()">${icon("tasks")} 查看我的任务</button></div></div>`;
  const compactEvidence = typeof window !== "undefined" && !!window.matchMedia?.("(max-width:700px)")?.matches;
  const evidenceFold = `<details class="demo-route-evidence-fold"${compactEvidence ? "" : " open"}><summary aria-expanded="${compactEvidence ? "false" : "true"}><span><b>查看 Skill、Harness 与运行证据</b><small>Agent Control Plane · Live Showcase · Run Stages · Run Evidence Pulse</small></span><span class="demo-route-evidence-fold-mark">${compactEvidence ? "展开" : "已展开"} ${icon("arrow")}</span></summary><div class="demo-route-evidence-fold-body">${agentArchitectureRailHtml(task)}${agentShowcaseHtml(task, current)}</div></details>`;
  return `<section class="demo-route" aria-label="展示路线">${taskContext}<div class="demo-route-head"><div><div class="eyebrow">DEMO ROUTE · 4 STOPS</div><h2>三分钟看懂一次收集</h2><p>按顺序点过四站，就能看到 FormFlow 如何把要求、证据和交付串起来。</p></div><span class="badge brand" title="${esc(task.name)}">${esc(task.name)} · ${esc(TASK_STATUS[task.status] || task.status)}</span></div>${demoRouteRoleSummaryHtml(id)}${agentQuickReadHtml(task, current, followUp)}${fallbackNotice}<div class="demo-route-progress"><span><b>${esc(routeProgress)}</b></span><span>${esc(focusLabel)}</span></div><div class="demo-route-meter" role="progressbar" aria-label="展示路线进度" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${completed}"><i style="width:${progressPct}%"></i></div>${focusHtml}${evidenceFold}${demoRouteSignalHtml(route?.review_signal)}${stepsHtml}${audienceHtml}<div class="demo-route-foot"><span><i class="demo-route-pulse"></i>使用虚构种子数据，所有决定都可回到原文证据</span><a href="${next.href}">${esc(route && route.completed === route.total ? "重新查看需求设计" : `进入${next.title}`)} ${icon("arrow")}</a></div></section>`;
}
function renderDemoRoute(tasks = state.tasks) {
  const box = document.getElementById("demo-route");
  if (!box) return;
  box.innerHTML = demoRouteHtml(demoRouteTask(tasks));
  paintAgentArchitecture();
  paintAgentShowcase();
  applyPresentationMode();
  if (state.presentationMode && !state.presentationStartAligned) {
    state.presentationStartAligned = true;
    const align = () => window?.scrollTo?.({top: 0, left: 0, behavior: "auto"});
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(align);
    else setTimeout(align, 0);
  }
}
async function loadDemoRoute(task) {
  if (!task || task.id == null) return;
  try {
    const route = await api(`/api/tasks/${task.id}/demo-route`);
    if (document.body.dataset.page !== "tasks") return;
    task.demo_route = route;
    task.demo_route_source = "server";
    task.demo_route_error = "";
    if (demoRouteTask(state.tasks)?.id === task.id) renderDemoRoute(state.tasks);
  } catch (e) {
    // Keep the route useful during a short outage, but make the stale source explicit.
    task.demo_route_source = "fallback";
    task.demo_route_error = "实时路线状态暂时不可用，下面保留已加载的展示路径。";
    if (document.body.dataset.page === "tasks" && demoRouteTask(state.tasks)?.id === task.id) renderDemoRoute(state.tasks);
  }
}
function paintWorkspaceAgentStatus() {
  const mode = document.getElementById("workspace-agent-mode");
  const status = document.getElementById("workspace-agent-status");
  const tourMode = document.getElementById("agent-tour-mode");
  const tourStatus = document.getElementById("agent-tour-availability");
  if (!mode || !status) return;
  const paintTour = (label, text, tone = "") => {
    if (tourMode) { tourMode.className = `runtime-mode ${tone}`.trim(); tourMode.textContent = label; }
    if (tourStatus) tourStatus.textContent = text;
  };
  mode.className = "runtime-mode";
  if (state.llmConfigured === false) {
    mode.classList.toggle("offline", true);
    mode.textContent = "离线演示";
    status.textContent = "没有模型密钥：可继续查看模板、已有结果和程序流程；新的需求起草会明确停下。";
    paintTour("离线演示", "当前没有模型密钥：程序规则、已有结果和人工接手仍可完整演示。", "offline");
    paintAgentRuntimeContractIssue(agentRuntimeContractWarning);
    paintAgentShowcase();
    return;
  }
  if (state.llmConfigured === true) {
    mode.classList.toggle("online", true);
    mode.textContent = "模型已接入";
    status.textContent = "模型已接入；当前任务的复核来源以运行摘要为准，配置状态不代表这次结果一定调用实时模型。";
    paintTour("模型已接入", "当前已配置模型密钥；每次复核是否调用实时模型，以运行记录中的来源标记为准。", "online");
    paintAgentRuntimeContractIssue(agentRuntimeContractWarning);
    paintAgentShowcase();
    return;
  }
  mode.textContent = "读取状态…";
  status.textContent = "正在读取当前模型配置；已有任务和程序流程仍可查看。";
  paintTour("运行状态读取中", "正在读取模型配置；已有任务和程序流程仍可查看。", "");
  paintAgentShowcase();
}
async function checkWorkspaceLLMStatus() {
  try {
    const r = await api("/api/config/status");
    state.llmConfigured = !!r.llm_configured;
  } catch (e) {
    state.llmConfigured = null;
  }
  paintWorkspaceAgentStatus();
}
function filterTasks(filter) {
  state.taskFilter = filter;
  document.querySelectorAll("[data-filter]").forEach(el => { el.classList.toggle("active", el.dataset.filter === filter); el.setAttribute("aria-pressed", String(el.dataset.filter === filter)); });
  paintTasks();
}
function paintTasks() {
  const q = (document.getElementById("task-search")?.value || "").trim().toLowerCase();
  const tasks = state.tasks.filter(t => t.name.toLowerCase().includes(q) && (state.taskFilter === "all" || (state.taskFilter === "done" ? ["closed","archived","cancelled"].includes(t.status) : t.status === state.taskFilter)));
  document.getElementById("task-list").innerHTML = tasks.length ? `<div class="task-list-head"><span>收集任务</span><span>状态</span><span>创建日期</span><span>操作</span></div>` + tasks.map(t => `<article class="task-item"><div class="task-name-cell"><div class="task-icon ${t.status === 'draft' ? 'draft' : ''}">${icon(t.status === 'draft' ? 'design' : 'workbench')}</div><div><a class="task-name" title="${esc(t.name)}" href="#/${t.status === 'draft' ? 'design' : 'workbench'}/${t.id}">${esc(t.name)}</a><div class="task-meta">${t.mode === 'roster' ? '固定名册' : '开放报名'}<span>·</span>任务 #${t.id}</div></div></div><div><span class="badge ${t.status === 'collecting' ? 'ok' : t.status === 'draft' ? 'warn' : ''}"><span class="badge-dot"></span>${esc(TASK_STATUS[t.status] || t.status)}</span></div><time>${esc((t.created_at || '').slice(0,10) || '—')}</time><a class="task-enter" href="#/${t.status === 'draft' ? 'design' : 'workbench'}/${t.id}">${t.status === 'draft' ? '继续设计' : '进入任务'} ${icon('arrow')}</a></article>`).join('') : `<div class="empty-state"><div class="empty-icon">${icon('tasks')}</div><h3>${q || state.taskFilter !== 'all' ? '没有符合条件的任务' : '你的第一个收集任务，从这里开始'}</h3><p>${q || state.taskFilter !== 'all' ? '试试其他关键词或状态。' : '创建任务后，小齐会协助你整理材料要求。'}</p>${!state.tasks.length ? '<button onclick="openDialog(&quot;create-dialog&quot;, this)">新建收集任务</button>' : ''}</div>`;
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
function designInputKey() {
  return state.designOwnerId != null && state.designTaskId != null
    ? `ff_design:${state.designOwnerId}:${state.designTaskId}` : null;
}
function readDesignInputs() {
  const key = designInputKey(); if (!key) return {versions:{}};
  state.localDesignInputs ||= {};
  try {
    const raw = state.localDesignInputs[key] || sessionStorage.getItem(key);
    const value = raw ? JSON.parse(raw) : {versions:{}};
    return value && typeof value.versions === 'object' && value.versions ? value : {versions:{}};
  } catch (e) { state.designCacheFailed = true; return {versions:{}}; }
}
function writeDesignInputs(value) {
  const key = designInputKey(); if (!key) return;
  state.localDesignInputs ||= {};
  state.localDesignInputs[key] = JSON.stringify(value);
  try { sessionStorage.setItem(key, JSON.stringify(value)); state.designCacheFailed = false; }
  catch (e) { state.designCacheFailed = true; }
}
function hasDesignInput(value) {
  return !!value && [value.composer, value.extra, ...Object.values(value.answers || {})].some(x => String(x || '').trim());
}
function collectDesignInputs() {
  return {composer:document.getElementById('chat-in')?.value || '',
    answers:Object.fromEntries((state.designQuestions || []).map((q,i) => [q.question,document.getElementById(`clar-${i}`)?.value || ''])),
    extra:document.getElementById('clar-extra')?.value || ''};
}
function canPublishDesign() {
  const bp=state.draft?.blueprint;
  return !!(state.bpId && bp && (bp.fields?.length || bp.slots?.length || bp.rules?.length)
    && !state.agentBusy && !state.designLoadFailed && !state.viewingVersion && !state.designNeedsRevision
    && state.draftStatus !== 'published' && !(state.designBlocking || []).length && !state.designDirty);
}
function paintDesignInputState() {
  const hint=document.getElementById('design-input-hint');
  if (hint) hint.textContent=state.designCacheFailed
    ? '浏览器暂存不可用：输入仅在内存中，刷新或关闭前请复制保留。'
    : state.designDirty ? '有未发送内容；已在本标签页暂存，尚未进入服务器草案。发送处理或手动清空后可发布。'
    : '当前输入为空；生成的草案保存在服务器，未发送输入仅在本标签页暂存。';
  const badge=document.getElementById('draft-state');
  if(badge)badge.textContent=badge.textContent.replace(/ · 有未发送内容$/, '')+(state.designDirty ? ' · 有未发送内容' : '');
  document.querySelectorAll('[data-publish]').forEach(el=>el.disabled=!canPublishDesign());
  paintDesignProgress();
}
function cacheDesignInputs() {
  if (!designInputKey() || !document.getElementById('chat-in') || state.designToken !== orgToken()) return;
  const value=collectDesignInputs(), saved=readDesignInputs();
  if(hasDesignInput(value))saved.versions[String(state.designBaseId || 0)]=value;
  else delete saved.versions[String(state.designBaseId || 0)];
  writeDesignInputs(saved); state.designDirty=hasDesignInput(value); paintDesignInputState();
}
function designInputText(value) {
  return [value.composer,...Object.entries(value.answers || {}).filter(([,v])=>String(v).trim()).map(([q,v])=>`${q}：${v}`),value.extra].filter(Boolean).join('\n');
}
function restoreDesignInputs() {
  if (!designInputKey() || state.designToken !== orgToken()) return;
  const saved=readDesignInputs(), base=String(state.designBaseId || 0), value=saved.versions[base] || {};
  const input=document.getElementById('chat-in'); if (input) input.value=value.composer || '';
  (state.designQuestions || []).forEach((q,i)=>{const el=document.getElementById(`clar-${i}`);if(el) el.value=value.answers?.[q.question] || '';});
  const extra=document.getElementById('clar-extra');if(extra)extra.value=value.extra || '';
  state.designDirty=hasDesignInput(value);paintDesignInputState();
  const old=Object.entries(saved.versions).filter(([id,v])=>/^\d+$/.test(id) && id!==base && hasDesignInput(v));
  const box=document.getElementById('design-recovery');
  if(box) box.innerHTML=old.length ? `<details class="notice-warn"><summary>另有 ${old.length} 份旧草案的未发送内容，尚未应用到当前草案</summary>${old.map(([id,v])=>`<p><b>${id==='0' ? '生成草案前的输入' : '历史草案 v'+((state.designVersions || []).find(x=>String(x.id)===id)?.version || '—')+' 的未发送输入'}</b></p><pre class="source-text">${esc(designInputText(v))}</pre><button class="ghost sm" onclick="recoverDesignInput('${id}')">复制为当前修改意见</button>`).join('')}</details>` : '';
}
function recoverDesignInput(base) {
  if(state.agentBusy || state.viewingVersion) return;
  const saved=readDesignInputs(), value=saved.versions[base];if(!value)return;
  const input=document.getElementById('chat-in');
  input.value=[input.value,designInputText(value)].filter(Boolean).join('\n\n');
  delete saved.versions[base];writeDesignInputs(saved);cacheDesignInputs();restoreDesignInputs();input.focus();
}
function consumeDesignInput(base, sent, source) {
  const saved=readDesignInputs();
  if(JSON.stringify(saved.versions[String(base || 0)])===JSON.stringify(sent)) {
    saved.versions[String(base || 0)]=source==='clarifications'
      ? {...sent,answers:{},extra:''} : {...sent,composer:''};writeDesignInputs(saved);
  }
}
async function viewDesign(taskId) {
  cacheDesignInputs();
  const epoch = ++state.designEpoch, token = orgToken();
  Object.assign(state,{designTaskId:taskId,designOwnerId:null,designToken:token,designBaseId:0,designQuestions:[],designRenderedBase:null,designDirty:false,designCacheFailed:false,designNeedsRevision:false});
  Object.assign(state, {taskId, chat: [], bpId: null, draft: null, requirement: "", answeredDone: false, draftStatus: "draft", draftVersionId: null, designLoadFailed: false, retryRequest: null, agentRequest: null, agentRequestPollTimer: 0, agentResumeStarted: false, agentRequestDisplayedId: null, designTab: "preview", agentBusy: false, designBlocking: [], designAdvisories: [], designVersions: [], designHistory: [], viewingVersion: null, viewingPublished: null, viewingImpact: null});
  document.getElementById("app").innerHTML = `<div class="breadcrumb"><a href="#/tasks">我的任务</a><span>/</span><span id="design-name">收集任务 #${taskId}</span></div>
    ${showcaseReturnHtml("需求设计")}
    <div class="page-heading design-heading"><div><div class="eyebrow">COLLECTION DESIGN</div><h1>把要求，变成好用的收集表</h1><p>左边一起梳理需求，右边实时核对。确认无误后再发布。</p></div><span class="badge brand" id="draft-state">正在加载…</span></div>
    <div id="flash" role="status" aria-live="polite"></div>
    <div id="agent-request-status" aria-live="polite"></div>
    <div id="llm-status-banner" class="llm-banner" style="display:none"></div>
    <div class="step-flow"><span class="st on"><span class="dot">1</span>描述需求</span><span class="arw"></span><span class="st" id="st-2"><span class="dot">2</span>核对与澄清</span><span class="arw"></span><span class="st" id="st-3"><span class="dot">3</span>确认发布</span><span class="step-hint">草案存在服务器上；没发出去的内容只留在当前标签页</span></div>
    <nav class="design-jump-nav" aria-label="需求设计区域"><button type="button" onclick="jumpToDesignSection('design-chat')">${icon("sparkle")} 和小齐整理</button><button type="button" onclick="jumpToDesignSection('draft-panel')">${icon("review")} 核对收集表</button></nav>
    <div id="design-recovery"></div><div class="grid-chat"><section id="design-chat" class="card agent-panel"><div class="agent-heading"><span class="agent-mark">${icon("sparkle")}</span><div><h2>小齐 <span>需求设计助手</span></h2><p id="agent-status">正在准备…</p></div><span class="agent-live"></span></div>
      <div class="chat"><div class="chat-scroll" id="chat-scroll" role="log" aria-label="需求对话" aria-live="polite"></div><div class="composer"><div class="chips" id="chat-chips"></div>
      <label class="sr-only" for="chat-in">告诉小齐你的收集要求</label><textarea id="chat-in" oninput="cacheDesignInputs()" placeholder="例如：收一份团课 PDF 报告，登记姓名和班级…" onkeydown="if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();chatSend()}"></textarea>
      <div class="composer-foot"><span>Enter 发送 · Shift + Enter 换行</span><button id="chat-send" onclick="chatSend()" aria-label="发送需求">发送 ${icon('arrow')}</button></div><p class="field-help" id="design-input-hint" role="status"></p></div></div>${designRuntimeHtml()}${designProgressHtml()}
    </section><section id="draft-panel" aria-label="实时收集表预览"></section></div>
    <dialog id="publish-dialog" aria-labelledby="publish-title"><form onsubmit="event.preventDefault();confirmPublish()"><div class="eyebrow">REVIEW & PUBLISH</div><h2 id="publish-title" tabindex="-1">确认这份收集要求</h2><p>发布后，这个版本的字段、材料和规则会被冻结。后续修改将产生新版本。</p><div id="publish-summary"></div><label class="check-label"><input type="checkbox" id="publish-consent" required>我已核对上方要求与数据处理说明，并按实际约定确认未填写项</label><div class="dialog-actions"><button type="button" class="ghost" onclick="this.closest('dialog').close()">返回核对</button><button type="submit" id="publish-confirm">确认并发布</button></div><div id="publish-error" role="alert" class="inline-error"></div></form></dialog>`;
  setAgentBusy(true, "正在加载"); renderDraftPanel();
  try {
    const r = await api(`/api/tasks/${taskId}/design`);
    if (epoch !== state.designEpoch || token !== orgToken()) return;
    state.task = r.task; state.designOwnerId=r.task.owner_id;
    state.designPublished=r.published;state.designPublishImpact=r.publish_impact;
    document.getElementById("design-name").textContent = r.task.name;
    const pendingAgentRequest = readDesignInputs().pendingAgentRequest;
    if (pendingAgentRequest?.requestId && !state.agentRequest) state.agentRequest = pendingAgentRequest;
    if (r.blueprint_version_id) {
      applyDraft(r); state.requirement = r.source_text || "";
      const when = r.versions && r.versions[0] ? fmtTime(r.versions[0].created_at) : "";
      agentSay(`已恢复这项任务的${r.status === 'published' ? '已发布蓝图' : '最新草案'} v${r.version}。`,
        `${when ? `最后保存于 ${esc(when)}。` : ''}右边可以实时预览，有什么要调整的继续告诉我就行。`);
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
      agentSay('我会先帮你整理草案，只追问影响收集的关键信息。', '不确定的地方会标出来，未经你确认不会发布，也不会暗加材料门槛。');
    }
  } catch(e) { if (epoch === state.designEpoch) { state.designLoadFailed = true; setFlash('草案没能加载：' + e.message + '。请重新打开这个页面，以免覆盖已有的设计。'); } }
  finally {
    if (epoch === state.designEpoch && token === orgToken()) {
      setAgentBusy(false); renderChips(); renderDraftPanel(); restoreDesignInputs();
      resumePendingAgentRequest(epoch, token);
      loadAgentRuntime(taskId);
      checkLLMStatus();
    }
  }
}
async function checkLLMStatus() {
  try {
    const r = await api("/api/config/status");
    state.llmConfigured = !!r.llm_configured;
    paintAgentRuntime();
    paintWorkspaceAgentStatus();
    if (!r.llm_configured) {
      const el = document.getElementById("llm-status-banner");
      if (el) { el.style.display = ""; el.innerHTML = '<span class="llm-banner-icon">ⓘ</span><span>当前没有配置 AI 模型密钥，所以智能起草暂时用不了。不过你可以用下面的模板快速开始，或者直接手动编辑草案。</span>'; }
    }
  } catch(e) { paintAgentRuntime(); paintWorkspaceAgentStatus(); /* silently skip */ }
}
function applyDraft(r) {
  if(state.bpId !== r.blueprint_version_id) state.designNeedsRevision=false;
  state.bpId = r.blueprint_version_id; state.draft = r.draft;
  state.designBaseId=state.bpId || 0;state.designQuestions=r.draft.clarifications || [];
  state.draftVersionId = r.version || state.draftVersionId;
  state.draftStatus = r.status || 'draft';
  state.answeredDone = !(r.draft.clarifications || []).length;
  if (r.blocking) state.designBlocking = r.blocking;
  if (r.advisories) state.designAdvisories = r.advisories;
  if (r.versions) state.designVersions = r.versions;
  if (r.history) state.designHistory = r.history;
  if ('published' in r) state.designPublished=r.published;
}
function agentWaitCopy() {
  const elapsed = state.agentRequest?.createdAt ? Math.max(0, Date.now() - state.agentRequest.createdAt) : 0;
  if (elapsed > 120000) return '这次内容比较多，模型还在想。你的输入和草案都保留着，可以先做别的，回来再看结果。';
  if (elapsed > 45000) return '还在整理中，正在确认结果有没有完整传回来，不会拿半份结果覆盖已有的草案。';
  if (state.agentRequest?.status === 'queued') return '内容已收到，正在排队等小齐开始处理。';
  if (state.agentRequest?.status === 'running') return '小齐正在整理字段和规则，好了会在这里更新。';
  return '正在连接服务器确认进度，断线的话会按同一个请求继续查，不会重复生成。';
}
function setAgentBusy(on, label = "正在整理") {
  state.agentBusy = on;
  const locked=on || !!state.viewingVersion || state.designLoadFailed;
  document.getElementById('chat-send')?.toggleAttribute('disabled', locked);
  document.getElementById('chat-in')?.toggleAttribute('disabled', locked);
  document.querySelectorAll('#chat-chips button, #clar-card input, #clar-card button, [data-publish]').forEach(x => x.disabled = locked);
  document.querySelectorAll('.version-picker select').forEach(x=>x.disabled=on);
  const status = document.getElementById('agent-status');
  if (status) status.textContent = on ? `${label} · ${agentWaitCopy()}` : '有什么想收的，先告诉我吧';
  const box = document.getElementById('chat-scroll'); if (box) box.setAttribute('aria-busy', String(on));
  chatTyping(on);paintDesignInputState(); paintAgentRuntime();
}
function paintAgentRuntime() {
  const mode = document.getElementById('agent-runtime-mode');
  const status = document.getElementById('agent-runtime-status');
  if (!mode || !status) return;
  const request = state.agentRequest;
  const setMode = (label, tone = '') => {
    mode.textContent = label;
    mode.className = `runtime-mode${tone ? ` ${tone}` : ''}`;
  };
  const replay = document.getElementById('offline-replay-action');
  if (replay) {
    const demoTask = state.task?.name === '2026 秋季第 1 期团课报告（演示）';
    replay.innerHTML = state.llmConfigured === false && demoTask
      ? `<div class="offline-replay-callout"><div><b>想把双 Agent 路径走完？</b><span>用固定虚构需求回放一次需求整理，沿同一队列、校验和人工发布门槛运行。</span></div><button class="ghost sm" type="button" onclick="runOfflineRequirementsReplay()" ${state.agentBusy ? 'disabled' : ''}>${icon('sparkle')} 回放离线起草</button></div>`
      : '';
  }
  if (state.llmConfigured === false) {
    setMode("离线可演示", "offline");
    status.textContent = "当前没有模型密钥：模板和手动编辑可用，需求 Agent 会保留原文并明确停下。";
    paintAgentRuntimeContractIssue(agentRuntimeContractWarning);
    return;
  }
  if (request?.status === "queued") {
    setMode("请求已入队", "online");
    status.textContent = "请求已先落库；断线或刷新后会按同一个请求编号继续查询。";
    paintAgentRuntimeContractIssue(agentRuntimeContractWarning);
    return;
  }
  if (request?.status === "running" || request?.status === "checking") {
    setMode("正在协作", "online");
    status.textContent = "需求 Agent 正在整理；旧草案不会被半份结果覆盖。";
    paintAgentRuntimeContractIssue(agentRuntimeContractWarning);
    return;
  }
  setMode("受限运行时", "online");
  status.textContent = "只在当前任务范围内运行；工具调用受 scope、预算、幂等和审计约束。";
  paintAgentRuntimeContractIssue(agentRuntimeContractWarning);
}
function renderChips() {
  const box = document.getElementById('chat-chips'); if (!box) return;
  box.innerHTML = state.bpId ? `<button class="chip" onclick="fillChat('我想调整截止时间：')">调整截止</button><button class="chip" onclick="fillChat('我想修改材料格式：')">材料格式</button><button class="chip" onclick="fillChat('增加一个登记字段：')">增加字段</button>` : `<button class="chip" onclick="quickTemplate('class_report')">${icon('workbench')} 团课报告</button><button class="chip" onclick="quickTemplate('contest_signup')">${icon('roster')} 比赛报名</button>`;
  box.querySelectorAll('button').forEach(x => x.disabled = state.agentBusy || state.designLoadFailed || !!state.viewingVersion);
}
function fillChat(t) { if (state.agentBusy) return; const el = document.getElementById('chat-in'); el.value = t;cacheDesignInputs(); el.focus(); }
function chatScrollBottom() { const el = document.getElementById('chat-scroll'); if (el) el.scrollTop = el.scrollHeight; }
function userSay(text) { state.chat.push({role: 'user', html: esc(text).replace(/\n/g,'<br>')}); paintChat(); }
function agentSay(html, mini) { state.chat.push({role: 'agent', html, mini: mini || ''}); paintChat(); }
function chatTyping(on) {
  document.getElementById('typing-row')?.remove(); if (!on) return;
  const box = document.getElementById('chat-scroll'); if (!box) return;
  box.insertAdjacentHTML('beforeend', `<div class="msg agent" id="typing-row"><div class="avatar">${icon("sparkle")}</div><div class="body"><span class="typing"><i></i><i></i><i></i></span><span class="mini">${esc(agentWaitCopy())}</span></div></div>`); chatScrollBottom();
}
function paintChat() {
  if(state.designRenderedBase === state.designBaseId) cacheDesignInputs();
  const box = document.getElementById('chat-scroll'); if (!box) return;
  box.innerHTML = state.chat.map(m => `<div class="msg ${m.role}"><div class="avatar">${m.role === 'agent' ? icon("sparkle") : '我'}</div><div class="body">${m.html}${m.mini ? `<div class="mini">${m.mini}</div>` : ''}</div></div>`).join('');
  const clar = state.designQuestions || [];
  if (state.bpId && clar.length && !state.answeredDone) box.insertAdjacentHTML('beforeend', clarCard(clar));
  state.designRenderedBase=state.designBaseId;restoreDesignInputs();chatScrollBottom();
}
function clarCard(clars) {
  const affects = c => (c.affects_rule_ids || []).length
    ? `<p class="field-help">影响规则：${c.affects_rule_ids.map(esc).join("、")}</p>` : "";
  return `<div class="clar-card" id="clar-card"><div class="eyebrow">NEEDS YOUR INPUT</div><h3>有 ${clars.length} 项需要你确认</h3><p class="muted">只回答已确定的内容，留空会保留为待确认，不代表同意默认值。</p>${clars.map((c,i) => `<label for="clar-${i}">${i+1}. ${esc(c.question)}</label>${c.why ? `<p class="field-help">${esc(c.why)}</p>` : ''}${affects(c)}<input id="clar-${i}" oninput="cacheDesignInputs()" placeholder="填写你的决定">`).join('')}<label for="clar-extra">其他修改意见（可选）</label><input id="clar-extra" oninput="cacheDesignInputs()" placeholder="还需要调整什么？"><button onclick="submitClarAnswers()">更新草案 ${icon('arrow')}</button></div>`;
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
    agentSay('模板已准备好，这只是个起点，不是最终要求。', '请核对材料、时间、审核方式和数据用途，有什么要改的继续告诉我就行。');
  } catch(e) { if (epoch === state.designEpoch) agentSay('模板暂时没载入，请稍后再试。', esc(e.message)); }
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
function newAgentRequestId() {
  const random = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return `req-${Date.now()}-${random}`.slice(0, 80);
}
function savePendingAgentRequest(request) {
  const saved = readDesignInputs();
  if (request) saved.pendingAgentRequest = request;
  else delete saved.pendingAgentRequest;
  writeDesignInputs(saved);
}
function clearPendingAgentRequest(requestId) {
  const saved = readDesignInputs();
  if (!requestId || saved.pendingAgentRequest?.requestId === requestId) {
    delete saved.pendingAgentRequest;
    writeDesignInputs(saved);
  }
  if (!requestId || state.agentRequest?.requestId === requestId) {
    state.agentRequest = null;
    clearTimeout(state.agentRequestPollTimer);
    state.agentRequestPollTimer = 0;
  }
  if (!requestId || state.retryRequest?.requestId === requestId) state.retryRequest = null;
}
function agentRequestPath(request) {
  return `/api/tasks/${state.taskId}/draft/agent-requests/${encodeURIComponent(request.requestId)}`;
}
function agentRequestForm(request) {
  const p = request.payload;
  return {request_id: request.requestId, kind: p.kind,
    requirement: p.requirement || "", template: p.template || "",
    blueprint_version_id: p.blueprint_version_id || "",
    base_blueprint_id: String(p.base_blueprint_id ?? 0),
    answered: JSON.stringify(p.answered || {}), instruction: p.instruction || "",
    execution_mode: p.execution_mode || "live"};
}
function agentRequestProgressHtml(request) {
  const status = request.status || "queued";
  const elapsed = Math.max(0, Date.now() - (request.createdAt || Date.now()));
  const minutes = Math.floor(elapsed / 60000);
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  const replay = request.payload?.execution_mode === "offline_replay";
  const title = replay ? (status === "queued" ? "离线脚本回放已排队" : status === "running" ? "离线脚本正在整理需求" : "正在确认离线回放状态")
    : status === "queued" ? "已收到，正在等候处理"
    : status === "running" ? "小齐正在整理这次要求"
    : status === "checking" && offline ? "网络已断开，等恢复后继续确认"
    : status === "checking" ? "正在确认服务器处理到哪一步"
    : "正在确认请求状态";
  const detail = replay
    ? "这是固定虚构输入的离线脚本回放，不调用外部模型；草案生成后仍要由组织者核对并发布。"
    : state.designCacheFailed
    ? "请求已交给服务器；不过本标签页暂存不可用，离开前请先复制你的原文。"
    : offline
      ? "原文和草案都已保留。恢复联网后会继续查询同一请求，不会重复生成。"
    : minutes >= 2
      ? `已经等了 ${minutes} 分钟。服务端仍保留这次请求；你可以先离开，回来后会继续核对状态。`
      : "原文和当前草案都已保留；即使网络中断，回来后也会接着查这次请求。";
  return `<section class="agent-request-card${replay ? ' offline' : ''}" role="status" aria-live="polite">
    <span class="agent-request-mark" aria-hidden="true">${status === "running" ? "…" : "↗"}</span>
    <div class="agent-request-copy"><b>${title}</b><p>${detail}</p></div>
    <button class="ghost sm" type="button" onclick="checkAgentRequestNow()">查看进度</button>
  </section>`;
}
function paintAgentRequestStatus(request, error = "") {
  const box = document.getElementById("agent-request-status");
  if (!box) return;
  if (!request) { box.innerHTML = ""; return; }
  if (request.status === "queued" || request.status === "running" || request.status === "checking") {
    box.innerHTML = agentRequestProgressHtml(request);
    return;
  }
  if (request.status === "failed") {
    const message = error || request.error || "小齐这次没有收到完整回复，原草案仍保留。";
    const stale = /草案已在另一页面更新|回到最新版本核对/.test(message);
    const modelOffline = /未配置|模型密钥|暂不可用/.test(message);
    // 没有模型密钥时重试必然失败：不给按钮，也不再重复提示——顶部常驻提示条和对话已经说明
    if (modelOffline) { box.innerHTML = ""; return; }
    box.innerHTML = `<section class="agent-request-card failed" role="alert"><span class="agent-request-mark" aria-hidden="true">!</span><div class="agent-request-copy"><b>${stale ? "草案已在别处更新" : "这次整理没有完成"}</b><p>${esc(message)}</p><p class="agent-request-hint">你的原文仍保留，旧结果没有覆盖当前草案。</p></div>${stale ? '<button class="ghost sm" type="button" onclick="refreshAfterAgentConflict()">刷新草案</button>' : request.permanentError ? '' : '<button class="ghost sm" type="button" onclick="retryAgent()">用原请求重试</button>'}</section>`;
    return;
  }
  box.innerHTML = "";
}
function currentDesignRequest(request, epoch, token) {
  return epoch === state.designEpoch && token === orgToken()
    && state.agentRequest?.requestId === request.requestId;
}
function scheduleAgentRequestPoll(request, epoch, token, mode = "lookup") {
  if (!currentDesignRequest(request, epoch, token)) return;
  clearTimeout(state.agentRequestPollTimer);
  const delays = [1200, 2200, 4000, 7000, 11000, 15000];
  const delay = delays[Math.min(request.pollCount || 0, delays.length - 1)];
  request.pollCount = (request.pollCount || 0) + 1;
  state.agentRequestPollTimer = setTimeout(() => pollAgentRequest(request, epoch, token, mode), delay);
}
function finishAgentRequestFailure(request, message, epoch, token, permanent = false) {
  if (!currentDesignRequest(request, epoch, token)) return;
  request.status = "failed"; request.error = message || request.error || "这次请求没能完成，原草案还在。";
  request.permanentError = !!permanent; state.retryRequest = request;
  savePendingAgentRequest(request); setAgentBusy(false); paintAgentRequestStatus(request);
  const text = String(request.error || "");
  const modelOffline = /暂不可用|未配置|模型密钥|LLM/i.test(text);
  if (request.permanentError && /草案已在另一页面更新/.test(text)) {
    agentSay("草案有了新版本，我先不把旧修改覆盖上去。", "你刚才写的内容保留了，可以检查后再带过来。");
  } else if (modelOffline) {
    // 没有配置模型密钥时，重试不会成功，别让人白试
    agentSay("现在还没有接入 AI 模型，所以没法自动帮你起草。", "你写的内容都保留着。可以先用下面的模板开始，或者直接改右侧草案；配置好模型密钥后，同一段话再发一次就能生成。");
  } else {
    agentSay("这次整理没完成，原草案还在。", "你刚才写的内容保留了，可以用同一个请求重试，不会重复生成版本。");
  }
  if (state.retryRequest && request.permanentError && !/草案已在另一页面更新/.test(text) && !modelOffline)
    agentSay("你也可以编辑原文再重新发送，这次没有改动草案。");
  renderChips(); renderDraftPanel();
}
async function completeAgentRequest(request, response, epoch, token) {
  if (!currentDesignRequest(request, epoch, token)) return;
  const result = response?.result;
  if (!result?.draft?.blueprint || !result.blueprint_version_id) {
    finishAgentRequestFailure(request, "服务器没有返回完整草案，原草案还在。可以用原请求重试。", epoch, token);
    return;
  }
  let latest;
  try { latest = await api(`/api/tasks/${state.taskId}/design`); }
  catch (e) {
    request.status = "checking"; request.error = "草案已经生成，正在确认它是否仍是最新版本。";
    savePendingAgentRequest(request); paintAgentRequestStatus(request);
    scheduleAgentRequestPoll(request, epoch, token, "lookup");
    return;
  }
  if (!currentDesignRequest(request, epoch, token)) return;
  const isLatestResult = latest.blueprint_version_id === result.blueprint_version_id;
  if (isLatestResult) {
    const bpNew = result.draft.blueprint || {};
    const usable = bpNew.fields?.length || bpNew.slots?.length || bpNew.rules?.length;
    const warnings = result.draft.warnings || [];
    const consumed = usable && !(request.previousBlueprintId === result.blueprint_version_id && warnings.length);
    if (consumed) consumeDesignInput(request.sentBase, request.sent, request.source);
    applyDraft(latest);
    state.requirement = latest.source_text || (request.previousBlueprintId ? state.requirement : request.text);
    clearPendingAgentRequest(request.requestId);
    const remaining = readDesignInputs().versions[String(state.designBaseId || 0)] || {};
    state.designDirty = hasDesignInput(remaining);
    restoreDesignInputs();
    const bp = latest.draft?.blueprint || {};
    const empty = !bp.fields?.length && !bp.slots?.length && !bp.rules?.length;
    const unchanged = request.previousBlueprintId === result.blueprint_version_id;
    const modelOffline = warnings.some(w => /暂不可用|未配置|模型密钥/.test(String(w)));
    agentSay(modelOffline ? "现在还没有接入 AI 模型，所以这次没能自动整理。"
      : empty ? "这次没能整理出可用的收集表，原要求还在。"
      : unchanged ? "这次没有形成新版本，原草案还在。"
      : request.previousBlueprintId ? "草案更新了，我们一起看看改动有没有按你的意思来。"
      : "第一份草案整理好了，先核对一下有没有漏掉或多加的要求。",
      modelOffline ? "你写的要求都保留着。可以先用模板开始，或直接改右侧草案；配好模型密钥后同一段话再发一次就能生成。"
      : request.previousBlueprintId ? impactText(result.impact) : empty
        ? "可以用同一个请求重试，或者从模板开始。"
        : `整理出 ${bp.fields?.length || 0} 项登记信息、${bp.slots?.length || 0} 类材料和 ${bp.rules?.length || 0} 条核对规则。`);
    if (warnings.length) agentSay("有几处还需要你看一眼。", warnings.map(esc).join("<br>"));
    if (empty || (unchanged && warnings.length)) {
      request.status = "failed"; request.error = "这次没有生成新的可用草案，原要求和旧版本还在。";
      request.permanentError = false; state.agentRequest = request; state.retryRequest = request;
      savePendingAgentRequest(request); paintAgentRequestStatus(request);
    } else { state.retryRequest = null; paintAgentRequestStatus(null); }
  } else {
    applyDraft(latest);
    state.requirement = latest.source_text || state.requirement;
    request.status = "failed"; request.error = "这次处理完成时，另一个页面已经更新了草案。我显示的是最新版本，没有用旧结果覆盖它，你的修改还留在恢复提示里。";
    request.permanentError = true;
    savePendingAgentRequest(request); paintAgentRequestStatus(request);
    agentSay("草案在另一个页面已经有更新了。", "我先显示最新版本，没有把旧结果盖上去。你的修改留在「旧草案的未发送内容」里，可以检查后再带过来。");
  }
  setAgentBusy(false); renderChips(); renderDraftPanel();
}
async function submitAgentRequest(request, epoch, token) {
  const p = request.payload;
  return api(`/api/tasks/${state.taskId}/draft/agent-requests`, {method: "POST", form: {
    request_id: request.requestId, kind: p.kind, requirement: p.requirement || "",
    template: p.template || "", blueprint_version_id: p.blueprint_version_id || "",
    base_blueprint_id: String(p.base_blueprint_id ?? 0),
    answered: JSON.stringify(p.answered || {}), instruction: p.instruction || "",
    execution_mode: p.execution_mode || "live",
  }});
}
async function pollAgentRequest(request, epoch = state.designEpoch, token = orgToken(), mode = "lookup") {
  if (!currentDesignRequest(request, epoch, token)) return;
  let response;
  try {
    if (mode === "enqueue") response = await submitAgentRequest(request, epoch, token);
    else {
      try { response = await api(agentRequestPath(request), {cache: "no-store"}); }
      catch (error) {
        if (error.status === 404) response = await submitAgentRequest(request, epoch, token);
        else throw error;
      }
    }
  } catch (error) {
    if (!currentDesignRequest(request, epoch, token)) return;
    if (error.status === 409 || error.status === 422) {
      const stale = /草案|版本/.test(error.message);
      finishAgentRequestFailure(request, error.message, epoch, token, true);
      if (stale) request.permanentError = true;
      return;
    }
    request.status = "checking";
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    request.error = offline
      ? "网络已断开，恢复后会继续确认这次请求。"
      : error.status ? "服务器暂时没有回应，我会继续确认这次请求的状态。" : "网络刚才断开了，我会按同一个请求编号继续确认，不会重复生成草案。";
    savePendingAgentRequest(request); paintAgentRequestStatus(request);
    setAgentBusy(true, "正在接回这次请求");
    if (!offline) scheduleAgentRequestPoll(request, epoch, token, "lookup");
    return;
  }
  if (!currentDesignRequest(request, epoch, token)) return;
  request.status = response.status || "queued";
  request.pollCount = request.pollCount || 0;
  request.error = response.error || "";
  savePendingAgentRequest(request);
  if (request.status === "completed") {
    await completeAgentRequest(request, response, epoch, token);
    return;
  }
  if (request.status === "failed") {
    const permanent = /草案已在另一页面更新|回到最新版本核对/.test(request.error);
    finishAgentRequestFailure(request, request.error, epoch, token, permanent);
    return;
  }
  request.status = request.status === "running" ? "running" : "queued";
  setAgentBusy(true, request.status === "queued" ? "正在排队整理" : "正在整理需求");
  paintAgentRequestStatus(request);
  scheduleAgentRequestPoll(request, epoch, token, "lookup");
}
function resumePendingAgentRequest(epoch, token) {
  if (state.agentResumeStarted || epoch !== state.designEpoch || token !== orgToken()) return;
  const pending = readDesignInputs().pendingAgentRequest;
  if (!pending?.requestId || !pending.payload) return;
  state.agentResumeStarted = true;
  state.agentRequest = pending; state.retryRequest = pending;
  if (pending.status === "failed" && pending.permanentError) {
    paintAgentRequestStatus(pending);
    return;
  }
  if (pending.text && state.agentRequestDisplayedId !== pending.requestId) {
    userSay(pending.text); state.agentRequestDisplayedId = pending.requestId;
  }
  agentSay("接着上次没完成的整理", "请求和原文都还在，我先确认一下进度，不会重复生成草案。");
  setAgentBusy(true, "正在接回上次的整理");
  return pollAgentRequest(pending, epoch, token, "lookup");
}
function refreshAfterAgentConflict() {
  const taskId = state.taskId;
  cacheDesignInputs();
  clearTimeout(state.agentRequestPollTimer);
  state.agentRequestPollTimer = 0;
  clearPendingAgentRequest(state.agentRequest?.requestId);
  state.agentRequest = null; state.retryRequest = null;
  viewDesign(taskId);
}
function checkAgentRequestNow() {
  const request = state.agentRequest;
  if (!request) return;
  clearTimeout(state.agentRequestPollTimer);
  state.agentRequestPollTimer = 0;
  return pollAgentRequest(request, state.designEpoch, orgToken(), "lookup");
}
async function runAgent(text, answered = {}, instruction = '', source = 'composer', resumeRequest = null, options = {}) {
  if (state.agentBusy || state.designLoadFailed || state.viewingVersion) return;
  cacheDesignInputs();
  const previous = resumeRequest ? resumeRequest.previousBlueprintId : state.bpId;
  const sent = resumeRequest ? resumeRequest.sent : collectDesignInputs();
  const sentBase = resumeRequest ? resumeRequest.sentBase : state.designBaseId;
  const token = orgToken(), epoch = state.designEpoch;
  const payload = resumeRequest ? resumeRequest.payload : options.executionMode === 'offline_replay'
    ? {kind: "agent", base_blueprint_id: state.bpId || 0, requirement: text,
       execution_mode: "offline_replay"}
    : previous
    ? {kind: "revise", blueprint_version_id: previous, base_blueprint_id: previous,
       requirement: state.requirement || "", answered: {...answered}, instruction,
       execution_mode: "live"}
    : {kind: "agent", base_blueprint_id: state.bpId || 0, requirement: text,
       execution_mode: "live"};
  const request = resumeRequest || {requestId: newAgentRequestId(), payload,
    text, answered: {...answered}, instruction, source, previousBlueprintId: previous,
    sentBase, sent, createdAt: Date.now(), pollCount: 0, status: "queued"};
  state.agentRequest = request; state.retryRequest = request;
  savePendingAgentRequest(request);
  if (!resumeRequest) {
    userSay(text); state.agentRequestDisplayedId = request.requestId;
  }
  setAgentBusy(true, previous ? "正在核对修改影响" : "正在整理字段、材料与规则");
  paintAgentRequestStatus(request); setFlash("");
  await pollAgentRequest(request, epoch, token, resumeRequest ? "lookup" : "enqueue");
}
function runOfflineRequirementsReplay() {
  if (state.llmConfigured !== false || state.agentBusy || state.task?.name !== '2026 秋季第 1 期团课报告（演示）') return;
  const text = '收集 2026 秋季第 1 期团课报告，报告包含本人姓名，接受一份 PDF 或 DOCX，最大 10 MiB、20 页，由组织者最终人工验收。';
  return runAgent(text, {}, '', 'offline_replay', null, {executionMode: 'offline_replay'});
}
function retryAgent() {
  const request = state.retryRequest || state.agentRequest;
  if (!request || request.permanentError) return;
  request.createdAt = Date.now(); request.pollCount = 0; request.status = "queued"; request.error = "";
  state.agentRequest = request; state.retryRequest = request; savePendingAgentRequest(request);
  setAgentBusy(true, "正在用同一请求重试");
  return pollAgentRequest(request, state.designEpoch, orgToken(), "enqueue");
}
function chatSend() { const text = (document.getElementById('chat-in')?.value || '').trim(); if (text) return runAgent(text, {}, state.bpId ? text : ''); }
function submitClarAnswers() {
  const answered = {}; (state.draft?.clarifications || []).forEach((c,i) => { const v = document.getElementById(`clar-${i}`)?.value.trim(); if(v) answered[c.question] = v; });
  const instruction = document.getElementById('clar-extra')?.value.trim() || '';
  if (!Object.keys(answered).length && !instruction) { setFlash('请至少回答一项，或填写修改意见。留空不会自动确认。'); return; }
  return runAgent(Object.entries(answered).map(([q,a]) => `${q}：${a}`).concat(instruction ? [instruction] : []).join('\n'), answered, instruction, 'clarifications');
}
function setDesignTab(tab) {
  if (!['preview', 'rules'].includes(tab)) return;
  state.designTab = tab;
  renderDraftPanel();
  document.getElementById(`design-tab-${tab}`)?.focus?.();
}
function moveDesignTab(event) {
  if (!event || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = ['preview', 'rules'].map(tab => document.getElementById(`design-tab-${tab}`)).filter(Boolean);
  const current = tabs.indexOf(event.currentTarget);
  if (current < 0) return;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
    : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next].click?.();
}
function renderDraftPanel() {
  paintDesignInputState();
  const box = document.getElementById('draft-panel'); if(!box) return;
  const d = state.draft, bp = d?.blueprint, has = !!(state.bpId && bp);
  const viewing = state.viewingVersion;
  const label = document.getElementById('draft-state');
  if(label) label.textContent = has
    ? `${viewing ? '只读' : (state.draftStatus === 'published' ? '已发布' : '草案')} v${state.draftVersionId || '—'}${state.designDirty ? ' · 有未发送内容' : ''}`
    : '尚未生成草案';
  document.getElementById('st-2')?.classList.toggle('on',has);
  document.getElementById('st-3')?.classList.toggle('on',state.draftStatus === 'published');
  if(!has) { box.innerHTML = `<div class="preview-empty"><div class="preview-empty-art"><div class="mock-sheet"><span></span><i></i><i></i><b></b></div><span class="floating-spark">${icon("sparkle")}</span></div><div class="eyebrow">LIVE PREVIEW</div><h2>你的收集表，会在这里成形</h2><p>先告诉小齐你的要求，或选一个模板。<br>字段、材料和检查依据会一起呈现。</p><div class="preview-placeholder-tags"><span>登记信息</span><span>材料上传</span><span>检查规则</span></div></div>`; return; }
  const rules = bp.rules || [], tp = bp.time_policy || {}, clar = d.clarifications || [];
  const scope = bp.task_scope || {}, hasContents = (bp.fields || []).length || (bp.slots || []).length;
  const blocking = state.designBlocking || [], advisories = state.designAdvisories || [];
  const versionOptions = (state.designVersions || []).map(v =>
    `<option value="${v.id}" ${(viewing?.id || state.bpId) === v.id ? 'selected' : ''}>v${v.version} · ${v.status === 'published' ? '已发布' : '草案'}${v.created_at ? ' · ' + esc(fmtTime(v.created_at).slice(5, 16)) : ''}</option>`).join('');
  box.innerHTML = `<div class="draft-toolbar"><div role="tablist" aria-label="草案视图"><button type="button" id="design-tab-preview" role="tab" aria-controls="design-tabpanel" aria-selected="${state.designTab === 'preview'}" tabindex="${state.designTab === 'preview' ? '0' : '-1'}" onkeydown="moveDesignTab(event)" onclick="setDesignTab('preview')" class="${state.designTab === 'preview' ? 'on' : ''}">提交者预览</button><button type="button" id="design-tab-rules" role="tab" aria-controls="design-tabpanel" aria-selected="${state.designTab === 'rules'}" tabindex="${state.designTab === 'rules' ? '0' : '-1'}" onkeydown="moveDesignTab(event)" onclick="setDesignTab('rules')" class="${state.designTab === 'rules' ? 'on' : ''}">规则与依据 <span>${rules.length}</span></button></div>
      <label class="version-picker"><span>版本</span><select onchange="loadDesignVersion(this.value)" aria-label="查看历史版本">${versionOptions || `<option>v${state.draftVersionId || 1}</option>`}</select></label></div>
    ${viewing ? `<div class="version-banner" role="status"><div><b>正在查看历史版本 v${viewing.version}</b><span>这是只读快照，发布与修订仍以最新草案为准。</span></div><div class="row-actions"><button class="ghost sm" onclick="useVersionAsBase()">以此为起点修改</button><button class="ghost sm" onclick="backToLatest()">回到最新</button></div></div>` : ''}
    ${blocking.length ? `<div class="draft-warning blocking" role="alert"><b>发布前必须处理 ${blocking.length} 项</b><ul>${blocking.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
    ${advisories.length ? `<div class="draft-warning" role="status"><b>${blocking.length ? '另有' : ''} ${advisories.length} 项提醒（不阻止发布）</b><ul>${advisories.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
    ${designReadinessHtml(bp, d, blocking, advisories, viewing)}
    ${designVersionImpactHtml()}
    <div id="design-tabpanel" class="draft-content" role="tabpanel" aria-labelledby="design-tab-${state.designTab}" tabindex="0">${state.designTab === 'preview' ? `<div class="form-preview"><div class="preview-banner"><span>${scope.mode === 'open' ? '开放报名' : '名册收集'}</span><span>填写预览 · 不会提交</span></div><h2>${esc(scope.name || state.task?.name || '收集任务')}</h2><p class="muted">${esc(scope.description || '请按以下要求登记信息并提交材料。')}</p>
      <div class="preview-section-title"><b>01</b> 登记信息</div>${(bp.fields || []).map(f => `<div class="preview-field"><label>${esc(f.label)}${f.required ? '<em> *</em>' : ' <small>选填</small>'}</label>${f.type === 'enum' ? `<select disabled aria-label="${esc(f.label)}"><option>请选择${esc(f.label)}</option>${(f.options || []).map(o => `<option>${esc(o)}</option>`).join('')}</select>` : `<input disabled aria-label="${esc(f.label)}" placeholder="请填写${esc(f.label)}">`}${f.required_condition ? `<p class="field-help">条件：${esc(f.required_condition)}</p>` : ''}${f.purpose ? `<p class="field-help">用途：${esc(f.purpose)}</p>` : ''}</div>`).join('') || '<p class="muted">尚未设置登记字段</p>'}
      <div class="preview-section-title"><b>02</b> 提交材料</div>${(bp.slots || []).map(sl => `<div class="upload-preview">${icon('delivery')}<div><strong>${esc(sl.label)}</strong><p>${(sl.formats || []).map(x=>esc(x.toUpperCase())).join(' / ') || '未限定格式'} · 最多 ${sl.max_count} 份${sl.max_size_mib ? ` · 每份 ≤ ${sl.max_size_mib} MiB` : ''}${sl.max_pages ? ` · ≤ ${sl.max_pages} 页` : ''}</p>${sl.required_condition ? `<p>条件：${esc(sl.required_condition)}</p>` : ''}</div><span>上传区域</span></div>`).join('') || '<p class="muted">尚未设置材料</p>'}
      <div class="preview-section-title"><b>03</b> 时间与验收</div><dl class="kv-list"><dt>时区</dt><dd>${esc(tp.timezone || 'Asia/Shanghai')}</dd><dt>开始收集</dt><dd>${esc(fmtTimeShort(tp.open_at, tp.timezone))}</dd><dt>首次截止</dt><dd>${esc(fmtTimeShort(tp.first_deadline, tp.timezone))}</dd><dt>补正截止</dt><dd>${esc(fmtTimeShort(tp.correction_deadline, tp.timezone))}</dd><dt>最终验收</dt><dd>${bp.manual_acceptance ? '组织者人工确认' : '按规则处理'}</dd></dl></div>` : `<div class="rules-preview"><h2>每条要求，都有依据</h2><p class="muted">程序校验、语义审核与人工判断分别标注，不把不确定的结论当成通过。</p>${rules.map((r,i) => `<article class="rule-preview"><div><span class="rule-number">${String(i+1).padStart(2,'0')}</span>${CAP_BADGE[r.capability] || ''}<span class="badge">${esc(EXECUTOR_LABEL[r.executor] || r.executor)}</span></div><h3>${esc(r.statement)}</h3><blockquote>${esc(r.requirement_source || '模板预置要求，请组织者核对')}</blockquote><p class="field-help">${r.severity === 'blocking' ? '阻塞项 · 未处理时不能验收' : '提醒项'}${r.clarification_question ? ' · ' + esc(r.clarification_question) : ''}</p></article>`).join('') || '<div class="empty">尚未设置检查规则</div>'}<details><summary>原始要求与修订依据</summary><p class="source-text">${esc((viewing ? viewing.source_text : state.requirement) || '当前使用模板预置要求，尚无自然语言输入。')}</p></details><details><summary>交付与数据治理</summary><pre>${esc(JSON.stringify({delivery:bp.delivery, governance:bp.governance},null,2))}</pre></details></div>`}</div>
    <div class="publish-bar"><div><strong>${viewing ? `历史版本 v${viewing.version}（只读）` : state.draftStatus === 'published' ? '当前版本已发布' : blocking.length ? '发布前还有内容必须处理' : '准备好后，由你确认发布'}</strong><span>${clar.length ? `${clar.length} 项待澄清 · ` : ''}${blocking.length ? `${blocking.length} 项阻塞 · ` : ''}${advisories.length ? `${advisories.length} 项提醒 · ` : ''}${rules.length} 条规则 · 修改将保留版本记录</span></div><button data-publish onclick="publishBp(${state.taskId})" ${!canPublishDesign() ? 'disabled' : ''}>${state.draftStatus === 'published' ? '已发布' : '核对并发布'} ${icon('arrow')}</button></div>`;
}

async function loadDesignVersion(bpId) {
  if (!bpId || state.agentBusy) return;
  cacheDesignInputs();
  const epoch = state.designEpoch;
  setAgentBusy(true,'正在读取历史版本');
  try {
    const r = await api(`/api/tasks/${state.taskId}/blueprints/${bpId}`);
    if (epoch !== state.designEpoch) return;
    state.viewingVersion = {id: r.blueprint_version_id, version: r.version, status: r.status, source_text:r.source_text || ''};
    state.viewingPublished = r.published || null;
    state.viewingImpact = r.publish_impact || null;
    state.draft = r.draft;
    state.draftVersionId = r.version;
    state.draftStatus = r.status;
    state.designBlocking = r.blocking || [];
    state.designAdvisories = r.advisories || [];
    renderDraftPanel();
  } catch(e) { if(epoch===state.designEpoch)setFlash('无法读取该版本：' + e.message); }
  finally { if(epoch===state.designEpoch)setAgentBusy(false); }
}
function backToLatest() {
  state.viewingVersion = null;
  state.viewingPublished = null;
  state.viewingImpact = null;
  viewDesign(state.taskId);
}
function useVersionAsBase() {
  const v = state.viewingVersion;
  if (!v) return;
  cacheDesignInputs();state.bpId = v.id;state.designBaseId=v.id;state.requirement=v.source_text || '';
  state.designQuestions=state.draft?.clarifications || [];state.designRenderedBase=null;state.designNeedsRevision=true;
  const input=document.getElementById('chat-in');if(input)input.value='';
  state.viewingVersion = null;
  state.designPublished = state.viewingPublished || state.designPublished;
  state.designPublishImpact = state.viewingImpact || state.designPublishImpact;
  state.viewingPublished = null;
  state.viewingImpact = null;
  state.draftStatus = 'draft';
  setAgentBusy(false);
  agentSay(`已切换到 v${v.version} 作为修订起点。`, '接下来的修改会基于这个版本形成新草案，历史版本不会丢。');
  renderDraftPanel();
}

function designVersionImpactHtml() {
  const viewing = state.viewingVersion;
  const published = viewing ? state.viewingPublished : state.designPublished;
  const impact = viewing ? state.viewingImpact : state.designPublishImpact;
  if (!state.draft?.blueprint || !published || !impact) return '';
  const heading = viewing
    ? `v${viewing.version} 相对已发布 v${published.version} 的变化`
    : `当前草案相对已发布 v${published.version} 的变化`;
  const note = viewing
    ? '这是历史版本的只读影响说明；回到最新草案后，发布核对会重新计算。'
    : '发布只会影响这份草案；既有正式版本和历史决定不会自动套用新要求。';
  return `<details class="version-impact" open><summary><span><b>版本变化</b><small>${esc(heading)}</small></span><span class="version-impact-mark">${impact.summary === '无实质变化' ? '无变化' : '需要核对'}</span></summary>${publishDiffHtml({published, draft:state.draft, publish_impact:impact}, {heading, note, compact:true}).replace(/^<div class="publish-group publish-diff">/, '<div class="publish-group publish-diff version-impact-body">')}</details>`;
}

function publishDiffHtml(server, options = {}) {
  const published=server.published;
  if(!published) return `<div class="publish-group"><h3>${esc(options.heading || '首次发布')}</h3><p>尚无已发布版本；请核对下面的完整收集要求。</p></div>`;
  const before=published.blueprint || {}, after=server.draft.blueprint, changes=server.publish_impact || {};
  const lines=[];
  const describe=(kind,item)=>kind==='fields'
    ? `${item.label}（${item.required ? '必填' : '选填'}；${({text:'文本',number:'数字',date:'日期',enum:'单选'})[item.type] || item.type || '文本'}${item.purpose ? '；用途：'+item.purpose : ''}${item.options?.length ? '；选项：'+item.options.join('、') : ''}${item.required_condition ? '；条件：'+item.required_condition : ''}）`
    : kind==='slots' ? `${item.label}（${item.formats?.join('/') || '不限格式'}；最多 ${item.max_count} 份${item.max_size_mib ? '；每份 ≤'+item.max_size_mib+'MiB' : ''}${item.max_pages != null ? '；最多 '+item.max_pages+' 页' : ''}${item.required_condition ? '；条件：'+item.required_condition : ''}）`
    : `${item.statement}（${EXECUTOR_LABEL[item.executor] || item.executor}；${item.severity==='blocking' ? '阻塞验收' : '提醒'}；来源：${item.requirement_source || '未标注'}${item.check?.kind==='team_size' ? '；团队人数 '+item.check.min+'–'+item.check.max+' 人' : ''}）`;
  for(const [kind,label] of [['fields','字段'],['slots','材料'],['rules','规则']]) {
    const old=Object.fromEntries((before[kind] || []).map(x=>[x.id,x])), next=Object.fromEntries((after[kind] || []).map(x=>[x.id,x]));
    for(const id of changes[kind]?.added || []) lines.push(`新增${label}：${describe(kind,next[id])}`);
    for(const id of changes[kind]?.removed || []) lines.push(`移除${label}：${describe(kind,old[id])}`);
    for(const id of changes[kind]?.changed || []) {
      lines.push(`调整${label}：${describe(kind,old[id])} → ${describe(kind,next[id])}`);
      if(kind==='rules' && JSON.stringify(old[id].check)!==JSON.stringify(next[id].check))lines.push('该规则的程序检查条件已调整，请核对其要求依据与相关材料限制');
    }
  }
  if(changes.time_policy_changed) lines.push('时间策略已调整，请核对下方时区与双截止');
  if(changes.manual_acceptance_changed) lines.push('最终验收方式已调整');
  if(changes.eligibility_required_changed) lines.push('资格前提：'+(after.eligibility_required ? '启用' : '关闭'));
  if(changes.auto_scope?.added?.length || changes.auto_scope?.removed?.length) lines.push('自动处理范围已调整，请逐条核对规则能力');
  for(const [key,label] of [['task_scope','收集对象与说明'],['delivery','交付设置'],['governance','用途与数据治理']])
    if(draftFingerprint(before[key] || {},{})!==draftFingerprint(after[key] || {},{}))lines.push(label+'已调整，请核对完整说明');
  return `<div class="publish-group publish-diff"><h3>${esc(options.heading || `相对已发布 v${published.version} 的变化`)}</h3>${lines.length ? `<ul>${lines.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>` : '<p>没有配置变化。</p>'}<p class="field-help">${esc(options.note || '既有正式版本和历史决定保留原范围，不自动套用新要求。')}</p></div>`;
}
async function publishBp(taskId) {
  cacheDesignInputs();
  if(!canPublishDesign()) { if(state.designDirty)setFlash('仍有未发送内容，请先处理后再核对发布。');return; }
  const epoch=state.designEpoch, bpId=state.bpId, token=orgToken();
  setAgentBusy(true,'正在核对发布差异');
  try {
    const fresh=await api(`/api/tasks/${taskId}/design`);
    if(epoch!==state.designEpoch || token!==orgToken())return;
    if(fresh.blueprint_version_id!==bpId || fresh.status==='published')throw new Error('草案或发布状态已变化，请回到最新版本重新核对。');
    state.publishReview={epoch,taskId,bpId,publishedId:fresh.published?.id || 0};
  const bp = state.draft.blueprint;
  const tp = bp.time_policy || {};
  const fields = bp.fields || [], slots = bp.slots || [], rules = bp.rules || [];
  const advisories = state.designAdvisories || [];
  document.getElementById('publish-summary').innerHTML = `<div class="publish-review">${publishDiffHtml(fresh)}
    <div class="publish-group"><div class="eyebrow">收集对象</div><p><b>${esc(bp.task_scope?.name || state.task?.name || '')}</b> · ${bp.task_scope?.mode === 'open' ? '开放报名' : '名册收集'} · ${bp.task_scope?.subject_kind === 'team' ? '团队提交' : '个人提交'}</p></div>
    <div class="publish-group"><div class="eyebrow">登记字段（${fields.length}）</div><p>${fields.map(f => `${esc(f.label)}${f.required ? '*' : ''}${f.required_condition ? `（${esc(f.required_condition)}）` : ''}`).join('、') || '无'}</p></div>
    <div class="publish-group"><div class="eyebrow">材料（${slots.length}）</div><p>${slots.map(s => `${esc(s.label)}：${(s.formats || []).map(x => esc(x.toUpperCase())).join('/') || '不限格式'}，最多 ${s.max_count} 份${s.max_size_mib ? `，≤${s.max_size_mib}MiB` : ''}${s.required_condition ? `，条件 ${esc(s.required_condition)}` : ''}`).join('<br>') || '无'}</p></div>
    <div class="publish-group"><div class="eyebrow">检查规则（${rules.length}）</div><ul class="publish-rules">${rules.map(r => `<li><span class="badge ${r.capability === 'supported' ? 'ok' : 'warn'}">${esc((CAP_BADGE[r.capability] || '').replace(/<[^>]+>/g, ''))}</span>${esc(r.statement)}</li>`).join('') || '<li>无</li>'}</ul></div>
    <div class="publish-group"><div class="eyebrow">时间</div><p>时区 ${esc(tp.timezone || 'Asia/Shanghai')} · 开始 ${esc(fmtTimeShort(tp.open_at, tp.timezone))} · 首次截止 ${esc(fmtTimeShort(tp.first_deadline, tp.timezone))} · 补正截止 ${esc(fmtTimeShort(tp.correction_deadline, tp.timezone))}</p></div>
    ${publishGovernanceHtml(bp)}
    ${advisories.length ? `<div class="draft-warning"><b>${advisories.length} 项提醒（不阻止发布）</b><ul>${advisories.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
  </div>`;
  document.getElementById('publish-error').textContent = ''; document.getElementById('publish-consent').checked = false;
  document.getElementById('publish-confirm').disabled=false;
  openDialog('publish-dialog', document.activeElement);
  document.getElementById('publish-title')?.focus();
  } catch(e) { if(epoch===state.designEpoch)setFlash(e.message); }
  finally { if(epoch===state.designEpoch)setAgentBusy(false); }
}
async function confirmPublish() {
  cacheDesignInputs();
  if(state.agentBusy || state.designDirty || !state.publishReview || state.publishReview.epoch!==state.designEpoch || state.publishReview.bpId!==state.bpId || !document.getElementById('publish-consent').checked) return;
  const epoch = state.designEpoch, taskId = state.taskId, bpId = state.bpId;
  const btn = document.getElementById('publish-confirm'); btn.disabled = true; setAgentBusy(true,'正在校验发布条件');
  try {
    const r = await api(`/api/tasks/${taskId}/blueprints/${bpId}/publish`, {method:'POST',form:{expected_published_id:state.publishReview.publishedId}});
    if(epoch !== state.designEpoch) return;
    state.draftStatus = 'published'; document.getElementById('publish-dialog').close();
    agentSay(`版本 v${r.published_version} 已发布！`, `下一步：<a href="#/roster/${taskId}">管理名单与发放凭证 ${icon('arrow')}</a>。记得发凭证给提交者，否则他们看不到入口。`);
    const fresh = await api(`/api/tasks/${taskId}/design`);
    if (epoch === state.designEpoch) applyDraft(fresh);
    renderDraftPanel();
  } catch(e) { if(epoch === state.designEpoch) { document.getElementById('publish-error').textContent = e.message; if(e.status===409)state.publishReview=null; } }
  finally { if(epoch === state.designEpoch) { btn.disabled = !state.publishReview; setAgentBusy(false); renderDraftPanel(); } }
}

/* ---------------------------------------------------------------- 名单管理 */
async function viewRoster(taskId) {
  state.rosterTaskId = taskId;
  state.rosterFilter = "all";
  state.rosterEntries = [];
  document.getElementById("app").innerHTML = `
    <div class="breadcrumb"><a href="#/tasks">我的任务</a><span>/</span><span id="roster-name">任务 #${taskId}</span></div>
    ${showcaseReturnHtml("名单与凭证")}
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
      <section class="card roster-list"><div class="section-heading"><div><div class="eyebrow">02 / CREDENTIALS</div><h2>名册与凭证</h2></div><button class="ghost sm" onclick="issueAllGrants(${taskId})">为全部待发放主体发放</button></div>
        <div id="roster-filter" class="roster-filter" role="group" aria-label="按凭证状态筛选"></div>
        <p id="roster-results-status" class="sr-only" role="status" aria-live="polite"></p>
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
  const epoch = state.routeEpoch, requestId = (state.rosterRequestId || 0) + 1;
  state.rosterRequestId = requestId;
  document.querySelectorAll?.(".roster-import input, .roster-import textarea, .roster-import button, .roster-list > .section-heading button, #roster-filter button").forEach(control => { control.disabled = false; });
  try {
    const d = await api(`/api/tasks/${taskId}/roster`);
    if (epoch !== state.routeEpoch || requestId !== state.rosterRequestId) return false;
    state.roster = {};
    state.rosterEntries = d.entries;
    d.entries.forEach(e => { state.roster[e.id] = e; });
    const nameEl = document.getElementById("roster-name");
    if (nameEl && d.entries.length !== undefined) nameEl.textContent = `任务 #${taskId}`;
    document.getElementById("roster-stats").innerHTML =
      [["名册总数", d.total, "roster"], ["已发放凭证", d.granted, "design"], ["有效免交", d.exempt, "delivery"], ["待发放", Math.max(0, d.total - d.granted - d.exempt), "workbench"]]
        .map(([l, n, ic]) => `<div class="overview-stat"><span>${l}</span><strong>${String(n).padStart(2, "0")}</strong><i>${icon(ic)}</i></div>`).join("");
    renderRosterTable();
    return true;
  } catch (e) {
    if (epoch !== state.routeEpoch || requestId !== state.rosterRequestId) return false;
    const table = document.getElementById("roster-table");
    if (table) table.innerHTML = `<div class="notice-warn" role="alert"><b>名册暂时无法读取</b><p>${esc(e.message || "请检查任务是否存在，或稍后重试。")}</p><button class="ghost sm" onclick="loadRoster(${taskId})">重试加载名册</button> <a class="ghost sm" href="#/workbench/${taskId}">回到收集工作台</a></div>`;
    document.querySelectorAll?.(".roster-import input, .roster-import textarea, .roster-import button, .roster-list > .section-heading button, #roster-filter button").forEach(control => { control.disabled = true; });
    return false;
  }
}

function setRosterFilter(filter) {
  if (!["all", "pending", "issued", "exempt"].includes(filter)) return;
  state.rosterFilter = filter;
  renderRosterTable();
}

function renderRosterTable() {
  const entries = state.rosterEntries || [];
  const counts = {
    all: entries.length,
    pending: entries.filter(e => !e.granted && !e.exempt).length,
    issued: entries.filter(e => e.granted).length,
    exempt: entries.filter(e => e.exempt).length,
  };
  const filter = ["all", "pending", "issued", "exempt"].includes(state.rosterFilter) ? state.rosterFilter : "all";
  const filterEl = document.getElementById("roster-filter");
  const filterOptions = [
    ["all", "全部"], ["pending", "待发放"], ["issued", "已发放"], ["exempt", "免交"],
  ];
  if (filterEl) {
    const buttons = [...filterEl.querySelectorAll("button[data-roster-filter]")];
    if (buttons.length === filterOptions.length) {
      buttons.forEach((button, index) => {
        const [key] = filterOptions[index];
        const active = filter === key;
        button.className = `roster-filter-button${active ? " active" : ""}`;
        button.setAttribute("aria-pressed", String(active));
        button.querySelector("span").textContent = String(counts[key]);
      });
    } else {
      filterEl.innerHTML = filterOptions.map(([key, label]) => `<button type="button" data-roster-filter="${key}"
        class="roster-filter-button${filter === key ? " active" : ""}" aria-pressed="${filter === key}"
        onclick="setRosterFilter('${key}')">${label}<span>${counts[key]}</span></button>`).join("");
    }
  }
  const visible = entries.filter(entry => {
    if (filter === "pending") return !entry.granted && !entry.exempt;
    if (filter === "issued") return !!entry.granted;
    if (filter === "exempt") return !!entry.exempt;
    return true;
  });
  const filterLabel = filterOptions.find(([key]) => key === filter)?.[1] || "全部";
  const resultsStatus = document.getElementById("roster-results-status");
  if (resultsStatus) {
    resultsStatus.textContent = !entries.length
      ? "名单为空。"
      : visible.length
        ? `${filter === "all" ? "显示全部" : `已筛选${filterLabel}`}，共 ${visible.length} 位主体。`
        : `筛选“${filterLabel}”没有匹配主体。`;
  }
  document.getElementById("roster-table").innerHTML = visible.length ? `
    <div class="roster-head"><span>姓名 / 备注</span><span>凭证</span><span>提交空间</span><span>操作</span></div>
    ${visible.map(e => `<article class="roster-row">
      <div class="roster-person"><span class="wb-avatar" aria-hidden="true">${esc((e.name || "?").slice(0, 1))}</span><div><b>${esc(e.name)}</b><span>${esc(e.ref || "未填备注")}</span></div></div>
      <div>${e.granted ? '<span class="badge ok">已发放</span>' : '<span class="badge warn">未发放</span>'}</div>
      <div>${e.exempt ? '<span class="badge info">免交</span>'
        : (e.subject_id ? `<span class="badge">#${e.subject_id}</span>` : '<span class="muted">发放时创建</span>')}</div>
      <div class="roster-actions"><button class="ghost sm" onclick="issueGrant(${state.rosterTaskId},${e.id})">${
          e.granted ? "重发凭证" : "发放凭证"}</button></div>
    </article>`).join("")}`
    : entries.length
      ? `<p class="roster-filter-empty">此状态下没有主体。</p>`
      : `<div class="empty-state"><div class="empty-icon">${icon("roster")}</div><h3>名单还是空的</h3><p>在左边粘贴名单导入，系统会按行生成提交主体。</p></div>`;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand("copy"); ta.remove(); return true;
  }
}
async function copyDemoRouteCue(button) {
  const cue = button?.dataset?.cue || "";
  if (!cue) return false;
  const copied = await copyText(cue);
  if (!button) return copied;
  button.innerHTML = `${icon(copied ? "check" : "copy")}<span>${copied ? "已复制" : "复制失败"}</span>`;
  if (copied) {
    clearTimeout(button._copyTimer);
    button._copyTimer = setTimeout(() => {
      button.innerHTML = `${icon("copy")}<span>复制讲解</span>`;
    }, 1800);
  }
  return copied;
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
    if (!e) throw new Error("名单条目不存在，请刷新页面再试");
    const r = await api(`/api/tasks/${taskId}/grants`, {
      method: "POST",
      form: { subject_name: e.name, roster_entry_id: String(entryId) } });
    showCredential(e.name, r.credential, r.warning);
    await loadRoster(taskId);
  });
}

async function issueAllGrants(taskId) {
  await guard(async () => {
    const d = await api(`/api/tasks/${taskId}/roster`);
    const todo = d.entries.filter(e => !e.granted && !e.exempt);
    if (!todo.length) { setFlash("所有名册主体都已发放凭证（免交主体不发放）", "ok"); return; }
    if (!window.confirm(`将为 ${todo.length} 个未发放凭证的主体各生成一个凭证，继续？`)) return;
    const out = [], failures = [];
    for (const e of todo) {
      try {
        const r = await api(`/api/tasks/${taskId}/grants`, {
          method: "POST",
          form: { subject_name: e.name, roster_entry_id: String(e.id) } });
        out.push({ name: e.name, credential: r.credential, warning: r.warning });
      } catch (error) {
        failures.push({ name: e.name, error: error.message || "请求未完成" });
      }
    }
    let rosterRefreshed = false;
    try { rosterRefreshed = await loadRoster(taskId); }
    catch { rosterRefreshed = false; }
    showCredentialList(out, failures, rosterRefreshed);
    setFlash(failures.length
      ? `已生成 ${out.length} 个凭证；${failures.length} 个结果未确认。${rosterRefreshed ? "先核对刷新后的发放状态，再逐项处理。" : "名册状态暂未刷新，请手动刷新后再处理未确认项。"}`
      : rosterRefreshed
        ? `已生成 ${out.length} 个凭证，请逐一复制并私下发给对应提交者。`
        : `已生成 ${out.length} 个凭证，但名册状态暂未刷新；请刷新页面核对状态。`,
      failures.length || !rosterRefreshed ? "warn" : "ok");
  });
}

function showCredential(name, cred, warning = "") {
  document.getElementById("grant-out").innerHTML = `
    <div class="credential-card">
      <div><span class="eyebrow">NEW CREDENTIAL · 仅显示这一次</span><b>${esc(name)}</b></div>
      <code>${esc(cred)}</code>
      ${warning ? `<p class="credential-warning" role="status">${esc(warning)}</p>` : ""}
      <div class="row-actions"><button class="sm" onclick="copyCredential(this.dataset.cred)" data-cred="${esc(cred)}">复制凭证</button><span class="muted">请通过私下渠道发给本人</span></div>
      <p class="field-help">同一提交主体重发后，旧凭证立即失效。请把新凭证通过私下渠道发给本人。</p>
    </div>`;
}
function showCredentialList(list, failures = [], rosterRefreshed = true) {
  document.getElementById("grant-out").innerHTML = `
    <div class="credential-card"><div><span class="eyebrow">NEW CREDENTIALS · 仅显示这一次</span><b>已生成 ${list.length} 个凭证</b></div>
    <p class="field-help">请逐一复制发给对应同学；关闭页面后无法再次查看明文。同一提交主体重发后，旧凭证立即失效。</p></div>
    ${list.length ? `<div class="credential-grid">${list.map(x => `<div class="credential-chip"><b>${esc(x.name)}</b><code>${esc(x.credential)}</code>${x.warning ? `<p class="credential-warning">${esc(x.warning)}</p>` : ""}<button class="ghost sm" onclick="copyCredential(this.dataset.cred)" data-cred="${esc(x.credential)}">复制</button></div>`).join("")}</div>` : ""}
    ${failures.length ? `<section class="credential-failures" aria-label="未确认的凭证发放结果"><h3>未确认结果 ${failures.length} 条</h3><ul>${failures.map(x => `<li><b>${esc(x.name)}</b><span>${esc(x.error)}</span></li>`).join("")}</ul><p>${rosterRefreshed ? "名册状态已刷新。对已显示“已发放”的条目，不要重复批量发放；确需更换凭证时请逐项重发，并将新凭证发给本人。" : "名册状态未能刷新。请先刷新名册核对每项状态，再处理未确认项；避免直接重复批量发放。"}</p></section>` : !rosterRefreshed ? `<p class="credential-warning" role="status">名册状态暂未刷新，请刷新页面核对发放状态。</p>` : ""}`;
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
  if (state.wbTaskId !== taskId) state.reminder = null;
  state.wbTaskId = taskId; state.wbFilter = state.wbFilter || "all";
  state.wbQuery = "";
  document.getElementById("app").innerHTML = `
    <div class="breadcrumb"><a href="#/tasks">我的任务</a><span>/</span><span id="wb-task-name">任务 #${taskId}</span></div>
    ${showcaseReturnHtml("收集工作台")}
    <div class="page-heading"><div><div class="eyebrow">COLLECTION WORKBENCH</div><h1>收集工作台<span class="heading-dot">.</span></h1><p>谁没交、谁要改、谁等你决定，都在这一页。</p></div>
      <div id="wb-lifecycle" class="row-actions"></div></div>
    <div id="flash" role="status" aria-live="polite"></div>
    <div id="wb-readonly"></div>
    <div id="wb-next-step"></div>
    <div id="wb-refresh-status" role="status" aria-live="polite"></div>
    <div class="overview-stats wb-summary" id="wb-stats"></div>
    <div class="wb-layout">
      <section class="card wb-panel" aria-label="提交者列表">
        <div class="section-toolbar"><div class="task-filters" role="group" aria-label="提交状态筛选">
          <button class="filter active" data-wbfilter="all" onclick="filterWorkbench('all')">全部</button>
          <button class="filter" data-wbfilter="todo" onclick="filterWorkbench('todo')">待处理</button>
          <button class="filter" data-wbfilter="submitted" onclick="filterWorkbench('submitted')">已提交</button>
          <button class="filter" data-wbfilter="missing" onclick="filterWorkbench('missing')">未提交</button>
          <button class="filter" data-wbfilter="exempt" onclick="filterWorkbench('exempt')">有效免交</button></div>
          <label class="search-box">${icon("search")}<input id="wb-search" aria-label="搜索提交者" placeholder="搜索姓名…" oninput="state.wbQuery=this.value;paintWorkbench()"></label></div>
        <div id="wb-list" aria-live="polite"><p class="empty">正在读取提交情况…</p></div>
      </section>
      <aside class="card remind-panel" id="remind-panel" aria-label="催交">
        <div class="remind-head"><div><div class="eyebrow">REMINDERS</div><h2>催交</h2></div><span class="badge warn" id="remind-count">—</span></div>
        <p class="muted">只生成可复制的通知内容，不宣称已发送。名单每次重算：已提交与免交会自动移出。</p>
        <div id="remind-body"><p class="empty">正在读取催交名单…</p></div>
      </aside>
    </div>`;
  if (state.wbDataTaskId === taskId) {
    paintWorkbench();
    paintReminder();
  }
  refreshWorkbench();
}

async function refreshWorkbench() {
  const taskId = state.wbTaskId, epoch = state.routeEpoch;
  const requestId = (state.wbRefreshRequestId || 0) + 1;
  state.wbRefreshRequestId = requestId;
  if (!taskId || location.hash !== `#/workbench/${taskId}`) return;
  const isCurrent = () => state.wbTaskId === taskId
    && epoch === state.routeEpoch && requestId === state.wbRefreshRequestId
    && location.hash === `#/workbench/${taskId}`;
  try {
    const [data, notif] = await Promise.all([
      api(`/api/tasks/${taskId}/workbench`),
      api(`/api/tasks/${taskId}/notifications`),
    ]);
    if (!isCurrent()) return;
    state.wbCounts = data.counts || {};
    state.wbTask = data.task || {}; state.wbRows = data.rows || [];
    state.wbDataTaskId = taskId;
    const previous = state.reminder;
    const content = document.getElementById("remind-content");
    const eligible = new Set((notif.view?.targets || []).map(x => x.subject_id));
    state.reminder = {
      ...previous,
      draftContent: content ? content.value : previous?.draftContent,
      view: notif.view || { targets: [], exempt: [], submitted: [], overdue: [] },
      notifications: notif.notifications || [],
      created: state.reminder?.created || null,
      selected: previous?.selected == null ? null : previous.selected.filter(id => eligible.has(id)),
    };
    const refreshStatus = document.getElementById("wb-refresh-status");
    if (refreshStatus) refreshStatus.innerHTML = "";
    paintWorkbench();
    paintReminder();
    const pending = state.wbRows.some(r => ["queued", "running", "retry_wait"].includes(r.run_status));
    clearTimeout(_wbTimer);
    if (pending) _wbTimer = setTimeout(refreshWorkbench, 3000);
  } catch (e) {
    if (!isCurrent()) return;
    const refreshStatus = document.getElementById("wb-refresh-status");
    const hasPreviousData = state.wbDataTaskId === taskId;
    if (refreshStatus) refreshStatus.innerHTML = `<div class="wb-refresh-notice" data-state="${hasPreviousData ? "stale" : "unavailable"}">
      <div><b>${hasPreviousData ? "显示的是上次读取的数据" : "提交情况尚未加载"}</b>
        <span>${hasPreviousData ? "当前暂时无法连接服务端；已有名单与进度仍可查看，恢复连接后请重新读取。" : `暂时无法连接服务端，${esc(e.message || "请检查连接后重试。")}`}</span></div>
      <button type="button" class="ghost sm" onclick="refreshWorkbench()">${icon("arrow")} 重试</button></div>`;
    if (!hasPreviousData) {
      const list = document.getElementById("wb-list");
      if (list) list.innerHTML = `<div class="empty-state wb-load-error"><div class="empty-icon">${icon("arrow")}</div><h3>名单暂时无法读取</h3><p>连接恢复后重试。读取成功前不会把名单显示为空。</p></div>`;
      const reminder = document.getElementById("remind-body");
      if (reminder) reminder.innerHTML = `<div class="empty-state wb-load-error"><p>催交名单暂时无法读取，请在连接恢复后重试。</p></div>`;
    }
  }
}

function chooseWorkbenchNextStep(rows, task) {
  const isTeam = task?.subject_kind === "team";
  const unit = isTeam ? "队" : "人";
  const formal = r => r.formal ?? (r.revision != null && r.summary !== "未正式提交");
  const priority = r => {
    const b = r.buckets || {};
    if ((b.blocking || []).length || r.summary === "待补正") return 0;
    if (r.eligibility?.required && ["not_assessed", "pending"].includes(r.eligibility.status)) return 1;
    if ((b.unknown || []).length || (b.human || []).length || r.summary === "待人工") return 2;
    if ((b.incomplete || []).length || r.summary === "检查未完成") return 3;
    if ((b.pending_jobs || []).length || ["排队中", "检查中"].includes(r.summary)) return 4;
    if (r.summary === "规则通过（待人工验收）") return 5;
    return 99;
  };
  const inScope = row => task?.mode !== "roster" || row.in_roster !== false;
  const actionable = rows.map((row, index) => ({row, index, priority: priority(row)}))
    .filter(x => x.priority < 99 && inScope(x.row) && formal(x.row) && !x.row.exempt)
    .sort((a, b) => a.priority - b.priority || a.index - b.index)[0]?.row;
  if (actionable) {
    const b = actionable.buckets || {};
    const blockingCount = (b.blocking || []).length;
    const pendingCount = blockingCount + (b.unknown || []).length
      + (b.human || []).length + (b.incomplete || []).length;
    const base = {name: actionable.name || "这位提交者", href: `#/review/${task.id}/${actionable.subject_id}`,
      action: "打开复核", kind: "review"};
    if (blockingCount || actionable.summary === "待补正") return {
      ...base, tone: "warn", kicker: "需要补正", title: `先看看${base.name}的材料`,
      detail: `${blockingCount ? `有 ${blockingCount} 项问题` : "还有问题"}尚未处理。确认问题不会自动结束补正，核对后再决定下一步。`};
    if (actionable.eligibility?.required && ["not_assessed", "pending"].includes(actionable.eligibility.status)) return {
      ...base, tone: "warn", kicker: "资格待核", title: `帮${base.name}核实一下资格`,
      detail: "资格需要单独核实；材料检查结果不会替你推断资格。"};
    if ((b.unknown || []).length || (b.human || []).length || actionable.summary === "待人工") return {
      ...base, tone: "info", kicker: "轮到人工核对", title: `和${base.name}一起看待确认项`,
      detail: `${pendingCount ? `有 ${pendingCount} 项待你核对` : "还有几项待你核对"}。机器不确定时会停下来，不会把没读到当成材料缺失。`};
    if ((b.incomplete || []).length || actionable.summary === "检查未完成") return {
      ...base, tone: "warn", kicker: "检查未完成", title: `${base.name}的检查还没跑完`,
      detail: "先看清技术原因，再决定重试或转人工；未完成不等于不通过。"};
    if ((b.pending_jobs || []).length || ["排队中", "检查中"].includes(actionable.summary)) return {
      ...base, tone: "info", kicker: "正在处理", title: `${base.name}的材料正在检查`,
      detail: "检查完成后结果会自动更新，你可以先看看当前进度。"};
    return {...base, tone: "ok", kicker: "还差最后一步", title: `${base.name}的规则检查已完成`,
      detail: "核对剩余事项后，单独验收当前版本即可。"};
  }
  const missing = rows.find(r => inScope(r) && !formal(r) && !r.exempt);
  if (missing) return {tone: "info", kicker: "等待正式提交", title: `${missing.name || "有提交者"}还没有正式提交`,
    detail: `草稿不会进入检查。可以先查看未提交名单，再决定是否提醒${unit}。`,
    action: "查看未提交名单", kind: "filter-missing"};
  if (rows.length && rows.every(r => r.exempt || r.acceptance === "accepted" || r.summary === "已验收")) return {
    tone: "ok", kicker: "暂时没有待处理事项", title: "这一轮的审核已经完成",
    detail: "如果准备交付，可以去查看纳入清单；固定快照前仍会逐项说明排除原因。",
    action: "查看交付清单", kind: "delivery"};
  return {tone: "neutral", kicker: "当前进度", title: "收集进度都在这里",
    detail: "有新的提交或检查结果时，这里会按实际状态整理下一步，不会替你做人工决定。",
    action: "查看名单", kind: "roster"};
}
function workbenchNextStepHtml(next, taskId) {
  if (!next) return "";
  const action = next.action ? next.kind === "review"
    ? `<a class="wb-next-action" href="${esc(next.href)}">${esc(next.action)} ${icon("arrow")}</a>`
    : next.kind === "delivery" ? `<a class="wb-next-action" href="#/delivery/${taskId}">${esc(next.action)} ${icon("arrow")}</a>`
    : next.kind === "roster" ? `<a class="wb-next-action" href="#/roster/${taskId}">${esc(next.action)} ${icon("arrow")}</a>`
    : `<button class="wb-next-action" onclick="filterWorkbench('missing',true)">${esc(next.action)} ${icon("arrow")}</button>` : "";
  return `<section class="wb-next-step ${esc(next.tone || "neutral")}" aria-label="下一步建议">
    <div class="wb-next-mark" aria-hidden="true">${next.tone === "ok" ? icon("check") : icon("arrow")}</div>
    <div class="wb-next-copy"><span class="wb-next-kicker">${esc(next.kicker)}</span><h2>${esc(next.title)}</h2><p>${esc(next.detail)}</p></div>
    ${action}</section>`;
}
function wbMatches(r, filter) {
  const hasRevision = r.formal ?? (r.revision != null && r.summary !== "未正式提交");
  if (filter === "todo") return hasRevision && (["待补正", "待人工", "检查未完成"].includes(r.summary)
    || (r.eligibility?.required && ["not_assessed", "pending"].includes(r.eligibility.status)));
  const inScope = state.wbTask?.mode !== "roster" || r.in_roster;
  if (filter === "roster") return !!r.in_roster;
  if (filter === "eligibility") return inScope && !r.exempt && r.eligibility?.required && ["not_assessed", "pending"].includes(r.eligibility.status);
  if (filter === "exempt") return inScope && !!r.exempt;
  if (filter === "required") return inScope && !r.exempt;
  if (filter === "accepted") return inScope && !r.exempt && r.acceptance === "accepted";
  if (filter === "submitted") return inScope && (state.wbTask?.mode !== "roster" || !r.exempt) && hasRevision;
  if (filter === "missing") return inScope && !hasRevision && !r.exempt;
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
  const nextStep = chooseWorkbenchNextStep(rows, {...t, id: taskId});
  const nextBox = document.getElementById("wb-next-step");
  if (nextBox) nextBox.innerHTML = workbenchNextStepHtml(nextStep, taskId);

  const count = (pred) => rows.filter(pred).length;
  const c = state.wbCounts || {};
  const metrics = t.mode === "open" ? [
    ["已登记", c.registered || 0, "roster", "all"], ["已正式提交", c.submitted || 0, "workbench", "submitted"],
    ["已验收", c.accepted || 0, "review", "accepted"],
  ] : [
    ["名册主体", c.roster || 0, "roster", "roster"], ["免交", c.exempt || 0, "roster", "exempt"],
    ["应交", c.required || 0, "roster", "required"], ["已正式提交", c.submitted || 0, "workbench", "submitted"],
    ["未正式提交", c.unsubmitted || 0, "delivery", "missing"], ["已验收", c.accepted || 0, "review", "accepted"],
  ];
  if (c.eligibility_pending != null) metrics.push(["资格待核", c.eligibility_pending, "review", "eligibility"]);
  const stats = document.getElementById("wb-stats");
  if (stats) stats.classList.toggle("open-qualification", t.mode === "open" && c.eligibility_pending != null);
  if (stats) stats.innerHTML = metrics.map(([label2, value, ic, filter]) =>
    `<button type="button" class="overview-stat" aria-pressed="${state.wbFilter === filter}" onclick="filterWorkbench('${filter}',true)"><span>${label2}${t.subject_kind === 'team' ? '（队）' : ''}</span><strong>${String(value).padStart(2, "0")}</strong><i>${icon(ic)}</i></button>`).join("");

  const q = (state.wbQuery || "").trim().toLowerCase();
  const visible = rows.filter(r => (r.name || "").toLowerCase().includes(q) && wbMatches(r, state.wbFilter));
  document.querySelectorAll("[data-wbfilter]").forEach(el => {
    const on = el.dataset.wbfilter === state.wbFilter;
    el.classList.toggle("active", on); el.setAttribute("aria-pressed", String(on));
  });
  const box = document.getElementById("wb-list");
  if (!box) return;
  if (!rows.length) {
    box.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon("roster")}</div><h3>还没有提交主体</h3><p>先去 <a href="#/roster/${taskId}">名单与凭证</a> 导入名单或创建提交空间，这里就会显示每个人的进度。</p></div>`;
    return;
  }
  if (!visible.length) { box.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon("search")}</div><h3>没有符合条件的提交者</h3><p>试试其他关键词或筛选条件。</p></div>`; return; }
  box.innerHTML = `<div class="wb-list-head"><span>提交者</span><span>状态</span><span>待办</span><span>操作</span></div>` +
    visible.map(r => {
      const b = r.buckets || {};
      const hasRevision = r.formal ?? (r.revision != null && r.summary !== "未正式提交");
      const ruleTitle = id => r.rule_labels?.[id] || id;
      const tags = [
        ...(r.eligibility?.required && ["not_assessed", "pending"].includes(r.eligibility.status) ? ['<span class="badge warn">核实资格后再验收</span>'] : []),
        ...(b.blocking || []).map(x => `<span class="badge bad">需要更正：${esc(ruleTitle(x))}</span>`),
        ...(b.unknown || []).map(x => `<span class="badge warn">待确认：${esc(ruleTitle(x))}</span>`),
        ...(b.human || []).map(x => `<span class="badge info">组织者核对：${esc(ruleTitle(x))}</span>`),
        ...(b.incomplete || []).map(x => `<span class="badge warn">检查未完成：${esc(ruleTitle(x))}</span>`),
        ...(b.pending_jobs || []).map(x => `<span class="badge info">${esc(RUN_LABEL[x] || x)}</span>`),
      ].join("");
      const canRetry = !ro && r.run_status === "failed";
      return `<article class="wb-row">
        <div class="wb-person"><span class="wb-avatar" aria-hidden="true">${esc((r.name || "?").slice(0, 1))}</span><div><b>${esc(r.name)}</b><span>${r.subject_id ? `主体 #${r.subject_id}` : "尚未发放凭证"}${hasRevision ? ` · v${r.revision}` : ""}</span></div></div>
        <div class="wb-state"><span class="badge ${WB_BADGE[r.summary] ?? ""}">${esc(r.exempt ? (hasRevision ? "免交 · 已正式提交" : "免交") : r.summary)}</span>${r.eligibility && (r.eligibility.required || r.eligibility.status !== 'not_assessed') ? eligibilityBadge(r.eligibility) : ''}${r.acceptance === "accepted" && r.summary !== "已验收" ? '<span class="badge ok">已验收</span>' : ""}</div>
        <div class="wb-buckets">${tags || `<span class="muted">${hasRevision ? "暂无待办" : (r.exempt ? "无需提交" : "等待提交")}</span>`}</div>
        <div class="wb-actions">${hasRevision ? `<a class="ghost sm" href="#/review/${taskId}/${r.subject_id}">复核 ${icon("arrow")}</a>` : (r.exempt ? "" : r.subject_id ? `<button class="ghost sm" onclick="remindTarget(${r.subject_id})">提醒</button>` : `<a class="ghost sm" href="#/roster/${taskId}">发放凭证</a>`)}
          ${!hasRevision && r.subject_id ? `<a class="ghost sm" href="#/review/${taskId}/${r.subject_id}">${r.eligibility?.required ? "资格与免交" : r.exempt ? "免交与历史" : "处理免交"} ${icon("arrow")}</a>` : ""}
          ${hasRevision && !ro ? `<button class="ghost sm" onclick="runCheck(${taskId},${r.subject_id})">重新检查</button>` : ""}
          ${canRetry ? `<button class="ghost sm" onclick="retryCheck(${taskId},${r.subject_id})" title="上次检查技术失败：重试生成新运行，旧运行标记被取代并保留">重试</button>` : ""}
        </div></article>`;
    }).join("");
}

function filterWorkbench(f, fromMetric = false) {
  state.wbFilter = f;
  if (fromMetric) {
    state.wbQuery = "";
    const search = document.getElementById("wb-search"); if (search) search.value = "";
  }
  paintWorkbench();
}

/* ---- 催交：通知意图（只记录「已复制」，不宣称已发送） ---- */
function paintReminder() {
  const box = document.getElementById("remind-body"), badge = document.getElementById("remind-count");
  const rem = state.reminder; if (!box || !rem) return;
  const v = rem.view, targets = v.targets || [];
  const currentContent = document.getElementById("remind-content");
  if (currentContent) rem.draftContent = currentContent.value;
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
  const focus = captureTextFocus(["remind-content"]);
  box.innerHTML = `
    <div class="remind-groups">
      <div class="remind-stat"><b>${targets.length}</b><span>可催交</span></div>
      <div class="remind-stat"><b>${(v.submitted || []).length}</b><span>已提交</span></div>
      <div class="remind-stat"><b>${(v.overdue || []).length}</b><span>已逾期</span></div>
      <div class="remind-stat"><b>${(v.exempt || []).length}</b><span>免交</span></div>
    </div>
    ${targets.length ? `<div class="target-list" role="group" aria-label="选择催交对象">${chips}</div>` : `<p class="muted">当前没有可催交对象：已提交、免交或已过首次截止的主体不再催交。</p>`}
    ${muted.length ? `<details class="remind-muted"><summary>不催交的 ${muted.length} ${state.wbTask?.subject_kind === 'team' ? '队' : '位'}</summary><p>${muted.join('、')}</p></details>` : ""}
    ${targets.length ? `<label for="remind-content">通知内容</label>
      <textarea id="remind-content" placeholder="例如：请在本周五 18:00 前完成提交，材料要求见任务说明。">${esc(rem.draftContent ?? defaultRemindText())}</textarea>
      <button class="sm" onclick="createReminder()" ${chosen.size ? "" : "disabled"}>生成催交通知（${chosen.size} ${state.wbTask?.subject_kind === 'team' ? '队' : '人'}）</button>` : ""}
    ${created ? `<div class="remind-created"><div class="eyebrow">READY TO COPY</div><p class="remind-content-text">${esc(created.content)}</p><div class="target-tags">${(created.targets || []).map(x => `<span class="pill">${esc(x.name)}</span>`).join("")}</div><div class="row-actions"><button class="sm" onclick="copyReminder(${created.id})">复制并标记已复制</button><span class="muted" id="remind-copy-state">${created.status === "copied" ? "已复制" : "尚未复制"}</span></div></div>` : ""}
    ${(rem.notifications || []).length ? `<details class="remind-history"><summary>历史通知意图（${rem.notifications.length}）</summary>${rem.notifications.map(n => `<div class="remind-history-row"><span class="badge ${n.status === "copied" ? "ok" : ""}">${n.status === "copied" ? "已复制" : "待复制"}</span><span>${(n.targets || []).length} ${state.wbTask?.subject_kind === 'team' ? '队' : '人'} · ${esc(fmtTime(n.created_at))}</span><p>${esc(n.content)}</p></div>`).join("")}</details>` : ""}`;
  restoreTextFocus(focus);
}
function defaultRemindText() {
  const t = state.wbTask || {};
  const deadline = t.first_deadline
    ? `请在首次截止时间 ${fmtTimeShort(t.first_deadline, t.timezone)} 前完成登记并上传材料。`
    : "请按任务说明完成登记并上传材料。";
  return `你好，${t.name || "本次收集"}还差你的材料。${deadline}如已提交请忽略。`;
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
    setFlash(`已生成催交通知，目标 ${r.targets.length} ${state.wbTask?.subject_kind === 'team' ? '队' : '人'}（尚未发送，复制后请自行发送）`, "ok");
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
async function offlineReplayCheck(taskId, sid) {
  if (!confirm("这会排队一次离线脚本回放：不调用外部模型，只用于展示 Agent 运行链和人工接手边界。继续？")) return;
  await guard(async () => {
    const r = await api(`/api/tasks/${taskId}/subjects/${sid}/checks/offline-replay`, { method: "POST" });
    setFlash(`已排队离线脚本回放：运行 #${r.run_id}，完成后会在这里标明结果来源`, "ok");
    await viewReview(taskId, sid);
  });
}

/* ---------------------------------------------------------------- P03 证据复核 */
const RUN_LABEL = {queued: "排队中", running: "检查中", retry_wait: "等待重试", success: "检查完成", failed: "检查失败"};
const DECISION_LABEL = {confirm_issue: "确认问题（需补正）", confirm_pass: "人工核对通过", correct_false_positive: "纠正误报",
  approve_exception: "批准例外", eligibility: "资格复核", exempt: "免交", accept_current: "验收本版本", revoke: "撤销决定"};
const RESULT_LABEL = {satisfied: "满足", issue: "问题", unknown: "待确认", not_applicable: "不适用", failed: "检查未完成", manual_pending: "人工核对"};
const ELIGIBILITY_LABEL = {not_assessed: "未评估", pending: "待核实", eligible: "符合", ineligible: "不符合"};
const eligibilityBadge = q => q ? `<span class="badge ${q.status === 'eligible' ? 'ok' : q.status === 'ineligible' ? 'bad' : 'warn'}">资格：${esc(ELIGIBILITY_LABEL[q.status] || '待核实')}</span>` : '';
const severityLabel = value => ({blocking: "阻塞验收", advisory: "提醒项"}[value] || value || "未标级别");
// Background refreshes must not move the cursor while someone is writing.
function captureTextFocus(ids) {
  const el = document.activeElement;
  return el && ids.includes(el.id) ? {id: el.id, start: el.selectionStart, end: el.selectionEnd} : null;
}
function restoreTextFocus(saved) {
  const el = saved && document.getElementById(saved.id);
  if (!el) return;
  el.focus({preventScroll: true});
  if (typeof saved.start === "number") el.setSelectionRange(saved.start, saved.end);
}
// Session-only storage: refresh-safe, never sent as a decision automatically.
const REVIEW_DRAFT_KEY = "ff_review_drafts:v1";
const REVIEW_DRAFT_TTL = 7 * 24 * 60 * 60 * 1000;
function loadReviewDrafts() {
  if (state.reviewDraftsLoaded) return;
  state.reviewDraftsLoaded = true;
  state.reviewDrafts ||= {};
  try {
    const stored = JSON.parse(sessionStorage.getItem(REVIEW_DRAFT_KEY) || "{}");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) throw new Error("invalid draft");
    for (const [key, draft] of Object.entries(stored)) {
      if (!/^[a-f0-9]{64}$/.test(key) || !draft || typeof draft !== "object" ||
          !Number.isFinite(draft.updatedAt) || Date.now() - draft.updatedAt > REVIEW_DRAFT_TTL ||
          draft.updatedAt > Date.now() || !draft.rules || typeof draft.rules !== "object" || Array.isArray(draft.rules)) continue;
      const rules = Object.create(null);
      for (const [rule, values] of Object.entries(draft.rules)) {
        if (!values || typeof values !== "object") continue;
        rules[rule] = Object.fromEntries(["dc-type", "dc-exp", "dc-reason"]
          .filter(id => typeof values[id] === "string").map(id => [id, values[id]]));
      }
      state.reviewDrafts[key] = {rules, acceptanceReason: typeof draft.acceptanceReason === "string" ? draft.acceptanceReason : "",
        eligibility: Object.fromEntries(["eligibility-result", "eligibility-reason", "eligibility-exp"]
          .filter(id => typeof draft.eligibility?.[id] === "string").map(id => [id, draft.eligibility[id]])),
        activeRule: typeof draft.activeRule === "string" ? draft.activeRule : null, updatedAt: draft.updatedAt};
    }
  } catch (e) { state.reviewCacheFailed = true; }
}
function reviewDraftStatus() {
  const el = document.getElementById("review-draft-status");
  if (el) el.textContent = state.reviewCacheFailed
    ? "暂存不可用：理由仅保留在当前页面，请勿刷新或关闭。"
    : "理由已在本标签页暂存 · 刷新可恢复 · 尚未提交决定";
}
function persistReviewDrafts() {
  try {
    const entries = Object.entries(state.reviewDrafts || {}).filter(([key, d]) =>
      /^[a-f0-9]{64}$/.test(key) && Date.now() - d.updatedAt <= REVIEW_DRAFT_TTL)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 50);
    sessionStorage.setItem(REVIEW_DRAFT_KEY, JSON.stringify(Object.fromEntries(entries)));
    state.reviewDrafts = Object.fromEntries(entries);
    state.reviewCacheFailed = false;
  } catch (e) { state.reviewCacheFailed = true; }
  reviewDraftStatus();
}
function cacheReviewDraft() {
  if (!state.reviewContext || !document.getElementById("dc-reason")) return;
  loadReviewDrafts();
  const draft = state.reviewDrafts[state.reviewContext] ||= {rules: Object.create(null)};
  draft.rules[state.reviewRule || ""] = Object.fromEntries(["dc-type", "dc-exp", "dc-reason"]
    .map(id => [id, document.getElementById(id)?.value || ""]));
  const acceptance = document.getElementById("acceptance-reason");
  if (acceptance) draft.acceptanceReason = acceptance.value;
  if (document.getElementById("eligibility-reason")) draft.eligibility = Object.fromEntries(
    ["eligibility-result", "eligibility-reason", "eligibility-exp"].map(id => [id, document.getElementById(id)?.value || ""]));
  draft.activeRule = state.reviewRule;
  draft.updatedAt = Date.now();
  persistReviewDrafts();
}
function discardReviewDraft(taskId, sid) {
  if (state.deciding || !confirm("清空此主体、版本和成员范围内所有未提交的理由？已提交的决定不受影响。")) return;
  delete state.reviewDrafts?.[state.reviewContext];
  persistReviewDrafts();
  paintReview(taskId, sid);
  setFlash("已清空当前复核范围的理由草稿，已提交决定不受影响。", "ok");
}
window.addEventListener("pagehide", cacheReviewDraft);
async function viewReview(taskId, sid) {
  cacheReviewDraft();
  state.reviewContext = null;
  // 缺少或非法的提交主体时，不要拿 NaN 去打接口，直接给一句人话
  if (!Number.isFinite(taskId) || taskId <= 0) { location.hash = "#/tasks"; return false; }
  if (!Number.isFinite(sid) || sid <= 0) {
    document.getElementById("app").innerHTML = `
      <div class="breadcrumb"><a href="#/tasks">我的任务</a><span>/</span><a href="#/workbench/${taskId}">收集工作台</a><span>/</span><span>证据复核</span></div>
      ${showcaseReturnHtml("证据复核")}
      <div class="page-heading"><div><div class="eyebrow">EVIDENCE REVIEW</div><h1>逐条核对证据<span class="heading-dot">.</span></h1><p>每处判断都附原文位置。解释不改变机器结论，最终由你决定。</p></div></div>
      <div class="card"><div class="empty-state"><div class="empty-icon">${icon("review")}</div>
        <h3>先选一位提交者</h3>
        <p>复核是针对某个人这一版材料的。回工作台点某一行右侧的「复核」，就能进到对应证据。</p>
        <a class="ghost sm" href="#/workbench/${taskId}">回到收集工作台 ${icon("arrow")}</a></div></div>`;
    return false;
  }
  const epoch = state.routeEpoch, requestId = (state.reviewRequestId || 0) + 1;
  state.reviewRequestId = requestId;
  state.reviewConflict = false;
  document.getElementById("app").innerHTML = `
    <div class="breadcrumb"><a href="#/tasks">我的任务</a><span>/</span><a href="#/workbench/${taskId}">收集工作台</a><span>/</span><span id="rv-name">证据复核</span></div>
    ${showcaseReturnHtml("证据复核")}
    <div class="page-heading"><div><div class="eyebrow">EVIDENCE REVIEW</div><h1>逐条核对证据<span class="heading-dot">.</span></h1><p>每处判断都附原文位置。解释不改变机器结论，最终由你决定。</p></div><div id="review-retry"></div></div>
    <div id="flash" role="status" aria-live="polite"></div>
    <div id="rv"><p class="empty">正在读取检查结果…</p></div>
    <dialog id="revoke-dialog" aria-labelledby="revoke-title" oncancel="if(state.revokeBusy) event.preventDefault()"><form onsubmit="event.preventDefault();confirmRevokeDecision()">
      <h2 id="revoke-title">撤销决定</h2><p id="revoke-impact"></p>
      <label for="revoke-reason">撤销理由（必填）</label><textarea id="revoke-reason" required placeholder="说明为什么撤销；原决定及撤销记录都会保留"></textarea>
      <div id="revoke-error" role="alert" class="inline-error"></div>
      <div class="dialog-actions"><button type="button" id="revoke-cancel" class="ghost" onclick="this.closest('dialog').close()">取消</button><button type="submit" id="revoke-confirm">确认撤销</button></div>
    </form></dialog>`;
  try {
    const d = await api(`/api/tasks/${taskId}/subjects/${sid}/findings`);
    if (epoch !== state.routeEpoch || requestId !== state.reviewRequestId) return;
    loadReviewDrafts();
    if (!/^[a-f0-9]{64}$/.test(d.review_context || "")) throw new Error("复核范围缺失，请刷新后重试；未提交理由不会套用到未知范围。");
    const context = d.review_context;
    const saved = state.reviewDrafts[context];
    if (saved && Date.now() - saved.updatedAt > REVIEW_DRAFT_TTL) delete state.reviewDrafts[context];
    state.reviewRule = state.reviewDrafts[context]?.activeRule || null;
    state.reviewContext = context;
    state.reviewData = d;
    document.getElementById("rv-name").textContent = d.subject.name;
    paintReview(taskId, sid);
    return true;
  } catch (e) {
    if (epoch === state.routeEpoch && requestId === state.reviewRequestId) {
      const box = document.getElementById("rv");
      if (box) box.innerHTML = `<div class="notice-warn" role="alert"><b>检查结果暂时无法读取</b><p>${esc(e.message || "请检查提交者是否属于当前任务，或稍后重试。")}</p><button class="ghost sm" onclick="viewReview(${taskId},${sid})">重试加载</button> <a class="ghost sm" href="#/workbench/${taskId}">回到收集工作台</a></div>`;
    }
    return false;
  }
}

function reviewRevisionHistoryHtml(history, currentRevision) {
  if (!history?.length) return '';
  const rows = history.slice().reverse().map(item => {
    const current = item.current || item.id === currentRevision?.id;
    const fieldChanges = (item.field_changes || []).map(change => {
      const label = change.kind === 'added' ? '新增字段' : change.kind === 'removed' ? '移除字段' : '字段变更';
      return `<span class="review-version-change">${esc(label)} · ${esc(change.id)}</span>`;
    }).join('');
    const fileChanges = [
      ...(item.added_files || []).map(file => `<span class="review-version-change">新增材料 · ${esc(file.name)}</span>`),
      ...(item.removed_files || []).map(file => `<span class="review-version-change">移除材料 · ${esc(file.name)}</span>`),
    ].join('');
    return `<li class="review-version-row ${current ? 'current' : ''}">
      <div class="review-version-head"><div><b>正式 v${esc(item.version)}</b>${current ? '<span class="badge ok">当前复核版本</span>' : '<span class="badge">历史版本</span>'}</div><time>${esc(fmtTimeShort(item.submitted_at))}</time></div>
      <div class="review-version-meta"><span>${esc(item.summary)}</span><span>${item.field_count} 个字段 · ${item.file_count} 份材料</span></div>
      ${fieldChanges || fileChanges ? `<div class="review-version-changes">${fieldChanges}${fileChanges}</div>` : ''}
      <p class="review-version-receipt">回执 ${esc(item.receipt)}${current ? ' · Agent 只读取这一版' : ' · 仅供对照，不能套用本次结论'}</p>
    </li>`;
  }).join('');
  return `<section class="card review-version-history" aria-label="正式版本对照">
    <div class="section-heading"><div><div class="eyebrow">VERSION SCOPE</div><h2>正式版本对照</h2></div><span class="muted">共 ${history.length} 个正式版本</span></div>
    <p class="review-version-intro">当前运行、证据和人工决定都绑定当前正式版本；历史版本只帮助你看清这次补交改了什么。</p>
    <ol class="review-version-list">${rows}</ol>
  </section>`;
}

function paintReview(taskId, sid) {
  const d = state.reviewData; if (!d) return;
  const rules = [...(d.rules || [])].sort((a, b) => {
    const priority = r => r.decision?.decision === "confirm_issue" ? 0 : r.decision?.resolves ? 2 : ["satisfied", "not_applicable"].includes(r.result) ? 1 : 0;
    return priority(a) - priority(b);
  });
  if (!rules.some(r => r.rule_id === state.reviewRule)) state.reviewRule = rules[0]?.rule_id || null;
  const active = rules.find(r => r.rule_id === state.reviewRule) || null;
  const run = d.run, notes = d.notes || [];
  const reviewFiles = new Map((d.files || []).map(file => [file.file_id, file]));
  const retry = document.getElementById("review-retry");
  const activeRun = run && ["queued", "running", "retry_wait"].includes(run.status);
  const replay = d.offline_replay;
  if (retry) retry.innerHTML = [
    run && run.status === "failed"
      ? `<button class="ghost" onclick="retryCheck(${taskId},${sid},'review')" title="上次检查技术失败：重试生成新运行，旧运行标记被取代并保留">${icon("arrow")} 重试检查</button>` : "",
    replay?.available && !activeRun
      ? `<button class="ghost" onclick="offlineReplayCheck(${taskId},${sid})" title="仅演示任务可用：确定性脚本回放，不调用外部模型">${icon("sparkle")} 回放离线检查</button>` : "",
  ].join("");

  const qualification = d.eligibility;
  const acceptance = d.acceptance || {ready: false, blockers: ["请刷新复核状态"]};
  const counts = { issue: 0, unknown: 0, failed: 0, satisfied: 0, manual: 0, manualResolved: 0 };
  rules.forEach(r => { if (r.decision?.decision === "confirm_issue") { counts.issue++; return; } if (r.decision?.resolves) { counts.satisfied++; counts.manualResolved++; return; } if (r.result === "manual_pending") counts.manual++; if (r.result === "issue") counts.issue++; else if (r.result === "unknown") counts.unknown++; else if (r.result === "failed") counts.failed++; else if (r.result === "satisfied") counts.satisfied++; });
  const cov = run && run.coverage ? run.coverage : null;
  const gap = cov ? (cov.unread_pages || 0) + (cov.failed_pages || 0) : 0;

  const pending = rules.filter(needsReview);
  const nextAction = pending.length
    ? `<div class="review-next-action review-next-action-warn" role="status"><div><span class="eyebrow">NEXT ACTION</span><strong>先处理 ${pending.length} 项待人工核对</strong><p>组织者需要核对原文或作出决定；提交者不需要为这些项目重复提交材料。</p></div><button class="ghost sm" onclick="nextPendingReview(${taskId},${sid})">跳到下一项待处理 ${icon("arrow")}</button></div>`
    : rules.length && acceptance.ready
      ? `<div class="review-next-action review-next-action-ok" role="status"><div><span class="eyebrow">NEXT ACTION</span><strong>材料规则已处理，可以验收本版本</strong><p>验收仍只针对当前正式版本，资格和验收依据会单独记录。</p></div><button class="ghost sm" onclick="jumpReviewSection('review-acceptance')">查看验收 ${icon("arrow")}</button></div>`
      : rules.length
        ? `<div class="review-next-action review-next-action-info" role="status"><div><span class="eyebrow">NEXT ACTION</span><strong>材料规则已处理，继续查看验收前置条件</strong><p>如果资格或覆盖范围仍有待办，先处理这些事项再决定是否验收。</p></div><button class="ghost sm" onclick="jumpReviewSection('review-acceptance')">查看前置条件 ${icon("arrow")}</button></div>`
        : `<div class="review-next-action review-next-action-info" role="status"><div><span class="eyebrow">NEXT ACTION</span><strong>先回工作台发起材料检查</strong><p>当前主体还没有可展示的规则结果；正式提交后才能验收材料。</p></div><a class="ghost sm" href="#/workbench/${taskId}">回工作台 ${icon("arrow")}</a></div>`;
  const evidenceStep = rules.length
    ? `<button class="ghost sm" onclick="jumpReviewSection('review-evidence')"><b>01</b> 核对材料 <span>${pending.length} 项待决定</span></button>`
    : `<button class="ghost sm" disabled title="本版本没有材料检查规则"><b>01</b> 核对材料 <span>本版本无规则</span></button>`;
  const workflow = `<nav class="review-workflow" aria-label="复核步骤">
    ${evidenceStep}
    <button class="ghost sm" onclick="jumpReviewSection('review-eligibility')" ${qualification ? '' : 'disabled'}><b>02</b> 核实资格 <span>${esc(ELIGIBILITY_LABEL[qualification?.status] || '未启用')}</span></button>
    <button class="ghost sm" onclick="jumpReviewSection('review-acceptance')"><b>03</b> 验收版本 <span>${d.acceptance?.accepted ? '已验收' : d.acceptance?.ready ? '可验收' : '尚有前置待办'}</span></button>
  </nav>`;
  const meta = `<section class="review-summary card">
    <div class="review-subject"><span class="wb-avatar">${esc((d.subject.name || "?").slice(0, 1))}</span><div><h2>${esc(d.subject.name)}</h2><span>主体 #${d.subject.id}${d.revision ? ` · 当前版本 v${d.revision.version} · 回执 ${esc(d.revision.receipt)}` : ""}${run ? ` · 运行 #${run.id}（${esc(RUN_LABEL[run.status] || run.status)}）` : ""}</span>${run?.execution_mode === "offline_replay" ? `<span class="badge info review-run-source">离线脚本回放 · 不调用外部模型</span>` : ""}</div></div>
    ${qualification && (qualification.required || qualification.status !== 'not_assessed') ? `<div>${eligibilityBadge(qualification)} <span class="muted">${esc(qualification.status_reason)}</span></div>` : ''}
    <div class="review-scope"><span class="badge info">本次复核范围</span><span>主体 #${d.subject.id} · ${d.revision ? `正式 v${d.revision.version}` : "尚未正式提交"} · ${qualification?.members?.length ? `登记成员：${qualification.members.map(esc).join("、")}` : "个人 / 未登记团队成员"}</span><p>理由只恢复到相同账号、主体、版本、成员与检查证据；范围变化后请重新核对。</p></div>
    <div class="review-metrics">${[["问题", counts.issue, "bad", ""], ["待人工核对", counts.unknown + counts.manual, "warn", ""], ["检查未完成", counts.failed, "info", ""], ["已满足", counts.satisfied, "ok", counts.manualResolved ? `含人工处理 ${counts.manualResolved} 项；机器结论 ${Math.max(0, counts.satisfied - counts.manualResolved)} 项` : "机器结论"]].map(([l, n, c, note]) => `<div class="review-metric"><strong class="${c}">${n}</strong><span>${l}</span>${note ? `<small>${esc(note)}</small>` : ""}</div>`).join("")}</div>
    <p class="review-metric-note">统计口径：已满足包含组织者人工核对通过的项目；原始机器结论与人工决定会在规则明细中分别保留。</p>
    ${run?.execution_mode === "offline_replay" ? `<div class="notice-info review-replay-note"><b>这是离线演示回放</b><p>结果由演示脚本桩沿同一 Skill、工具白名单、Harness 预算和审计链生成，不代表真实模型质量；unknown / failed 仍需组织者人工处理。</p></div>` : ""}
    ${nextAction}
    ${gap ? `<div class="notice-warn">材料共 ${gap} 页未能读取。这些页不构成「确认缺失」，相关规则按待确认处理；请让提交者补充清晰材料，或人工核对。</div>` : ""}
  </section>`;

  const visibleRules = state.reviewFilter === "pending" ? pending : rules;
  const reviewGroups = [
    {key: "pending", label: "待人工", note: "需要组织者核对原文或作出判断", tone: "warn"},
    {key: "issue", label: "有问题", note: "发现不符合，或已经确认需要补正", tone: "bad"},
    {key: "failed", label: "检查未完成", note: "本次运行没有形成可靠结论", tone: "info"},
    {key: "done", label: "已满足", note: "已满足、不适用，或已被人工处理", tone: "ok"},
  ];
  const reviewBucket = rule => {
    if (rule.decision?.resolves || ["satisfied", "not_applicable"].includes(rule.result)) return "done";
    if (rule.decision?.decision === "confirm_issue" || rule.result === "issue") return "issue";
    if (rule.result === "failed") return "failed";
    return "pending";
  };
  const ruleButton = r => {
    const on = r.rule_id === state.reviewRule;
    const status = r.decision ? (DECISION_LABEL[r.decision.decision] || "已有人工决定") : (RESULT_LABEL[r.result] || "待核对");
    const done = reviewBucket(r) === "done";
    const severity = severityLabel(r.severity);
    const ariaStatus = done ? status : `${status}；${severity}`;
    return `<button class="review-rule-item ${on ? "on" : ""}" aria-current="${on}" aria-label="${esc((r.requirement && r.requirement.statement) || r.explanation || "待核对的一项要求")}；${esc(ariaStatus)}" data-review-rule="${esc(r.rule_id)}">
      <span class="review-rule-text">${esc((r.requirement && r.requirement.statement) || r.explanation || "待核对的一项要求")}</span>
      <span class="review-rule-side">${r.decision ? `<span class="badge ${r.decision.decision === "confirm_issue" ? "bad" : "info"}">${esc(DECISION_LABEL[r.decision.decision] || "已有人工决定")}</span>` : resultBadge(r.result)}${done ? "" : `<span class="rule-severity">${esc(severity)}</span>`}</span>
    </button>`;
  };
  const groupedRules = reviewGroups.map(group => ({...group, rules: visibleRules.filter(r => reviewBucket(r) === group.key)})).filter(group => group.rules.length);
  const groupedList = groupedRules.map(group => `<section class="review-group review-group-${group.tone}" aria-label="${group.label}">
    <div class="review-group-head"><div><b>${group.label}</b><span>${group.note}</span></div><em>${group.rules.length}</em></div>
    <div class="review-group-items">${group.rules.map(ruleButton).join("")}</div>
  </section>`).join("");
  const emptyFilterText = state.reviewFilter === "pending" ? "当前没有待处理规则" : "当前没有可展示的规则";
  const list = rules.length ? `<div class="review-list-actions">
    <div class="review-list-summary"><span id="review-queue-status" role="status" aria-live="polite">${state.reviewFilter === "pending" ? `当前显示 ${pending.length} 项待处理规则` : `当前显示全部 ${rules.length} 项规则`}${active ? `，已选中${esc(active.requirement?.statement || "当前规则")}` : ""}</span><span class="review-filter" role="group" aria-label="规则筛选">
      <button class="ghost sm ${state.reviewFilter === "all" ? "selected" : ""}" data-review-filter="all" aria-pressed="${state.reviewFilter === "all"}" onclick="setReviewFilter('all',${taskId},${sid})">全部</button>
      <button class="ghost sm ${state.reviewFilter === "pending" ? "selected" : ""}" data-review-filter="pending" aria-pressed="${state.reviewFilter === "pending"}" ${pending.length ? "" : "disabled"} onclick="setReviewFilter('pending',${taskId},${sid})">只看待处理</button>
    </span></div>
    <button class="ghost sm" ${pending.length ? '' : 'disabled'} onclick="nextPendingReview(${taskId},${sid})">下一待处理 ↓</button>
  </div>${visibleRules.length ? `<div class="review-rules" role="group" aria-label="检查规则">${groupedList}</div>` : `<div class="review-filter-empty"><b>${emptyFilterText}</b><span>${state.reviewFilter === "pending" ? "已处理的规则仍保留在“全部”中。" : "当前版本还没有可以展示的检查项。"}</span>${state.reviewFilter === "pending" ? `<button class="link" onclick="setReviewFilter('all',${taskId},${sid})">查看全部规则</button>` : ""}</div>`}` : `<div class="empty-state"><div class="empty-icon">${icon("workbench")}</div><h3>${d.revision ? run?.status === 'success' ? "本版本没有材料检查规则" : "暂无规则结果" : "尚无正式提交"}</h3><p>${d.revision ? run?.status === 'success' ? "材料检查已完成，请核对独立资格与验收状态。" : "可能尚未检查。回到工作台发起检查，或稍后刷新。" : "现在可以处理主体免交或预核资格；正式提交后才能检查和验收材料。"}</p><p><a class="ghost sm" href="#/workbench/${taskId}">返回工作台</a></p></div>`;

  const evidence = active ? `
    <article class="evidence-detail" id="review-evidence" tabindex="-1">
      <header><div><span class="eyebrow">这一项的证据</span><h2>${esc((active.requirement && active.requirement.statement) || "待核对的一项要求")}</h2></div>${resultBadge(active.result)}</header>
      <div class="evidence-meta">${(active.requirement && active.requirement.executor) ? `<span class="badge">${esc(EXECUTOR_LABEL[active.requirement.executor] || active.requirement.executor)}</span>` : ""}${(active.requirement && active.requirement.capability) ? (CAP_BADGE[active.requirement.capability] || "") : ""}${(!active.decision?.resolves && !["satisfied", "not_applicable"].includes(active.result)) ? `<span class="badge">${esc(severityLabel(active.severity))}</span>` : ""}${(active.requirement && active.requirement.requirement_source) ? `<span class="source-quote">来源：${esc(active.requirement.requirement_source)}</span>` : ""}</div>
      ${active.result === "failed" ? (() => {
        const explanation = String(active.explanation || "");
        const missingKey = /未配置\s*FORMFLOW_LLM_API_KEY/.test(explanation);
        return `<div class="notice-warn review-llm-help ${missingKey ? "review-llm-help-missing-key" : "review-llm-help-transient"}">
          <b>${missingKey ? "模型尚未配置，检查暂未开始" : "这次检查没有形成结论"}</b>
          <p>${missingKey
            ? "当前运行环境没有配置 FORMFLOW_LLM_API_KEY。这条规则暂时没有机器结论；可以先按模板或人工核对，配置密钥后回工作台重新发起检查。"
            : "模型这次没有返回可靠结论。可以稍后重新发起检查，也可以直接转人工复核；原始材料和当前记录会保留。"}</p>
          <a class="link" href="#/tasks">${missingKey ? "回任务列表查看模型配置提示" : "回任务列表选择下一步"}</a>
        </div>`;
      })() : ""}
      ${active.decision ? `<div class="notice-warn"><b>${esc(DECISION_LABEL[active.decision.decision] || active.decision.decision)}</b><p>${esc(active.decision.reason)}</p><span class="muted">人工决定不改写原始检查结果；撤销后可重新核对。</span></div>` : ""}
      ${active.explanation ? `<p class="evidence-explanation">${esc(active.explanation)}</p>` : ""}
      ${(active.evidence || []).length ? `<div class="evidence-list">${active.evidence.map(e => { const file = e.file_id ? reviewFiles.get(e.file_id) : null; const fileLink = file?.url ? `<a class="evidence-file-link" href="${esc(file.url)}" data-file-url="${esc(file.url)}" onclick="return openReviewFile(event,this.dataset.fileUrl)" target="_blank" rel="noreferrer">${icon("delivery")} 打开原件 · ${esc(file.name || "未命名文件")}</a>` : ""; return `<blockquote class="evidence"><span class="evidence-loc">${esc(e.locator || "未标注位置")} · ${esc(e.method || "-")}</span>${fileLink}${esc(e.quote || "")}</blockquote>`; }).join("")}</div>` : `<p class="muted">这条规则没有可引用的原文证据。</p>`}
      ${active.next_step ? `<div class="evidence-next"><b>${active.decision ? "原始检查建议" : "下一步"}</b><p>${esc(active.next_step)}</p></div>` : ""}
    </article>` : `<article class="evidence-detail" id="review-evidence" tabindex="-1"><p class="muted">${rules.length ? "点击左侧任意一条规则查看证据。" : "暂时没有可展示的规则证据。"}</p></article>`;

  const decision = `<section class="card decision-panel" id="review-decision" tabindex="-1" aria-label="人工决定">
    <div class="section-heading"><div><div class="eyebrow">DECISION</div><h2>${active ? "人工决定" : "免交与决定历史"}</h2></div><span class="muted">撤销只追加记录，不删历史</span></div>
    <div class="decision-form">
      <div class="grid2"><div><label for="dc-type">决定</label><select id="dc-type">
        <option value="" disabled selected>请选择核对结论</option>
        <option value="confirm_pass">人工核对通过</option>
        <option value="confirm_issue">确认问题，要求补正</option>
        <option value="correct_false_positive">纠正误报</option>
        <option value="approve_exception">批准例外</option>
        <option value="exempt">主体免交（不等于验收）</option></select></div>
        <div>${active ? `<p class="field-help">本次决定只针对：${esc(active.requirement?.statement || "当前这项要求")}</p>` : ''}<input type="hidden" id="dc-rule" value="${esc(active ? active.rule_id : "")}" readonly></div></div>
      ${active ? '<p class="field-help">确认问题会保留补正待办；核对通过、纠正误报或批准例外只解除当前规则，之后仍需单独验收。</p>' : ''}
      <p class="field-help">免交对整个任务生效；到期或撤销后重新计入应交，已有正式提交和历史回执保留。</p><label for="dc-exp">过期时间（可空，ISO；无偏移时按任务时区）</label><input id="dc-exp" placeholder="2026-12-31T23:59:59+08:00">
      <label for="dc-reason">理由（必填）</label><textarea id="dc-reason" placeholder="为什么这样做决定；提交者解释会显示在上方"></textarea>
      <div class="review-draft-note"><p id="review-draft-status" role="status" aria-live="polite"></p><p class="muted">仅当前浏览器标签页，最长 7 天；关闭标签页或退出登录后不再保证保留，不跨设备同步。</p><button class="link" onclick="discardReviewDraft(${taskId},${sid})">清空本次理由草稿</button></div>
      <div id="review-conflict" role="alert"></div>
      <button id="decision-submit" ${state.reviewConflict ? "disabled" : ""} onclick="submitDecision(${taskId},${sid})">提交决定 ${icon("arrow")}</button>
    </div>
    <div class="decision-history"><h3>决定历史</h3>
      ${(d.decisions || []).map(x => `<div class="decision-row"><div><span class="badge ${x.revoked ? "" : "info"}">${esc(DECISION_LABEL[x.decision] || x.decision)}${x.decision === 'eligibility' ? '：' + esc(ELIGIBILITY_LABEL[x.eligibility] || '旧记录未保存结论') : ''}${x.revoked ? "（已撤销）" : x.expires_at && Date.parse(x.expires_at) <= Date.now() ? "（已过期）" : x.decision === "accept_current" && (!d.acceptance?.accepted || x.revision_id !== d.revision?.id) ? "（当前不生效）" : x.decision === 'eligibility' && (!qualification?.effective || qualification?.decision_id !== x.id) ? '（当前不生效）' : ""}</span><span class="muted">${x.revision_id ? (x.revision_id === d.revision?.id ? "本版本" : "历史版本（修订 #" + x.revision_id + "）") : x.decision === 'eligibility' ? "提交前预核" : "名单级"} · ${x.scope_rule_id ? "规则 " + esc(x.scope_rule_id) + " · " : ""}${esc(fmtTime(x.created_at))}</span></div><p>${esc(x.reason)}</p>${x.revoked || x.decision === "revoke" ? "" : `<button class="link" onclick="revokeDecision(${taskId},${sid},${x.id})">撤销</button>`}</div>`).join("") || `<p class="muted">还没有人工决定。</p>`}
    </div>
  </section>`;

  const acceptPanel = `<section class="card acceptance-panel" id="review-acceptance" tabindex="-1" aria-label="验收本版本">
    <h2>${acceptance.accepted ? "本版本已验收" : "验收本版本"}</h2>
    <p>验收只针对${d.revision ? ` v${d.revision.version}` : "当前版本"}，不豁免尚未处置的规则，也不自动验收后续补交。</p>
    ${acceptance.blockers.length ? `<div class="notice-warn"><b>验收前还需处理</b><ul>${acceptance.blockers.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
    ${acceptance.accepted ? '<span class="badge ok">已记录验收决定</span>' : `<label for="acceptance-reason">验收依据（必填）</label><textarea id="acceptance-reason" placeholder="核对了哪些材料，为什么可以验收"></textarea><button id="acceptance-submit" ${!acceptance.ready || state.reviewConflict ? "disabled" : ""} onclick="submitDecision(${taskId},${sid},'accept_current')">确认验收${d.revision ? ` v${d.revision.version}` : "本版本"}</button>`}
  </section>`;
  const eligibilityPanel = qualification ? `<section class="card eligibility-panel" id="review-eligibility" tabindex="-1" aria-label="资格核实">
    <div class="section-heading"><h2>独立核实资格</h2>${eligibilityBadge(qualification)}</div>
    <p>${qualification.required ? '本任务要求资格符合后才能验收材料。' : '本任务未启用资格前提；资格结论单独记录。'}材料检查不会推导资格结论。</p>
    <p class="field-help">${esc(qualification.status_reason)}${qualification.reason ? '；资格记录依据：' + esc(qualification.reason) : ''}</p>
    <p class="field-help">${d.revision ? '本次结论只对当前正式版本 v' + d.revision.version + ' 和当前登记成员有效。' : '尚无正式版本，本次仅为提交前预核。'}补交新正式版本或登记成员变化后需重新核实；到期或撤销后回到待核。</p>
    <p class="field-help">${qualification.members?.length ? '当前登记成员：' + qualification.members.map(esc).join('、') : '当前登记主体：' + esc(d.subject.name)}</p>
    <label for="eligibility-result">资格结论（必选）</label><select id="eligibility-result"><option value="" selected disabled>请选择人工核实结论</option><option value="eligible">符合</option><option value="ineligible">不符合</option><option value="pending">待核实</option></select>
    <label for="eligibility-reason">资格核实依据（必填）</label><textarea id="eligibility-reason" placeholder="说明人工核实了什么，以及结论依据"></textarea>
    <label for="eligibility-exp">资格结论有效期（可空，ISO；无偏移按任务时区）</label><input id="eligibility-exp" placeholder="2026-12-31T23:59:59+08:00">
    <button id="eligibility-submit" ${state.reviewConflict ? 'disabled' : ''} onclick="submitDecision(${taskId},${sid},'eligibility')">记录资格结论</button>
  </section>` : '';
  const notesHtml = notes.length ? `<section class="card notes-panel"><div class="section-heading"><div><div class="eyebrow">FROM SUBMITTER</div><h2>提交者解释 / 申诉</h2></div><span class="badge warn">${notes.filter(n => !n.handled).length} 项待处理</span></div>
    ${notes.map(n => `<div class="note-row"><div><b>${esc(n.rule_id || "整体提交")}</b><span class="badge ${n.handled ? "ok" : "warn"}">${n.handled ? "已处理" : "待处理"}</span><span class="muted">${esc(fmtTime(n.created_at))}</span></div><p>${esc(n.content)}</p></div>`).join("")}
    <p class="muted">解释不改变机器结论；请核对原文后再做决定，可确认问题、纠正误报或批准有范围的例外。</p></section>` : "";

  const sameName = (d.same_name_subjects || []).length ? `<section class="card notice-warn"><b>同名主体待核</b><p>${esc(d.same_name_hint || "")}</p>${d.same_name_subjects.map(s => `<p>主体 #${s.id}（${esc(s.name)}）——以主体 ID 为准人工核对，系统不自动合并。</p>`).join("")}</section>` : "";
  const covHtml = coverageCard(run);
  const versionHistory = reviewRevisionHistoryHtml(d.revision_history, d.revision);

  document.getElementById("rv").innerHTML = `${meta}${versionHistory}${workflow}${sameName}${agentRunCard(run, rules, d.tool_trace, taskId, sid)}
    <div class="review-layout ${rules.length ? '' : 'no-rule-layout'}">${rules.length ? `<div class="review-list-col">${list}</div>` : ''}<div class="review-detail-col">${rules.length ? evidence : `<div class="notice-warn">${d.revision ? '本版本没有材料检查规则。请直接核对独立资格与验收状态。' : '尚无正式提交，现在可以预核资格或处理免交；正式提交后才能验收。'}</div>`}${notesHtml}${decision}${eligibilityPanel}${acceptPanel}${covHtml}</div></div>`;
  const missingKeyHelp = document.querySelector(".review-llm-help-missing-key");
  if (missingKeyHelp) missingKeyHelp.innerHTML += '<details class="review-llm-steps"><summary>&#x67e5;&#x770b;&#x672c;&#x5730;&#x914d;&#x7f6e;&#x6b65;&#x9aa4;</summary><ol><li>&#x505c;&#x6b62;&#x5f53;&#x524d; API &#x548c; Worker&#x3002;</li><li>&#x5728;&#x542f;&#x52a8;&#x73af;&#x5883;&#x914d;&#x7f6e; <code>FORMFLOW_LLM_API_KEY</code>&#xff1b;&#x5982;&#x4f7f;&#x7528;&#x81ea;&#x5b9a;&#x4e49;&#x7f51;&#x5173;&#xff0c;&#x540c;&#x65f6;&#x914d;&#x7f6e;&#x6a21;&#x578b;&#x5730;&#x5740;&#x548c;&#x540d;&#x79f0;&#x3002;</li><li>&#x91cd;&#x542f;&#x670d;&#x52a1;&#x540e;&#x56de;&#x5230;&#x5de5;&#x4f5c;&#x53f0;&#xff0c;&#x4e3a;&#x8fd9;&#x4e2a;&#x4e3b;&#x4f53;&#x91cd;&#x65b0;&#x53d1;&#x8d77;&#x68c0;&#x67e5;&#x3002;</li></ol><p class="field-help">&#x79bb;&#x7ebf;&#x6f14;&#x793a;&#x53ef;&#x4ee5;&#x7ee7;&#x7eed;&#x4f7f;&#x7528;&#x6a21;&#x677f;&#x3001;&#x7a0b;&#x5e8f;&#x89c4;&#x5219;&#x548c;&#x4eba;&#x5de5;&#x6838;&#x5bf9;&#xff1b;&#x5df2;&#x6709;&#x6750;&#x6599;&#x4e0e;&#x56de;&#x6267;&#x4f1a;&#x4fdd;&#x7559;&#x3002;</p></details><a class="ghost sm review-llm-workbench-link" href="#/workbench/' + taskId + '">&#x56de;&#x5de5;&#x4f5c;&#x53f0;&#x7ee7;&#x7eed;</a>';
  document.querySelectorAll("[data-review-rule]").forEach(el => el.addEventListener("click", () =>
    selectReviewRule(el.dataset.reviewRule, taskId, sid)));
  const draft = state.reviewDrafts?.[state.reviewContext];
  for (const id of ["dc-type", "dc-reason", "dc-exp", "eligibility-result", "eligibility-reason", "eligibility-exp"]) {
    const el = document.getElementById(id); if (el) el.value = "";
  }
  if (draft?.rules[state.reviewRule || ""]) Object.entries(draft.rules[state.reviewRule || ""]).forEach(([id, value]) => {
    const el = document.getElementById(id); if (el && id !== "dc-rule" && (id !== "dc-type" || ["confirm_pass", "confirm_issue", "correct_false_positive", "approve_exception", "exempt", ""].includes(value))) el.value = value;
  });
  if (document.getElementById("acceptance-reason")) document.getElementById("acceptance-reason").value = draft?.acceptanceReason || "";
  if (draft?.eligibility) Object.entries(draft.eligibility).forEach(([id,value]) => {
    const el = document.getElementById(id); if (el && (id !== "eligibility-result" || ["eligible", "ineligible", "pending", ""].includes(value))) el.value = value;
  });
  if (!d.revision || !active) {
    document.querySelectorAll("#dc-type option").forEach(o => { o.disabled = o.value !== "exempt"; });
    document.getElementById("dc-type").value = "exempt";
  }
  const context = state.reviewContext;
  for (const id of ["dc-type", "dc-exp", "dc-reason", "acceptance-reason", "eligibility-result", "eligibility-reason", "eligibility-exp"]) {
    const el = document.getElementById(id);
    if (el) for (const event of ["input", "change"]) el.addEventListener(event, () => {
      if (context === state.reviewContext) cacheReviewDraft();
    });
  }
  const status = document.getElementById("review-draft-status");
  if (status) {
    if (state.reviewCacheFailed) reviewDraftStatus();
    else status.textContent = draft ? "已恢复当前复核范围的理由草稿 · 尚未提交决定" : "尚无理由草稿 · 输入时自动暂存，刷新可恢复";
  }
  if (state.reviewConflict) showReviewConflict(taskId, sid);
}
function needsReview(rule) {
  return !rule.decision && ["issue", "unknown", "failed", "manual_pending"].includes(rule.result);
}
function jumpReviewSection(id) {
  const section = document.getElementById(id);
  if (!section) return;
  section.scrollIntoView({block: "start"});
  section.focus({preventScroll: true});
}
function setReviewFilter(filter, taskId, sid) {
  if (state.deciding) return;
  cacheReviewDraft();
  state.reviewFilter = filter === "pending" ? "pending" : "all";
  const pending = (state.reviewData?.rules || []).filter(needsReview);
  if (state.reviewFilter === "pending") {
    if (pending.length && !pending.some(r => r.rule_id === state.reviewRule)) state.reviewRule = pending[0].rule_id;
    if (!pending.length) state.reviewRule = null;
  } else if (!state.reviewRule && state.reviewData?.rules?.length) {
    state.reviewRule = state.reviewData.rules[0].rule_id;
  }
  paintReview(taskId, sid);
  document.querySelector(`[data-review-filter="${state.reviewFilter}"]`)?.focus();
}
function setReviewTraceFilter(filter, taskId, sid) {
  if (state.deciding) return;
  state.reviewTraceFilter = ["all", "deterministic", "semantic", "human"].includes(filter) ? filter : "all";
  paintReview(taskId, sid);
  document.querySelector(`[data-trace-filter="${state.reviewTraceFilter}"]`)?.focus();
  const runCard = document.querySelector(".agent-run-card");
  const trace = document.querySelector(".agent-trace");
  if (runCard && trace) {
    runCard.open = true;
    trace.open = true;
  }
}
function nextPendingReview(taskId, sid) {
  if (state.deciding) return;
  const rules = state.reviewData?.rules || [];
  const index = rules.findIndex(r => r.rule_id === state.reviewRule);
  const ordered = [...rules.slice(index + 1), ...rules.slice(0, index + 1)];
  const next = ordered.find(needsReview);
  if (next) selectReviewRule(next.rule_id, taskId, sid);
}
function selectReviewRule(ruleId, taskId, sid) {
  if (state.deciding) return;
  cacheReviewDraft();
  state.reviewRule = ruleId;
  paintReview(taskId, sid);
  jumpReviewSection("review-evidence");
}
function showReviewConflict(taskId, sid) {
  document.getElementById("decision-submit").disabled = true;
  if (document.getElementById("acceptance-submit")) document.getElementById("acceptance-submit").disabled = true;
  if (document.getElementById("eligibility-submit")) document.getElementById("eligibility-submit").disabled = true;
  document.getElementById("review-conflict").innerHTML = `<div class="notice-warn">复核范围已变化，决定未保存。理由仍按旧范围保留；请先刷新核对主体、版本、成员与检查证据。<button class="ghost sm" onclick="refreshReview(${taskId},${sid})">刷新并核对最新版本</button></div>`;
}
async function refreshReview(taskId, sid) {
  cacheReviewDraft();
  const epoch = state.routeEpoch;
  if (await viewReview(taskId, sid) && epoch === state.routeEpoch)
    setFlash("已读取最新复核范围。旧理由只在原主体、版本、成员与检查证据完全匹配时恢复，不自动套用。", "ok");
}
async function submitDecision(taskId, sid, action = null) {
  if (state.reviewConflict || state.deciding) return;
  const epoch = state.routeEpoch, context = state.reviewContext, requestId = state.reviewRequestId, submittedRule = state.reviewRule || "";
  const isCurrent = () => epoch === state.routeEpoch && context === state.reviewContext && requestId === state.reviewRequestId;
  cacheReviewDraft();
  state.deciding = true;
  const controls = [...document.querySelectorAll("#rv button, #rv input, #rv textarea, #rv select")]
    .map(el => ({el, disabled: el.disabled}));
  controls.forEach(({el}) => { el.disabled = true; });
  const isEligibility = action === "eligibility";
  const reasonId = isEligibility ? "eligibility-reason" : action === "accept_current" ? "acceptance-reason" : "dc-reason";
  const btn = document.getElementById(isEligibility ? "eligibility-submit" : action === "accept_current" ? "acceptance-submit" : "decision-submit"); btn.disabled = true;
  try {
    const submittedReason = document.getElementById(reasonId).value;
    const form = {
      decision: action || document.getElementById("dc-type").value,
      reason: submittedReason.trim(),
      scope_rule_id: action === "accept_current" || isEligibility || document.getElementById("dc-type").value === "exempt" ? "" : document.getElementById("dc-rule").value.trim(),
      expected_current_revision: state.reviewData?.revision?.id || 0,
      expected_review_context: state.reviewData?.review_context || "",
    };
    const exp = document.getElementById(isEligibility ? "eligibility-exp" : "dc-exp").value.trim();
    if (exp && (!action || isEligibility)) form.expires_at = exp;
    if (isEligibility) {
      form.eligibility = document.getElementById("eligibility-result").value;
      form.expected_members_hash = state.reviewData?.eligibility?.members_hash || "";
      if (!form.eligibility) throw new Error("请选择资格核实结论");
    }
    if (!form.decision) throw new Error("请先选择核对结论");
    if (!form.reason) throw new Error("请先填写决定理由或验收依据");
    if (form.decision === "exempt" && !confirm("免交作用于整个主体，会移出应交和催交名单，但不代表材料已验收。确认免交？")) return;
    await api(`/api/tasks/${taskId}/subjects/${sid}/decisions`, { method: "POST", form });
    const saved = state.reviewDrafts?.[context];
    if (saved) {
      // A request may finish after leaving and reopening this exact scope.
      // Only clear the input actually sent, never a newer local edit.
      if (action === "accept_current") {
        if (saved.acceptanceReason === submittedReason) saved.acceptanceReason = "";
      } else if (isEligibility) {
        if (saved.eligibility?.["eligibility-reason"] === submittedReason) saved.eligibility["eligibility-reason"] = "";
      } else if (saved.rules[submittedRule]?.["dc-reason"] === submittedReason) saved.rules[submittedRule]["dc-reason"] = "";
      persistReviewDrafts();
    }
    if (!isCurrent()) return;
    document.getElementById(reasonId).value = "";
    if (await viewReview(taskId, sid) && epoch === state.routeEpoch)
      setFlash(action === "accept_current" ? "本版本已验收" : isEligibility ? "资格结论已记录；材料验收仍需单独确认" : "决定已记录", "ok");
  } catch (e) {
    if (!isCurrent()) return;
    if (e.status === 409) { state.reviewConflict = true; showReviewConflict(taskId, sid); }
    else setFlash(e.message);
  } finally {
    state.deciding = false;
    if (epoch === state.routeEpoch) {
      controls.forEach(({el, disabled}) => { if (el.isConnected) el.disabled = disabled; });
      if (btn.isConnected) btn.disabled = state.reviewConflict;
      if (state.reviewConflict) showReviewConflict(taskId, sid);
    }
  }
}
function revokeDecision(taskId, sid, did) {
  if (state.deciding || state.revokeBusy) return;
  state.revokeTarget = {taskId, sid, did, epoch: state.routeEpoch, context: state.reviewContext};
  const original = state.reviewData?.decisions?.find(d => d.id === did);
  document.getElementById("revoke-impact").textContent = original?.decision === "exempt"
    ? "撤销本条免交后，若没有其他有效免交，主体将恢复应交；已有提交、回执和旧快照保留。"
    : original?.decision === "eligibility" ? "撤销后资格回到待核，依赖该资格的当前验收将失效；原决定和旧快照保留。"
    : "撤销后将重新计算当前状态，原决定保留在历史中。";
  document.getElementById("revoke-reason").value = "";
  document.getElementById("revoke-error").textContent = "";
  openDialog("revoke-dialog", document.activeElement);
  document.getElementById("revoke-reason").focus();
}
async function confirmRevokeDecision() {
  const target = state.revokeTarget;
  if (!target || state.deciding || state.revokeBusy) return;
  const isCurrent = () => target.epoch === state.routeEpoch && target.context === state.reviewContext;
  if (!isCurrent()) return;
  const input = document.getElementById("revoke-reason"), error = document.getElementById("revoke-error");
  const reason = input.value.trim();
  if (!reason) { error.textContent = "请填写撤销理由"; input.focus(); return; }
  const dialog = document.getElementById("revoke-dialog");
  const controls = [input, document.getElementById("revoke-confirm"), document.getElementById("revoke-cancel")];
  state.revokeBusy = true;
  controls.forEach(el => el.disabled = true);
  try {
    await api(`/api/tasks/${target.taskId}/subjects/${target.sid}/decisions/${target.did}/revoke`,
              { method: "POST", form: { reason } });
    if (isCurrent()) { dialog.close(); await viewReview(target.taskId, target.sid); }
  } catch (e) { if (isCurrent()) error.textContent = e.message; }
  finally { state.revokeBusy = false; controls.forEach(el => { if (el.isConnected) el.disabled = false; }); }
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
      if (input) input.disabled = !!state.sub?.ro;
      if (btn) btn.disabled = !!state.sub?.ro;
    } else if (r === false) {
      note.innerHTML = `<span class="badge">当前填写下不适用</span>`;
      if (input) input.disabled = true;
      if (btn) btn.disabled = true;
    } else {
      note.innerHTML = `<span class="badge warn">条件「${esc(s.required_condition)}」暂不支持自动判定，将转人工核验</span>`;
      if (input) input.disabled = !!state.sub?.ro;
      if (btn) btn.disabled = !!state.sub?.ro;
    }
  });
}

function setFilesFromDraft(slotFileIds) {
  state.files = {}; state.fileMeta = {};
  Object.entries(slotFileIds || {}).forEach(([slot, list]) => {
    state.files[slot] = [];
    (list || []).forEach(f => {
      const fid = typeof f === "string" ? f : f.file_id;
      state.files[slot].push(fid);
      state.fileMeta[fid] = typeof f === "string" ? { file_id: fid, name: fid } : f;
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
  const error = new Error(Array.isArray(detail) ? detail.map(x => humanizeValidation(x)).join("；")
    : (typeof detail === "string" ? humanizeValidation({ msg: detail }) : "出了点问题，请稍后再试（" + status + "）"));
  error.status = status;
  return error;
}
function receiptFilesHtml(receipt) {
  const files = Array.isArray(receipt?.files) ? receipt.files : [];
  if (!receipt?.formal || !files.length) return "";
  return `<div class="receipt-files"><span>正式版本 v${esc(receipt.revision)} 已提交材料</span><ul>${files.map(file =>
    `<li><b>${esc(file.name || "材料")}</b><span>${esc(file.slot || "材料槽位")} · ${esc(fmtBytes(file.size))}</span></li>`).join("")}</ul></div>`;
}
function fileChips(slot, ro) {
  const ids = state.files[slot] || [];
  if (!ids.length) return "";
  return ids.map(fid => {
    const m = state.fileMeta[fid] || { name: fid };
    return `<span class="file-chip">${icon("delivery")}<span class="file-chip-name" title="${esc(m.name)}">${esc(m.name)}</span><span class="file-chip-size">${esc(fmtBytes(m.size))}</span>${ro ? "" : `<button type="button" class="file-chip-x icon-only" aria-label="删除 ${esc(m.name)}" title="删除 ${esc(m.name)}" onclick="deleteSlotFile('${esc(slot)}','${esc(fid)}')">${icon("close")}</button>`}</span>`;
  }).join("");
}
function filePickerHtml(id, label, formats = [], describedBy = "") {
  const extensions = Array.isArray(formats) ? formats : [];
  const accept = extensions.length ? ` accept="${extensions.map(x => "." + esc(x)).join(",")}"` : "";
  const described = describedBy ? ` aria-describedby="${esc(describedBy)}"` : "";
  return `<div class="file-picker-wrap"><label class="file-picker"><input class="file-picker-input" type="file" id="${esc(id)}" aria-label="选择 ${esc(label)} 文件"${described} onchange="showSelectedFile(this)"${accept}><span>选择文件</span></label><span class="file-picker-name" aria-live="polite">未选择文件</span></div>`;
}
function showSelectedFile(input) {
  const name = input.closest(".file-picker-wrap")?.querySelector(".file-picker-name");
  if (name) name.textContent = input.files?.[0]?.name || "未选择文件";
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
function submissionIssues(fields) {
  const issues = [];
  const values = Object.fromEntries(Object.entries(fields).map(([id, v]) => [id, String(v ?? "").trim()]));
  const add = (target, id, code, message) => issues.push({target, id, code, message});
  for (const f of state.sub?.fields || []) {
    if (f.type === "enum" && values[f.id] && !(f.options || []).includes(values[f.id])) {
      add("field", f.id, "invalid_option", `请从「${f.label}」的选项中选择`);
    }
    if (!f.required) continue;
    const required = evalSlotCondition(f.required_condition, values);
    if (required === null) add("field", f.id, "unsupported_condition", `「${f.label}」的必填条件无法判断，请联系组织者核对要求`);
    else if (required && !values[f.id]) add("field", f.id, "required", `请填写「${f.label}」`);
  }
  for (const slot of state.sub?.slots || []) {
    const required = evalSlotCondition(slot.required_condition, values);
    const ids = state.files[slot.id] || [];
    if (required === null) add("slot", slot.id, "unsupported_condition", `「${slot.label}」的必交条件无法判断，请联系组织者核对要求`);
    else if (required && !ids.length) add("slot", slot.id, "required", `请上传「${slot.label}」`);
    if (ids.length > slot.max_count) add("slot", slot.id, "max_count", `「${slot.label}」最多 ${slot.max_count} 份`);
  }
  return issues;
}
function submissionIssueControl(issue) {
  return document.getElementById((issue.target === "field" ? "field-" : "file-") + issue.id);
}
function showSubmissionIssues(issues) {
  // Always expose the full form, including errors discovered while using the guide.
  if (issues.length) setSubMode("form");
  for (const [target, defs] of [["field", state.sub?.fields || []], ["slot", state.sub?.slots || []]]) {
    for (const def of defs) {
      const matching = issues.filter(i => i.target === target && i.id === def.id);
      const message = document.getElementById(`${target}-error-${def.id}`);
      if (message) { message.textContent = matching.map(i => i.message).join("；"); message.hidden = !matching.length; }
      submissionIssueControl({target, id: def.id})?.setAttribute("aria-invalid", String(!!matching.length));
    }
  }
  const box = document.getElementById("submission-errors");
  if (!box) return;
  box.hidden = !issues.length;
  box.innerHTML = issues.length ? `<h3>还有 ${issues.length} 项需要核对，尚未正式提交</h3>
    <p>填写和附件仍保留，可以继续修改或保存草稿。</p>
    <ul>${issues.map(i => `<li><button type="button" class="validation-link">${esc(i.message)}</button></li>`).join("")}</ul>` : "";
  box.querySelectorAll("button").forEach((button, index) => button.addEventListener("click", () => {
    const control = submissionIssueControl(issues[index]);
    if (control) { control.scrollIntoView({behavior: "smooth", block: "center"}); control.focus(); }
  }));
  if (issues.length) { box.scrollIntoView({behavior: "smooth", block: "center"}); box.focus(); }
}

function draftFingerprint(fields, files) {
  const ids = Object.fromEntries(Object.entries(files || {}).filter(([, list]) => list.length)
    .map(([slot, list]) => [slot, list.map(f => typeof f === "string" ? f : f.file_id)]));
  return JSON.stringify({ fields: fields || {}, files: ids }, (_, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
}
function submissionMatchesReceipt(fields, files, receipt = state.receipt) {
  return !!receipt?.formal
    && draftFingerprint(fields, files) === draftFingerprint(receipt.fields, receipt.slot_file_ids);
}
function refreshSubmitAction() {
  const button = document.querySelector(".submit-action-primary");
  if (!button || !state.receipt) return;
  const unchanged = submissionMatchesReceipt(collectDraftFields(), state.files);
  button.disabled = state.submitterReadOnly || unchanged;
  const label = state.receipt.formal
    ? unchanged ? "当前版本已提交" : "提交更正版本并重新核对"
    : "提交材料并开始核对";
  button.innerHTML = label + " " + icon("arrow");
}
function submissionContext() {
  const epoch = state.routeEpoch, key = draftCacheKey(), token = subToken();
  return () => epoch === state.routeEpoch && key === draftCacheKey() && token === subToken();
}
function draftCacheKey() {
  return state.me ? `ff_draft:${state.me.task.id}:${state.me.subject.id}` : null;
}
function collectDraftFields() {
  const fields = {};
  document.querySelectorAll("[data-field]").forEach(el => { fields[el.dataset.field] = el.value; });
  const pending = document.getElementById("sub-ans");
  if (pending && state.sub?.mode === "chat" && state.sub.phase === "fields") {
    const field = state.sub.fields[state.sub.fIdx];
    if (field) fields[field.id] = pending.value;
  }
  return fields;
}
function updateSubmissionProgress(fields) {
  const defs = state.sub?.fields || [];
  const filled = defs.filter(f => String(fields[f.id] ?? "").trim()).length;
  const fieldCount = document.getElementById("submission-field-count");
  const fileCount = document.getElementById("submission-file-count");
  if (fieldCount) fieldCount.textContent = `${filled}/${defs.length}`;
  if (fileCount) fileCount.textContent = String(Object.values(state.files).reduce((n, ids) => n + ids.length, 0));
}
function cacheSubmissionDraft() {
  if (!document.getElementById("sub") || !state.me || state.draftVersion === null) return;
  if (READONLY_STATUSES.includes(state.me.task.status)) return;
  const key = draftCacheKey();
  const draft = { fields: collectDraftFields(), slot_file_ids: state.files, draft_version: state.draftVersion,
    file_meta: state.fileMeta, pending_submission: state.pendingSubmission };
  updateSubmissionProgress(draft.fields);
  paintSubmitterNextStep();
  const dirty = draftFingerprint(draft.fields, draft.slot_file_ids) !== state.serverDraftFingerprint;
  state.localDrafts = state.localDrafts || {};
  state.localDrafts[key] = JSON.stringify(draft);
  try {
    sessionStorage.setItem(key, JSON.stringify(draft));
    state.cacheFailed = false;
    const el = document.getElementById("draft-hint");
    if (el) el.textContent = dirty ? "已在本标签页暂存；刷新或切页可恢复。尚未保存到服务器。" : `已与服务器草稿同步（v${state.draftVersion}），不是正式提交。`;
  } catch (e) {
    state.cacheFailed = true;
    setFlash("浏览器暂存不可用，请先保存草稿再离开页面");
  }
}
function paintSubmitterNextStep(results = state.submitterResults) {
  const box = document.getElementById("submit-next-step");
  if (!box || !state.me) return;
  const formal = !!state.receipt?.formal;
  const fields = collectDraftFields();
  const issues = formal ? [] : (state.sub ? submissionIssues(fields) : []);
  box.innerHTML = submitterNextStepHtml({
    formal,
    readOnly: !!state.submitterReadOnly,
    issues,
    summary: results?.summary || "",
    buckets: results?.buckets || {},
    runStatus: results?.run_status || "",
    revision: results?.revision,
    resultsUnavailable: !!state.submitterResultsError && !state.submitterResults,
  });
}
window.addEventListener("beforeunload", event => {
  cacheSubmissionDraft();cacheDesignInputs();
  if (state.cacheFailed || (state.designCacheFailed && state.designDirty)) { event.preventDefault(); event.returnValue = ""; }
});
async function reloadServerDraft() {
  if (!confirm("用服务端草稿替换本页暂存内容？未保存到服务器的填写会被替换。")) return;
  const key = draftCacheKey();
  try { sessionStorage.removeItem(key); } catch (e) {}
  if (state.localDrafts) delete state.localDrafts[key];
  await viewSubmit();
}

async function viewSubmit() {
  const epoch = state.routeEpoch, token = subToken();
  if (!token) {
    location.hash = "#/login?role=sub";
    return;
  }
  state.me = null; state.draftVersion = null; state.sub = null; state.receipt = null; state.submitterResults = null; state.submitterResultsError = false; state.submitterReadOnly = false;
  document.getElementById("app").innerHTML = `<div id="flash" role="status" aria-live="polite"></div><div id="sub"><p class="empty">正在打开你的提交空间…</p></div>`;
  try {
    const me = await api("/api/me", { sub: true });
    if (epoch !== state.routeEpoch || token !== subToken()) return;
    const [draft, receipt] = await Promise.all([
      api("/api/me/draft", { sub: true }),
      api("/api/me/receipt", { sub: true }),
    ]);
    if (epoch !== state.routeEpoch || token !== subToken()) return;
    state.me = me; state.draftVersion = draft.draft_version || null;
    state.receipt = receipt;
    state.submitterReadOnly = READONLY_STATUSES.includes(me.task.status);
    state.serverDraftFields = {...(draft.fields || {})};
    state.serverDraftFingerprint = draftFingerprint(draft.fields, draft.slot_file_ids);
    let cached = null;
    try { cached = JSON.parse(state.localDrafts?.[draftCacheKey()] || sessionStorage.getItem(draftCacheKey()) || "null"); } catch (e) {}
    state.pendingSubmission = cached?.pending_submission || null;
    const local = cached && draftFingerprint(cached.fields, cached.slot_file_ids) !== state.serverDraftFingerprint ? cached : null;
    const localConflict = local && local.draft_version !== draft.draft_version;
    if (local) {
      draft.fields = local.fields || {};
      draft.slot_file_ids = local.slot_file_ids || {};
      state.draftVersion = local.draft_version;
    }
    setFilesFromDraft(draft.slot_file_ids);
    if (local?.file_meta) Object.assign(state.fileMeta, local.file_meta);
    const fields = (me.blueprint && me.blueprint.fields) || [];
    const slots = (me.blueprint && me.blueprint.slots) || [];
    const ro = READONLY_STATUSES.includes(me.task.status);
    const done = fields.filter(f => String((draft.fields || {})[f.id] ?? "").trim()).length;
    const uploaded = Object.values(state.files).reduce((n, ids) => n + ids.length, 0);
    const fileMetricLabel = receipt.formal ? "本次编辑附件" : "已上传材料";
    const receiptHtml = receipt.formal
      ? `<div class="receipt"><div><span class="eyebrow">RECEIPT</span><b>已正式提交 · v${receipt.revision}</b><span class="receipt-no">${esc(receipt.receipt)}</span></div><div class="receipt-meta"><span>提交时间</span><b>${esc(fmtTime(receipt.formal_submitted_at))}</b></div></div>${receiptFilesHtml(receipt)}`
      : `<div class="receipt pending"><div><span class="eyebrow">RECEIPT</span><b>尚未正式提交</b><span>保存草稿不会形成报名；正式提交后会得到固定回执。</span></div></div>`;
    const resultsHtml = `<section id="my-results-card" class="card my-results-card" tabindex="-1" aria-labelledby="my-results-heading"><div class="section-heading"><div><div class="eyebrow">材料进度</div><h2 id="my-results-heading">这份材料核对到哪了</h2></div><span class="muted">提交后的状态与下一步</span></div><div id="my-results"><p class="muted">—</p></div></section>`;

    document.getElementById("sub").innerHTML = `
      <div class="submit-shell">
        <div class="breadcrumb"><span>提交者空间</span><span>/</span><span>${esc(me.subject.name)}</span></div>
        <div class="page-heading"><div><div class="eyebrow">MY SUBMISSION</div><h1>${esc(me.task.name)}</h1><p>以「${esc(me.subject.name)}」身份提交${me.subject.kind === "team" ? "（团队）" : ""}。草稿随时保存，正式提交后仍可在补正截止前更新。</p></div>
          <span class="badge ${ro ? "warn" : "ok"}"><span class="badge-dot"></span>${esc(TASK_STATUS_LABEL[me.task.status] || me.task.status)}</span></div>
        ${ro ? `<div class="notice-warn">任务已${esc(TASK_STATUS_LABEL[me.task.status] || me.task.status)}，处于只读状态：不能保存草稿、上传或正式提交；已提交内容与回执仍可查看。</div>` : ""}
        <section class="submit-overview">
          <div class="overview-stats">${[["登记字段", `${done}/${fields.length}`, "design"], [fileMetricLabel, uploaded, "delivery"], ["首次截止", fmtTimeShort(me.task.first_deadline, me.task.timezone), "workbench"], ["补正截止", fmtTimeShort(me.task.correction_deadline, me.task.timezone), "workbench"]].map(([l, v, ic]) => `<div class="overview-stat"><span>${esc(l)}</span><strong class="stat-text" ${l === "登记字段" ? 'id="submission-field-count"' : l === fileMetricLabel ? 'id="submission-file-count"' : ""}>${esc(v)}</strong><i>${icon(ic)}</i></div>`).join("")}</div>
          ${receiptHtml}
        </section>
        <div id="submit-next-step">${submitterNextStepHtml({formal: !!receipt.formal, readOnly: ro, issues: []})}</div>
        ${receipt.formal ? resultsHtml : ""}
        <div class="submit-layout">
          <section class="card submit-form-card">
              <div class="submit-card-head"><div><div class="eyebrow">FORM</div><h2>填写与上传</h2></div>
              <div class="tabs" role="tablist" aria-label="填写方式"><button role="tab" id="submode-form" aria-selected="true" aria-controls="sub-fields-card" tabindex="0" onkeydown="moveSubmitModeTab(event)" onclick="setSubMode('form')">完整表单</button><button role="tab" id="submode-chat" aria-selected="false" aria-controls="sub-chat-card" tabindex="-1" onkeydown="moveSubmitModeTab(event)" onclick="setSubMode('chat')" ${ro ? "disabled" : ""}>需要帮助？逐步填写</button></div></div>
            <div class="card" id="sub-chat-card" role="tabpanel" aria-labelledby="submode-chat" hidden>
              <div class="step-flow"><span class="st on" id="sub-st-1"><span class="dot">1</span>登记信息</span><span class="arw"></span><span class="st" id="sub-st-2"><span class="dot">2</span>上传材料</span><span class="arw"></span><span class="st" id="sub-st-3"><span class="dot">3</span>核对提交</span></div>
              <div class="chat"><div class="chat-scroll" id="sub-chat-scroll" role="log" aria-label="逐步填写对话记录" tabindex="0"></div></div>
              <p class="field-help">逐步填写与下方表单是同一份草稿，答案实时同步；向导不调用模型，也不代替材料检查。</p>
            </div>
            <div id="submission-errors" class="submission-errors" role="alert" tabindex="-1" hidden></div>
            <div id="sub-fields-card" role="tabpanel" aria-labelledby="submode-form">
              <h3>登记信息</h3>
              ${fields.map(f => `<div class="submit-field"><label for="field-${esc(f.id)}">${esc(f.label)}${f.required ? " <em>*</em>" : ' <small>选填</small>'}</label>
                ${f.type === "enum"
                  ? `<select id="field-${esc(f.id)}" data-field="${esc(f.id)}" aria-describedby="field-error-${esc(f.id)}" ${ro ? "disabled" : ""}>${["", ...(f.options || [])].map(o => `<option value="${esc(o)}" ${((draft.fields || {})[f.id] || "") === o ? "selected" : ""}>${o ? esc(o) : "请选择"}</option>`).join("")}</select>`
                  : `<input id="field-${esc(f.id)}" data-field="${esc(f.id)}" aria-describedby="field-error-${esc(f.id)}" value="${esc((draft.fields || {})[f.id] ?? "")}" placeholder="请填写${esc(f.label)}" ${ro ? "disabled" : ""}>`}
                <p id="field-error-${esc(f.id)}" class="validation-message" hidden></p>
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
                  <p id="slot-error-${esc(s.id)}" class="validation-message" hidden></p>
                  <div class="file-chips" id="slot-files-${esc(s.id)}">${fileChips(s.id, ro)}</div>
                  ${ro ? "" : `<div class="upload-row">${filePickerHtml(`file-${s.id}`, s.label, s.formats, `slot-error-${s.id}`)}<button class="ghost sm" id="upload-${esc(s.id)}" onclick="uploadSlot('${esc(s.id)}')">上传</button></div>`}
                </article>`;
              }).join("") || '<p class="muted">本次收集没有材料要求。</p>'}
            </div>
            <div class="submit-actions">
              <button class="ghost sm submit-action-reload" onclick="reloadServerDraft()">重新加载服务器草稿</button>
              <button class="ghost submit-action-save" onclick="saveDraft()" ${ro ? "disabled" : ""}>保存草稿</button>
              <span class="muted" id="draft-hint">${draft.draft_version ? `草稿版本 ${draft.draft_version}` : "尚未保存草稿"}${draft.updated_at ? ` · ${esc(fmtTime(draft.updated_at))}` : ""}</span>
            </div>
            <div class="submit-primary-dock"><button class="submit-action-primary" onclick="doSubmit()" ${ro || submissionMatchesReceipt(draft.fields, state.files, receipt) ? "disabled" : ""}>${receipt.formal && submissionMatchesReceipt(draft.fields, state.files, receipt) ? "当前版本已提交" : receipt.formal ? "提交更正版本并重新核对" : "提交材料并开始核对"} ${icon("arrow")}</button></div>
            <div id="receipt-out"></div>
          </section>
          <aside class="submit-side">
            ${receipt.formal ? `<section class="card side-note"><div class="eyebrow">AFTER SUBMISSION</div><h2>补正与回执</h2>
              <ul class="check-list"><li>当前正式版本为 <b>v${esc(receipt.revision)}</b>，回执已固定。</li><li>需要更正时，更新材料后提交更正版本，原版本仍会保留。</li><li>补正截止：<b>${esc(fmtTimeShort(me.task.correction_deadline, me.task.timezone))}</b><span class="muted">（${esc(me.task.timezone)}）</span></li><li>上传附件或保存草稿不会替换当前正式版本。</li></ul>
            </section>` : `<section class="card side-note"><div class="eyebrow">BEFORE YOU SUBMIT</div><h2>提交前核对</h2>
              <ul class="check-list"><li>首次截止：<b>${esc(fmtTimeShort(me.task.first_deadline, me.task.timezone))}</b></li><li>补正截止：<b>${esc(fmtTimeShort(me.task.correction_deadline, me.task.timezone))}</b><span class="muted">（${esc(me.task.timezone)}）</span></li><li>正式提交会形成不可篡改的版本，再次提交会形成补正版本。</li><li>上传成功 ≠ 正式提交，记得点「正式提交」。</li></ul>
            </section>`}
            <section class="card side-note"><div class="eyebrow">如果有疑问</div><h2>提交之后</h2>
              <p class="field-help">核对后会列出对应的材料、原文位置和建议做法。觉得有一处没看清，可以补充说明请组织者再核对；需要更正时也可以直接补交材料。</p>
            </section>
          </aside>
        </div>
        ${receipt.formal ? "" : resultsHtml}
      </div>`;
    document.querySelectorAll("[data-field]").forEach(el =>
      el.addEventListener("input", () => {
        refreshSlotConditions(slots);
        if (state.sub && state.sub.mode === "chat") syncSubAnswersFromForm();
        cacheSubmissionDraft();
        refreshSubmitAction();
      }));
    refreshSlotConditions(slots);
    initSubChat(fields, slots, ro, me.subject.name, draft.fields || {});
    setSubMode("form");
    paintSubmitterNextStep();
    if (local) {
      document.getElementById("draft-hint").textContent = localConflict
        ? "服务端已有更新，已保留本地填写；请先核对，旧版本保存会被拦截。"
        : "已恢复本标签页暂存内容；尚未保存到服务器。";
    }
    loadMyResults();
  } catch (e) {
    if (epoch !== state.routeEpoch) return;
    if (e.status === 401) {
      localStorage.removeItem(SUB_KEY);
      location.hash = "#/login?role=sub&notice=credential-expired";
      return;
    }
    const message = submitterNetworkError(e, "load");
    document.getElementById("sub").innerHTML =
      `<div class="flash err">${esc(message.message)} <button class="ghost sm" type="button" onclick="viewSubmit()">重新加载提交空间</button></div>`;
  }
}
async function uploadFile(slot, file) {
  const fd = new FormData();
  fd.append("slot", slot);
  fd.append("expected_version", String(state.draftVersion));
  fd.append("file", file);
  const r = await fetch("/api/me/files", {
    method: "POST", headers: { Authorization: "Bearer " + subToken() }, body: fd });
  let data = {};
  try { data = await r.json(); } catch (e) { data = { detail: "服务端返回了无法解析的响应" }; }
  if (!r.ok) throw apiError(data, r.status);
  return data;
}
async function uploadSlot(slot) {
  const current = submissionContext();
  await guard(async () => {
    const input = document.getElementById("file-" + slot);
    if (!input || !input.files.length) throw new Error("请先选择文件");
    const file = input.files[0];
    let data;
    try { data = await uploadFile(slot, file); }
    catch (error) { throw submitterNetworkError(error, "upload"); }
    if (!current()) return;
    afterSlotUpload(slot, data.file_id, { name: file.name, size: file.size || data.size }, data.draft_version);
    input.value = "";
    setFlash(`「${file.name}」已上传（上传成功不等于正式提交）`, "ok");
  }, current);
}
function afterSlotUpload(slot, fileId, meta, draftVersion) {
  (state.files[slot] = state.files[slot] || []).push(fileId);
  state.fileMeta[fileId] = { file_id: fileId, name: (meta && meta.name) || fileId, size: meta && meta.size };
  if (Number.isInteger(draftVersion)) state.draftVersion = draftVersion;
  state.serverDraftFingerprint = draftFingerprint(state.serverDraftFields || {}, state.files);
  cacheSubmissionDraft();
  const ro = state.sub ? state.sub.ro : false;
  paintSlotFiles(slot, ro);
  refreshSubmitAction();
  if (state.sub && state.sub.slots) refreshSlotConditions(state.sub.slots);
  if (state.sub) {
    const i = state.sub.slots.findIndex(s => s.id === slot);
    if (i >= 0) {
      const msg = document.getElementById("sub-slot-msg");
      if (state.sub.mode === "chat" && state.sub.phase === "slots" && state.sub.sIdx === i) {
        subUser(`上传了「${esc(state.sub.slots[i].label)}」：${esc((meta && meta.name) || fileId)}`);
        advanceSlot(i);
      } else if (msg && state.sub.mode === "chat") {
        msg.innerHTML = `<div class="flash ok">已上传：${esc((meta && meta.name) || fileId)}</div>`;
      }
    }
  }
}
async function deleteSlotFile(slot, fileId) {
  const current = submissionContext();
  await guard(async () => {
    const result = await api(`/api/me/files/${encodeURIComponent(fileId)}`, { method: "DELETE", sub: true,
      form: { expected_version: state.draftVersion } });
    if (!current()) return;
    state.files[slot] = (state.files[slot] || []).filter(x => x !== fileId);
    delete state.fileMeta[fileId];
    if (Number.isInteger(result.draft_version)) state.draftVersion = result.draft_version;
    state.serverDraftFingerprint = draftFingerprint(state.serverDraftFields || {}, state.files);
    cacheSubmissionDraft();
    paintSlotFiles(slot, state.sub ? state.sub.ro : false);
    refreshSubmitAction();
    if (state.sub && state.sub.slots) refreshSlotConditions(state.sub.slots);
    setFlash(result.cleanup_pending
      ? "文件已从草稿中移除，但存储清理未完成，请联系管理员处理。"
      : "文件已从草稿中删除", result.cleanup_pending ? "warn" : "ok");
  }, current);
}
async function saveDraft() {
  const current = submissionContext();
  await guard(async () => {
    const fields = collectDraftFields();
    const snapshot = draftFingerprint(fields, state.files);
    let r;
    try {
      r = await api("/api/me/draft", { method: "POST", sub: true,
        json: { fields, slot_file_ids: state.files, expected_version: state.draftVersion } });
    } catch (error) { throw submitterNetworkError(error, "draft"); }
    if (!current()) return;
    state.serverDraftFields = {...fields};
    state.serverDraftFingerprint = snapshot;
    state.draftVersion = r.draft_version;
    cacheSubmissionDraft();
    const changed = snapshot !== draftFingerprint(collectDraftFields(), state.files);
    document.getElementById("draft-hint").textContent = changed
      ? "本次快照已保存；保存期间的新修改尚未保存。"
      : `已保存到服务器（草稿 v${r.draft_version}），不是正式提交。`;
    setFlash("草稿已保存到服务器", "ok");
  }, current);
}
async function doSubmit() {
  if (state.submitting) return;
  const epoch = state.routeEpoch, subject = draftCacheKey(), current = submissionContext();
  state.submitting = true;
  try {
    await guard(async () => {
      const fields = collectDraftFields();
      document.querySelectorAll("[data-field]").forEach(el => { el.value = fields[el.dataset.field] ?? ""; });
      cacheSubmissionDraft();
      const issues = submissionIssues(fields);
      showSubmissionIssues(issues);
      if (issues.length) return;
      const slotFiles = Object.fromEntries(Object.entries(state.files).filter(([, ids]) => ids.length));
      const signature = subject + ":" + draftFingerprint(fields, slotFiles);
      if (!state.pendingSubmission || state.pendingSubmission.signature !== signature) {
        state.pendingSubmission = {signature, key: "web-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8)};
      }
      cacheSubmissionDraft();
      let r;
      try {
        r = await api("/api/me/submit", { method: "POST", sub: true,
          json: { fields, slot_file_ids: slotFiles, idempotency_key: state.pendingSubmission.key } });
      } catch (error) {
        if (!current()) return;
        if (error.issues?.length) { showSubmissionIssues(error.issues); return; }
        throw submitterNetworkError(error, "submit");
      }
      if (!current()) return;
      state.serverDraftFields = {...fields};
      state.serverDraftFingerprint = draftFingerprint(fields, slotFiles);
      state.pendingSubmission = null;
      state.draftVersion = r.draft_version;
      cacheSubmissionDraft();
      await viewSubmit();
      setFlash(`提交成功！回执 ${r.receipt}（v${r.revision}）`, "ok");
    }, current);
  } finally { state.submitting = false; }
}
let _resultsTimer = 0;
let _resultsRetryDelay = 3000;
let _resultsRetryCount = 0;
async function loadMyResults() {
  clearTimeout(_resultsTimer);
  const epoch = state.routeEpoch, token = subToken();
  const requestId = (state.resultsRequestId || 0) + 1;
  state.resultsRequestId = requestId;
  const previousBuckets = state.submitterResults?.buckets || {};
  const wasAwaitingFollowUp = (previousBuckets.unknown || []).length
    + (previousBuckets.human || []).length + (previousBuckets.incomplete || []).length > 0
    || (previousBuckets.pending_jobs || []).length > 0
    || state.submitterResults?.summary === "规则通过（待人工验收）"
    || ["queued", "running", "retry_wait"].includes(state.submitterResults?.run_status);
  try {
    const r = await api("/api/me/results", { sub: true });
    if (epoch !== state.routeEpoch || token !== subToken() || requestId !== state.resultsRequestId) return;
    _resultsRetryDelay = 3000;
    _resultsRetryCount = 0;
    state.submitterResults = r;
    state.submitterResultsError = false;
    paintSubmitterNextStep(r);
    const b = r.buckets || {};
    const details = r.details || [];
    const countBadge = (items, label, kind) => items?.length
      ? `<span class="badge ${kind}">${label} ${items.length} 项</span>` : "";
    let html = `
      <p>当前进度：<b>${esc(submitterSummary(r.summary))}</b>${r.revision ? ` · 第 ${r.revision} 版` : ""}</p>
      <p>${[
        countBadge(b.blocking, "需要更正", "bad"),
        ...(b.pending_jobs || []).map(x => `<span class="badge info">${esc(RUN_LABEL[x] || "正在核对")}</span>`),
      ].filter(Boolean).join("") || '<span class="muted">暂时没有需要你处理的事项</span>'}</p>`;
    const organizerCount = (b.unknown || []).length + (b.human || []).length + (b.incomplete || []).length;
    if (organizerCount) html += `<p class="muted">组织者待办：${[
      countBadge(b.unknown, "待确认", "warn"),
      countBadge(b.human, "组织者核对", "info"),
      countBadge(b.incomplete, "检查未完成", "warn"),
    ].filter(Boolean).join(" ")}。这些需要组织者完成核对或恢复检查；你不需要为它们重复提交材料。</p>`;
    if (r.eligibility && (r.eligibility.required || r.eligibility.status !== 'not_assessed')) {
      html += `<div class="notice-warn">${eligibilityBadge(r.eligibility)}<p>${esc(r.eligibility.status_reason)}</p><p>${r.eligibility.reason ? '资格记录依据：' + esc(r.eligibility.reason) : ''}</p><span>资格由组织者独立核实，材料检查不会自动决定资格。</span></div>`;
    }
    // 覆盖缺口：读不到的页不能算缺失，必须显式告知提交者
    const cov = r.coverage || {};
    const gap = (cov.unread_pages || 0) + (cov.failed_pages || 0);
    if (gap) {
      html += `<div class="notice-warn"><b>有 ${gap} 页暂时没读清</b><p>这不代表材料缺失。你可以换一份更清晰的文件再提交，或请组织者一起核对。</p></div>`;
    }
    // 规则明细：哪里有问题、怎么改、引用证据、剩余待办
    const todo = details.filter(x => x.decision?.decision === "confirm_issue"
      || (!x.decision?.resolves && x.result === "issue"));
    const organizerItems = details.filter(x => !x.decision?.resolves
      && ["unknown", "failed", "manual_pending"].includes(x.result));
    const done = details.filter(x => x.decision?.resolves
      || (!x.decision && ["satisfied", "not_applicable"].includes(x.result)));
    if (todo.length) {
      html += `<h3>需要一起处理（${todo.length}）</h3>` + todo.map(ruleCard).join("");
    }
    if (organizerItems.length) {
      html += `<section class="notice-warn"><b>组织者待办（${organizerItems.length}）</b><p>这些项目需要组织者核对或重新完成检查，你不需要为它们重复提交材料；若有需要更正的材料，可按上方提示补交。</p>${organizerItems.map(ruleCard).join("")}</section>`;
    }
    if (done.length) {
      html += `<p class="kv">已按要求核对完成 ${done.length} 项。</p>`;
      const reviewed = done.filter(x => x.decision);
      if (reviewed.length) html += `<details><summary>查看组织者的核对记录（${reviewed.length} 项）</summary>${reviewed.map(ruleCard).join("")}</details>`;
    }
    if (!details.length && r.summary && r.summary !== "未正式提交") {
      html += `<p class="muted">目前还没有可展示的核对明细，检查完成后会在这里更新。</p>`;
    }
    const ruleLabel = id => details.find(x => x.rule_id === id)?.requirement?.statement || "一项要求";
    if (todo.length) {
      html += `<div class="card"><h3>想补充说明，或请组织者再看一眼？</h3>
        <p class="kv">如果你觉得有一处没核对到，可以告诉组织者在哪里；也可以直接补交更正后的材料。组织者会结合原文处理，并保留原来的检查记录。</p>
        <div class="row">
          <div><label>想说明哪一项（可选）</label><select id="ap-rule">
            <option value="">整份材料</option>
            ${todo.map(x => `<option value="${esc(x.rule_id)}">${esc(ruleLabel(x.rule_id))}</option>`).join("")}
          </select></div>
        </div>
        <label>补充说明（必填）</label>
        <textarea id="ap-content" placeholder="说说希望组织者再核对哪里，例如：封面第二页的期次可能没识别清楚。"></textarea>
        <button onclick="submitAppeal()">发给组织者</button>
      </div>`;
    }
    const appeals = r.appeals || [];
    if (appeals.length) {
      html += `<div class="card"><h3>我发出的补充说明</h3>
        ${appeals.map(a => `<p>针对：${a.rule_id ? esc(ruleLabel(a.rule_id)) : "整份材料"}
          <span class="badge${a.status === "withdrawn" ? "" : (a.handled ? " ok" : " warn")}">${
            a.status === "withdrawn" ? "已撤回" : (a.handled ? "组织者已处理" : "等待组织者查看")}</span>
          <span class="kv">${esc(a.content)} · ${esc(fmtTime(a.created_at))}</span>
          ${a.status === "pending" && !a.handled ?
            `<button class="link" onclick="withdrawAppeal(${a.id})">撤回</button>` : ""}</p>`).join("")}
      </div>`;
    }
    const box = document.getElementById("my-results"); if (!box) return;
    const reason = document.getElementById("ap-content")?.value || "";
    const rule = document.getElementById("ap-rule")?.value || "";
    const focus = captureTextFocus(["ap-content"]);
    box.innerHTML = html;
    if (document.getElementById("ap-content")) document.getElementById("ap-content").value = reason;
    if (document.getElementById("ap-rule")) document.getElementById("ap-rule").value = rule;
    restoreTextFocus(focus);
    const hasPendingRun = (b.pending_jobs || []).length || ["queued", "running", "retry_wait"].includes(r.run_status);
    const hasOrganizerTodo = (b.unknown || []).length + (b.human || []).length + (b.incomplete || []).length
      || r.summary === "规则通过（待人工验收）";
    if (hasPendingRun) {
      _resultsTimer = setTimeout(loadMyResults, 3000);
    } else if (hasOrganizerTodo) {
      _resultsTimer = setTimeout(loadMyResults, 30000);
    }
  } catch (e) {
    if (epoch !== state.routeEpoch || token !== subToken() || requestId !== state.resultsRequestId) return;
    const box = document.getElementById("my-results");
    if (!state.submitterResults) {
      state.submitterResultsError = true;
      paintSubmitterNextStep();
    }
    if (box) {
      const notice = `<div class="notice-warn" id="results-load-error">检查结果暂时无法更新，已有回执和填写不受影响。<button class="ghost sm" onclick="loadMyResults()">重试加载结果</button></div>`;
      if (!document.getElementById("results-load-error")) box.insertAdjacentHTML("afterbegin", notice);
    }
    if (navigator.onLine !== false && (isSubmitterNetworkFailure(e) || e.status >= 500)) {
      if (wasAwaitingFollowUp) {
        _resultsTimer = setTimeout(loadMyResults, 30000);
      } else if (_resultsRetryCount < 5) {
        _resultsTimer = setTimeout(loadMyResults, _resultsRetryDelay);
        _resultsRetryCount++;
        _resultsRetryDelay = Math.min(_resultsRetryDelay * 2, 30000);
      }
    }
  }
}

async function submitAppeal() {
  await guard(async () => {
    const epoch = state.routeEpoch, token = subToken();
    const ruleId = document.getElementById("ap-rule").value;
    const content = document.getElementById("ap-content").value.trim();
    if (!content) throw new Error("解释/复核理由不能为空");
    const key = "web-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    const r = await api("/api/me/appeals", { method: "POST", sub: true,
      json: { rule_id: ruleId, content, idempotency_key: key } });
    if (epoch !== state.routeEpoch || token !== subToken()) return;
    const input = document.getElementById("ap-content");
    if (input && input.value.trim() === content) input.value = "";
      setFlash("说明已发给组织者，原有核对记录不会被覆盖；需要更正时也可以直接补交材料。", "ok");
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
                answers: Object.fromEntries(Object.entries(initialAnswers || {})
                  .map(([id, value]) => [id, String(value ?? "").trim()]).filter(([, value]) => value)), doneSlots: {} };
  document.querySelectorAll("[data-field]").forEach(el => {
    if (el.value.trim()) state.sub.answers[el.dataset.field] = el.value.trim();
  });
  if (state.sub.fields.length) {
    const firstEmpty = state.sub.fields.findIndex(f => !state.sub.answers[f.id]);
    state.sub.fIdx = firstEmpty < 0 ? state.sub.fields.length : firstEmpty;
    if (state.sub.fIdx >= state.sub.fields.length) startPendingSlots();
  } else { startPendingSlots(); }
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
      <div class="avatar">${m.role === "agent" ? icon("sparkle") : "我"}</div>
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
  const fields = collectDraftFields();
  document.querySelectorAll("[data-field]").forEach(el => { el.value = fields[el.dataset.field] ?? ""; });
  cacheSubmissionDraft();
  state.sub.mode = m;
  const bc = document.getElementById("submode-chat"), bf = document.getElementById("submode-form");
  if (bc) {
    bc.classList.toggle("on", m === "chat");
    bc.setAttribute("aria-selected", String(m === "chat"));
    bc.setAttribute("tabindex", m === "chat" ? "0" : "-1");
  }
  if (bf) {
    bf.classList.toggle("on", m === "form");
    bf.setAttribute("aria-selected", String(m === "form"));
    bf.setAttribute("tabindex", m === "form" ? "0" : "-1");
  }
  const cc = document.getElementById("sub-chat-card"), fc = document.getElementById("sub-fields-card");
  if (cc) cc.hidden = m !== "chat";
  if (fc) fc.hidden = m !== "form";
  if (m === "chat") {
    syncSubAnswersFromForm();
    const firstEmpty = state.sub.fields.findIndex(f => !state.sub.answers[f.id]);
    if (firstEmpty >= 0) { state.sub.phase = "fields"; state.sub.fIdx = firstEmpty; }
    else startPendingSlots();
    renderSubStep();
  }
}
function moveSubmitModeTab(event) {
  if (!event || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [document.getElementById("submode-form"), document.getElementById("submode-chat")]
    .filter(tab => tab && !tab.disabled);
  const current = tabs.indexOf(event.currentTarget);
  if (current < 0 || !tabs.length) return;
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
    : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next].focus?.();
  tabs[next].click?.();
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
  return `<div class="msg agent"><div class="avatar">${icon("sparkle")}</div><div class="body">
    <b>第 ${i + 1}/${state.sub.fields.length} 题 · ${esc(f.label)}</b>
    ${req ? '<span class="badge bad">必填</span>' : '<span class="badge">选填</span>'}
    ${f.purpose ? `<div class="mini">${esc(f.purpose)}</div>` : ""}
    ${opts}
    <input id="sub-ans" placeholder="请输入${esc(f.label)}" value="${esc(val)}"
      oninput="cacheSubmissionDraft()" onkeydown="if(event.key===String.fromCharCode(13)&&!event.isComposing){event.preventDefault();subAnswerField(${i})}">
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
  cacheSubmissionDraft();
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
    startPendingSlots();
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
    startPendingSlots();
    renderSubStep();
  }
}

function subSlotReq(s) {
  if (!s.required_condition) return true;
  return evalSlotCondition(s.required_condition, formValues()) !== false;
}
function nextPendingSlot(start) {
  for (let i = start; i < state.sub.slots.length; i++) {
    const slot = state.sub.slots[i];
    if (!(state.files[slot.id] || []).length && subSlotReq(slot)) return i;
  }
  return state.sub.slots.length;
}
function startPendingSlots() {
  state.sub.sIdx = nextPendingSlot(0);
  state.sub.phase = state.sub.sIdx < state.sub.slots.length ? "slots" : "done";
  setSubStep(state.sub.phase === "done" ? 3 : 2);
}
function subSlotCard(i) {
  const s = state.sub.slots[i];
  const req = subSlotReq(s);
  const done = (state.files[s.id] || []).length;
  const na = s.required_condition && !req
    ? `<div class="mini">按你刚才填的内容，这项材料<b>不适用</b>（条件：${esc(s.required_condition)}），可以直接跳过。</div>` : "";
  return `<div class="msg agent"><div class="avatar">${icon("sparkle")}</div><div class="body">
    <b>第 ${i + 1}/${state.sub.slots.length} 项材料 · ${esc(s.label)}</b>
    ${req ? '<span class="badge bad">必交</span>' : '<span class="badge">选交</span>'}
    <div class="mini">${esc(slotMetaText(s))}</div>
    ${na}
    ${done ? `<div class="file-chips">${fileChips(s.id, false)}</div>` : ""}
    <div class="row">
      ${filePickerHtml("sub-file", s.label, s.formats)}
      <button class="sm" onclick="subUploadSlot(${i})">上传</button>
      ${req ? `<button class="ghost sm" onclick="setSubMode('form')" title="留到表单区再传">稍后传</button>`
            : `<button class="ghost sm" onclick="subSkipSlot(${i})">跳过</button>`}
    </div>
    <div id="sub-slot-msg"></div>
  </div></div>`;
}
async function subUploadSlot(i) {
  const current = submissionContext();
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
    if (!current()) return;
    msg.innerHTML = "";
    afterSlotUpload(s.id, data.file_id, { name: file.name, size: file.size || data.size });
  } catch (e) {
    if (!current()) return;
    msg.innerHTML = `<div class="flash err" style="margin:6px 0">${esc(e.message)}</div>`;
  }
}
function advanceSlot(i) {
  state.sub.sIdx = nextPendingSlot(i + 1);
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
  return `<div class="msg agent"><div class="avatar">${icon("sparkle")}</div><div class="body">
    <b>核对一下再提交 ✅</b>
    ${state.sub.fields.length ? `<table style="margin-top:8px"><tr><th>登记信息</th><th>内容</th></tr>${ans}</table>` : ""}
    ${state.sub.slots.length ? `<table style="margin-top:8px"><tr><th>材料</th><th>状态</th></tr>${files}</table>` : ""}
    ${missing.length ? `<div class="flash err" style="margin-top:8px">还有必交材料没上传：${esc(missing.map(s => s.label).join("、"))}。
      传好后（或到表单区上传）再提交，没传齐的话系统会拦住。</div>` : ""}
    <p class="mini">在下方统一操作区保存草稿或正式提交就好，不用重复提交。</p>
    <div class="mini">提交成功后会拿到稳定回执，检查结果出来后，我会在这里告诉你要不要改、怎么改。</div>
  </div></div>`;
}

/* ---------------------------------------------------------------- 交付与归档 */
async function viewDelivery(taskId) {
  state.deliveryTaskId = taskId;
  state.deliveryHistory = [];
  state.deliveryHistoryHasMore = false;
  document.getElementById("app").innerHTML = `
    <div class="breadcrumb"><a href="#/tasks">我的任务</a><span>/</span><span>交付与归档</span></div>
    ${showcaseReturnHtml("交付与归档")}
    <div class="page-heading"><div><div class="eyebrow">DELIVERY & ARCHIVE</div><h1>交付与归档<span class="heading-dot">.</span></h1><p>先固定一份快照再导出，之后的新提交不会影响已经固定的包。</p></div>
      <a class="ghost" href="#/workbench/${taskId}">回工作台 ${icon("arrow")}</a></div>
    <div id="flash" role="status" aria-live="polite"></div>
    <div class="delivery-layout">
      <section class="card snapshot-panel"><div class="eyebrow">01 / SNAPSHOT</div><h2>固定新快照</h2>
        <label for="snap-kind">快照类型</label>
        <select id="snap-kind"><option value="formal">正式（仅已验收）</option><option value="preview">整理预览（全部列出）</option></select>
        <p class="field-help">${icon("delivery")} 正式快照只纳入已验收版本；预览快照列出全部主体并标明排除原因。每次点击都会生成一份新的独立快照，已有快照不会被覆盖。</p>
        <div id="delivery-snapshot-status" class="delivery-current-status" role="status" aria-live="polite">正在读取最近快照…</div>
        <button id="create-snapshot" onclick="createSnapshot(${taskId})">固定一份新快照 ${icon("arrow")}</button>
      </section>
      <section class="card delivery-note"><div class="eyebrow">02 / EXPORT</div><h2>导出说明</h2>
        <ul class="check-list"><li>CSV 汇总每个主体的登记信息、版本、回执与验收状态。</li><li>ZIP 按交付命名规则打包材料原件。</li><li>导出基于快照，不在导出时读取最新数据。</li></ul>
      </section>
    </div>
    <section class="card delivery-history"><div class="section-heading"><div><div class="eyebrow">HISTORY</div><h2>历史快照与导出</h2></div><button class="ghost sm" onclick="loadDeliveryHistory(${taskId})">刷新记录</button></div>
      <p class="field-help">离开页面后，已固定的清单和成功生成的文件仍可从这里找回。</p>
      <div id="delivery-history-list"><p class="muted">正在读取历史记录…</p></div>
    </section>
    <div id="snap-view"></div>`;
  loadDeliveryHistory(taskId);
}
function deliveryHistoryHtml(snapshots, taskId, hasMore) {
  if (!snapshots?.length) return '<div class="delivery-history-empty"><b>还没有生成过快照</b><span>生成后，清单和可下载文件会保留在这里。</span></div>';
  const statusLabel = {success:"已生成", failed:"未完成", running:"生成中", queued:"排队中"};
  const items = snapshots.map(snapshot => {
    const id = Number(snapshot.snapshot_id);
    const jobs = Array.isArray(snapshot.exports) ? snapshot.exports : [];
    const latest = jobs[0];
    const jobHtml = jobs.length ? jobs.map(job => {
      const jobId = Number(job.job_id);
      const downloads = [
        job.csv_available ? `<button class="ghost sm" onclick="downloadFile('/api/exports/${jobId}/csv','summary_${jobId}.csv')">下载 CSV</button>` : "",
        job.zip_available ? `<button class="ghost sm" onclick="downloadFile('/api/exports/${jobId}/zip','materials_${jobId}.zip')">下载 ZIP</button>` : "",
      ].filter(Boolean).join("");
      const missing = job.status === "success" && (!job.csv_available || !job.zip_available);
      return `<div class="delivery-history-export"><div class="delivery-history-export-head"><b>导出 #${jobId}</b><span class="badge ${job.status === "success" && !missing ? "ok" : job.status === "failed" || missing ? "warn" : "info"}">${esc(statusLabel[job.status] || job.status)}${missing ? " · 文件缺失" : ""}</span><time>${esc(fmtTime(job.created_at))}</time></div>
        ${job.error ? `<p class="field-help">${esc(job.error)}</p>` : missing ? '<p class="field-help">部分文件不再可用，可从原快照重新生成。</p>' : ""}
        ${downloads ? `<div class="row-actions">${downloads}</div>` : ""}</div>`;
    }).join("") : '<p class="muted">尚未生成 CSV / ZIP。</p>';
    return `<article class="delivery-history-item"><div class="delivery-history-item-head"><div><b>${snapshot.kind === "formal" ? "正式快照" : "整理预览快照"} #${id}</b><time>${esc(fmtTime(snapshot.created_at))}</time></div><span class="badge">纳入 ${Number(snapshot.totals?.included || 0)} / 排除 ${Number(snapshot.totals?.excluded || 0)}</span></div>
      <div class="delivery-history-exports">${jobHtml}</div>
      <div class="row-actions delivery-history-actions"><button class="ghost sm" onclick="inspectSnapshot(${id})">查看固定清单</button></div>
    </article>`;
  }).join("");
  return `${items}${hasMore ? `<div class="delivery-history-more"><button class="ghost sm" onclick="loadDeliveryHistory(${taskId},true)">加载更早记录</button><span id="delivery-history-more-error" class="muted"></span></div>` : ""}`;
}
function deliverySnapshotStatusHtml(snapshots) {
  const latest = Array.isArray(snapshots) && snapshots.length ? snapshots[0] : null;
  if (!latest) return '<span class="delivery-current-status-label">还没有固定快照</span><span>先生成一份快照，之后才能导出 CSV 和 ZIP。</span>';
  const kind = latest.kind === "formal" ? "正式快照" : "整理预览快照";
  return `<span class="delivery-current-status-label">最近固定：${kind} #${Number(latest.snapshot_id)}</span><span>${esc(fmtTime(latest.created_at))} · 再次固定会生成新快照，旧包保持不变。</span>`;
}
async function loadDeliveryHistory(taskId, append = false) {
  const epoch = state.routeEpoch, token = orgToken();
  const container = document.getElementById("delivery-history-list");
  if (!container) return;
  const offset = append ? (state.deliveryHistoryOffset || 0) : 0;
  if (!append) { state.deliveryHistory = []; state.deliveryHistoryOffset = 0; }
  try {
    const result = await api(`/api/tasks/${taskId}/snapshots?limit=20&offset=${offset}`);
    if (epoch !== state.routeEpoch || token !== orgToken() || Number(taskId) !== Number(state.deliveryTaskId)) return;
    const received = result.snapshots || [];
    if (append) {
      const known = new Set((state.deliveryHistory || []).map(snapshot => snapshot.snapshot_id));
      state.deliveryHistory = (state.deliveryHistory || []).concat(
        received.filter(snapshot => !known.has(snapshot.snapshot_id)));
    } else state.deliveryHistory = received;
    state.deliveryHistoryOffset = Number.isInteger(result.next_offset)
      ? result.next_offset : offset + received.length;
    state.deliveryHistoryHasMore = !!result.has_more;
    container.innerHTML = deliveryHistoryHtml(state.deliveryHistory, taskId, state.deliveryHistoryHasMore);
    const status = document.getElementById("delivery-snapshot-status");
    if (status && !append) status.innerHTML = deliverySnapshotStatusHtml(state.deliveryHistory);
  } catch (error) {
    if (epoch !== state.routeEpoch || token !== orgToken()) return;
    const message = `<span class="flash err">${esc(error.message || "历史记录暂时无法读取")}</span>`;
    const status = document.getElementById("delivery-snapshot-status");
    if (status && !append) status.innerHTML = '<span class="delivery-current-status-label">最近快照暂时无法读取</span><span>可以先固定新快照；历史记录恢复后会自动显示。</span>';
    if (append) {
      const moreError = document.getElementById("delivery-history-more-error");
      if (moreError) moreError.innerHTML = message;
    } else container.innerHTML = `${message}<button class="ghost sm" onclick="loadDeliveryHistory(${Number(taskId)})">重试</button>`;
  }
}
async function inspectSnapshot(snapshotId) {
  const epoch = state.routeEpoch, token = orgToken();
  await guard(async () => {
    const snapshot = await api(`/api/snapshots/${snapshotId}`);
    if (epoch !== state.routeEpoch || token !== orgToken()) return;
    paintSnapshot(snapshot.snapshot_id, JSON.parse(snapshot.manifest), snapshot.agent_evidence);
    document.getElementById("snap-view")?.scrollIntoView({behavior:"smooth", block:"start"});
    setFlash(`已打开快照 #${snapshot.snapshot_id}，清单保持不变`, "ok");
  }, () => epoch === state.routeEpoch && token === orgToken());
}
function agentEvidenceSummaryHtml(evidence) {
  const entries = Array.isArray(evidence?.entries) ? evidence.entries : [];
  const runs = entries.map(entry => entry && entry.run).filter(Boolean);
  const completed = runs.filter(run => run.status === "success").length;
  const pending = runs.filter(run => ["queued", "running", "retry_wait"].includes(run.status)).length;
  const failed = runs.filter(run => run.status === "failed").length;
  const offline = runs.filter(run => run.execution_mode === "offline_replay").length;
  const live = runs.filter(run => run.execution_mode !== "offline_replay").length;
  const toolSteps = runs.reduce((total, run) => total + (Array.isArray(run.tool_trace) ? run.tool_trace.length : 0), 0);
  const ruleCounts = {};
  runs.forEach(run => Object.entries(run.rule_results || {}).forEach(([key, value]) => {
    ruleCounts[key] = (ruleCounts[key] || 0) + Number(value || 0);
  }));
  const ruleText = Object.entries(ruleCounts).map(([key, value]) => `${esc(key)} ${value}`).join(" · ") || "暂无规则结论";
  const handoff = failed || pending || entries.some(entry => entry && !entry.run);
  const status = failed ? `<span class="badge bad">有运行失败</span>`
    : pending ? `<span class="badge info">仍在运行</span>`
    : runs.length ? `<span class="badge ok">证据已就绪</span>`
    : `<span class="badge">暂无运行</span>`;
  return `<section class="agent-evidence-panel" aria-label="Agent 运行证据">
    <div class="agent-evidence-head"><div><div class="eyebrow">AGENT EVIDENCE</div><h3>Agent 运行证据</h3></div>${status}</div>
    <p class="field-help">与本快照中的版本绑定，只展示可追溯的运行元数据；材料正文、提示词、工具参数和隐藏推理不会出现在这里。</p>
    <div class="agent-evidence-metrics">
      <div><span>已绑定运行</span><b>${runs.length}/${entries.length}</b><small>完成 ${completed} · 待处理 ${pending + failed}</small></div>
      <div><span>运行方式</span><b>${offline} 离线 / ${live} 实时</b><small>用于区分演示回放与模型服务</small></div>
      <div><span>规则结论</span><b>${Object.values(ruleCounts).reduce((a, b) => a + b, 0)}</b><small>${ruleText}</small></div>
      <div><span>工具步骤</span><b>${toolSteps}</b><small>仅保留工具名、序号、状态和耗时</small></div>
    </div>
    ${handoff ? `<div class="notice-warn agent-evidence-handoff"><b>仍需要人工接手</b><p>${failed ? "有检查运行失败；" : ""}${pending ? "有检查尚未完成；" : ""}${entries.some(entry => entry && !entry.run) ? "部分主体没有可绑定的检查运行；" : ""}这些状态不会被包装成已通过，组织者可以回到复核页逐项处理。</p></div>` : `<div class="notice-info agent-evidence-handoff"><b>人工发布门仍然有效</b><p>Agent 只提供证据，纳入交付仍以组织者验收和固定快照为准。</p></div>`}
  </section>`;
}
function paintSnapshot(snapshotId, manifest, evidence = null) {
  const excluded = (manifest.entries || []).filter(entry => !entry.included);
  const target = document.getElementById("snap-view");
  if (!target) return;
  target.innerHTML = `<section class="card snapshot-result">
    <div class="section-heading"><div><div class="eyebrow">SNAPSHOT #${snapshotId}</div><h2>${manifest.kind === "formal" ? "正式快照" : "整理预览快照"}</h2></div><span class="badge ${manifest.kind === "formal" ? "ok" : "info"}">已固定</span></div>
    <div class="overview-stats">${[["主体总数", manifest.totals.subjects], ["纳入", manifest.totals.included], ["排除", manifest.totals.excluded], ["蓝图版本", "#" + manifest.blueprint_version_id]].map(([label, value]) => `<div class="overview-stat"><span>${label}</span><strong>${value}</strong><i>${icon("delivery")}</i></div>`).join("")}</div>
    <div class="table-wrap"><table><thead><tr><th>主体</th><th>版本</th><th>纳入</th><th>排除原因</th><th>材料</th></tr></thead>
    <tbody>${(manifest.entries || []).map(entry => `<tr><td>${esc(entry.name)}</td><td>${entry.revision ?? "-"}</td>
      <td>${entry.included ? '<span class="badge ok">是</span>' : '<span class="badge">否</span>'}</td><td>${esc(entry.excluded_reason || "—")}</td>
      <td>${(entry.files || []).length}</td></tr>`).join("")}</tbody></table></div>
    ${excluded.length ? `<p class="field-help">有 ${excluded.length} 个主体未纳入：正式快照只包含已验收版本，可在工作台逐个人工验收后重新固定。</p>` : ""}
    ${agentEvidenceSummaryHtml(evidence)}
    <div class="row-actions snapshot-actions"><div class="snapshot-export-action"><button class="ghost" onclick="runExport(${snapshotId})">导出当前快照 ${icon("arrow")}</button><span class="field-help">生成这份快照的 CSV + ZIP</span></div><span id="dl" class="row-actions"></span></div>
  </section>`;
}
async function createSnapshot(taskId) {
  const button = document.getElementById("create-snapshot");
  if (!button || button.disabled) return;
  const original = button.innerHTML;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.innerHTML = "正在固定快照…";
  try {
    await guard(async () => {
      const kind = document.getElementById("snap-kind").value;
      const r = await api(`/api/tasks/${taskId}/snapshots`,
                          { method: "POST", form: { kind } });
      paintSnapshot(r.snapshot_id, JSON.parse(r.manifest), r.agent_evidence);
      setFlash(`快照 #${r.snapshot_id} 已固定`, "ok");
      await loadDeliveryHistory(taskId);
    });
  } finally {
    if (button.isConnected !== false) {
      button.disabled = false;
      button.setAttribute("aria-busy", "false");
      button.innerHTML = original;
    }
  }
}
async function runExport(snapId, targetId = "dl") {
  await guard(async () => {
    const r = await api(`/api/snapshots/${snapId}/export`, { method: "POST" });
    state.lastJob = r;
    const target = document.getElementById(targetId);
    if (!target) return;
    if (r.status !== "success" || !r.csv || !r.zip) {
      target.innerHTML = '<span class="badge bad">未生成可下载文件</span>';
      setFlash(r.error || `导出作业 #${r.job_id} 未完成，请核对材料后重试`, "err");
      await loadDeliveryHistory(state.deliveryTaskId);
      return;
    }
    target.innerHTML = `
      <button class="ghost sm" onclick="downloadFile('/api/exports/${r.job_id}/csv','summary_${r.job_id}.csv')">下载 CSV</button>
      <button class="ghost sm" onclick="downloadFile('/api/exports/${r.job_id}/zip','materials_${r.job_id}.zip')">下载 ZIP</button>`;
    setFlash(`导出作业 #${r.job_id} 已生成`, "ok");
    await loadDeliveryHistory(state.deliveryTaskId);
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
