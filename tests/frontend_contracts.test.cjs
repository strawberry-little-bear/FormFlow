const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app/static/app.js'), 'utf8')
  .replace(/\nroute\(\);\s*$/, '\n');
const styleSource = fs.readFileSync(path.join(__dirname, '../app/static/style.css'), 'utf8');
const indexSource = fs.readFileSync(path.join(__dirname, '../app/static/index.html'), 'utf8');
const showcaseHarnessSource = fs.readFileSync(path.join(__dirname, '../scripts/showcase_check.cjs'), 'utf8');

function storage() {
  const data = new Map();
  return {getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,String(v)), removeItem: k => data.delete(k)};
}
function element(value = '') {
  const classes = new Set();
  return {value, innerHTML: '', textContent: '', dataset: {}, disabled: false, isConnected: true,
    classList: {toggle(name, force) { if (force) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); }}, attributes: {}, listeners: {},
    toggleAttribute(k, on) {this.attributes[k]=on;this.disabled=!!on;}, remove() {},
    setAttribute(k, v) {this.attributes[k] = v;}, getAttribute(k) {return this.attributes[k] ?? null;},
    addEventListener(k, fn) {this.listeners[k] = fn;}, querySelector() {return null;},
    querySelectorAll() {return [];}, scrollIntoView() {this.scrolled = true;},
    insertAdjacentHTML(_, html) {this.innerHTML = html + this.innerHTML;},
    focus() {this.focused = true;}, click() {this.clicked = true;}, showModal() {this.open = true;}, close() {this.open = false; this.listeners.close?.();},
    setSelectionRange(start, end) {this.selectionStart = start; this.selectionEnd = end;}};
}
function setup(sharedStorage = storage()) {
  const els = Object.fromEntries(['sub', 'draft-hint', 'flash', 'receipt-out', 'decision-submit', 'presentation-toggle', 'lg-cred',
    'review-conflict', 'login-err', 'dc-type', 'dc-rule', 'dc-reason', 'dc-exp', 'acceptance-reason', 'acceptance-submit',
    'review-draft-status', 'submission-errors', 'field-error-name', 'dl', 'delivery-history-list', 'delivery-history-more-error', 'snap-view', 'create-snapshot', 'snap-kind', 'app', 'rv', 'rv-name', 'my-results', 'my-results-card', 'submit-next-step', 'nav', 'role-label', 'wb-next-step', 'btn-logout', 'workspace-agent-mode', 'workspace-agent-status', 'agent-tour-mode', 'agent-tour-availability', 'agent-runtime-mode', 'agent-runtime-status', 'grant-out', 'roster-name', 'roster-stats', 'roster-filter', 'roster-results-status', 'roster-table'].map(id => [id, element()]));
  const fields = [Object.assign(element('old'), {dataset: {field:'name'}})];
  els['login-err'].style = {};
  els['field-name'] = fields[0];
  const body = Object.assign(element(), {dataset: {page: 'tasks'}});
  const document = {body, documentElement: {style: {setProperty(name, value) { this[name] = value; }}}, getElementById: id => els[id] || null,
    querySelectorAll: sel => sel === '[data-field]' ? fields : [], querySelector: () => null};
  const windowListeners = {};
  const viewportListeners = {};
  const visualViewport = {height: 844, offsetTop: 0, addEventListener(name, fn) {viewportListeners[name] = fn;}};
  const context = vm.createContext({document, localStorage: storage(), sessionStorage: sharedStorage,
    window: {innerHeight: 844, visualViewport, addEventListener(name, fn) {windowListeners[name] = fn;}}, navigator: {onLine: true}, location: {hash:'#/submit'}, Intl, URLSearchParams, FormData,
    requestAnimationFrame: fn => fn(),
    setTimeout, clearTimeout, confirm: () => true, console,
    fetch: async () => {throw new Error('Unexpected request');}});
vm.runInContext(source + '\nthis.app = {state, route, useVersionAsBase, loadDesignVersion, cacheDesignInputs, restoreDesignInputs, recoverDesignInput, recoverDesignInput, paintChat, runAgent, runExport, deliveryHistoryHtml, deliverySnapshotStatusHtml, loadDeliveryHistory, inspectSnapshot, paintSnapshot, agentEvidenceSummaryHtml, canPublishDesign, publishDiffHtml, designVersionImpactHtml, publishGovernanceHtml, publishBp, confirmPublish, revokeDecision, confirmRevokeDecision, paintWorkbench, filterWorkbench, fmtTime, fmtTimeShort, designReadinessHtml, designProgressHtml, applyDraft, draftFingerprint, collectDraftFields, cacheSubmissionDraft, paintSubmitterNextStep, submitterNextStepHtml, setSubMode, moveSubmitModeTab, setDesignTab, moveDesignTab, refreshSlotConditions, wbMatches, api, apiError, submitDecision, saveDraft, doSubmit, doSubLogin, uploadSlot, deleteSlotFile, cacheReviewDraft, discardReviewDraft, logout, nextPendingReview, setReviewFilter, setReviewTraceFilter, selectReviewRule, viewReview, reviewRevisionHistoryHtml, paintReview, renderNav, loadMyResults, refreshWorkbench, paintReminder, chooseWorkbenchNextStep, workbenchNextStepHtml, agentRunCard, agentTourHtml, agentTourRuntimeHtml, runtimeSelfTestHtml, submitterGuidance, ruleCard, receiptFilesHtml, submissionIssues, checkAgentRequestNow, resumePendingAgentRequest, savePendingAgentRequest, agentRequestProgressHtml, retryAgent, pollAgentRequest, showSubmissionIssues, initSubChat, demoRouteTask, demoRouteHtml, demoRouteCueHtml, copyDemoRouteCue, agentArchitectureRailHtml, agentQuickReadHtml, agentShowcaseHtml, runStageReplayHtml, paintAgentShowcase, jumpToRunStage, mcpSnapshotHtml, renderDemoRoute, paintWorkspaceAgentStatus, paintAgentRuntime, paintAgentRuntimeContractIssue, viewLogin, viewSubmit, switchLoginTab, moveLoginTab, setFlash, openDialog, readPresentationMode, showcaseReturnHtml, applyPresentationMode, setPresentationMode, togglePresentationMode, fillDemoCred, doLogin, issueAllGrants, viewRoster, loadRoster, setRosterFilter, renderRosterTable, showCredential, showCredentialList, setEmptyTaskHome, jumpToSubmitResults};', context);
  context.app.deliverySnapshotStatusHtml = context.deliverySnapshotStatusHtml;
  context.app.afterSlotUpload = context.afterSlotUpload;
  context.app.agentRuntimeContractIssue = context.agentRuntimeContractIssue;
  Object.assign(context.app.state, {routeEpoch: 1, me:{task:{id:1, status:'collecting', timezone:'Asia/Shanghai'},subject:{id:2}},
    draftVersion:1, fileMeta:{}, sub:{mode:'chat',phase:'fields',fIdx:0, fields:[{id:'name'}],slots:[],answers:{}}});
  context.window.confirm = () => true;
  context.localStorage.setItem('ff_sub_token', 'test-only-credential');
  return {context, app:context.app, document, els, fields, windowListeners, viewportListeners, visualViewport};
}
function response(data, status = 200) {
  return {ok:status < 400,status,text:async()=>JSON.stringify(data),json:async()=>data};
}
function deferred() {
  let resolve; const promise = new Promise(r => {resolve=r;}); return {promise,resolve};
}

test('agent runtime rejects missing and stale manifest contracts', () => {
  const {app} = setup();
  assert.equal(app.agentRuntimeContractIssue({contract_version: 1}), '');
  assert.match(app.agentRuntimeContractIssue({contract_version: 0}), /\u91cd\u542f API \u670d\u52a1\u540e\u5237\u65b0\u9875\u9762/);
  assert.match(app.agentRuntimeContractIssue({}), /\u8fd0\u884c\u65f6\u6e05\u5355\u672a\u52a0\u8f7d/);
});

test('agent runtime details keep the restart guidance in one place', () => {
  const {app, els} = setup();
  const warning = '服务端 API 与当前页面版本不一致；请重启 API 服务后刷新页面。运行时清单未加载，以下为静态说明。';
  app.paintAgentRuntimeContractIssue(warning);
  assert.equal(els['workspace-agent-status'].textContent, warning);
  assert.equal(els['agent-runtime-status'].textContent, warning);
  assert.equal(els['agent-tour-availability'].textContent, '运行时清单版本不匹配，架构说明使用静态内容。');
});

test('deadline formatting uses task timezone, never browser timezone', () => {
  const {app} = setup();
  assert.equal(app.fmtTime('2026-11-08T10:00:00Z'), '2026-11-08 18:00 Asia/Shanghai');
  assert.equal(app.fmtTime('2026-11-08T10:00:00'), app.fmtTime('2026-11-08T18:00:00+08:00'));
  assert.equal(app.fmtTime('2026-11-08T10:00:00Z','America/New_York'), '2026-11-08 05:00 America/New_York');
  assert.equal(app.fmtTime('2026-11-08T10:00:00Z','Invalid/TaskZone'), '2026-11-08 10:00 UTC');
  assert.equal(app.fmtTimeShort('2026-11-08T10:00:00Z','Invalid/TaskZone'), '2026-11-08 10:00 UTC');
});
test('short deadline formatting keeps the year when a task crosses New Year', () => {
  const {app} = setup();
  assert.equal(app.fmtTimeShort('2026-12-31T16:00:00Z', 'Asia/Shanghai'), '2027-01-01 00:00');
  assert.equal(app.fmtTimeShort('2027-01-08T16:00:00Z', 'Asia/Shanghai'), '2027-01-09 00:00');
});
test('login explains the constrained agent boundary before authentication', () => {
  const {app, els} = setup();
  app.viewLogin();
  const html = els.app.innerHTML;
  assert.match(html, /CONTROLLED AGENT FLOW/);
  assert.match(html, /原始要求/);
  assert.match(html, /受限 Skill/);
  assert.match(html, /原文证据/);
  assert.match(html, /人工确认/);
  assert.match(html, /不会自动完成/);
  assert.match(html, /智能起草，先确认再发布/);
  assert.match(html, /配置模型密钥后/);
  assert.match(html, /发布前由组织者确认/);
  assert.doesNotMatch(html, /聊几句就能出表/);
});
test('submitter login explains where demo credentials appear and only offers organizer return when signed in', () => {
  const {app, context, els} = setup();
  app.viewLogin('sub');
  assert.match(els.app.innerHTML, /首次初始化显示的提交凭证在启动器终端中/);
  assert.match(els.app.innerHTML, /联系组织者重新发一份/);
  assert.doesNotMatch(els.app.innerHTML, /返回组织者任务列表/);

  context.localStorage.setItem('ff_org_token', 'org-test');
  app.viewLogin('sub');
  assert.match(els.app.innerHTML, /href="#\/tasks">返回组织者任务列表/);
});
test('login feature icons use shared SVGs and the document has an inline favicon', () => {
  const {app, els} = setup();
  app.viewLogin();
  const featureIcons = els.app.innerHTML.match(/<div class="feat"><div class="ic"><svg\b/g) || [];
  assert.equal(featureIcons.length, 3);
  assert.doesNotMatch(els.app.innerHTML, /<div class="feat"><div class="ic">[✧⌕▣]/);
  assert.match(indexSource, /<link rel="icon" href="data:image\/svg\+xml,/);
  assert.match(indexSource, /%E9%BD%90/);
});
test('login tabs and fields expose their relationships to assistive technology', () => {
  const {app} = setup();
  app.viewLogin();
  assert.match(source, /role="tablist" aria-label="登录身份"/);
  assert.match(source, /id="tab-org"[^>]*role="tab"[^>]*aria-selected="\$\{submitterTab \? "false" : "true"\}"[^>]*aria-controls="pane-org"/);
  assert.match(source, /id="tab-org"[^>]*tabindex="\$\{submitterTab \? "-1" : "0"\}"[^>]*onkeydown="moveLoginTab\(event\)"/);
  assert.match(source, /id="tab-sub"[^>]*tabindex="\$\{submitterTab \? "0" : "-1"\}"[^>]*onkeydown="moveLoginTab\(event\)"/);
  assert.match(source, /id="pane-sub" role="tabpanel" aria-labelledby="tab-sub"\$\{submitterTab \? "" : " hidden"\}/);
  assert.match(source, /<label for="lg-user">用户名<\/label>/);
  assert.match(source, /<label for="lg-pass">密码<\/label>/);
});
test('login tabs support roving focus with arrow and Home/End keys', () => {
  const {app, els} = setup();
  els['tab-org'] = Object.assign(element(), {id: 'tab-org'});
  els['tab-sub'] = Object.assign(element(), {id: 'tab-sub'});
  els['pane-org'] = Object.assign(element(), {style: {}});
  els['pane-sub'] = Object.assign(element(), {style: {}});
  els['login-err'] = Object.assign(element(), {style: {}});
  app.switchLoginTab('org');
  assert.equal(els['tab-org'].attributes.tabindex, '0');
  assert.equal(els['tab-sub'].attributes.tabindex, '-1');
  let prevented = false;
  app.moveLoginTab({key: 'ArrowRight', currentTarget: els['tab-org'], preventDefault: () => {prevented = true;}});
  assert.equal(prevented, true);
  assert.equal(els['tab-sub'].focused, true);
  assert.equal(els['tab-sub'].clicked, true);
  app.switchLoginTab('sub');
  app.moveLoginTab({key: 'Home', currentTarget: els['tab-sub'], preventDefault() {}});
  assert.equal(els['tab-org'].focused, true);
  app.moveLoginTab({key: 'End', currentTarget: els['tab-org'], preventDefault() {}});
  assert.equal(els['tab-sub'].focused, true);
});
test('design tabs expose a complete keyboard and assistive-technology pattern', () => {
  assert.match(source, /id="design-tab-preview" role="tab" aria-controls="design-tabpanel"[^>]*tabindex="\$\{state\.designTab === 'preview' \? '0' : '-1'\}" onkeydown="moveDesignTab\(event\)"/);
  assert.match(source, /id="design-tab-rules" role="tab" aria-controls="design-tabpanel"[^>]*onkeydown="moveDesignTab\(event\)"/);
  assert.match(source, /id="design-tabpanel" class="draft-content" role="tabpanel" aria-labelledby="design-tab-\$\{state\.designTab\}" tabindex="0"/);
  const {app, els} = setup();
  els['design-tab-preview'] = Object.assign(element(), {id: 'design-tab-preview'});
  els['design-tab-rules'] = Object.assign(element(), {id: 'design-tab-rules'});
  let prevented = false;
  app.moveDesignTab({key: 'ArrowRight', currentTarget: els['design-tab-preview'], preventDefault: () => {prevented = true;}});
  assert.equal(prevented, true);
  assert.equal(els['design-tab-rules'].clicked, true);
  app.moveDesignTab({key: 'Home', currentTarget: els['design-tab-rules'], preventDefault() {}});
  assert.equal(els['design-tab-preview'].clicked, true);
  app.setDesignTab('rules');
  assert.equal(app.state.designTab, 'rules');
  assert.equal(els['design-tab-rules'].focused, true);
  app.setDesignTab('invalid');
  assert.equal(app.state.designTab, 'rules');
});
test('login remains readable at 200 percent narrow widths', () => {
  assert.match(styleSource, /\.hero-flow-steps em \{ color:#596760; font-size:12px;/);
  assert.match(styleSource, /@media\(max-width:700px\)[\s\S]*\.hero-flow-steps em \{ font-size:12px; \}/);
  assert.match(styleSource, /@media\(max-width:340px\)\s*\{[\s\S]*\.hero-flow-steps \{ grid-template-columns:1fr; gap:7px; \}/);
  assert.match(styleSource, /@media\(max-width:340px\)[\s\S]*\.hero-flow-steps strong \{ white-space:normal; \}/);
  assert.match(styleSource, /@media\(max-width:340px\)[\s\S]*\.tabs \{ flex-direction:column; \}/);
  assert.match(styleSource, /@media\(max-width:340px\)[\s\S]*\.auth-page main \{ padding:12px; \}/);
  assert.match(styleSource, /@media\(max-width:340px\)[\s\S]*\.skip-link \{ left:12px; max-width:calc\(100vw - 24px\); \}/);
  assert.match(styleSource, /@media\(min-width:300px\) and \(max-width:340px\)[\s\S]*\.hero-flow-steps \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styleSource, /@media\(min-width:300px\) and \(max-width:340px\)[\s\S]*\.hero-flow-steps em \{ display:none; \}/);
  assert.match(styleSource, /@media\(min-width:300px\) and \(max-width:340px\)[\s\S]*\.hero-flow-note \{ display:none; \}/);
  assert.match(styleSource, /@media\(min-width:300px\) and \(max-width:340px\)[\s\S]*\.login-panel \{ padding:14px 16px; \}/);
  assert.match(styleSource, /@media\(min-width:300px\) and \(max-width:340px\)[\s\S]*\.tabs \{ flex-direction:row;/);
  assert.match(styleSource, /@media\(min-width:341px\) and \(max-width:420px\)[\s\S]*\.hero-flow-steps em,\.hero-flow-note \{ display:none; \}/);
  assert.match(styleSource, /@media\(min-width:341px\) and \(max-width:420px\)[\s\S]*\.login-panel \{ padding:12px 24px; \}/);
});
test('mobile agent architecture descriptions stay readable and wrap', () => {
  assert.match(styleSource, /@media \(max-width:600px\)[\s\S]*\.demo-route-architecture-lead small,\s*\.demo-route-architecture-step b,\s*\.demo-route-architecture-step code,\s*\.demo-route-architecture-step small \{ font-size:12px; line-height:1\.45; \}/);
});
test('login route can open directly on the submitter tab', () => {
  const {app, context, els} = setup();
  context.location.hash = '#/login?role=sub';
  app.route();
  assert.match(els.app.innerHTML, /id="tab-sub" class="on"[^>]*aria-selected="true"/);
  assert.match(els.app.innerHTML, /id="pane-org"[^>]* hidden/);
  assert.match(els.app.innerHTML, /id="pane-sub"[^>]*aria-labelledby="tab-sub"(?! hidden)/);
});
test('submitter credential errors show the server guidance once', async () => {
  const {app, context, els} = setup();
  els['lg-cred'].value = 'expired-token';
  context.fetch = async () => response({detail: '凭证已失效，请联系组织者重新发放'}, 401);
  await app.doSubLogin();
  assert.equal(els['login-err'].textContent, '凭证已失效，请联系组织者重新发放');
  assert.doesNotMatch(els['login-err'].textContent, /凭证无效或已失效：/);
});
test('submitter input modes expose tab and panel relationships', () => {
  setup();
  assert.match(source, /role="tablist" aria-label="填写方式"/);
  assert.match(source, /role="tab" id="submode-form"[^>]*aria-selected="true"[^>]*aria-controls="sub-fields-card"[^>]*tabindex="0"[^>]*onkeydown="moveSubmitModeTab\(event\)"/);
  assert.match(source, /role="tab" id="submode-chat"[^>]*aria-selected="false"[^>]*aria-controls="sub-chat-card"[^>]*tabindex="-1"[^>]*onkeydown="moveSubmitModeTab\(event\)"/);
  assert.match(source, /id="sub-chat-card" role="tabpanel" aria-labelledby="submode-chat" hidden/);
  assert.match(source, /id="sub-fields-card" role="tabpanel" aria-labelledby="submode-form"/);
});
test('submitter input modes support roving focus with arrow and Home/End keys', () => {
  const {app, els} = setup();
  els['submode-form'] = Object.assign(element(), {id: 'submode-form'});
  els['submode-chat'] = Object.assign(element(), {id: 'submode-chat'});
  els['sub-chat-card'] = Object.assign(element(), {hidden: true});
  els['sub-fields-card'] = Object.assign(element(), {hidden: false});
  let prevented = false;
  app.moveSubmitModeTab({key: 'ArrowRight', currentTarget: els['submode-form'], preventDefault: () => {prevented = true;}});
  assert.equal(prevented, true);
  assert.equal(els['submode-chat'].focused, true);
  assert.equal(els['submode-chat'].clicked, true);
  app.setSubMode('chat');
  assert.equal(els['submode-chat'].attributes['aria-selected'], 'true');
  assert.equal(els['submode-chat'].attributes.tabindex, '0');
  assert.equal(els['submode-form'].attributes.tabindex, '-1');
  assert.equal(els['sub-chat-card'].hidden, false);
  assert.equal(els['sub-fields-card'].hidden, true);
  app.moveSubmitModeTab({key: 'Home', currentTarget: els['submode-chat'], preventDefault() {}});
  assert.equal(els['submode-form'].focused, true);
  app.moveSubmitModeTab({key: 'End', currentTarget: els['submode-form'], preventDefault() {}});
  assert.equal(els['submode-chat'].focused, true);
});
test('apiError preserves HTTP status for callers that need an auth fallback', () => {
  const {app} = setup();
  assert.equal(app.apiError({detail: '凭证失效'}, 401).status, 401);
});
test('submitter navigation is reachable from an organizer session without a submitter token', () => {
  const {app, context, els} = setup();
  context.localStorage.removeItem('ff_sub_token');
  context.localStorage.setItem('ff_org_token', 'org-test');
  context.location.hash = '#/tasks';
  app.renderNav();
  assert.match(els.nav.innerHTML, /href="#\/login\?role=sub"/);
  assert.match(els.nav.innerHTML, /提交者入口/);
});
test('submitter page redirects to submitter login when the credential is missing or expired', async () => {
  const {app, context, els} = setup();
  context.localStorage.removeItem('ff_sub_token');
  await app.viewSubmit();
  assert.equal(context.location.hash, '#/login?role=sub');

  context.location.hash = '#/submit';
  context.localStorage.setItem('ff_sub_token', 'expired');
  const requests = [];
  context.fetch = async url => { requests.push(url); return response({detail: '凭证失效'}, 401); };
  await app.viewSubmit();
  assert.deepEqual(requests, ['/api/me'], 'expired credentials should fail before loading draft and receipt');
  assert.equal(context.localStorage.getItem('ff_sub_token'), null);
  assert.equal(context.location.hash, '#/login?role=sub&notice=credential-expired');
  app.route();
  assert.equal(els['login-err'].textContent, '当前提交凭证已失效，请联系组织者重新发放，再用新凭证登录。');
});
test('submitter initial network failure keeps the credential and offers reload', async () => {
  const {app, context, els} = setup();
  context.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await app.viewSubmit();
  assert.equal(context.localStorage.getItem('ff_sub_token'), 'test-only-credential');
  assert.match(els.sub.innerHTML, /网络连接暂时不可用/);
  assert.match(els.sub.innerHTML, /重新加载提交空间/);
  assert.equal(context.location.hash, '#/submit');
});
test('flash messages announce errors urgently and successes politely', () => {
  const {app, els} = setup();
  app.setFlash('操作失败', 'err');
  assert.equal(els.flash.attributes.role, 'alert');
  assert.equal(els.flash.attributes['aria-live'], 'assertive');
  app.setFlash('已完成', 'ok');
  assert.equal(els.flash.attributes.role, 'status');
  assert.equal(els.flash.attributes['aria-live'], 'polite');
});
test('modal focus stays inside the dialog and returns to its opener', () => {
  const {app, context, els} = setup();
  const dialog = element(), first = element(), last = element(), opener = element();
  dialog.querySelector = () => first;
  dialog.querySelectorAll = () => [first, last];
  first.focus = () => { first.focused = true; context.document.activeElement = first; };
  last.focus = () => { last.focused = true; context.document.activeElement = last; };
  opener.focus = () => { opener.focused = true; };
  els['focus-dialog'] = dialog;
  app.openDialog('focus-dialog', opener);
  assert.equal(dialog.attributes['aria-modal'], 'true');
  context.document.activeElement = last;
  let prevented = false;
  dialog.listeners.keydown({key:'Tab', shiftKey:false, preventDefault:() => {prevented = true;}});
  assert.equal(prevented, true);
  assert.equal(first.focused, true);
  dialog.close();
  assert.equal(opener.focused, true);
});
test('demo route explains the full workflow and points to the selected task', () => {
  const {app} = setup();
  const task = {id: 7, name: '演示任务', status: 'collecting'};
  assert.equal(app.demoRouteTask([task]).id, 7);
  const html = app.demoRouteHtml(task);
  assert.match(html, /DEMO ROUTE/);
  assert.match(html, /整理要求/);
  assert.match(html, /发放凭证/);
  assert.match(html, /检查并接手/);
  assert.match(html, /固定交付/);
  assert.match(html, /#\/design\/7/);
  assert.match(html, /#\/roster\/7/);
  assert.match(html, /#\/workbench\/7/);
  assert.match(html, /#\/delivery\/7/);
  assert.match(html, /Agent \+ 人确认/);
  assert.match(html, /程序执行/);
  assert.match(html, /Agent → 人/);
  assert.match(html, /程序快照/);
  assert.doesNotMatch(html, /class="demo-route-step[^>]*aria-label=/);
  assert.match(styleSource, /\.demo-route-owner\.system/);
  assert.match(styleSource, /\.demo-route-owner\.human/);
});
test('demo route focus turns the evidence entry into a stage-specific action', () => {
  const {app} = setup();
  const base = {id: 7, name: '演示任务', status: 'collecting'};
  const stages = [
    ['整理要求', '原始要求 + 蓝图', '#/design/7', '打开蓝图'],
    ['发放凭证', '名单 + 凭证记录', '#/roster/7', '打开名单与凭证'],
    ['检查并接手', '规则结论 + 原文位置', '#/review/7/2', '打开规则证据'],
    ['固定交付', '验收结果 + 正式版本', '#/delivery/7', '打开验收快照'],
  ];
  for (const [title, evidence, href, action] of stages) {
    const html = app.demoRouteHtml({...base, demo_route: {
      completed: 1, total: 4,
      current: {key: title === '整理要求' ? 'design' : title === '发放凭证' ? 'roster' : title === '检查并接手' ? 'review' : 'delivery', title, href, detail: '当前站'},
      next: {title: '下一站', detail: '继续'},
      steps: [{key: 'design', title: '整理要求', status: 'upcoming', href: '#/design/7'}, {key: 'roster', title: '发放凭证', status: 'upcoming', href: '#/roster/7'}, {key: 'review', title: '检查并接手', status: 'upcoming', href: '#/review/7/2'}, {key: 'delivery', title: '固定交付', status: 'upcoming', href: '#/delivery/7'}],
    }});
    assert.ok(html.includes(`class="demo-route-focus-evidence" href="${href}"`));
    assert.ok(html.includes(`${evidence} `));
    assert.ok(html.includes(`<span>${action}</span>`));
  }
  assert.match(styleSource, /\.demo-route-focus-evidence \{/);
  assert.match(styleSource, /\.demo-route-focus-evidence:focus-visible/);
});
test('demo route puts the current station command panel before supporting runtime evidence', () => {
  const {app} = setup();
  const html = app.demoRouteHtml({id: 7, name: '演示任务', status: 'collecting', demo_route: {
    completed: 2,
    total: 4,
    current: {key: 'review', title: '检查并接手', href: '#/review/7/2', detail: '把结论落到原文证据'},
    next: {title: '固定交付', href: '#/delivery/7', detail: '验收完成后固定快照'},
    steps: [
      {key: 'design', title: '整理要求', status: 'done', href: '#/design/7'},
      {key: 'roster', title: '发放凭证', status: 'done', href: '#/roster/7'},
      {key: 'review', title: '检查并接手', status: 'current', href: '#/review/7/2'},
      {key: 'delivery', title: '固定交付', status: 'upcoming', href: '#/delivery/7'},
    ],
  }});
  const commandIndex = html.indexOf('class="demo-route-focus demo-route-command"');
  const liveIndex = html.indexOf('class="demo-route-live"');
  assert.ok(commandIndex >= 0);
  assert.ok(liveIndex > commandIndex);
  assert.match(html, /demo-route-command[\s\S]*从这里开始 · 当前焦点[\s\S]*进入检查并接手/);
  assert.match(styleSource, /\.demo-route-command \{/);
  assert.match(styleSource, /\.demo-route-command \.button-link/);
});
test('demo route makes the agent control plane legible to a first-time viewer', () => {
  const {app} = setup();
  app.state.llmConfigured = false;
  const html = app.demoRouteHtml({id: 7, name: '演示任务', status: 'collecting'});
  assert.match(html, /AGENT CONTROL PLANE/);
  assert.match(html, /requirements_draft/);
  assert.match(html, /review_one_submission/);
  assert.match(html, /4 read-only tools/);
  assert.match(html, /class="demo-route-architecture"/);
  assert.match(html, /数据边界/);
  assert.match(html, /当前走离线演示路径，不调用实时模型。网页显示服务端脱敏投影；外部 MCP sidecar 需在终端单独授权，浏览器不持有 sidecar token。/);
  assert.match(html, /终端单独调用，只读导航与聚合快照/);
  assert.match(styleSource, /\.demo-route-architecture \{/);
  assert.match(styleSource, /\.demo-route-architecture-flow \{ display:grid;/);
  assert.match(styleSource, /\.demo-route-architecture-foot \{/);
  assert.match(styleSource, /@media \(max-width:360px\) \{[\s\S]*\.demo-route-architecture-flow \{ grid-template-columns:1fr; \}/);
});
test('agent control plane nodes expose real task and runtime entry points', () => {
  const {app} = setup();
  const html = app.demoRouteHtml({id: 7, name: '演示任务', status: 'collecting', demo_route: {
    review_signal: {subject_name: '李四', review_href: '#/review/7/2'},
  }});
  assert.match(html, /href="#\/design\/7">打开需求设计/);
  assert.match(html, /href="#\/review\/7\/2">打开证据复核/);
  assert.match(html, /onclick="jumpToAgentTour\(\)">查看运行边界/);
  assert.match(html, /onclick="jumpToMcpSnapshot\(\)">查看只读回放/);
  assert.match(styleSource, /\.demo-route-architecture-step a:focus-visible/);
  assert.match(styleSource, /\.demo-route-architecture-step button:focus-visible/);
});
test('agent control plane projects service runtime, MCP and authorized review state', () => {
  const {app} = setup();
  app.state.agentRuntime = {
    skills: [{name: 'requirements_draft'}, {name: 'review_one_submission'}],
    harness: {max_invocations: 6},
  };
  app.state.mcpSnapshot = {execution: {status: 'completed'}};
  const html = app.demoRouteHtml({id: 7, name: '演示任务', status: 'collecting', demo_route: {
    review_signal: {subject_name: '李四', review_href: '#/review/7/2'},
  }});
  assert.match(html, /id="architecture-requirements-status" class="demo-route-architecture-status ok">已登记/);
  assert.match(html, /id="architecture-review-status" class="demo-route-architecture-status ok">证据已授权/);
  assert.match(html, /id="architecture-harness-status" class="demo-route-architecture-status ok">6 次上限/);
  assert.match(html, /id="architecture-mcp-status" class="demo-route-architecture-status ok">已回放/);
  assert.match(html, /主体复核入口已返回/);
});
test('review control plane node waits for an authorized submission before opening review', () => {
  const {app} = setup();
  app.state.agentRuntime = {
    skills: [{name: 'requirements_draft'}, {name: 'review_one_submission'}],
    harness: {max_invocations: 6},
  };
  const html = app.demoRouteHtml({id: 7, name: '演示任务', status: 'collecting'});
  assert.match(html, /等待授权提交后进入主体复核/);
  assert.match(html, /id="architecture-review-status" class="demo-route-architecture-status warn">等待提交/);
  assert.match(html, /href="#\/workbench\/7">等待授权提交/);
  assert.doesNotMatch(html, /aria-label="(?:打开|进入)[^"]+"/);
});
test('demo route keeps live runtime, MCP, route and human handoff in one visible state rail', () => {
  const {app} = setup();
  app.state.llmConfigured = false;
  app.state.mcpSnapshot = {execution:{status:'completed'}};
  const html = app.demoRouteHtml({id:7, name:'演示任务', status:'collecting'});
  assert.match(html, /LIVE SHOWCASE STATE/);
  assert.match(html, /当前路线/);
  assert.match(html, /Agent runtime/);
  assert.match(html, /离线可演示/);
  assert.match(html, /MCP 只读回放/);
  assert.match(html, /已完成/);
  assert.match(html, /人工接管/);
  assert.match(html, /aria-label="现场 Agent 运行链"/);
  assert.match(html, /一条运行链/);
  assert.match(html, /RUN EVIDENCE PULSE/);
  assert.match(html, /真实运行证据/);
  assert.match(html, /尚未形成运行/);
  assert.match(html, /主体级入口将在有授权提交后出现/);
  assert.match(html, /demo-route-live-step" aria-hidden="true">01/);
  assert.match(html, /demo-route-live-step" aria-hidden="true">04/);
  assert.match(html, /组织者确认/);
  assert.match(html, /jumpToAgentTour\(\)/);
  assert.match(html, /查看运行边界/);
  assert.match(html, /查看回放/);
  assert.match(styleSource, /\.demo-route-live-grid \{ display:grid; grid-template-columns:repeat\(4,minmax\(0,1fr\)\);/);
  assert.match(styleSource, /\.demo-route-live-proof \{[\s\S]*grid-template-columns:1\.25fr repeat\(4,minmax\(0,1fr\)\);/);
  assert.match(styleSource, /@media \(max-width:600px\) \{[\s\S]*\.demo-route-live-grid \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\);/);
  assert.match(styleSource, /@media \(max-width:600px\) \{[\s\S]*\.demo-route-live-proof \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\);/);
  assert.match(styleSource, /@media \(max-width:360px\) \{[\s\S]*\.demo-route-live-grid \{ grid-template-columns:1fr;/);
});
test('demo route puts a quick read of focus, runtime, MCP and next action before the architecture rail', () => {
  const {app} = setup();
  app.state.llmConfigured = false;
  app.state.mcpSnapshot = {execution:{status:'completed'}};
  const html = app.demoRouteHtml({id:7, name:'演示任务', status:'collecting', demo_route:{
    completed:2, total:4,
    current:{title:'检查并接手', href:'#/review/7/2', detail:'查看当前主体'},
    steps:[{key:'design',title:'整理要求',status:'done',href:'#/design/7'},
      {key:'roster',title:'发放凭证',status:'done',href:'#/roster/7'},
      {key:'review',title:'检查并接手',status:'current',href:'#/review/7/2'},
      {key:'delivery',title:'固定交付',status:'upcoming',href:'#/delivery/7'}]}});
  assert.match(html, /class="demo-route-quick-read"[\s\S]*FIRST LOOK/);
  assert.match(html, /quick-route-value">检查并接手/);
  assert.match(html, /quick-runtime-value">离线可演示/);
  assert.match(html, /quick-mcp-value">已完成/);
  assert.match(html, /demo-route-quick-index[^>]*>01<\/span>[\s\S]*demo-route-quick-index[^>]*>02<\/span>[\s\S]*demo-route-quick-index[^>]*>03<\/span>[\s\S]*demo-route-quick-index[^>]*>04<\/span>/);
  assert.match(html, /按 01 → 04 读四个信号/);
  assert.match(html, /class="demo-route-quick-next"[\s\S]*进入检查并接手/);
  assert.match(html, /onclick="jumpToAgentTour\(\)"/);
  assert.match(html, /onclick="jumpToMcpSnapshot\(\)"/);
  assert.ok(html.indexOf('demo-route-quick-read') < html.indexOf('AGENT CONTROL PLANE'));
  assert.match(styleSource, /\.demo-route-quick-read \{/);
  assert.match(styleSource, /\.demo-route-quick-link \{/);
  assert.match(styleSource, /\.demo-route-quick-index \{/);
  assert.match(styleSource, /\.demo-route-quick-index \{[^}]*color:#626775/);
  assert.match(styleSource, /\.design-progress-index \{[^}]*color:#626775/);
  assert.match(styleSource, /\.demo-route-live-timeline-index \{ color:#626775/);
  assert.match(styleSource, /@media \(max-width:600px\) \{[\s\S]*\.demo-route-quick-read \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\);/);
  assert.match(styleSource, /@media \(max-width:360px\) \{[\s\S]*\.demo-route-quick-read \{ grid-template-columns:1fr;/);
});
test('first look surfaces a passed runtime contract without implying model quality', () => {
  const {app} = setup();
  app.state.llmConfigured = false;
  app.state.agentRuntime = {contract_self_test: {status:'passed', passed:5, total:5}};
  const html = app.demoRouteHtml({id:7, name:'演示任务', status:'collecting'});
  assert.match(html, /quick-runtime-value">5\/5 合同通过/);
  assert.match(html, /quick-runtime-detail">离线演示 · 不调用实时模型/);
});
test('demo route keeps deep agent evidence expandable and preserves shortcut targets', () => {
  const {app} = setup();
  const html = app.demoRouteHtml({id: 7, name: '演示任务', status: 'collecting'});
  assert.match(html, /class="demo-route-evidence-fold"/);
  assert.match(html, /查看 Skill、Harness 与运行证据/);
  assert.match(html, /Agent Control Plane · Live Showcase · Run Stages · Run Evidence Pulse/);
  assert.match(source, /function openDemoEvidenceFold\(\)/);
  assert.match(source, /openDemoEvidenceFold\(\);\r?\n  const target = document\.querySelector\?\.\("\.mcp-snapshot"\)/);
  assert.match(source, /openDemoEvidenceFold\(\);\r?\n  const signal =/);
  assert.match(styleSource, /\.demo-route-evidence-fold > summary/);
  assert.match(styleSource, /\.demo-route-evidence-fold\[open\] > summary/);
});
test('demo route puts both audience paths in a compact first-look summary', () => {
  const {app} = setup();
  const html = app.demoRouteHtml({id: 7, name: '演示任务', status: 'collecting'});
  assert.match(html, /class="demo-route-role-summary"[\s\S]*双角色快速路径/);
  assert.match(html, /推荐顺序：先看组织者工作台，再回到这里看 Agent 运行证据，最后打开提交者回执/);
  assert.match(html, /class="demo-route-role-card organizer" href="#\/workbench\/7"/);
  assert.match(html, /组织者[\s\S]*设计[\s\S]*发凭证[\s\S]*复核[\s\S]*交付/);
  assert.match(html, /class="demo-route-role-card submitter" href="#\/login\?role=sub"/);
  assert.match(html, /提交者[\s\S]*登录[\s\S]*填写[\s\S]*正式提交[\s\S]*核对/);
  assert.ok(html.indexOf('demo-route-role-summary') < html.indexOf('demo-route-quick-read'));
  assert.ok(html.indexOf('demo-route-quick-read') < html.indexOf('AGENT CONTROL PLANE'));
  assert.match(styleSource, /\.demo-route-role-summary-grid \{ display:grid; grid-template-columns:repeat\(2,minmax\(0,1fr\)\);/);
  assert.match(styleSource, /\.demo-route-role-card-main small \{ color:#626874;/);
  assert.match(styleSource, /@media \(max-width:600px\) \{[\s\S]*\.demo-route-role-summary-grid \{ grid-template-columns:1fr;/);
  assert.match(styleSource, /body\.presentation-mode \.demo-route-audience \{ display:none; \}/);
});
test('presentation task home leads with the product promise while normal task home keeps workspace language', () => {
  assert.match(source, /const pageEyebrow = presentationHeading \? "FORMFLOW \/ 评委展示"/);
  assert.match(source, /const pageTitle = presentationHeading \? "从要求到有证据的交付" : "我的任务"/);
  assert.match(source, /受限 Agent 负责整理与取证，人工确认后才进入可交付快照。/);
  assert.match(source, /从需求到交付，把每一次收集安排妥当。/);
  assert.match(source, /function paintTaskHomeHeading\(\)/);
  assert.match(source, /id="task-home-eyebrow"/);
  assert.match(source, /id="task-home-title"/);
  assert.match(source, /id="task-home-lead"/);
  assert.match(source, /paintTaskHomeHeading\(\);/);
});
test('showcase state rail gives the current route and human gate direct next actions', () => {
  const {app} = setup();
  const html = app.demoRouteHtml({id:7, name:'演示任务', status:'collecting', demo_route:{
    completed:2, total:4,
    current:{title:'检查并接手', href:'#/review/7/2', detail:'查看当前主体'},
    next:{title:'固定交付', href:'#/delivery/7', detail:'验收完成后固定快照'},
    steps:[{key:'design',title:'整理要求',status:'done',href:'#/design/7'},
      {key:'roster',title:'发放凭证',status:'done',href:'#/roster/7'},
      {key:'review',title:'检查并接手',status:'current',href:'#/review/7/2'},
      {key:'delivery',title:'固定交付',status:'upcoming',href:'#/delivery/7'}]}});
  assert.match(html, /class="demo-route-live-action" href="#\/review\/7\/2">进入当前站/);
  assert.match(html, /onclick="jumpToMcpSnapshot\(\)">查看回放/);
  assert.match(html, /onclick="jumpToAgentTour\(\)">查看接管边界/);
  assert.match(html, /进入当前站/);
  assert.match(html, /查看接管边界/);
});
test('showcase state surfaces the four run stages without inventing model conclusions', () => {
  const {app} = setup();
  const html = app.demoRouteHtml({id:7, name:'演示任务', status:'collecting', demo_route:{
    review_signal:{subject_name:'李四', run_id:12, status:'success', run_source:'simulation', pages_read:2,
      deterministic_rules:1, semantic_rules:2, pending_rules:1, human_rules:1, coverage_complete:true},
  }});
  assert.match(html, /RUN STAGES/);
  assert.match(html, /aria-label="当前复核运行阶段"/);
  assert.match(html, /读取材料[\s\S]*2 页已读/);
  assert.match(html, /程序核验[\s\S]*1 项已记/);
  assert.match(html, /语义审核[\s\S]*2 项已记/);
  assert.match(html, /离线演示结果/);
  assert.match(html, /人工接手[\s\S]*1 项待处理/);
  assert.match(html, /onclick="jumpToRunStage\('materials'\)"/);
  assert.match(html, /onclick="jumpToRunStage\('semantic'\)"/);
  assert.match(html, /查看对应证据/);
  assert.match(styleSource, /\.demo-route-live-timeline \{/);
  assert.match(styleSource, /\.demo-route-live-timeline ol \{ display:grid; grid-template-columns:repeat\(4,minmax\(0,1fr\)\);/);
  assert.match(styleSource, /\.demo-route-live-timeline li > button \{/);
  assert.match(styleSource, /@media \(max-width:360px\) \{[\s\S]*\.demo-route-live-timeline ol \{ grid-template-columns:1fr;/);
});
test('showcase run stages stay honest while a review is queued or failed', () => {
  const {app} = setup();
  const queued = app.demoRouteHtml({id:7, name:'演示任务', status:'collecting', demo_route:{
    review_signal:{subject_name:'李四', status:'queued', review_href:'#/review/7/2', pages_read:0,
      deterministic_rules:0, semantic_rules:0, pending_rules:0, coverage_complete:false},
  }});
  assert.match(queued, /排队中/);
  assert.match(queued, /运行结束后确认/);
  assert.match(queued, /查看运行状态/);
  assert.doesNotMatch(queued, /可继续交付/);
  const failed = app.demoRouteHtml({id:7, name:'演示任务', status:'collecting', demo_route:{
    review_signal:{subject_name:'李四', status:'failed', review_href:'#/review/7/2', pages_read:0,
      deterministic_rules:0, semantic_rules:0, pending_rules:0, coverage_complete:false,
      failure:{title:'语义审核服务暂时不可用', detail:'未完成的语义项目没有被当成通过。', action:'配置或恢复模型服务后重试，也可以由组织者人工核对。'}},
  }});
  assert.match(failed, /运行失败/);
  assert.match(failed, /先处理运行失败/);
  assert.match(failed, /查看失败详情/);
  assert.match(failed, /语义审核服务暂时不可用/);
  assert.match(failed, /配置或恢复模型服务后重试/);
  assert.match(failed, /运行失败 · 语义审核服务暂时不可用/);
  assert.match(failed, /进入人工复核/);
  assert.match(failed, /class="failed"/);
});
test('run stage replay explains each boundary from the server summary', () => {
  const {app} = setup();
  const signal = {status:'success', run_source:'simulation', pages_read:2, coverage_complete:true,
    deterministic_rules:1, semantic_rules:2, pending_rules:1,
    trace:[{step:'review.deterministic_rule'}, {step:'review.semantic_rule'}]};
  const materials = app.runStageReplayHtml('materials', signal);
  const deterministic = app.runStageReplayHtml('deterministic', signal);
  const semantic = app.runStageReplayHtml('semantic', signal);
  const human = app.runStageReplayHtml('human', signal);
  assert.match(materials, /2 页材料已进入检查范围/);
  assert.match(materials, /覆盖完整/);
  assert.match(deterministic, /1 项确定性规则已记录/);
  assert.match(deterministic, /工具记录 1 步/);
  assert.match(semantic, /离线演示结果/);
  assert.match(semantic, /逐条查看原文位置/);
  assert.match(human, /1 项需要组织者决定/);
  assert.match(human, /待处理规则不会被自动标成通过/);
  assert.doesNotMatch(semantic, /https?:\/\//);
});
test('showcase run stages expose an interactive selected detail panel', () => {
  const {app} = setup();
  const html = app.demoRouteHtml({id:7, name:'演示任务', status:'collecting', demo_route:{review_signal:{status:'success', run_source:'simulation', pages_read:2, coverage_complete:true}}});
  assert.match(html, /data-run-stage="materials"/);
  assert.match(html, /data-run-stage="semantic"/);
  assert.doesNotMatch(html, /data-run-stage="[^"]+"[^>]*aria-label=/);
  assert.doesNotMatch(html, /demo-route-role-card (?:organizer|submitter)"[^>]*aria-label=/);
  assert.match(html, /id="demo-route-stage-detail"/);
  assert.match(html, /class="demo-route-stage-replay"/);
  assert.match(styleSource, /\.demo-route-live-timeline li\.selected/);
  assert.match(styleSource, /\.demo-route-stage-replay/);
});
test('MCP snapshot labels capabilities while keeping raw tool evidence visible', () => {
  const {app} = setup();
  const html = app.mcpSnapshotHtml({
    task: {id: 7, name: '演示任务'},
    captured_at: '2026-10-26T04:00:00Z',
    runtime: {contract_version: 1},
    calls: [
      {tool: 'list_my_tasks', status: 'ok', task_count: 1},
      {tool: 'get_task_collection_progress', status: 'ok', counts: {submitted: 2, pending: 3}},
    ],
    boundary: '只读任务导航',
  });
  assert.match(html, /MCP 工具调用账本/);
  assert.match(html, /任务索引/);
  assert.match(html, /get_task_collection_progress/);
  assert.match(html, /submitted 2 · pending 3/);
  assert.match(html, /class="mcp-call-status ok"/);
  assert.match(styleSource, /\.mcp-call-copy \{/);
  assert.match(styleSource, /\.mcp-call-status\.warn/);
});
test('MCP snapshot gives explicit pending, refresh and error states', () => {
  const {app} = setup();
  app.state.mcpSnapshotLoading = false;
  assert.match(app.mcpSnapshotHtml(null), /还没有读取只读快照/);
  app.state.mcpSnapshotLoading = true;
  assert.match(app.mcpSnapshotHtml(null), /正在读取只读快照/);
  app.state.mcpSnapshotLoading = false;
  app.state.mcpSnapshot = {error:'组织者会话已失效'};
  assert.match(app.mcpSnapshotHtml(), /只读快照暂时没有读到/);
  assert.match(app.mcpSnapshotHtml(), /这不会阻塞任务路线/);
  app.state.mcpSnapshot = {task:{id:7,name:'演示任务'}, calls:[], execution:{status:'completed'}};
  app.state.mcpSnapshotLoading = true;
  assert.match(app.mcpSnapshotHtml(), /正在刷新只读快照/);
  assert.match(styleSource, /\.mcp-snapshot-state\.error/);
});
test('task home keeps populated workspaces focused and preserves the full showcase in presentation mode', () => {
  const {app, els} = setup();
  app.setEmptyTaskHome(true);
  assert.equal(els.app.classList.contains('task-home-empty'), true);
  app.setEmptyTaskHome(false);
  assert.equal(els.app.classList.contains('task-home-empty'), false);
  assert.match(styleSource, /body:not\(\.presentation-mode\) #app:not\(\.task-home-empty\) #demo-route,[\s\S]*body:not\(\.presentation-mode\) #app:not\(\.task-home-empty\) \.agent-tour \{ display:none; \}/);
  assert.match(styleSource, /#app\.task-home-empty #demo-route[\s\S]*#app\.task-home-empty \.task-section \.section-toolbar \{ display:none; \}/);
  assert.match(styleSource, /body\.presentation-mode \.workspace-runtime-strip \{ display:none; \}/);
});
test('demo route exposes organizer and submitter lanes for a complete showcase', () => {
  const {app} = setup();
  const html = app.demoRouteHtml({id: 7, name: '演示任务', status: 'collecting'});
  assert.match(html, /双角色体验/);
  assert.match(html, /组织者/);
  assert.match(html, /设计 → 凭证 → 复核 → 交付/);
  assert.match(html, /#\/workbench\/7/);
  assert.match(html, /提交者/);
  assert.match(html, /登录 → 填写 → 提交 → 核对/);
  assert.match(html, /#\/login\?role=sub/);
  assert.match(styleSource, /\.demo-route-lanes \{ display:grid;/);
  assert.match(styleSource, /\.demo-route-lane \{ display:flex;[^\n]*padding:9px 2px 1px; border-top:2px solid transparent;/);
  assert.doesNotMatch(styleSource, /\.demo-route-lane \{[^\n]*border:1px solid var\(--line-soft\);[^\n]*border-radius:[^;]+;[^\n]*background:#fff;/);
  assert.match(styleSource, /\.demo-route-lane\.submitter/);
});
test('demo route renders server lifecycle progress and the next stop', () => {
  const {app} = setup();
  const html = app.demoRouteHtml({id:7, name:'演示任务', status:'collecting', demo_route:{
    completed:2, total:4,
    next:{title:'固定交付', href:'#/delivery/7', detail:'验收完成后固定快照', status:'upcoming'},
    steps:[
      {key:'design', title:'整理要求', detail:'正式蓝图已发布', status:'done', href:'#/design/7'},
      {key:'roster', title:'发放凭证', detail:'5/5 位已安排', status:'done', href:'#/roster/7'},
      {key:'review', title:'检查并接手', detail:'已验收 1/4 个主体', status:'current', href:'#/workbench/7'},
      {key:'delivery', title:'固定交付', detail:'验收完成后固定快照', status:'upcoming', href:'#/delivery/7'},
    ],
    review_signal:{subject_name:'李四', review_href:'#/review/7/2', run_id:12, status:'success', pages_read:2,
      deterministic_rules:1, semantic_rules:2, human_rules:1, pending_rules:2,
      coverage_complete:true, coverage_gaps:0, llm_calls_used:1,
      run_source:'simulation',
      budget:{pages:{used:2, limit:40}, semantic_calls:{used:1, limit:30}},
       trace:[{tool:'review.deterministic_rule', sequence:1, status:'satisfied', simulation:true, duration_ms:3},
         {tool:'review.semantic_rule', sequence:2, status:'unknown', simulation:true, duration_ms:18},
         {tool:'review.semantic_rule', sequence:3, status:'issue', simulation:true, duration_ms:21}],
      focus_rule:{rule_id:'r_term_match', statement:'报告期次须为 2026 秋季第 1 期', status:'待确认', executor:'semantic'}},
  }});
  assert.match(html, /2\/4 站已完成/);
  assert.match(html, /整理要求[\s\S]*已完成/);
  assert.match(html, /检查并接手[\s\S]*现在处理/);
  assert.match(html, /href="#\/delivery\/7"[\s\S]*进入固定交付/);
  assert.match(html, /aria-current="step"/);
  assert.match(html, /当前焦点[\s\S]*检查并接手/);
  assert.match(html, /现场讲解/);
  assert.match(html, /这里看证据链：程序规则、语义检查和人工判断分开/);
  assert.match(html, /复制讲解/);
  assert.match(html, /完成后[\s\S]*固定交付/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow="2"/);
  assert.match(html, /进入检查并接手/);
  assert.doesNotMatch(html, /下一站：检查并接手/);
  assert.match(html, /最近复核运行/);
  assert.match(html, /aria-label="最近复核运行摘要"/);
  assert.doesNotMatch(html, /真实复核运行/);
  assert.match(html, /运行 #12 · 李四/);
  assert.match(html, /aria-label="当前运行证据"/);
  assert.match(html, /运行 #12/);
  assert.match(html, /离线演示结果/);
  assert.match(html, /3 步工具记录/);
  assert.match(html, /程序 1 · 语义 2 · 待人工 2/);
  assert.match(html, /打开李四复核/);
  assert.match(html, /本次运行来源/);
  assert.match(html, /离线演示结果/);
  assert.match(html, /没有调用实时模型/);
  assert.match(html, /aria-label="复核执行链"/);
  assert.match(html, /Harness 预算/);
  assert.match(html, /页数<\/b><em>2 \/ 40<\/em>/);
  assert.match(html, /语义调用<\/b><em>1 \/ 30<\/em>/);
  assert.match(html, /aria-label="页数预算 2 \/ 40"/);
  assert.match(styleSource, /\.demo-route-signal-budget-item > i > i/);
  assert.match(styleSource, /\.demo-route-signal-action:focus-visible/);
  assert.match(html, /读取材料/);
  assert.match(html, /程序核验/);
  assert.match(html, /语义审核/);
  assert.match(html, /人工接手/);
  assert.match(html, /摘要来自当前正式提交的检查运行/);
  assert.match(html, /class="demo-route-signal-action" href="#\/review\/7\/2"/);
  assert.match(html, /打开本次证据复核/);
  assert.match(html, /demo-route-chain-icon/);
  assert.match(html, /程序 1 · 语义 2/);
  assert.match(html, /2 项待处理/);
  assert.match(html, /运行回放/);
  assert.match(html, /skill \/ harness 已记录 3 步/);
  assert.doesNotMatch(html, /<details class="demo-route-trace" open>/);
  assert.match(html, /离线语义/);
  assert.match(html, /原文、参数与结果仍只在授权的复核页查看/);
  assert.match(html, /建议先处理/);
  assert.match(html, /报告期次须为 2026 秋季第 1 期/);
  assert.match(html, /待确认 · 语义审核/);
  assert.match(html, /<details class="demo-route-signal"/);
  assert.match(html, /查看运行详情/);
  assert.doesNotMatch(html, /<details class="demo-route-signal" open>/);
});
test('demo route presenter cue can be copied without changing route state', async () => {
  const {app, context} = setup();
  let copied = '';
  context.navigator.clipboard = {writeText: async text => { copied = text; }};
  const button = element();
  button.dataset.cue = '现场讲解内容';
  assert.equal(await app.copyDemoRouteCue(button), true);
  assert.equal(copied, '现场讲解内容');
  assert.match(button.innerHTML, /已复制/);
  assert.equal(app.state.presentationMode, false);
});
test('demo route makes stale fallback state and long task names explicit', () => {
  const {app} = setup();
  const taskName = '一个很长的演示任务名称，用来确认窄屏和悬停提示仍然可读';
  const html = app.demoRouteHtml({id:7, name:taskName, status:'collecting', demo_route_source:'fallback',
    demo_route_error:'实时路线状态暂时不可用，下面保留已加载的展示路径。'});
  assert.match(html, /实时路线状态暂时不可用/);
  assert.match(html, /role="status"/);
  assert.match(html, /重新读取状态/);
  assert.match(html, new RegExp(`title="${taskName}`));
  assert.match(styleSource, /\.demo-route-notice\s*\{/);
  assert.match(styleSource, /\.demo-route-notice \.link/);
  assert.match(styleSource, /\.demo-route-notice \{ align-items:flex-start; flex-direction:column;/);
});
test('long task and file content stays readable in presentation surfaces', () => {
  assert.match(source, /class=\"task-name\" title=\"\$\{esc\(t\.name\)\}\"/);
  assert.match(styleSource, /Long content and zoom-safe presentation surfaces/);
  assert.match(styleSource, /\.file-chip-name \{ min-width:0; max-width:min\(210px, 100%\)/);
  assert.match(styleSource, /body\.presentation-mode \{ background:#f1f3f7; \}/);
  assert.doesNotMatch(styleSource, /letter-spacing\s*:\s*-/);
});
test('review revision history keeps old versions as comparison only', () => {
  const {app} = setup();
  const html = app.reviewRevisionHistoryHtml([
    {id: 1, version: 1, receipt: 'R1', submitted_at: '2026-10-22T10:00:00Z', current: false,
      field_count: 1, file_count: 1, summary: '首次正式提交', field_changes: [], added_files: [], removed_files: []},
    {id: 2, version: 2, receipt: 'R2', submitted_at: '2026-10-23T10:00:00Z', current: true,
      field_count: 1, file_count: 1, summary: '字段 1 项变化；新增材料 1 份；移除材料 1 份',
      field_changes: [{id: 'term', kind: 'changed'}], added_files: [{name: '修订稿.txt'}], removed_files: [{name: '初稿.txt'}]},
  ], {id: 2, version: 2});
  assert.match(html, /正式版本对照/);
  assert.match(html, /当前复核版本/);
  assert.match(html, /Agent 只读取这一版/);
  assert.match(html, /仅供对照，不能套用本次结论/);
  assert.match(html, /修订稿\.txt/);
});
test('task workspace explains offline mode without hiding the available workflow', () => {
  const {app, els} = setup();
  assert.match(source, /review_one_submission/);
  assert.match(source, /MCP 边界/);
  assert.match(source, /网页内置 Agent 不调用外部 MCP/);
  assert.match(source, /只读 sidecar/);
  assert.match(source, /review\.deterministic_rule/);
  app.state.llmConfigured = false;
  app.paintWorkspaceAgentStatus();
  assert.equal(els['workspace-agent-mode'].textContent, '离线演示');
  assert.match(els['workspace-agent-status'].textContent, /没有模型密钥/);
  assert.match(els['workspace-agent-status'].textContent, /已有结果/);
  app.state.llmConfigured = true;
  app.paintWorkspaceAgentStatus();
  assert.equal(els['workspace-agent-mode'].textContent, '模型已接入');
  assert.match(els['workspace-agent-status'].textContent, /运行摘要/);
  assert.match(els['workspace-agent-status'].textContent, /不代表这次结果一定调用实时模型/);
  assert.match(source, /class="runtime-strip-icon"/);
  assert.match(source, /workspace-runtime-strip" aria-label="FormFlow Agent runtime">\s*<details>\s*<summary>/);
  assert.match(source, /查看工具与安全边界/);
  for (const tone of ['runtime-skill', 'runtime-tools', 'runtime-harness', 'runtime-mcp', 'runtime-human'])
    assert.match(source, new RegExp(`class="${tone}"`));
  assert.match(styleSource, /\.runtime-strip-icon svg/);
  assert.match(styleSource, /\.runtime-strip-grid code \{[^}]*white-space:nowrap;[^}]*overflow-wrap:normal;/);
  assert.match(styleSource, /\.runtime-strip-grid \.runtime-tools/);
  assert.match(styleSource, /\.runtime-strip-grid \.runtime-human/);
  assert.match(styleSource, /@media \(max-width:900px\) \{[\s\S]*\.runtime-strip-grid \{ grid-template-columns:repeat\(3,minmax\(0,1fr\)\); \}/);
  assert.match(styleSource, /\.workspace-runtime-strip details > summary \{ display:flex;/);
  assert.match(styleSource, /\.workspace-runtime-strip details\[open\] \.runtime-strip-grid \{ padding:/);
  assert.match(styleSource, /@media \(max-width:340px\)[\s\S]*\.runtime-strip-grid \{ grid-template-columns:1fr; \}/);
});
test('runtime presentation follows skill allowlists and distinguishes agent budgets', () => {
  assert.match(source, /function runtimeToolNames\(runtime, skill = null\)/);
  assert.match(source, /allowed\.includes\(tool\.name\)/);
  assert.match(source, /semantic_model_calls_per_run/);
  assert.match(source, /parsed_pages_per_run/);
  assert.match(source, /持久请求队列/);
  assert.match(source, /版本冲突拒绝/);
  assert.match(source, /当前 Skill 不直接调用工具/);
});
test('task runtime summary separates execution boundaries from the agent walkthrough', () => {
  const {context} = setup();
  const html = context.taskRuntimeHtml({skills:[
    {name:'requirements_draft'},
    {name:'review_one_submission'}
  ]});
  assert.match(html, /运行时边界与安全护栏/);
  assert.match(html, /需求 Agent 整理待确认蓝图；审核 Agent 按规则逐条取证/);
  assert.doesNotMatch(html, /requirements_draft/);
  assert.doesNotMatch(html, /runtime-agent-pair/);
  assert.match(html, /review_one_submission/);
  assert.match(html, /按当前规则逐条取证/);
  assert.match(html, /MCP 边界/);
  assert.match(html, /人来决定/);
  assert.match(html, /合同自测未加载/);
  assert.match(source, /runtimeSelfTestSummary/);
  assert.match(styleSource, /\.workspace-runtime-strip details > summary \{ display:flex;/);
  assert.match(styleSource, /body\.presentation-mode \.runtime-agent-roles \{ display:none; \}/);
});
test('runtime summary surfaces a passed static harness contract check', () => {
  const {context} = setup();
  const html = context.taskRuntimeHtml({
    model:{label:'离线可演示'},
    scope:{published_blueprint:true},
    skills:[{name:'review_one_submission', allowed_tools:['review.deterministic_rule']}],
    tools:[{name:'review.deterministic_rule'}],
    harness:{max_invocations:1, semantic_model_calls_per_run:0, parsed_pages_per_run:10, result_limit_bytes:16384},
    contract_self_test:{status:'passed', passed:5, total:5},
  });
  assert.match(html, /合同自测 5\/5 通过/);
  assert.match(html, /只验证运行合同，不调用模型/);
});
test('runtime contract checks are expandable and preserve server details', () => {
  const {app} = setup();
  const html = app.runtimeSelfTestHtml({contract_self_test:{
    status:'passed', passed:5, total:5,
    checks:[
      {id:'skill_allowlist', label:'Skill 只使用已注册工具', passed:true, detail:'审核 Skill 的白名单与工具注册表一致'},
      {id:'tool_limits', label:'每个工具都有正向边界', passed:true, detail:'超时、预算、输入和结果上限均已声明'},
    ],
    note:'只验证服务端运行合同、白名单和预算；没有调用模型，也没有读取材料。',
  }});
  assert.match(html, /<details class="runtime-self-test passed">/);
  assert.match(html, /查看 2 项/);
  assert.match(html, /Skill 只使用已注册工具/);
  assert.match(html, /审核 Skill 的白名单与工具注册表一致/);
  assert.match(html, /只验证服务端运行合同、白名单和预算/);
  assert.match(html, /runtime-self-test-mark/);
  assert.match(app.runtimeSelfTestHtml({}), /合同自测未加载/);
  assert.match(source, /function runtimeSelfTestHtml\(runtime = null\)/);
  assert.match(source, /class="runtime-self-test-list"/);
  assert.match(styleSource, /\.runtime-self-test-list li \{/);
});
test('agent walkthrough keeps supporting text readable on narrow screens', () => {
  const mobile = styleSource.match(/@media \(max-width:600px\) \{\s*\.agent-tour details[\s\S]*?\.agent-tour-boundary \{ grid-template-columns:1fr; gap:8px; \}\s*\}/)?.[0] || '';
  assert.match(mobile, /\.agent-tour-intro p,/);
  assert.match(mobile, /\.agent-tour-step > div > span/);
  assert.match(mobile, /\.agent-tour-boundary span \{ font-size:12px; \}/);
  assert.match(mobile, /\.agent-tour-boundary code \{ font-size:11px; overflow-wrap:anywhere; \}/);
});
test('design workspace exposes the same constrained agent boundary', () => {
  const {app, els} = setup();
  assert.ok(source.includes('id="design-agent-runtime" class="agent-runtime-card"'), 'runtime details should be collapsible');
  assert.ok(source.includes('<summary class="runtime-card-summary">'), 'the collapsed view should have a native summary');
  assert.ok(source.includes('runtime-card-toggle'));
  assert.match(source, /class="runtime-card-item runtime-skill"/);
  assert.match(source, /class="runtime-card-item runtime-tools"/);
  assert.match(source, /class="runtime-card-item runtime-harness"/);
  assert.match(source, /class="runtime-card-item runtime-mcp"/);
  assert.match(source, /class="runtime-card-item runtime-human"/);
  assert.match(source, /requirements_draft/);
  assert.match(source, /MCP 边界/);
  assert.match(source, /网页内置 Agent 不调用外部 MCP/);
  assert.match(source, /只读 sidecar/);
  assert.match(source, /人工确认/);
  assert.match(styleSource, /\.runtime-card-item\.runtime-harness/);
  assert.match(styleSource, /\.runtime-card-icon svg/);
  assert.match(styleSource, /\.runtime-card-item code \{[^}]*white-space:nowrap;[^}]*overflow-wrap:normal;/);
  assert.match(styleSource, /@media \(max-width:600px\)[\s\S]*\.runtime-card-grid \{ grid-template-columns:1fr; \}/);
  app.state.llmConfigured = false;
  app.paintAgentRuntime();
  assert.equal(els['agent-runtime-mode'].textContent, '离线可演示');
  assert.equal(els['agent-runtime-mode'].className, 'runtime-mode offline');
  assert.match(els['agent-runtime-status'].textContent, /模板和手动编辑可用/);
  app.state.llmConfigured = true;
  app.state.agentRequest = {status: 'running'};
  app.paintAgentRuntime();
  assert.equal(els['agent-runtime-mode'].textContent, '正在协作');
  assert.equal(els['agent-runtime-mode'].className, 'runtime-mode online');
  assert.match(els['agent-runtime-status'].textContent, /旧草案不会被半份结果覆盖/);
});
test('showcase run source stays separate from model configuration', () => {
  const {app} = setup();
  const base = {id:7, name:'演示任务', status:'collecting', demo_route:{completed:2, total:4,
    next:{title:'固定交付', href:'#/delivery/7', detail:'验收完成后固定快照', status:'upcoming'},
    steps:[{key:'design',title:'整理要求',status:'done',href:'#/design/7'},
      {key:'roster',title:'发放凭证',status:'done',href:'#/roster/7'},
      {key:'review',title:'检查并接手',status:'current',href:'#/review/7/2'},
      {key:'delivery',title:'固定交付',status:'upcoming',href:'#/delivery/7'}]}};
  assert.match(app.demoRouteHtml({...base, demo_route:{...base.demo_route,
    review_signal:{status:'success', run_id:1, subject_name:'李四', run_source:'live'}}}), /实时模型结果/);
  assert.match(app.demoRouteHtml({...base, demo_route:{...base.demo_route,
    review_signal:{status:'success', run_id:1, subject_name:'李四'}}}), /来源待确认/);
});
test('showcase run replay only exposes compact tool metadata', () => {
  const {app} = setup();
  const html = app.demoRouteHtml({id:7, name:'演示任务', status:'collecting', demo_route:{completed:2, total:4,
    next:{title:'固定交付', href:'#/delivery/7', detail:'验收完成后固定快照', status:'upcoming'},
    steps:[{key:'design',title:'整理要求',status:'done',href:'#/design/7'},
      {key:'roster',title:'发放凭证',status:'done',href:'#/roster/7'},
      {key:'review',title:'检查并接手',status:'current',href:'#/review/7/2'},
      {key:'delivery',title:'固定交付',status:'upcoming',href:'#/delivery/7'}],
    review_signal:{status:'success', run_id:2, subject_name:'李四', run_source:'simulation',
      blueprint_version:3, revision_version:2, retry:{attempt:2, retried_from:1},
      trace:[{tool:'review.deterministic_rule', tool_version:'v2', sequence:1, execution_attempt:1, status:'satisfied', simulation:true, duration_ms:3},
        {tool:'review.semantic_rule', tool_version:'v1', sequence:2, execution_attempt:2, status:'unknown', simulation:true, duration_ms:18}]}}});
  assert.match(html, /运行回放/);
  assert.match(html, /skill \/ harness 已记录 2 步/);
  assert.match(html, /程序规则/);
  assert.match(html, /离线语义/);
  assert.match(html, /蓝图 v3 · 提交 v2 · 第 2 次运行 · 由 #1 重试/);
  assert.match(html, /程序规则 · v2/);
  assert.match(html, /02 · 第 2 次/);
  assert.match(html, /Worker 恢复后重新执行过未完成检查/);
  assert.match(html, /模型请求可能重复/);
  assert.match(html, /&lt;10 毫秒/);
  assert.doesNotMatch(html, /即时/);
  assert.doesNotMatch(html, /隐藏推理|原始材料/);
});
test('showcase execution chain survives queued runs without trace data', () => {
  const {app} = setup();
  const html = app.demoRouteHtml({id:7, name:'演示任务', status:'collecting', demo_route:{completed:1, total:4,
    review_signal:{status:'queued', subject_name:'李四', run_source:'unknown'}}});
  assert.match(html, /检查已排队/);
  assert.match(html, /aria-label="复核执行链"/);
  assert.match(html, /读取材料/);
  assert.match(html, /程序核验/);
  assert.match(html, /语义审核/);
  assert.match(html, /人工接手/);
  assert.match(html, /来源待确认/);
  assert.doesNotMatch(html, /Harness 预算/);
});
test('presentation view is session-scoped, reversible, and keyboard discoverable', () => {
  const {app, context, els} = setup();
  assert.equal(app.readPresentationMode(), false);
  app.setPresentationMode(true);
  assert.equal(app.state.presentationMode, true);
  assert.equal(context.sessionStorage.getItem('ff_tasks_presentation'), '1');
  assert.equal(els['presentation-toggle'].attributes['aria-pressed'], 'true');
  assert.match(els['presentation-toggle'].innerHTML, /退出展示视图/);
  app.togglePresentationMode();
  assert.equal(app.state.presentationMode, false);
  assert.equal(context.sessionStorage.getItem('ff_tasks_presentation'), null);
  assert.equal(els['presentation-toggle'].attributes['aria-pressed'], 'false');
  assert.match(source, /event\.key === "Escape"/);
  assert.match(styleSource, /body\.presentation-mode \.workspace-intro \{ display:none; \}/);
  assert.match(styleSource, /body\.presentation-mode #task-stats/);
  assert.match(styleSource, /body\.presentation-mode \.task-section/);
  assert.match(source, /查看 Agent 架构/);
  assert.match(styleSource, /body\.presentation-mode \.presentation-agent-jump \{ display:inline-flex; \}/);
  assert.match(styleSource, /body\.presentation-mode \.workspace-runtime-strip \{ display:none; \}/);
  const taskIndex = source.indexOf('<section class="card task-section"');
  const routeIndex = source.indexOf('<div id="demo-route"');
  const runtimeIndex = source.indexOf('${taskRuntimeHtml()}');
  assert.ok(taskIndex >= 0 && routeIndex > taskIndex, 'normal task home should lead with the real task list');
  assert.ok(runtimeIndex > routeIndex, 'showcase route should lead the agent explanation');
  assert.equal((source.match(/id="demo-route"/g) || []).length, 1, 'task page should mount one demo route container');
});
test('show my tasks exits presentation mode and scrolls the list into view', () => {
  const {app, context} = setup();
  const taskSection = element();
  const scrollCalls = [];
  taskSection.scrollIntoView = options => scrollCalls.push(options);
  taskSection.focus = options => { taskSection.focused = true; taskSection.focusOptions = options; };
  context.document.querySelector = selector => selector === '.task-section' ? taskSection : null;
  context.window.matchMedia = () => ({matches: false});

  app.setPresentationMode(true);
  vm.runInContext('showTaskListFromPresentation()', context);

  assert.equal(app.state.presentationMode, false);
  assert.equal(context.sessionStorage.getItem('ff_tasks_presentation'), null);
  assert.equal(scrollCalls[0].behavior, 'smooth');
  assert.equal(scrollCalls[0].block, 'start');
  assert.equal(taskSection.focused, true);
  assert.equal(taskSection.focusOptions.preventScroll, true);
  assert.match(source, /<section class="card task-section" tabindex="-1" aria-label="我的任务列表"/);

  context.window.matchMedia = () => ({matches: true});
  app.setPresentationMode(true);
  vm.runInContext('showTaskListFromPresentation()', context);
  assert.equal(scrollCalls[1].behavior, 'auto');
  assert.equal(scrollCalls[1].block, 'start');
  assert.equal(taskSection.focused, true);
});
test('showcase browser harness verifies the task list receives accessible focus', () => {
  assert.match(showcaseHarnessSource, /name: 'laptop-768', width: 1366, height: 768/);
  assert.match(showcaseHarnessSource, /taskListFocused: document\.activeElement === taskSection/);
  assert.match(showcaseHarnessSource, /taskListLabel: taskSection\?\.getAttribute\('aria-label'\)/);
  assert.match(showcaseHarnessSource, /taskListInViewport: !!rect && rect\.top >= 0 && rect\.bottom <= window\.innerHeight/);
  assert.match(showcaseHarnessSource, /showcaseVisibleInPresentation/);
  assert.match(showcaseHarnessSource, /taskHomeExtrasHidden/);
  assert.match(showcaseHarnessSource, /!viewport\.presentationExit\?\.taskListFocused/);
  assert.match(showcaseHarnessSource, /taskListLabel !== '我的任务列表'/);
  assert.match(showcaseHarnessSource, /actualHash: evidence\.hash/);
  assert.match(showcaseHarnessSource, /heading: evidence\.heading/);
  assert.match(showcaseHarnessSource, /path\.posix\.join\('screenshots', viewport\.name, `\$\{route\.name\}\.png`\)/);
  assert.match(showcaseHarnessSource, /route\.actualHash !== route\.hash/);
  assert.match(showcaseHarnessSource, /inspectDesignScroll\(page, viewport\)/);
  assert.match(showcaseHarnessSource, /position === 'sticky' && result\.panelInViewport && result\.headingInViewport/);
  assert.match(showcaseHarnessSource, /!designScroll \|\| designScroll\.ok/);
});
test('showcase browser harness checks and captures the login first screen at each viewport', () => {
  assert.match(showcaseHarnessSource, /loginSurface: null/);
  assert.match(showcaseHarnessSource, /hasDemoEntry: await button\.isVisible\(\)/);
  assert.match(showcaseHarnessSource, /demoEntryInViewport: await button\.evaluate/);
  assert.match(showcaseHarnessSource, /&& loginSurface\.demoEntryInViewport/);
  assert.match(showcaseHarnessSource, /loginSurface\.accessibility\.unnamed\.length/);
  assert.match(showcaseHarnessSource, /loginSurface\.accessibility\.unlabeledFields\.length/);
  assert.match(showcaseHarnessSource, /!viewport\.loginSurface\?\.ok/);
  assert.match(showcaseHarnessSource, /captureRouteEvidence\(page, viewport, \{name: 'login'\}\)/);
  assert.match(showcaseHarnessSource, /viewportReport\.loginSurface = await enterDemo\(page, viewport\)/);
});
test('demo entry appears before credential fields on the organizer login tab', () => {
  const {app, els} = setup();
  app.viewLogin();
  const html = els.app.innerHTML;
  assert.ok(html.indexOf('id="demo-hint"') < html.indexOf('for="lg-user"'));
});
test('presentation agent shortcut opens the walkthrough and moves keyboard focus', () => {
  const {context} = setup();
  const summary = element();
  const details = element();
  details.querySelector = selector => selector === 'summary' ? summary : null;
  const section = element();
  section.scrollIntoView = options => { section.scrolled = true; section.scrollBehavior = options.behavior; };
  section.querySelector = selector => selector === 'details' ? details : null;
  context.document.querySelector = selector => selector === '.agent-tour' ? section : null;
  context.window.matchMedia = () => ({matches: false});

  vm.runInContext('jumpToAgentTour()', context);

  assert.equal(details.open, true);
  assert.equal(summary.attributes['aria-expanded'], 'true');
  assert.equal(section.tabIndex, -1);
  assert.equal(section.scrolled, true);
  assert.equal(section.focused, true);
  assert.equal(section.scrollBehavior, 'smooth');
  context.window.matchMedia = () => ({matches: true});
  vm.runInContext('jumpToAgentTour()', context);
  assert.equal(section.scrollBehavior, 'auto');
});
test('showcase MCP shortcut opens the evidence panel and moves focus', () => {
  const {context} = setup();
  const summary = element();
  const details = element();
  details.querySelector = selector => selector === 'summary' ? summary : null;
  const target = element();
  target.closest = selector => selector === 'details' ? details : null;
  target.scrollIntoView = options => {
    target.scrolled = true;
    target.scrollBehavior = options.behavior;
  };
  context.document.querySelector = selector => selector === '.mcp-snapshot' ? target : null;
  context.window.matchMedia = () => ({matches: false});

  vm.runInContext('jumpToMcpSnapshot()', context);

  assert.equal(details.open, true);
  assert.equal(summary.attributes['aria-expanded'], 'true');
  assert.equal(target.tabIndex, -1);
  assert.equal(target.scrolled, true);
  assert.equal(target.focused, true);
  assert.equal(target.scrollBehavior, 'smooth');
  context.window.matchMedia = () => ({matches: true});
  vm.runInContext('jumpToMcpSnapshot()', context);
  assert.equal(target.scrollBehavior, 'auto');
});
test('run stage shortcut opens the authorized evidence summary', () => {
  const {context} = setup();
  const summary = element();
  const details = element();
  details.querySelector = selector => selector === 'summary' ? summary : null;
  const target = element();
  target.closest = selector => selector === 'details' ? details : null;
  target.scrollIntoView = options => {
    target.scrolled = true;
    target.scrollBehavior = options.behavior;
  };
  context.document.querySelector = selector => selector === '.demo-route-signal' ? target : null;
  context.window.matchMedia = () => ({matches: false});

  vm.runInContext("jumpToRunStage('semantic')", context);

  assert.equal(details.open, true);
  assert.equal(summary.attributes['aria-expanded'], 'true');
  assert.equal(target.tabIndex, -1);
  assert.equal(target.scrolled, true);
  assert.equal(target.focused, true);
  assert.equal(target.scrollBehavior, 'smooth');
});
test('showcase route puts the current action before role background', () => {
  const {app} = setup();
  const html = app.demoRouteHtml({id:7, name:'演示任务', status:'collecting', demo_route:{completed:2, total:4,
    next:{title:'固定交付', href:'#/delivery/7', detail:'验收完成后固定快照', status:'upcoming'},
    steps:[{key:'design',title:'整理要求',status:'done',href:'#/design/7'},
      {key:'roster',title:'发放凭证',status:'done',href:'#/roster/7'},
      {key:'review',title:'检查并接手',status:'current',href:'#/review/7/2'},
      {key:'delivery',title:'固定交付',status:'upcoming',href:'#/delivery/7'}]}});
  const audience = html.indexOf('aria-label="双角色体验"');
  const focus = html.indexOf('当前焦点');
  assert.ok(focus >= 0 && focus < audience, 'current action should appear before role entrances');
  assert.match(html, /回到组织者工作台/);
  assert.match(html, /打开提交者入口/);
});
test('presentation route aligns the first render to the top of the showcase', () => {
  assert.match(source, /state\.presentationMode && !state\.presentationStartAligned/);
  assert.match(source, /window\?\.scrollTo\?\.\(\{top: 0, left: 0, behavior: "auto"\}\)/);
  assert.match(source, /从这里开始 · 当前焦点/);
  assert.match(source, /demo-route-focus-meta/);
  assert.match(source, /决定边界/);
  assert.match(source, /证据入口/);
  assert.match(source, /完成标志/);
  assert.match(source, /demo-route-focus-goal/);
  assert.match(source, /这一站要做到/);
  assert.match(source, /把每条结论落到原文证据，未完成就转人工/);
  assert.match(source, /按需展开蓝图确认、审核 Skill、执行护栏与人工接手点/);
  assert.match(source, /LIVE SHOWCASE STATE/);
  assert.match(source, /人工接管/);
});
test('showcase review keeps a return path to the presentation route', () => {
  const shared = storage();
  const {app, context} = setup(shared);
  assert.equal(app.showcaseReturnHtml('证据复核'), '');
  context.localStorage.setItem('ff_org_token', 'demo-token');
  shared.setItem('ff_tasks_presentation', '1');
  const html = app.showcaseReturnHtml('证据复核');
  assert.match(html, /class="showcase-context-bar"/);
  assert.match(html, /正在查看 证据复核/);
  assert.match(html, /href="#\/tasks">回到展示路线/);
  assert.match(styleSource, /\.showcase-context-bar \{/);
  assert.match(styleSource, /\.showcase-context-bar a \{ width:100%; \}/);
  assert.match(source, /showcaseReturnHtml\("证据复核"\)/);
});
test('all organizer showcase stops keep a return path to the presentation route', () => {
  for (const label of ['需求设计', '名单与凭证', '收集工作台', '交付与归档']) {
    assert.match(source, new RegExp(`showcaseReturnHtml\\("${label}"\\)`));
  }
});
test('demo login enters showcase view and logout clears the temporary entry state', async () => {
  const {app, context, els} = setup();
  const loginUser = element(), loginPass = element();
  context.document.getElementById = id => ({...els, 'lg-user': loginUser, 'lg-pass': loginPass}[id] || null);
  context.fetch = async () => response({token: 'demo-token'});
  await app.fillDemoCred();
  assert.equal(loginUser.value, 'demo');
  assert.equal(loginPass.value, 'demo1234');
  assert.equal(context.location.hash, '#/tasks');
  assert.equal(context.sessionStorage.getItem('ff_demo_entry'), null);
  assert.equal(context.sessionStorage.getItem('ff_tasks_presentation'), '1');
  app.logout();
  assert.equal(context.sessionStorage.getItem('ff_tasks_presentation'), null);
  assert.equal(context.sessionStorage.getItem('ff_demo_entry'), null);
});
test('presentation entry keeps Agent evidence on demand while retaining the live summary', () => {
  const {app, context, els} = setup();
  const details = element();
  const summary = element();
  const signal = element();
  const signalSummary = element();
  const trace = element();
  const traceSummary = element();
  const currentStop = element();
  details.open = false;
  details.querySelector = selector => selector === 'summary' ? summary : null;
  signal.open = false;
  signal.querySelector = selector => selector === 'summary' ? signalSummary : null;
  trace.open = false;
  trace.querySelector = selector => selector === 'summary' ? traceSummary : null;
  context.document.querySelector = selector => {
    if (selector === '.agent-tour details') return details;
    if (selector === '.demo-route-signal') return signal;
    if (selector === '.demo-route-trace') return trace;
    if (selector === '.demo-route-focus .button-link') return currentStop;
    return null;
  };
  app.setPresentationMode(true);
  assert.equal(details.open, false);
  assert.equal(summary.attributes['aria-expanded'], 'false');
  assert.equal(signal.open, false);
  assert.equal(trace.open, false);
  assert.equal(currentStop.focused, true);
  signal.open = true;
  trace.open = true;
  app.setPresentationMode(false);
  assert.equal(details.open, false);
  assert.equal(signal.open, true, 'manually opened run details should remain open');
  assert.equal(trace.open, true, 'manually opened tool replay should remain open');
  assert.equal(els['presentation-toggle'].focused, true);
  assert.match(source, /details\.addEventListener\("toggle"/);
});
test('presentation route makes the current task and next action explicit', () => {
  assert.match(source, /class="presentation-task-context" aria-label="当前演示任务"/);
  assert.match(source, /当前演示任务[\s\S]*任务 #\$\{esc\(task\.id\)\}/);
  assert.match(source, /class="presentation-task-focus"[\s\S]*现在处理[\s\S]*current\.title/);
  assert.match(source, /onclick="showTaskListFromPresentation\(\)"/);
  assert.match(source, /function showTaskListFromPresentation\(\)/);
  assert.match(styleSource, /body\.presentation-mode \.presentation-task-context\s*\{[\s\S]*grid-template-columns:minmax\(0,1\.35fr\)/);
  assert.match(styleSource, /@media \(max-width:600px\)[\s\S]*\.presentation-task-focus\s*\{[\s\S]*border-top:1px solid/);
});
test('mobile presentation compacts every route stop while the focus panel keeps actionable detail', () => {
  assert.match(styleSource, /@media \(max-width:600px\)[\s\S]*body\.presentation-mode \.demo-route-step\s*\{[\s\S]*grid-template-columns:auto auto minmax\(0,1fr\)[\s\S]*body\.presentation-mode \.demo-route-step \.demo-route-copy span[\s\S]*body\.presentation-mode \.demo-route-step \.demo-route-owner[\s\S]*body\.presentation-mode \.demo-route-step \.demo-route-arrow/);
  assert.match(source, /demo-route-focus-main[\s\S]*current\.detail[\s\S]*demo-route-focus-next[\s\S]*followUp\.detail/);
  assert.doesNotMatch(source, /class="demo-route-step[^`]*aria-label=/);
});
test('mobile presentation keeps agent detail on demand while retaining its summary', () => {
  const {app, context} = setup();
  const details = element();
  const summary = element();
  details.open = false;
  details.querySelector = selector => selector === 'summary' ? summary : null;
  context.document.documentElement = {clientWidth: 390};
  context.document.querySelector = selector => selector === '.agent-tour details' ? details : null;
  app.setPresentationMode(true);
  assert.equal(details.open, false);
  assert.equal(summary.attributes['aria-expanded'], 'false');
  const html = app.agentTourHtml(false);
  assert.match(html, /AGENT WALKTHROUGH/);
  assert.match(html, /两个 Agent 怎样从要求走到可交付证据/);
  details.open = true;
  details.listeners.toggle?.();
  assert.equal(summary.attributes['aria-expanded'], 'true');
});
test('presentation keeps the walkthrough collapsed until the viewer opens it', () => {
  const {app, context} = setup();
  const details = element();
  const summary = element();
  details.open = false;
  details.querySelector = selector => selector === 'summary' ? summary : null;
  context.document.documentElement = {clientWidth: 1440};
  context.document.querySelector = selector => selector === '.agent-tour details' ? details : null;

  app.setPresentationMode(true);
  assert.equal(details.open, false, 'desktop presentation keeps the walkthrough collapsed');
  context.document.documentElement.clientWidth = 390;
  app.applyPresentationMode();
  assert.equal(details.open, false, 'resize to mobile closes presentation auto-expansion');
  assert.equal(summary.attributes['aria-expanded'], 'false');

  details.open = true;
  details.listeners.toggle?.();
  context.document.documentElement.clientWidth = 1440;
  app.applyPresentationMode();
  context.document.documentElement.clientWidth = 390;
  app.applyPresentationMode();
  assert.equal(details.open, true, 'manual walkthrough choice survives viewport changes');
  assert.ok(source.includes('window.addEventListener("resize"'));
});
test('agent walkthrough makes the constrained execution path visible', () => {
  const {app} = setup();
  const offline = app.agentTourHtml(false);
  assert.match(offline, /AGENT WALKTHROUGH/);
  assert.match(offline, /<details>/);
  assert.match(offline, /<summary aria-expanded="false">/);
  assert.doesNotMatch(offline, /<details open>/);
  assert.match(offline, /requirements_draft/);
  assert.match(offline, /review_one_submission/);
  assert.match(offline, /蓝图确认/);
  assert.match(offline, /需求整理与审核的五个业务阶段/);
  assert.match(offline, /审核 Agent · Harness 工具护栏/);
  assert.match(offline, /工具调用受白名单、任务范围、运行预算、幂等键和结果上限约束/);
  assert.match(offline, /按任务、账号和请求编号恢复/);
  assert.equal((offline.match(/class="agent-tour-step /g) || []).length, 5);
  assert.match(styleSource, /\.agent-tour-flow\s*\{[^}]*grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(offline, /<b>Harness<\/b>/);
  assert.match(offline, /两个 Agent 怎样从要求走到可交付证据/);
  assert.match(offline, /review\.deterministic_rule/);
  assert.match(offline, /独立只读 MCP sidecar/);
  assert.match(offline, /list_my_tasks/);
  assert.match(offline, /get_task_collection_progress/);
  assert.match(offline, /get_task_next_step/);
  assert.match(offline, /get_task_agent_runtime/);
  assert.match(offline, /适用的收集阶段聚合计数/);
  assert.match(offline, /不读取逐人名单、材料正文或审核结果/);
  assert.match(offline, /不供网页 Agent 调用/);
  assert.match(offline, /蓝图发布、补正处理和最终验收由组织者决定/);
  assert.match(offline, /组织者做最终决定/);
  const online = app.agentTourHtml(true);
  assert.match(online, /模型已接入/);
  assert.match(online, /语义审核仍受工具白名单/);
});
test('agent walkthrough runtime facts come from the server manifest', () => {
  const {app} = setup();
  const manifest = {
    skills: [
      {name:'review_one_submission', allowed_tools:['review.custom_rule']},
      {name:'requirements_draft', request_idempotency:'task_account_request_id', version_conflict:'fail_closed', human_gate:'组织者确认发布'},
    ],
    tools: [{name:'review.custom_rule'}],
    harness: {max_invocations:7, semantic_model_calls_per_run:2, parsed_pages_per_run:11, result_limit_bytes:4096},
    mcp: {boundary:'组织者只读导航。', adapters:[{tools:['list_scoped_tasks']}]},
    human_control:['资格由组织者决定。'],
  };
  const html = app.agentTourRuntimeHtml(manifest).replace(/<wbr>/g, '');
  assert.match(html, /review\.custom_rule/);
  assert.doesNotMatch(html, /review\.deterministic_rule|review\.semantic_rule/);
  assert.match(html, /最多 7 次工具调用/);
  assert.match(html, /2 次语义模型调用/);
  assert.match(html, /11 页材料/);
  assert.match(html, /单结果 ≤4096 B/);
  assert.match(html, /按 任务、账号和请求编号 恢复/);
  assert.match(html, /list_scoped_tasks/);
  assert.match(html, /组织者只读导航/);
  assert.match(html, /资格由组织者决定/);
});
test('agent walkthrough can show a redacted read-only MCP snapshot', () => {
  const {app} = setup();
  const html = app.agentTourRuntimeHtml({
    skills: [{name:'review_one_submission'}],
    tools: [],
    harness: {max_invocations:2, semantic_model_calls_per_run:1, parsed_pages_per_run:20, result_limit_bytes:16384},
    mcp: {adapters:[{tools:['list_my_tasks', 'get_task_next_step']}], boundary:'只读任务导航'},
  });
  assert.match(html, /LIVE MCP EVIDENCE/);
  assert.match(html, /读取只读快照/);
  const rendered = app.mcpSnapshotHtml({
    task:{id:7, name:'演示任务'},
    intent:{goal:'定位当前任务下一步并读取受限聚合进度'},
    execution:{status:'completed', correlation_id:'mcp-demo-7', human_gate:'最终验收仍由组织者确认'},
    calls:[{tool:'list_my_tasks', status:'ok', task_count:1}],
    runtime:{contract_version:1},
  });
  assert.match(rendered, /Agent 只读意图/);
  assert.match(rendered, /mcp-demo-7/);
  assert.match(rendered, /运行 Agent 导览/);
  assert.match(rendered, /服务端脱敏投影/);
  assert.match(rendered, /工具调用按 Harness 预算执行/);
  app.state.mcpReplayIndex = 0;
  app.state.mcpSnapshotRunning = true;
  const replaying = app.mcpSnapshotHtml({
    task:{id:7, name:'演示任务'},
    intent:{goal:'只读导航'},
    execution:{status:'completed', replay:[
      {tool:'list_my_tasks', label:'确认任务范围', detail:'只读取任务索引'},
      {tool:'get_task_next_step', label:'定位下一步', detail:'读取路线'},
    ], replay_budget:{tool_calls:2, max_tool_calls:7}},
    calls:[{tool:'list_my_tasks', status:'ok', task_count:1}, {tool:'get_task_next_step', status:'ok'}],
    runtime:{contract_version:1},
  });
  assert.match(replaying, /等待第一项只读调用/);
  assert.match(source, /\/api\/tasks\/\$\{state\.demoTaskId\}\/mcp-snapshot/);
  assert.match(source, /\/api\/tasks\/\$\{state\.demoTaskId\}\/mcp-demo/);
  assert.match(source, /scheduleMcpReplay/);
  assert.match(source, /回放中/);
  assert.match(source, /浏览器不会接触 MCP 会话 token/);
  assert.match(source, /服务端脱敏投影/);
  assert.match(styleSource, /\.mcp-snapshot-calls \{ display:grid;/);
  assert.match(styleSource, /\.mcp-run-summary \{ display:grid;/);
  assert.match(styleSource, /@media \(max-width:600px\) \{\s*\.mcp-snapshot-head/);
  assert.doesNotMatch(html, /FORMFLOW_MCP_TOKEN|Authorization/);
});
test('agent trace keeps the run correlation visible without exposing tool payloads', () => {
  const {app} = setup();
  const html = app.agentRunCard({status:'success', pages_read:1, llm_calls_used:1, coverage:{files:[]}}, [
    {rule_id:'S-01', requirement:{statement:'原文依据'}, executor:'semantic'},
  ], [{tool:'review.semantic_rule', tool_version:'v1', sequence:1, rule_id:'S-01',
    status:'satisfied', simulation:true, duration_ms:12, correlation_id:'review-run:9'}]);
  assert.match(html, /review-run:9/);
  assert.match(html, /关联编号/);
  assert.doesNotMatch(html, /arguments/);
});
test('agent trace can be narrowed to tool family or human handoff for live explanation', () => {
  const {app} = setup();
  const trace = [
    {tool:'review.deterministic_rule', rule_id:'D-01', status:'satisfied', duration_ms:4, sequence:1},
    {tool:'review.semantic_rule', rule_id:'S-01', status:'unknown', duration_ms:800, sequence:2, simulation:true},
  ];
  const rules = [
    {rule_id:'D-01', requirement:{executor:'deterministic', statement:'确定性项'}},
    {rule_id:'S-01', requirement:{executor:'semantic', statement:'需要人工确认的语义项'}},
  ];
  app.state.reviewTraceFilter = 'semantic';
  const html = app.agentRunCard({status:'success', llm_calls_used:1, coverage:{files:[]}}, rules, trace, 1, 2);
  assert.match(html, /本次运行记录（1\/2 项）/);
  assert.match(html, /需要人工确认的语义项/);
  assert.doesNotMatch(html, /确定性项/);
  assert.match(html, /程序规则/);
  assert.match(html, /语义审核/);
  assert.match(html, /需人工/);
  assert.match(html, /aria-pressed="true"/);
});
test('agent run summary exposes version, elapsed time, result distribution, and retry lineage', () => {
  const {app} = setup();
  const html = app.agentRunCard({id:12, status:'success', revision_version:3, duration_ms:1840,
    retry:{attempt:2, retried_from:9, from_status:'failed'}, result_summary:{satisfied:2, issue:1, unknown:1},
    budget:{pages:{used:2, limit:40}, semantic_calls:{used:1, limit:30}},
    pages_read:2, llm_calls_used:1, coverage:{files:[]}}, [
    {rule_id:'D-01',result:'satisfied',requirement:{executor:'deterministic',statement:'必填项'}},
    {rule_id:'D-02',result:'satisfied',requirement:{executor:'deterministic',statement:'格式项'}},
    {rule_id:'S-01',result:'issue',requirement:{executor:'semantic',statement:'一致性项'}},
    {rule_id:'S-02',result:'unknown',requirement:{executor:'semantic',statement:'待确认项'}},
  ]);
  assert.match(html, /运行编号/);
  assert.match(html, /#12/);
  assert.match(html, /正式版本/);
  assert.match(html, /v3/);
  assert.match(html, /1\.8 秒/);
  assert.match(html, /第 2 次运行 · 由 #9 重试/);
  assert.match(html, /已满足 <b>2<\/b>/);
  assert.match(html, /需处理 <b>1<\/b>/);
  assert.match(html, /待人工 <b>1<\/b>/);
  assert.match(html, /页数预算/);
  assert.match(html, /2 \/ 40 页/);
  assert.match(html, /语义调用预算/);
  assert.match(html, /1 \/ 30 次/);
});
test('failed agent runs expose recovery actions at the handoff point', () => {
  const {app} = setup();
  const html = app.agentRunCard({id:14, status:'failed', failure:{
    title:'语义审核服务暂时不可用', detail:'未完成的语义项目没有被当成通过。',
    action:'配置或恢复模型服务后重试，也可以由组织者人工核对.'
  }, coverage:{files:[]}}, [], [], 7, 2);
  assert.match(html, /语义审核服务暂时不可用/);
  assert.match(html, /onclick="retryCheck\(7,2,'review'\)"/);
  assert.match(html, /href="#\/review\/7\/2"/);
  assert.match(html, /重新排队检查/);
  assert.match(html, /进入人工复核/);
  assert.match(html, /^<details[^>]* open>/);
  assert.match(styleSource, /\.agent-run-failure-actions/);
});
test('agent surfaces use the shared SVG icon language', () => {
  const {app} = setup();
  const trace = app.agentRunCard({status:'success', coverage:{files:[]}}, [], [
    {tool:'review.deterministic_rule', rule_id:'D-01', status:'satisfied', duration_ms:4, sequence:1},
  ]);
  assert.match(trace, /<svg[^>]*aria-hidden="true"/);
  assert.match(source, /sparkle:/);
  assert.match(source, /close:/);
  assert.doesNotMatch(source, /<div class="avatar">✧<\/div>/);
  assert.doesNotMatch(source, /class="file-chip-x"[^>]*>×<\/button>/);
});
test('publish readiness summarizes scope, collection, timing, review, and data boundaries', () => {
  const {app} = setup();
  const html = app.designReadinessHtml({
    task_scope: {name: '<演示任务>', mode: 'open', subject_kind: 'team', description: '请提交团队材料'},
    fields: [{label: '队名', required: true}],
    slots: [{label: '方案 PDF', formats: ['pdf']}],
    time_policy: {timezone: 'Asia/Shanghai', first_deadline: '2026-11-08T10:00:00Z', correction_deadline: '2026-11-09T10:00:00Z'},
    rules: [{executor: 'deterministic'}, {executor: 'semantic'}, {executor: 'human_only'}],
    manual_acceptance: true,
    eligibility_required: true,
    delivery: {group_by: '提交者', naming: '任务_主体'},
    governance: {purpose: '评审与归档', model_processing: '只分析规则需要理解的内容', retention: '活动结束后 30 天删除'},
  }, {publish_summary: ['已整理字段', '已标注人工验收']}, ['还缺少截止时间'], []);
  assert.match(html, /发布前核对/);
  assert.match(html, /谁来交/);
  assert.match(html, /要交什么/);
  assert.match(html, /什么时候交/);
  assert.match(html, /怎么核对/);
  assert.match(html, /交付与数据边界/);
  assert.match(html, /发布前要处理 1 项/);
  assert.match(html, /&lt;演示任务&gt;/);
  assert.doesNotMatch(html, /<演示任务>/);
  assert.match(html, /readiness-boundary/);
  assert.match(html, /评审与归档/);
  assert.match(html, /活动结束后 30 天删除/);
});
test('design readiness marks missing governance instead of inventing policy defaults', () => {
  const {app} = setup();
  const html = app.designReadinessHtml({rules: [{executor: 'semantic'}]});
  assert.match(html, /未填写用途/);
  assert.match(html, /未填写模型处理说明（1 条语义审核规则）/);
  assert.match(html, /未填写留存与删除安排/);
  assert.match(html, /readiness-missing/);
  assert.match(html, /可发布 · 有提醒/);
  assert.match(html, /发布前建议看一眼/);
  assert.doesNotMatch(html, /按任务用途整理材料/);
  assert.doesNotMatch(html, /由组织者按约定留存/);
  assert.match(app.designReadinessHtml({rules: []}), /本版本没有语义审核规则，不会调用语义模型/);
});
test('publish confirmation discloses governance, marks gaps, and escapes blueprint text', () => {
  const {app} = setup();
  const html = app.publishGovernanceHtml({
    governance: {purpose: '<审查 & 归档>', model_processing: '仅分析规则相关内容'},
    delivery: {group_by: '提交者', naming: '<任务名>'},
    rules: [{executor: 'semantic'}, {executor: 'cross_material'}],
  });
  assert.match(html, /收集用途/);
  assert.match(html, /&lt;审查 &amp; 归档&gt;/);
  assert.match(html, /仅分析规则相关内容/);
  assert.match(html, /留存与删除/);
  assert.match(html, /未填写留存期限或删除安排/);
  assert.match(html, /&lt;任务名&gt;/);
  assert.doesNotMatch(html, /<审查/);
  assert.doesNotMatch(html, /<任务名>/);
  assert.match(html, /未填写.*按实际处理方式补充/);
  assert.match(html, /aria-label="数据用途与处理说明"/);
  const missingModel = app.publishGovernanceHtml({rules: [{executor: 'semantic'}, {executor: 'cross_material'}]});
  assert.match(missingModel, /有 2 条语义审核规则/);
  assert.match(missingModel, /说明送入模型的内容和部署使用的模型服务/);
  assert.match(app.publishGovernanceHtml({}), /当前版本没有语义审核规则/);
});
test('exempt subjects are not missing and formal submissions need not have check results', () => {
  const {app} = setup();
  assert.equal(app.wbMatches({exempt:true,formal:false},'missing'),false);
  assert.equal(app.wbMatches({formal:true},'submitted'),true);
});
test('draft fingerprint ignores key order and file metadata shape', () => {
  const {app} = setup();
  assert.equal(app.draftFingerprint({a:1,b:2},{r:['f'],empty:[]}),app.draftFingerprint({b:2,a:1},{r:[{file_id:'f',name:'file'}]}));
});
test('pending guide answer and attachment metadata survive route caching, scoped by subject', () => {
  const {app,els,context} = setup(); els['sub-ans'] = element('not-yet-next');
  app.state.files = {r:['file-1']}; app.state.fileMeta = {'file-1':{name:'report.pdf'}};
  app.cacheSubmissionDraft();
  const cached = JSON.parse(context.sessionStorage.getItem('ff_draft:1:2'));
  assert.equal(cached.fields.name,'not-yet-next');
  assert.equal(cached.file_meta['file-1'].name,'report.pdf');
  app.state.me.subject.id=3; app.cacheSubmissionDraft();
  assert.ok(context.sessionStorage.getItem('ff_draft:1:3'));
});
test('switching from guide to form retains the pending input without pressing Next', () => {
  const {app,els,fields} = setup(); els['sub-ans']=element('pending');
  app.setSubMode('form'); assert.equal(fields[0].value,'pending');
});
test('read-only conditional uploads stay disabled', () => {
  const {app,els} = setup(); app.state.sub.ro=true;
  for (const id of ['slot-cond-r','file-r','upload-r']) els[id]=element();
  app.refreshSlotConditions([{id:'r',required_condition:"name == 'old'"}]);
  assert.equal(els['file-r'].disabled,true); assert.equal(els['upload-r'].disabled,true);
});
test('API errors preserve HTTP status for conflict interaction', async () => {
  const {app,context} = setup(); context.fetch=async()=>response({detail:'stale'},409);
  await assert.rejects(app.api('/test'), e => e.status===409 && e.message==='stale');
});
test('stale review sends loaded revision, keeps reason and locks stale evidence', async () => {
  const {app,context,els} = setup(); app.state.reviewData={revision:{id:41}};
  els['dc-type'].value='confirm_issue'; els['dc-reason'].value='reason for v1';
  let sent; context.fetch=async(_,opts)=>{sent=new URLSearchParams(opts.body);return response({detail:'changed'},409);};
  await app.submitDecision(1,2);
  assert.equal(sent.get('expected_current_revision'),'41');
  assert.equal(els['dc-reason'].value,'reason for v1');
  assert.equal(els['decision-submit'].disabled,true);
  assert.equal(app.state.reviewConflict,true);
  assert.match(els['review-conflict'].innerHTML,/refreshReview/);
});
test('late draft save cannot change another route or subject', async () => {
  const {app,context,els} = setup(); const pending=deferred(); context.fetch=()=>pending.promise;
  const saved=app.saveDraft(); app.state.routeEpoch++; app.state.me.subject.id=99;
  pending.resolve(response({draft_version:20})); await saved;
  assert.equal(app.state.draftVersion,1); assert.equal(els.flash.innerHTML,'');
});
test('edits made while saving remain local and are not falsely labeled saved', async () => {
  const {app,context,fields,els} = setup(); app.state.sub.mode='form';
  const pending=deferred();context.fetch=()=>pending.promise;
  const saved=app.saveDraft(); fields[0].value='newer edit';
  pending.resolve(response({draft_version:2}));await saved;
  assert.equal(app.state.draftVersion,2);assert.equal(fields[0].value,'newer edit');
  assert.match(els['draft-hint'].textContent,/尚未保存/);
});
test('double submit is locked; network retry reuses key; success starts next iteration fresh', async () => {
  const {app,context,els} = setup(); app.state.sub.mode='form';
  const pending=deferred();let calls=0;context.fetch=()=>{calls++;return pending.promise;};
  const first=app.doSubmit(); const key=app.state.pendingSubmission.key;
  await app.doSubmit(); assert.equal(calls,1);
  pending.resolve(response({detail:'network timeout'},503));await first;
  let retryKey;context.fetch=async(url,opts)=>{
    if(url==='/api/me/submit') {retryKey=JSON.parse(opts.body).idempotency_key;return response({receipt:'R1',revision:1,draft_version:2});}
    return response({summary:'queued'});
  };
  await app.doSubmit();assert.equal(retryKey,key);assert.equal(app.state.pendingSubmission,null);
  assert.match(els.flash.innerHTML,/提交成功/);
});
test('offline formal submit explains unknown result and retry reuses the pending idempotency key', async () => {
  const {app, context, els} = setup(); app.state.sub.mode='form';
  context.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await app.doSubmit();
  const key = app.state.pendingSubmission.key;
  assert.match(els.flash.innerHTML, /提交结果尚未确认/);
  assert.match(els.flash.innerHTML, /同一请求编号/);
  let retryKey;
  context.fetch = async (url, opts) => {
    if (url === '/api/me/submit') {
      retryKey = JSON.parse(opts.body).idempotency_key;
      return response({receipt:'R2',revision:1,draft_version:2});
    }
    if (url === '/api/me/results') return response({summary:'queued'});
    throw new Error('unexpected ' + url);
  };
  await app.doSubmit();
  assert.equal(retryKey, key);
  assert.equal(app.state.pendingSubmission, null);
  assert.match(els.flash.innerHTML, /提交成功/);
});
test('uploads claim the loaded draft version and advance the local version on success', async () => {
  const {app,context,els} = setup();
  els['file-r']={files:[new Blob(['test'])],value:'file'};
  app.state.serverDraftFields={name:'saved'}; app.state.serverDraftFingerprint=app.draftFingerprint({name:'saved'},{});
  context.document.getElementById('field-name').value='saved';
  let sent;
  context.fetch=async(_url,opts)=>{sent=opts.body;return {ok:true,status:200,json:async()=>({file_id:'file-new',size:4,draft_version:2})};};
  await app.uploadSlot('r');
  assert.equal(sent.get('expected_version'),'1');
  assert.equal(app.state.draftVersion,2);
  assert.deepEqual(Array.from(app.state.files.r),['file-new']);
  assert.match(els['draft-hint'].textContent,/已与服务器草稿同步/);
});
test('file deletion sends a compare-and-swap version and adopts the returned version', async () => {
  const {app,context,els} = setup();
  app.state.files={r:['file-a']};app.state.fileMeta={'file-a':{name:'report.txt'}};
  app.state.serverDraftFields={name:'saved'};app.state.serverDraftFingerprint=app.draftFingerprint({name:'saved'},{r:['file-a']});
  context.document.getElementById('field-name').value='saved';
  let path,opts;
  context.fetch=async(url,options)=>{path=url;opts=options;return response({deleted:'file-a',draft_version:2,cleanup_pending:true});};
  await app.deleteSlotFile('r','file-a');
  assert.equal(path,'/api/me/files/file-a');assert.equal(opts.method,'DELETE');
  assert.equal(opts.body.get('expected_version'),'1');
  assert.equal(app.state.draftVersion,2);assert.deepEqual(app.state.files.r,[]);
  assert.match(els['draft-hint'].textContent,/已与服务器草稿同步/);
  assert.match(els.flash.innerHTML,/存储清理未完成/);
});
test('stale attachment operations preserve the selected file and existing local references', async () => {
  const {app,context,els}=setup();
  els['file-r']={files:[new Blob(['new'])],value:'selected'};
  context.fetch=async()=>({ok:false,status:409,json:async()=>({detail:'草稿已更新'})});
  await app.uploadSlot('r');
  assert.equal(els['file-r'].value,'selected');
  assert.equal(app.state.draftVersion,1);assert.equal(app.state.files.r,undefined);
  assert.match(els.flash.innerHTML,/草稿已更新/);

  app.state.files={r:['file-a']};
  context.fetch=async()=>response({detail:'草稿已更新'},409);
  await app.deleteSlotFile('r','file-a');
  assert.deepEqual(Array.from(app.state.files.r),['file-a']);
  assert.equal(app.state.draftVersion,1);assert.match(els.flash.innerHTML,/草稿已更新/);
});
test('late upload cannot attach a previous subject file to the current subject', async () => {
  const {app,context,els} = setup();els['file-r']={files:[new Blob(['test'])],value:'file'};
  const pending=deferred();context.fetch=()=>pending.promise;
  const uploaded=app.uploadSlot('r');app.state.routeEpoch++;app.state.me.subject.id=99;
  pending.resolve({ok:true,status:200,json:async()=>({file_id:'old-subject-file',draft_version:2})});await uploaded;
  assert.equal(app.state.files.r,undefined);
});
test('storage failure retains an in-memory route cache and warns on reload risk', () => {
  const {app,context} = setup(); context.sessionStorage.setItem=()=>{throw new Error('full');};
  app.cacheSubmissionDraft();assert.equal(app.state.cacheFailed,true);
  assert.equal(JSON.parse(app.state.localDrafts['ff_draft:1:2']).fields.name,'old');
});

test('review reasons are isolated by rule, subject and formal revision', () => {
  const {app,els} = setup();
  app.state.reviewData = {subject:{id:2,name:'A'},revision:{id:41,version:1},rules:[
    {rule_id:'A',result:'manual_pending'}, {rule_id:'B',result:'unknown'}],acceptance:{ready:false,blockers:[]}};
  app.state.reviewContext=reviewScope('a');app.state.reviewRule='A';
  els['dc-reason'].value='only A';els['acceptance-reason'].value='separate acceptance';
  app.selectReviewRule('B',1,2);els['dc-reason'].value='only B';
  app.selectReviewRule('A',1,2);
  assert.equal(els['dc-reason'].value,'only A');
  assert.equal(els['acceptance-reason'].value,'separate acceptance');
  assert.equal(app.state.reviewDrafts[reviewScope('a')].rules.B['dc-reason'],'only B');
  app.state.reviewContext=reviewScope('b');app.state.reviewRule='A';els['dc-reason'].value='other subject';
  app.cacheReviewDraft();
  assert.equal(app.state.reviewDrafts[reviewScope('a')].rules.A['dc-reason'],'only A');
  assert.equal(app.state.reviewDrafts[reviewScope('b')].rules.A['dc-reason'],'other subject');
});
test('acceptance has its own reason, no rule scope or rule expiry, and locks on conflict', async () => {
  const {app,context,els} = setup();app.state.reviewData={revision:{id:41}};
  els['dc-type'].value='approve_exception';els['dc-rule'].value='A';
  els['dc-reason'].value='rule reason';els['dc-exp'].value='2026-12-31';
  els['acceptance-reason'].value='acceptance evidence';let sent;
  context.fetch=async(_,opts)=>{sent=new URLSearchParams(opts.body);return response({detail:'stale'},409);};
  await app.submitDecision(1,2,'accept_current');
  assert.equal(sent.get('decision'),'accept_current');assert.equal(sent.get('scope_rule_id'),'');
  assert.equal(sent.get('reason'),'acceptance evidence');assert.equal(sent.has('expires_at'),false);
  assert.equal(els['dc-reason'].value,'rule reason');
  assert.equal(els['acceptance-reason'].value,'acceptance evidence');
  assert.equal(els['acceptance-submit'].disabled,true);
});
test('a pending decision cannot switch rule or erase another review context', async () => {
  const {app,context,els} = setup();app.state.reviewData={revision:{id:41}};
  app.state.reviewContext=reviewScope('a');app.state.reviewRule='A';
  els['dc-type'].value='confirm_issue';els['dc-reason'].value='original';
  const pending=deferred();context.fetch=()=>pending.promise;
  const saving=app.submitDecision(1,2);app.selectReviewRule('B',1,2);
  assert.equal(app.state.reviewRule,'A');
  app.state.reviewContext=reviewScope('c');els['dc-reason'].value='other context';
  pending.resolve(response({}));await saving;
  assert.equal(els['dc-reason'].value,'other context');
});
test('review request failure replaces the loading state with recovery actions', async () => {
  const {app,context,els}=setup();
  context.fetch=async()=>response({detail:'主体不存在或不属于该任务'},404);
  await app.viewReview(1,9999);
  assert.match(els.rv.innerHTML,/检查结果暂时无法读取/);
  assert.match(els.rv.innerHTML,/主体不存在或不属于该任务/);
  assert.match(els.rv.innerHTML,/重试加载/);
  assert.doesNotMatch(els.rv.innerHTML,/正在读取检查结果/);
});
test('a late review failure cannot flash an error onto a different page', async () => {
  const {app,context,els}=setup();const pending=deferred();context.fetch=()=>pending.promise;
  const loading=app.viewReview(1,2);app.state.routeEpoch++;
  pending.resolve(response({detail:'old failure'},500));await loading;
  assert.equal(els.flash.innerHTML,'');
});
test('roster request failure exits loading and offers retry without enabling mutations', async () => {
  const {app,context,els}=setup();
  const controls=[{disabled:false},{disabled:false}];
  context.document.querySelectorAll=()=>controls;
  let reads=0;
  context.fetch=async()=>++reads===1?response({detail:'Not Found'},404):response({entries:[],total:0,granted:0,exempt:0});
  await app.loadRoster(9999);
  assert.match(els['roster-table'].innerHTML,/名册暂时无法读取/);
  assert.match(els['roster-table'].innerHTML,/重试加载名册/);
  assert.doesNotMatch(els['roster-table'].innerHTML,/正在读取名册/);
  assert.ok(controls.every(control=>control.disabled));
  await app.loadRoster(1);
  assert.ok(controls.every(control=>!control.disabled));
});
test('dual identity navigation reflects the current role and review highlights workbench', () => {
  const {app,context,els}=setup();context.localStorage.setItem('ff_org_token','org-test');
  app.renderNav();assert.equal(els['role-label'].textContent,'提交者');
  assert.match(els.nav.innerHTML,/切换到组织者/);assert.doesNotMatch(els.nav.innerHTML,/需求设计/);
  context.location.hash='#/review/1/2';app.renderNav();
  assert.equal(els['role-label'].textContent,'组织者');
  assert.match(els.nav.innerHTML, /href="#\/workbench\/1" aria-current="page"/);
});
test('overflowing narrow navigation scrolls the active route into view', () => {
  const {app,context,els}=setup();
  context.localStorage.setItem('ff_org_token','org-test');
  context.location.hash='#/delivery/1';
  let scrolled=false;
  els.nav.scrollWidth=900;els.nav.clientWidth=280;
  els.nav.querySelector=selector=>selector==='a.active'?{scrollIntoView(options){scrolled=true;assert.deepEqual({...options},{block:'nearest',inline:'nearest'});}}:null;
  app.renderNav();
  assert.equal(scrolled,true);
});
test('results poll only while pending, preserve explanation and ignore stale responses', async () => {
  const {app,context,els}=setup();let next,clears=0;
  context.setTimeout=fn=>{next=fn;return 1;};context.clearTimeout=()=>{clears++;next=null;};
  els['ap-content']=element('unfinished explanation');els['ap-content'].id='ap-content';
  els['ap-content'].selectionStart=3;els['ap-content'].selectionEnd=7;
  context.document.activeElement=els['ap-content'];els['ap-rule']=element('A');
  context.fetch=async()=>response({summary:'检查中',run_status:'queued',details:[{rule_id:'A',result:'unknown'}]});
  await app.loadMyResults();assert.equal(typeof next,'function');
  assert.equal(els['ap-content'].value,'unfinished explanation');assert.equal(els['ap-content'].focused,true);
  assert.equal(els['ap-content'].selectionStart,3);
  context.fetch=async()=>response({summary:'待人工',run_status:'success',details:[{rule_id:'A',result:'unknown'}]});
  await next();assert.equal(next,null);assert.ok(clears>=2);
  const before=els['my-results'].innerHTML,pending=deferred();context.fetch=()=>pending.promise;
  const loading=app.loadMyResults();app.state.routeEpoch++;
  pending.resolve(response({summary:'old context'}));await loading;
  assert.equal(els['my-results'].innerHTML,before);
});
test('submitter keeps checking while the organizer still needs to accept the revision', async () => {
  const {app,context}=setup();
  const scheduled=[];
  context.setTimeout=(fn,ms)=>{scheduled.push({fn,ms});return scheduled.length;};
  context.clearTimeout=()=>{};
  let calls=0;
  context.fetch=async()=>response(++calls===1
    ? {summary:'规则通过（待人工验收）',run_status:'success',buckets:{},details:[]}
    : {summary:'已验收',run_status:'success',buckets:{},details:[]});
  await app.loadMyResults();
  assert.equal(scheduled[0].ms,30000);
  await scheduled.shift().fn();
  assert.equal(calls,2);
  assert.equal(scheduled.length,0);
});
test('submitter keeps retrying acceptance status after a transient refresh failure', async () => {
  const {app,context,windowListeners}=setup();
  const scheduled=[];
  context.setTimeout=(fn,ms)=>{scheduled.push({fn,ms});return scheduled.length;};
  context.clearTimeout=()=>{};
  let calls=0;
  context.fetch=async()=>++calls===2
    ? response({detail:'temporarily unavailable'},503)
    : response({summary:'规则通过（待人工验收）',run_status:'success',buckets:{},details:[]});
  await app.loadMyResults();
  await scheduled.shift().fn();
  assert.equal(scheduled.at(-1).ms,30000);
  await windowListeners.online();
  assert.equal(calls,3);
});
test('submitter progress summarizes buckets in plain language rather than exposing rule IDs', async () => {
  const {app,context,els}=setup();
  context.setTimeout=()=>41;context.clearTimeout=()=>{};
  context.fetch=async()=>response({summary:'待补正',revision:1,buckets:{
    blocking:['r_term_match'],unknown:['r_name_clear'],human:['r_final_review'],incomplete:[],pending_jobs:[]},
    details:[
      {rule_id:'r_term_match',result:'issue',severity:'blocking',requirement:{statement:'报告期次与活动期次一致',requirement_source:'活动说明'},explanation:'期次不一致',next_step:'请核对期次'},
      {rule_id:'r_name_clear',result:'unknown',severity:'blocking',requirement:{statement:'姓名清晰可读',requirement_source:'活动说明'},explanation:'技术分析文字',next_step:'转人工复核'},
      {rule_id:'r_final_review',result:'manual_pending',severity:'blocking',requirement:{statement:'组织者人工核对',requirement_source:'活动说明'},explanation:'等待人工',next_step:'组织者会核对'},
    ]});
  await app.loadMyResults();
  assert.match(els['my-results'].innerHTML,/当前进度：<b>有材料需要补充或更正/);
  assert.match(els['my-results'].innerHTML,/需要更正 1 项/);
  assert.match(els['my-results'].innerHTML,/组织者核对 1 项/);
  assert.match(els['my-results'].innerHTML,/组织者待办/);
  assert.match(els['my-results'].innerHTML,/需要一起处理（1）/);
  assert.doesNotMatch(els['my-results'].innerHTML,/阻塞:r_term_match|待确认:r_name_clear|人工:r_final_review/);
  assert.match(els['my-results'].innerHTML,/想补充说明，或请组织者再看一眼/);
  assert.match(els['my-results'].innerHTML,/报告期次与活动期次一致/);
  assert.doesNotMatch(els['my-results'].innerHTML,/技术分析文字/);
});
test('submitter separates organizer-only review work from submitter actions', async () => {
  const {app,context,els}=setup();
  context.setTimeout=()=>41;context.clearTimeout=()=>{};
  context.fetch=async()=>response({summary:'检查未完成',revision:1,buckets:{blocking:[],unknown:['r_name_clear'],human:['r_final_review'],incomplete:['r_semantic'],pending_jobs:[]},details:[
    {rule_id:'r_name_clear',result:'unknown',requirement:{statement:'姓名清晰可读'},explanation:'需要组织者核对'},
    {rule_id:'r_final_review',result:'manual_pending',requirement:{statement:'组织者人工核对'},explanation:'等待人工'},
    {rule_id:'r_semantic',result:'failed',requirement:{statement:'语义检查'},explanation:'模型尚未配置'},
  ]});
  await app.loadMyResults();
  assert.match(els['my-results'].innerHTML,/暂时没有需要你处理的事项/);
  assert.match(els['my-results'].innerHTML,/组织者待办（3）/);
  assert.match(els['my-results'].innerHTML,/不需要为它们重复提交材料/);
  assert.doesNotMatch(els['my-results'].innerHTML,/需要一起处理（3）/);
});
test('submitter checks for organizer review updates every 30 seconds and stops after resolution', async () => {
  const {app,context,els}=setup();
  app.state.me={};
  app.state.receipt={formal:true,revision:1};
  let scheduled, delay, scheduleCount = 0, calls = 0;
  context.setTimeout=(fn,ms)=>{scheduled=fn;delay=ms;scheduleCount++;return scheduleCount;};
  context.clearTimeout=()=>{};
  context.fetch=async()=>response(++calls === 1
    ? {summary:'待人工',revision:1,buckets:{blocking:[],unknown:[],human:['r_final_review'],incomplete:[],pending_jobs:[]},details:[
      {rule_id:'r_final_review',result:'manual_pending',requirement:{statement:'组织者人工核对'}}]}
    : {summary:'已验收',revision:1,buckets:{blocking:[],unknown:[],human:[],incomplete:[],pending_jobs:[]},details:[]});
  await app.loadMyResults();
  assert.equal(delay,30000);
  assert.match(els['submit-next-step'].innerHTML,/组织者核对中/);
  await scheduled();
  assert.equal(calls,2);
  assert.match(els['submit-next-step'].innerHTML,/这份提交已经验收/);
  assert.equal(scheduleCount,1);
});
test('submitter keeps checking a known organizer todo after a temporary server error', async () => {
  const {app,context,els}=setup();
  app.state.me={};
  app.state.receipt={formal:true,revision:1};
  app.state.submitterResults={run_status:'success',buckets:{human:['r_final_review']}};
  let scheduled, delay, calls=0, scheduleCount=0;
  context.setTimeout=(fn,ms)=>{scheduled=fn;delay=ms;scheduleCount++;return scheduleCount;};
  context.clearTimeout=()=>{};
  context.fetch=async()=>++calls===1
    ? response({detail:'暂时不可用'},503)
    : response({summary:'已验收',revision:1,buckets:{blocking:[],unknown:[],human:[],incomplete:[],pending_jobs:[]},details:[]});
  await app.loadMyResults();
  assert.equal(delay,30000);
  assert.match(els['my-results'].innerHTML,/检查结果暂时无法更新/);
  await scheduled();
  assert.equal(calls,2);
  assert.match(els['submit-next-step'].innerHTML,/这份提交已经验收/);
  assert.equal(scheduleCount,1);
});
test('submitter next-step band follows draft and review state without inventing a second status', () => {
  const {app,context,els} = setup();
  let html = app.submitterNextStepHtml({formal:false, issues:[{code:'required'}]});
  assert.match(html,/完成登记并上传材料/);
  assert.match(html,/尚未提交/);
  html = app.submitterNextStepHtml({formal:false, issues:[]});
  assert.match(html,/核对内容后正式提交/);
  html = app.submitterNextStepHtml({formal:true, summary:'待补正', buckets:{blocking:['r1']}, revision:2});
  assert.match(html,/处理需要更正的事项/);
  assert.match(html,/有 1 项需要补充或更正/);
  html = app.submitterNextStepHtml({formal:true, summary:'待补正', runStatus:'running', buckets:{blocking:['r1'],pending_jobs:['running']}, revision:2});
  assert.match(html,/处理需要更正的事项/);
  assert.doesNotMatch(html,/等待材料核对完成/);
  html = app.submitterNextStepHtml({formal:true, summary:'规则通过（待人工验收）', buckets:{}});
  assert.match(html,/等待组织者最终验收/);
  assert.match(html,/每 30 秒检查核对进度/);
  html = app.submitterNextStepHtml({formal:true, summary:'待人工', buckets:{human:['r1']}});
  assert.match(html,/组织者核对中，你无需重复提交/);
  assert.match(html,/页面打开时每 30 秒检查核对进度/);
  html = app.submitterNextStepHtml({formal:true, summary:'规则通过'});
  assert.match(html,/材料检查已完成/);
  html = app.submitterNextStepHtml({formal:true});
  assert.match(html,/正在读取这份提交的核对结果/);
  html = app.submitterNextStepHtml({formal:true, resultsUnavailable:true});
  assert.match(html,/当前核对结果暂时读不到/);
  assert.doesNotMatch(html,/正在读取这份提交的核对结果/);
  html = app.submitterNextStepHtml({formal:true, readOnly:true, summary:'已验收'});
  assert.match(html,/查看已提交版本与核对记录/);
  assert.match(html,/onclick="jumpToSubmitResults\(\)"/);
  assert.doesNotMatch(app.submitterNextStepHtml({formal:false}),/查看核对记录/);
  context.jumpToSubmitResults();
  assert.equal(els['my-results-card'].scrolled,true);
  assert.equal(els['my-results-card'].focused,true);
  assert.match(source,/id="my-results-card"[^>]*aria-labelledby="my-results-heading"/);
  assert.match(source,/id="my-results-heading">这份材料核对到哪了/);
  assert.match(styleSource,/\.my-results-card\s*\{[^}]*scroll-margin-top:\s*88px/s);
  assert.match(styleSource,/@media\(max-width:700px\)\s*\{\s*\.my-results-card\s*\{[^}]*scroll-margin-top:\s*16px/s);
  assert.match(styleSource,/\.submit-next-step/);
});
test('result load failure is visible and does not replace existing results', async () => {
  const {app,context,els}=setup();els['my-results'].innerHTML='existing receipt and results';
  context.setTimeout=()=>41;context.clearTimeout=()=>{};
  context.fetch=async()=>response({detail:'offline'},503);await app.loadMyResults();
  assert.match(els['my-results'].innerHTML,/重试加载结果/);
  assert.match(els['my-results'].innerHTML,/existing receipt and results/);
});
test('submitter results resume immediately when connectivity returns and transient failures back off', async () => {
  const {app,context,els,windowListeners}=setup();
  let retry, delay, calls=0;
  context.setTimeout=(fn,ms)=>{retry=fn;delay=ms;return 31;};
  context.clearTimeout=()=>{};
  context.fetch=async()=>{calls++;return calls===1
    ? response({detail:'temporarily unavailable'},503)
    : response({summary:'结果已更新',run_status:'success',details:[]});};
  await app.loadMyResults();
  assert.equal(delay,3000);
  assert.match(els['my-results'].innerHTML,/重试加载结果/);
  await windowListeners.online();
  assert.equal(calls,2);
  assert.match(els['my-results'].innerHTML,/当前进度：<b>结果已更新/);
});
test('submitter results cap automatic retries and do not retry authorization failures', async () => {
  const {app,context}=setup();
  const scheduled=[];
  context.setTimeout=(fn,ms)=>{scheduled.push({fn,ms});return scheduled.length;};
  context.clearTimeout=()=>{};
  let status=503,calls=0;
  context.fetch=async()=>{calls++;return response({detail:'temporary failure'},status);};
  await app.loadMyResults();
  const delays=[];
  while(scheduled.length){
    const item=scheduled.shift();delays.push(item.ms);await item.fn();
  }
  assert.deepEqual(delays,[3000,6000,12000,24000,30000]);
  assert.equal(calls,6);
  status=401;await app.loadMyResults();
  assert.equal(calls,7);
  assert.equal(scheduled.length,0);
});
test('workbench refresh preserves even an empty reminder and prunes only ineligible selections', async () => {
  const {app,context,els}=setup();context.location.hash='#/workbench/1';
  app.state.wbTaskId=1;app.state.reminder={selected:[2,3],view:{targets:[]},created:null};
  els['remind-content']=element('');els['remind-body']=element();
  context.fetch=async url=>response(url.endsWith('/workbench') ? {task:{},rows:[],counts:{}} : {
    view:{targets:[{subject_id:2,name:'A'},{subject_id:4,name:'B'}]},notifications:[]});
  await app.refreshWorkbench();
  assert.equal(app.state.reminder.draftContent,'');
  assert.deepEqual([...app.state.reminder.selected],[2]);
  assert.doesNotMatch(els['remind-body'].innerHTML,/你好/);
  els['remind-content'].value='newly edited notice';app.paintReminder();
  assert.equal(app.state.reminder.draftContent,'newly edited notice');
});

test('workbench first-load failure is explicit and never reports an empty roster', async () => {
  const {app,context,els}=setup();context.location.hash='#/workbench/1';
  app.state.wbTaskId=1;app.state.wbRefreshRequestId=0;
  for (const id of ['wb-refresh-status','wb-list','remind-body']) els[id]=element();
  context.fetch=async()=>{throw new Error('offline');};
  await app.refreshWorkbench();
  assert.match(els['wb-refresh-status'].innerHTML,/提交情况尚未加载/);
  assert.match(els['wb-refresh-status'].innerHTML,/onclick="refreshWorkbench\(\)"/);
  assert.match(els['wb-list'].innerHTML,/名单暂时无法读取/);
  assert.doesNotMatch(els['wb-list'].innerHTML,/还没有提交主体/);
  assert.match(els['remind-body'].innerHTML,/催交名单暂时无法读取/);
});

test('workbench retains loaded data on failure and ignores an older overlapping response', async () => {
  const {app,context,els}=setup();context.location.hash='#/workbench/1';
  app.state.wbTaskId=1;
  for (const id of ['wb-task-name','wb-lifecycle','wb-readonly','wb-next-step','wb-refresh-status','wb-stats','wb-list','remind-body','remind-count']) els[id]=element();
  const oldRound={workbench:deferred(),notifications:deferred()};
  const newRound={workbench:deferred(),notifications:deferred()};
  let round=oldRound, calls=0;
  context.fetch=url=>{calls++;return (round[url.endsWith('/workbench')?'workbench':'notifications']).promise;};
  const older=app.refreshWorkbench();
  round=newRound;
  const newer=app.refreshWorkbench();
  newRound.workbench.resolve(response({task:{id:1,name:'最新数据',mode:'roster',status:'collecting'},rows:[],counts:{}}));
  newRound.notifications.resolve(response({view:{targets:[]},notifications:[]}));
  await newer;
  oldRound.workbench.resolve(response({task:{id:1,name:'过期数据',mode:'roster',status:'collecting'},rows:[],counts:{}}));
  oldRound.notifications.resolve(response({view:{targets:[]},notifications:[]}));
  await older;
  assert.equal(calls,4);
  assert.equal(app.state.wbTask.name,'最新数据');
  assert.equal(els['wb-refresh-status'].innerHTML,'');

  context.fetch=async()=>{throw new Error('offline');};
  await app.refreshWorkbench();
  assert.match(els['wb-refresh-status'].innerHTML,/显示的是上次读取的数据/);
  assert.equal(app.state.wbTask.name,'最新数据');
});

test('reminder draft names the exact first deadline in the task timezone and remains editable', () => {
  const {app,els} = setup();
  app.state.wbTask={name:'团课报告',first_deadline:'2026-10-31T11:50:00Z',timezone:'Asia/Shanghai'};
  app.state.reminder={selected:null,view:{targets:[{subject_id:2,name:'赵六'}]},notifications:[],created:null};
  els['remind-body']=element();
  app.paintReminder();
  assert.match(els['remind-body'].innerHTML,/请在首次截止时间 2026-10-31 19:50 前完成登记并上传材料/);
  assert.match(els['remind-body'].innerHTML,/如已提交请忽略/);
  app.state.wbTask.first_deadline=null;
  app.state.reminder.draftContent=null;
  app.paintReminder();
  assert.match(els['remind-body'].innerHTML,/请按任务说明完成登记并上传材料/);
  assert.doesNotMatch(els['remind-body'].innerHTML,/未设置前完成/);
});


test('formal-submit preflight aggregates required fields and conditional slots; zero remains valid', () => {
  const {app} = setup();
  app.state.sub.fields = [{id:'name', label:'姓名', required:true},
    {id:'address', label:'地址', required:true, required_condition:'track==实物'},
    {id:'optional', required:false}];
  app.state.sub.slots = [{id:'photo', label:'实物照片', max_count:1, required_condition:'track==实物'}];
  let issues = app.submissionIssues({name:'  ', track:'实物'});
  assert.equal(issues.length,3);
  assert.deepEqual(Array.from(issues, i => i.id), ['name','address','photo']);
  assert.equal(app.submissionIssues({name:0,track:'数字'}).length,0);
  app.state.files.photo=['a','b'];
  assert.ok(app.submissionIssues({name:'A',track:'数字'}).some(i => i.code==='max_count'));
});
test('guide submit failure exposes form, focuses summary, links inline errors, preserves pending answer', async () => {
  const {app,context,els,fields} = setup();
  els['sub-ans']=element('not-yet-next');
  app.state.sub.fields=[{id:'name',label:'姓名',required:true}];
  app.state.sub.slots=[{id:'report',label:'报告',max_count:1}];
  let calls=0;context.fetch=async()=>{calls++;throw new Error('must not submit');};
  await app.doSubmit();
  assert.equal(calls,0);assert.equal(app.state.sub.mode,'form');
  assert.equal(els['submission-errors'].focused,true);
  assert.match(els['submission-errors'].innerHTML,/请上传/);
  assert.equal(fields[0].value,'not-yet-next');
  assert.equal(app.state.submitting,false);
  assert.equal(JSON.parse(context.sessionStorage.getItem('ff_draft:1:2')).fields.name,'not-yet-next');
});
test('inline validation and summary navigation target the input; next attempt clears invalid state', () => {
  const {app,els,fields} = setup();
  app.state.sub.fields=[{id:'name',label:'姓名',required:true}];
  const link=element();els['submission-errors'].querySelectorAll=()=>[link];
  app.showSubmissionIssues([{target:'field',id:'name',code:'required',message:'请填写姓名'}]);
  assert.equal(fields[0].attributes['aria-invalid'],'true');
  assert.equal(els['field-error-name'].textContent,'请填写姓名');
  link.listeners.click();assert.equal(fields[0].focused,true);assert.equal(fields[0].scrolled,true);
  els['submission-errors'].querySelectorAll=()=>[];
  app.showSubmissionIssues([]);
  assert.equal(fields[0].attributes['aria-invalid'],'false');
  assert.equal(els['field-error-name'].hidden,true);assert.equal(els['submission-errors'].hidden,true);
});
test('structured server errors preserve inputs and attachment references without fabricating a receipt', async () => {
  const {app,context,els,fields} = setup();app.state.sub.mode='form';app.state.files={report:['file-a']};
  context.fetch=async()=>response({detail:{code:'submission_validation',message:'请核对',
    issues:[{target:'field',id:'name',code:'required',message:'<script>不是 HTML</script>'}]}},422);
  await app.doSubmit();
  assert.equal(fields[0].value,'old');assert.equal(app.state.files.report[0],'file-a');
  assert.match(els['submission-errors'].innerHTML,/&lt;script&gt;/);
  assert.equal(els['receipt-out'].innerHTML,'');assert.equal(app.state.draftVersion,1);
});
test('late validation response cannot paint errors in another subject page', async () => {
  const {app,context,els} = setup();app.state.sub.mode='form';
  const pending=deferred();context.fetch=()=>pending.promise;
  const sent=app.doSubmit();app.state.routeEpoch++;app.state.me.subject.id=99;
  pending.resolve(response({detail:{message:'old',issues:[{target:'field',id:'name',message:'old'}]}},422));
  await sent;assert.equal(els['submission-errors'].innerHTML,'');assert.equal(els.flash.innerHTML,'');
});
test('unsupported field/slot conditions surface as configuration errors, never quietly optional', () => {
  const {app} = setup();app.state.sub.fields=[{id:'name',required:true,required_condition:'len(name)>0'}];
  app.state.sub.slots=[{id:'r',required_condition:'track in [数字]'}];
  assert.equal(app.submissionIssues({}).filter(i => i.code==='unsupported_condition').length,2);
});


test('progress reflects current empty fields, numeric zero and uploaded references', () => {
  const {app,els,fields} = setup(); app.state.sub.mode='form';
  els['submission-field-count']=element();els['submission-file-count']=element();
  app.state.files={report:['one','two']};fields[0].value='   ';
  app.cacheSubmissionDraft();
  assert.equal(els['submission-field-count'].textContent,'0/1');
  assert.equal(els['submission-file-count'].textContent,'2');
  fields[0].value=0;app.cacheSubmissionDraft();
  assert.equal(els['submission-field-count'].textContent,'1/1');
});

test('returning to guide resumes at the first material not already uploaded', () => {
  const {app,els} = setup();
  els['sub-chat-scroll'] = element();
  app.state.files = {first:['already-uploaded']};
  app.state.sub.mode = 'form';
  app.state.sub.fields = [{id:'name'}];
  app.state.sub.slots = [{id:'first',label:'First'},{id:'second',label:'Second'}];
  app.state.sub.msgs = [];
  app.setSubMode('chat');
  assert.equal(app.state.sub.phase, 'slots');
  assert.equal(app.state.sub.sIdx, 1);
});

test('guide upload advances to the next pending material and completes the review step', () => {
  const {app,els} = setup();
  els['sub-chat-scroll'] = element();
  app.state.files = {};
  app.state.sub.mode = 'chat';
  app.state.sub.phase = 'slots';
  app.state.sub.fields = [{id:'name'}];
  app.state.sub.slots = [{id:'first',label:'First'},{id:'second',label:'Second'}];
  app.state.sub.msgs = [];
  app.state.sub.sIdx = 0;
  app.afterSlotUpload('first', 'new-file', {name:'first.pdf'});
  assert.equal(app.state.sub.sIdx, 1);
  app.afterSlotUpload('second', 'new-file-2', {name:'second.pdf'});
  assert.equal(app.state.sub.phase, 'done');
  assert.match(els['sub-chat-scroll'].innerHTML, /核对一下再提交/);
});

test('returning to guide revisits a field cleared in the full form', () => {
  const {app,els,fields} = setup();app.state.sub.mode='form';app.state.sub.phase='slots';
  app.state.sub.answers={name:'old'};app.state.sub.msgs=[];fields[0].value='';
  els['sub-chat-scroll']=element();
  app.setSubMode('chat');
  assert.equal(app.state.sub.phase,'fields');assert.equal(app.state.sub.fIdx,0);
  assert.equal(app.state.sub.answers.name,undefined);
});


test('restored guide answers exclude blanks but retain numeric zero', () => {
  const {app,fields}=setup();fields[0].value='';
  app.initSubChat([{id:'name'},{id:'count'}],[],false,'演示',{name:'  ',count:0});
  assert.equal(app.state.sub.answers.name,undefined);
  assert.equal(app.state.sub.answers.count,'0');
  assert.equal(app.state.sub.fIdx,0);
});

test('initializing a restored guide skips materials already attached to its draft', () => {
  const {app} = setup();
  app.state.files = {first:['existing-file']};
  app.initSubChat([{id:'name'}], [{id:'first',label:'First'},{id:'second',label:'Second'}], false, '演示', {name:'已填写'});
  assert.equal(app.state.sub.phase, 'slots');
  assert.equal(app.state.sub.sIdx, 1);
});


test('roster metric filters match denominators and exclude out-of-roster or exempt submissions', () => {
  const {app} = setup(); app.state.wbTask = {mode:'roster'};
  const rows = [
    {in_roster:true, formal:false},
    {in_roster:true, exempt:true, formal:true, acceptance:'accepted'},
    {in_roster:true, formal:true, acceptance:'accepted'},
    {in_roster:false, formal:true, acceptance:'accepted'},
  ];
  for (const [filter, count] of [['roster',3],['exempt',1],['required',2],['submitted',1],['missing',1],['accepted',1]]) {
    assert.equal(rows.filter(r=>app.wbMatches(r,filter)).length,count,filter);
  }
});
test('roster credential filters show matching entries and explicit, accessible counts', () => {
  const {app, els} = setup();
  app.state.rosterTaskId = 7;
  app.state.rosterEntries = [
    {id:1,name:'张三',ref:'一班',granted:true,exempt:false},
    {id:2,name:'李四',ref:'一班',granted:false,exempt:false},
    {id:3,name:'王五',ref:'二班',granted:false,exempt:true},
    {id:4,name:'赵六',ref:'二班',granted:true,exempt:true},
  ];
  app.renderRosterTable();
  assert.match(els['roster-filter'].innerHTML, /待发放<span>1<\/span>/);
  assert.match(els['roster-filter'].innerHTML, /已发放<span>2<\/span>/);
  assert.match(els['roster-filter'].innerHTML, /免交<span>2<\/span>/);
  assert.match(els['roster-filter'].innerHTML, /aria-pressed="true"/);
  assert.equal(els['roster-results-status'].textContent, '显示全部，共 4 位主体。');
  const filterMarkup = els['roster-filter'].innerHTML;
  const buttons = ['all','pending','issued','exempt'].map((rosterFilter, index) => ({
    dataset: {rosterFilter}, className: index === 0 ? 'roster-filter-button active' : 'roster-filter-button',
    attributes: {'aria-pressed': String(index === 0)}, count: {textContent: String([4,1,2,2][index])},
    setAttribute(name, value) { this.attributes[name] = value; },
    querySelector(selector) { return selector === 'span' ? this.count : null; },
  }));
  els['roster-filter'].querySelectorAll = () => buttons;
  app.setRosterFilter('pending');
  assert.equal(els['roster-filter'].innerHTML, filterMarkup, 'updating filter state should preserve the existing button nodes');
  assert.equal(buttons[1].attributes['aria-pressed'], 'true');
  assert.equal(buttons[1].count.textContent, '1');
  assert.equal(els['roster-results-status'].textContent, '已筛选待发放，共 1 位主体。');
  assert.match(els['roster-table'].innerHTML, /李四/);
  assert.doesNotMatch(els['roster-table'].innerHTML, /张三|王五|赵六/);
  assert.match(els['roster-table'].innerHTML, /issueGrant\(7,2\)/);
  app.setRosterFilter('issued');
  assert.match(els['roster-table'].innerHTML, /张三/);
  assert.match(els['roster-table'].innerHTML, /赵六/);
  app.setRosterFilter('exempt');
  assert.match(els['roster-table'].innerHTML, /王五/);
  assert.match(els['roster-table'].innerHTML, /赵六/);
  app.setRosterFilter('unknown');
  assert.match(els['roster-table'].innerHTML, /王五/);
  app.state.rosterEntries = [{id:5,name:'钱七',granted:true,exempt:false}];
  app.setRosterFilter('pending');
  assert.equal(els['roster-results-status'].textContent, '筛选“待发放”没有匹配主体。');
  app.state.rosterEntries = [];
  app.renderRosterTable();
  assert.match(els['roster-table'].innerHTML, /名单还是空的/);
  assert.equal(els['roster-results-status'].textContent, '名单为空。');
});
test('roster avatar keeps its centered identity style instead of the metadata truncation style', () => {
  const avatarRule = styleSource.match(/\.roster-person\s*>\s*\.wb-avatar\s*\{([^}]*)\}/);
  assert.ok(avatarRule, 'roster avatars need a selector more specific than the metadata span rule');
  assert.match(avatarRule[1], /display\s*:\s*inline-flex/);
  assert.match(avatarRule[1], /align-items\s*:\s*center/);
  assert.match(avatarRule[1], /justify-content\s*:\s*center/);
  assert.match(avatarRule[1], /white-space\s*:\s*normal/);
});
test('bulk credential issuance keeps successful one-time tokens visible after a partial failure', async () => {
  const {app,context,els} = setup();
  const entries = [
    {id:1,name:'甲同学',ref:'一班',granted:false,exempt:false},
    {id:2,name:'乙同学',ref:'一班',granted:false,exempt:false},
    {id:3,name:'丙同学',ref:'二班',granted:false,exempt:false},
  ];
  let grants = 0;
  context.fetch = async (url, options = {}) => {
    if (url.endsWith('/roster')) return response({entries,total:3,granted:0,exempt:0});
    grants++;
    if (grants === 2) return response({detail:'暂时无法确认'}, 503);
    return response({credential:`one-time-${grants}`,warning:grants === 3 ? '该主体此前已有有效凭证，请核对主体 ID' : undefined});
  };
  await app.issueAllGrants(7);
  assert.equal(grants,3,'one failed request must not stop later roster entries');
  assert.match(els['grant-out'].innerHTML,/one-time-1/);
  assert.match(els['grant-out'].innerHTML,/one-time-3/);
  assert.match(els['grant-out'].innerHTML,/乙同学/);
  assert.match(els['grant-out'].innerHTML,/未确认结果 1 条/);
  assert.match(els['grant-out'].innerHTML,/此前已有有效凭证/);
  assert.match(els.flash.innerHTML,/先核对刷新后的发放状态/);
});
test('bulk credential issuance keeps tokens and reports stale roster when refresh fails', async () => {
  const {app,context,els} = setup();
  const entries = [
    {id:1,name:'甲同学',ref:'一班',granted:false,exempt:false},
    {id:2,name:'乙同学',ref:'一班',granted:false,exempt:false},
  ];
  let rosterReads = 0, grants = 0;
  context.fetch = async url => {
    if (url.endsWith('/roster')) {
      rosterReads++;
      return rosterReads === 1 ? response({entries,total:2,granted:0,exempt:0}) : response({detail:'暂时无法刷新'},503);
    }
    grants++;
    return grants === 1 ? response({credential:'one-time-1'}) : response({detail:'暂时无法确认'},503);
  };
  await app.issueAllGrants(7);
  assert.match(els['grant-out'].innerHTML,/one-time-1/);
  assert.match(els['grant-out'].innerHTML,/名册状态未能刷新/);
  assert.doesNotMatch(els['grant-out'].innerHTML,/名册状态已刷新/);
  assert.match(els['grant-out'].innerHTML,/乙同学/);
  assert.match(els.flash.innerHTML,/名册状态暂未刷新/);
});
test('workbench expands pending rule ids into the published rule titles', () => {
  const {app,els} = setup();
  els['wb-stats'] = element(); els['wb-list'] = element(); els['wb-next-step'] = element();
  Object.assign(app.state, {wbTask:{id:1,mode:'roster',status:'collecting'},wbTaskId:1,wbCounts:{},wbRows:[{
    subject_id:3,name:'李同学',in_roster:true,formal:true,revision:1,summary:'待补正',
    buckets:{blocking:['r_term_match'],unknown:['r_name_clear'],human:['r_final_review']},
    rule_labels:{r_term_match:'报告期次须与活动一致',r_name_clear:'姓名需清晰可读',r_final_review:'组织者人工核对'},
  }]});
  app.paintWorkbench();
  assert.match(els['wb-list'].innerHTML,/需要更正：报告期次须与活动一致/);
  assert.match(els['wb-list'].innerHTML,/待确认：姓名需清晰可读/);
  assert.match(els['wb-list'].innerHTML,/组织者核对：组织者人工核对/);
  assert.doesNotMatch(els['wb-list'].innerHTML,/r_term_match|r_name_clear|r_final_review/);
});
test('metric navigation clears search and unsubmitted exempt subjects can reach history', () => {
  const {app,els} = setup();
  els['wb-stats']=element(); els['wb-list']=element(); els['wb-search']=element('hidden');
  Object.assign(app.state, {wbTask:{mode:'roster', status:'collecting'},wbTaskId:1,wbCounts:{exempt:1},
    wbRows:[{subject_id:2,name:'免交者',in_roster:true,exempt:true,formal:false}],wbQuery:'hidden'});
  app.filterWorkbench('exempt',true);
  assert.equal(app.state.wbQuery,''); assert.equal(els['wb-search'].value,'');
  assert.match(els['wb-stats'].innerHTML,/aria-pressed="true"/);
  assert.match(els['wb-list'].innerHTML,/#\/review\/1\/2/);
  assert.match(els['wb-list'].innerHTML,/免交与历史/);
});


test('revoke dialog validates reason, locks retries and preserves reason on failure', async () => {
  const {app,context,els} = setup();
  for (const id of ['revoke-dialog','revoke-impact','revoke-reason','revoke-error','revoke-confirm','revoke-cancel']) els[id]=element();
  els['revoke-dialog'].showModal=()=>{els['revoke-dialog'].open=true;};
  app.state.reviewContext=reviewScope('d'); app.state.reviewData={decisions:[{id:7,decision:'exempt'}]};
  app.revokeDecision(1,2,7); assert.equal(els['revoke-dialog'].open,true);
  assert.match(els['revoke-impact'].textContent,/恢复应交/);
  await app.confirmRevokeDecision(); assert.match(els['revoke-error'].textContent,/理由/);
  els['revoke-reason'].value='已恢复'; const pending=deferred(); let count=0;
  context.fetch=async()=>{count++; return pending.promise;};
  const first=app.confirmRevokeDecision(); await app.confirmRevokeDecision();
  assert.equal(count,1); assert.equal(els['revoke-confirm'].disabled,true);
  pending.resolve(response({detail:'网络暂时不可用'},503)); await first;
  assert.equal(els['revoke-reason'].value,'已恢复');
  assert.match(els['revoke-error'].textContent,/暂时不可用/);
  assert.equal(els['revoke-confirm'].disabled,false);
});


test('confirmed issues remain visible as problems in review and submitter details', async () => {
  const {app,els,context} = setup();
  app.state.reviewContext=reviewScope('e'); app.state.reviewData={subject:{id:2,name:'用户'},revision:{id:3,version:1},
    rules:[{rule_id:'H',result:'satisfied',decision:{decision:'confirm_issue',reason:'内容仍有问题',resolves:false}}],
    acceptance:{ready:false,accepted:false,blockers:['H 需补正']}};
  app.paintReview(1,2);
  assert.doesNotMatch(els.rv.innerHTML,/RULE H/);
  assert.match(els.rv.innerHTML,/决定只针对：当前这项要求/);
  assert.match(els.rv.innerHTML,/确认问题（需补正）/);
  assert.match(els.rv.innerHTML,/请选择核对结论/);
  assert.match(els.rv.innerHTML,/人工核对通过/);
  context.fetch=async()=>response({summary:'待补正',buckets:{blocking:['H']},details:app.state.reviewData.rules});
  await app.loadMyResults();
  assert.match(els['my-results'].innerHTML,/需要一起处理（1）/);
  assert.match(els['my-results'].innerHTML,/内容仍有问题/);
  assert.doesNotMatch(els['my-results'].innerHTML,/已按要求核对完成 1 项/);
});
test('human resolution moves raw unknown out of submitter todo without hiding evidence', async () => {
  const {app,els,context} = setup();
  context.fetch=async()=>response({summary:'规则通过（待人工验收）',buckets:{},details:[{
    rule_id:'R',result:'unknown',explanation:'机器原先未读到',evidence:[{quote:'原文已核对'}],
    decision:{decision:'confirm_pass',reason:'人工核对原文通过',resolves:true}}]});
  await app.loadMyResults();
  assert.doesNotMatch(els['my-results'].innerHTML,/待办事项/);
  assert.match(els['my-results'].innerHTML,/已按要求核对完成 1 项/);
  assert.match(els['my-results'].innerHTML,/人工核对原文通过/);
  assert.match(els['my-results'].innerHTML,/系统当时还不能确认这一项/);
  assert.match(els['my-results'].innerHTML,/组织者后续人工核对结果/);
});


test('eligibility submit uses its own conclusion, reason, expiry and reviewed member scope', async () => {
  const {app,context,els} = setup();
  for (const id of ['eligibility-result','eligibility-reason','eligibility-exp','eligibility-submit']) els[id]=element();
  app.state.reviewContext=reviewScope('f'); app.state.reviewData={revision:{id:9},eligibility:{members_hash:'verified-members'}};
  els['eligibility-result'].value='eligible'; els['eligibility-reason'].value='独立资格依据';
  els['eligibility-exp'].value='2099-01-01T00:00:00Z';
  els['dc-rule'].value='rule-A'; els['dc-reason'].value='其他规则理由';
  let sent; context.fetch=async(_,options)=>{sent=options.body;return response({detail:'登记成员已变化'},409);};
  await app.submitDecision(1,2,'eligibility');
  assert.equal(sent.get('decision'),'eligibility'); assert.equal(sent.get('eligibility'),'eligible');
  assert.equal(sent.get('reason'),'独立资格依据'); assert.equal(sent.get('scope_rule_id'),'');
  assert.equal(sent.get('expected_members_hash'),'verified-members'); assert.equal(sent.get('expected_current_revision'),'9');
  assert.equal(sent.get('expires_at'),'2099-01-01T00:00:00Z');
  assert.equal(els['eligibility-reason'].value,'独立资格依据'); assert.equal(els['dc-reason'].value,'其他规则理由');
  assert.equal(els['eligibility-submit'].disabled,true);
});
test('qualification reasons are cached independently and a late save cannot erase another review', async () => {
  const {app,context,els} = setup();
  for (const id of ['eligibility-result','eligibility-reason','eligibility-exp','eligibility-submit']) els[id]=element();
  app.state.reviewContext=reviewScope('f'); app.state.reviewData={revision:{id:9},eligibility:{members_hash:'members'}};
  els['eligibility-result'].value='pending'; els['eligibility-reason'].value='还需核实';
  app.cacheReviewDraft(); assert.equal(app.state.reviewDrafts[reviewScope('f')].eligibility['eligibility-reason'],'还需核实');
  const pending=deferred(); context.fetch=async()=>pending.promise;
  const save=app.submitDecision(1,2,'eligibility'); app.state.reviewContext=reviewScope('0');
  els['eligibility-reason'].value='另一主体的理由'; pending.resolve(response({decision_id:1})); await save;
  assert.equal(els['eligibility-reason'].value,'另一主体的理由');
});
test('qualification filters separate pending verification from a completed negative conclusion', () => {
  const {app}=setup(); app.state.wbTask={mode:'open'};
  assert.equal(app.wbMatches({formal:true,summary:'规则通过',eligibility:{required:true,status:'pending'}},'todo'),true);
  assert.equal(app.wbMatches({eligibility:{required:true,status:'ineligible'}},'eligibility'),false);
  assert.equal(app.wbMatches({eligibility:{required:true,status:'pending'}},'eligibility'),true);
});


test('workbench next step prioritizes confirmed issues and links directly to scoped review', () => {
  const {app} = setup();
  const rows = [
    {name:'名单外同学', subject_id:1, in_roster:false, formal:true, summary:'待补正', buckets:{blocking:['R0']}},
    {name:'陈同学', subject_id:3, in_roster:true, formal:true, summary:'待人工', buckets:{unknown:['R2']}},
    {name:'林同学', subject_id:8, in_roster:true, formal:true, summary:'待补正', buckets:{blocking:['R1']}},
    {name:'免交者', subject_id:9, in_roster:true, formal:true, exempt:true, summary:'待补正', buckets:{blocking:['R0']}},
  ];
  const task = {id:7, mode:'roster', subject_kind:'individual'};
  const next = app.chooseWorkbenchNextStep(rows, task);
  assert.equal(next.name, '林同学');
  assert.equal(next.action, '打开复核');
  assert.equal(next.href, '#/review/7/8');
  assert.match(app.workbenchNextStepHtml(next, 7), /先看看林同学的材料/);
});
test('workbench next step does not present incomplete work as failure or completion', () => {
  const {app} = setup();
  const next = app.chooseWorkbenchNextStep([{name:'赵同学', subject_id:4, formal:true,
    summary:'检查未完成', buckets:{incomplete:['R-OCR']}}], {id:7, subject_kind:'individual'});
  assert.equal(next.tone, 'warn');
  assert.match(next.detail, /未完成不等于不通过/);
  assert.match(next.href, /#\/review\/7\/4/);
});
test('workbench next step falls back to missing, delivery, then neutral states', () => {
  const {app} = setup();
  const missing = app.chooseWorkbenchNextStep([{name:'孙同学', in_roster:true, formal:false}], {id:7, mode:'roster'});
  assert.equal(missing.kind, 'filter-missing');
  const delivery = app.chooseWorkbenchNextStep([{name:'张同学', in_roster:true, formal:true, acceptance:'accepted'}], {id:7, mode:'roster'});
  assert.equal(delivery.kind, 'delivery');
  const neutral = app.chooseWorkbenchNextStep([], {id:7, mode:'roster'});
  assert.equal(neutral.kind, 'roster');
  const outOfRoster = app.chooseWorkbenchNextStep([{name:'外部报名', in_roster:false, formal:false}], {id:7, mode:'roster'});
  assert.equal(outOfRoster.kind, 'roster');
});
test('formal receipt retains its submitted file list separately from the correction draft', () => {
  const {app} = setup();
  const html=app.receiptFilesHtml({formal:true,revision:1,files:[
    {name:'报名单 <final>.txt',slot:'活动报名单',size:17},
  ]});
  assert.match(html,/正式版本 v1 已提交材料/);
  assert.match(html,/报名单 &lt;final&gt;\.txt/);
  assert.match(html,/活动报名单 · 17 B/);
  assert.equal(app.receiptFilesHtml({formal:false,files:[{name:'draft.txt'}]}),'');
});
test('delivery history restores old snapshot manifests and only offers available files', async () => {
  const {app,context,els}=setup();app.state.deliveryTaskId=7;
  context.localStorage.setItem('ff_org_token','test-owner-token');
  const requested=[];let page=0;
  context.fetch=async url=>{
    requested.push(url);
    if(page++>0)return response({has_more:false,snapshots:[]});
    return response({has_more:true,next_offset:20,snapshots:[
      {snapshot_id:12,kind:'formal',created_at:'2026-10-22T04:00:00Z',totals:{subjects:3,included:2,excluded:1},exports:[
        {job_id:44,status:'success',error:'',created_at:'2026-10-22T04:01:00Z',csv_available:true,zip_available:true}]},
      {snapshot_id:11,kind:'preview',created_at:'2026-10-21T04:00:00Z',totals:{subjects:3,included:3,excluded:0},exports:[
        {job_id:40,status:'failed',error:'原件 <missing>',created_at:'2026-10-21T04:01:00Z',csv_available:false,zip_available:false}]},
    ]});
  };
  await app.loadDeliveryHistory(7);
  assert.equal(requested[0],'/api/tasks/7/snapshots?limit=20&offset=0');
  assert.match(els['delivery-history-list'].innerHTML,/正式快照 #12/);
  assert.match(els['delivery-history-list'].innerHTML,/downloadFile\('\/api\/exports\/44\/csv/);
  assert.match(els['delivery-history-list'].innerHTML,/查看固定清单/);
  assert.match(els['delivery-history-list'].innerHTML,/加载更早记录/);
  assert.match(els['delivery-history-list'].innerHTML,/原件 &lt;missing&gt;/);
  assert.doesNotMatch(els['delivery-history-list'].innerHTML,/downloadFile\('\/api\/exports\/40/);
  assert.doesNotMatch(els['delivery-history-list'].innerHTML,/重新生成 CSV \+ ZIP/);
  await app.loadDeliveryHistory(7,true);
  assert.equal(requested[1],'/api/tasks/7/snapshots?limit=20&offset=20');
  assert.doesNotMatch(els['delivery-history-list'].innerHTML,/加载更早记录/);
});
test('delivery snapshot status makes repeat fixation and immutable history explicit', () => {
  const {app} = setup();
  const empty = app.deliverySnapshotStatusHtml([]);
  assert.match(empty, /还没有固定快照/);
  assert.match(empty, /先生成一份快照/);
  const current = app.deliverySnapshotStatusHtml([{snapshot_id:12, kind:'formal', created_at:'2026-10-22T04:00:00Z'}]);
  assert.match(current, /最近固定：正式快照 #12/);
  assert.match(current, /再次固定会生成新快照，旧包保持不变/);
  assert.match(source, /id="delivery-snapshot-status"/);
  assert.match(styleSource, /\.delivery-current-status \{/);
});
test('an old snapshot can be reopened from its immutable manifest', async () => {
  const {app,context,els}=setup();
  context.localStorage.setItem('ff_org_token','test-owner-token');
  context.fetch=async url=>{
    assert.equal(url,'/api/snapshots/12');
    return response({snapshot_id:12,manifest:JSON.stringify({kind:'formal',totals:{subjects:1,included:1,excluded:0},blueprint_version_id:2,
      entries:[{name:'张三 <组>',revision:1,included:true,excluded_reason:'',files:[{file_id:'f1'}]}]}),
      agent_evidence:{schema_version:1,snapshot_id:12,entries:[{subject_id:3,revision_id:8,included:true,run:{status:'success',execution_mode:'offline_replay',tool_trace:[{tool:'review.rule',sequence:1}],rule_results:{satisfied:2}}}]}});
  };
  await app.inspectSnapshot(12);
  assert.match(els['snap-view'].innerHTML,/SNAPSHOT #12/);
  assert.match(els['snap-view'].innerHTML,/张三 &lt;组&gt;/);
  assert.match(els['snap-view'].innerHTML,/Agent 运行证据/);
  assert.match(els['snap-view'].innerHTML,/1 离线 \/ 0 实时/);
  assert.match(els['snap-view'].innerHTML,/人工发布门仍然有效/);
});
test('agent evidence summary keeps failed and unbound runs on the human handoff path', () => {
  const {app} = setup();
  const html = app.agentEvidenceSummaryHtml({entries:[
    {subject_id:1,run:{status:'failed',execution_mode:'live',tool_trace:[],rule_results:{unknown:1}}},
    {subject_id:2,run:null},
  ]});
  assert.match(html,/有运行失败/);
  assert.match(html,/仍需要人工接手/);
  assert.match(html,/部分主体没有可绑定的检查运行/);
  assert.match(html,/材料正文、提示词、工具参数和隐藏推理不会出现在这里/);
});
test('failed delivery export exposes no CSV or ZIP download controls', async () => {
  const {app,context,els}=setup();
  context.fetch=async()=>response({job_id:7,status:'failed',error:'快照材料缺失',csv:'',zip:''});
  await app.runExport(3);
  assert.equal(app.state.lastJob.status,'failed');
  assert.match(els.dl.innerHTML,/未生成可下载文件/);
  assert.doesNotMatch(els.dl.innerHTML,/downloadFile/);
  assert.match(els.flash.innerHTML,/快照材料缺失/);
});
test('submitter-facing result cards explain status in calm plain language without changing the result', () => {
  const {app} = setup();
  const issue = app.ruleCard({rule_id:'R-01', result:'issue', severity:'blocking',
    requirement:{statement:'报告期次须与任务一致', requirement_source:'报名说明'},
    explanation:'材料写的是 2026 秋季第 2 期。', next_step:'请核对报告封面上的期次，并替换为第 1 期。', evidence:[{locator:'p.1', method:'llm', quote:'2026 秋季第 2 期'}]});
  assert.match(issue, /这项材料还需要核对；只针对这条收集要求，不是在评价你本人/);
  assert.match(issue, /可以这样处理/);
  assert.match(issue, /请核对报告封面上的期次/);
  assert.match(issue, /2026 秋季第 2 期/);
  assert.match(issue, /模型核对/);
  assert.doesNotMatch(issue, / · llm\]/);
  assert.match(issue, /验收前需要处理/);
  assert.doesNotMatch(issue, /R-01/);
  const satisfied = app.ruleCard({rule_id:'R-02', result:'satisfied', severity:'blocking',
    requirement:{statement:'活动日期符合要求', requirement_source:'活动日期为 2026 年 11 月 14 日'},
    next_step:'请继续提交身份证和紧急联系人电话。'});
  assert.doesNotMatch(satisfied, /身份证/);
  assert.doesNotMatch(satisfied, /紧急联系人/);
  const unknown = app.ruleCard({rule_id:'R-03', result:'unknown', severity:'blocking',
    requirement:{statement:'姓名清晰可读', requirement_source:'材料需包含本人姓名'},
    explanation:'模型结论缺少可在原文定位的证据，按规则降级为 unknown', next_step:'转人工复核'});
  assert.match(unknown, /不会把没读到或证据不足当成缺失/);
  assert.match(unknown, /请联系组织者帮你确认/);
  assert.doesNotMatch(unknown, /模型结论缺少/);
  const failed = app.ruleCard({rule_id:'R-04', result:'failed', severity:'blocking',
    requirement:{statement:'材料页数符合要求', requirement_source:'材料页数不超过 10 页'},
    explanation:'网关连接失败: secret host detail', next_step:'检查服务暂不可用'});
  assert.match(failed, /这次检查没能完成，材料已经收到/);
  assert.doesNotMatch(failed, /网关连接失败|secret host detail/);
  const failedGuidance = app.submitterGuidance({result:'failed'});
  assert.match(failedGuidance, /检查没能完成，材料已经收到；这不代表不合格/);
  const unknownGuidance = app.submitterGuidance({result:'unknown'});
  assert.match(unknownGuidance, /这不代表缺失/);
});
test('incomplete checks are labeled neutrally across submitter and organizer review', () => {
  const {app,els} = setup();
  const failedRule = {rule_id:'R-05', result:'failed', severity:'blocking',
    requirement:{statement:'材料页数符合要求'}, explanation:'检查没有完成'};
  const submitterCard = app.ruleCard(failedRule);
  assert.match(submitterCard, /badge info">检查未完成/);
  assert.doesNotMatch(submitterCard, /badge bad">失败/);

  app.state.reviewData = {subject:{id:2,name:'赵同学'}, revision:{id:9,version:1},
    run:{id:4,status:'success'}, rules:[failedRule], acceptance:{ready:false,accepted:false,blockers:['检查未完成']}};
  app.paintReview(1,2);
  assert.match(els.rv.innerHTML, /<span>检查未完成<\/span>/);
  assert.match(els.rv.innerHTML, /badge info">检查未完成/);
  assert.doesNotMatch(els.rv.innerHTML, /<span>失败<\/span>/);

  const runSummary = app.agentRunCard({status:"success", result_summary:{failed:1}}, [failedRule]);
  assert.match(runSummary, /agent-result-chip info">未完成 <b>1<\/b>/);
  assert.doesNotMatch(runSummary, /agent-result-chip warn">未完成/);
});
test('agent run result chips follow effective human decisions', () => {
  const {app} = setup();
  const html = app.agentRunCard({status:'success', result_summary:{satisfied:1, manual_pending:1}}, [
    {rule_id:'R-01', result:'satisfied', requirement:{statement:'程序项'}},
    {rule_id:'R-02', result:'manual_pending', decision:{decision:'confirm_pass', resolves:true}, requirement:{statement:'人工已确认项'}},
  ]);
  assert.match(html, /已满足 <b>2<\/b>/);
  assert.doesNotMatch(html, /人工项 <b>1<\/b>/);
});
test('completed review evidence does not present rule severity as a current status', () => {
  const {app,els} = setup();
  app.state.reviewData = {subject:{id:2,name:'赵同学'}, revision:{id:9,version:1},
    run:{id:4,status:'success'}, rules:[{rule_id:'R-done', result:'satisfied', severity:'blocking',
      requirement:{statement:'材料格式符合要求', executor:'deterministic'}}],
    acceptance:{ready:true,accepted:false,blockers:[]}};
  app.paintReview(1,2);
  const meta = els.rv.innerHTML.match(/<div class="evidence-meta">([\s\S]*?)<\/div>/)?.[1] || '';
  assert.match(meta, /程序校验/);
  assert.doesNotMatch(meta, /阻塞验收/);
});
test('review makes deterministic, semantic, and human handoffs visible without implying every rule used a model call', () => {
  const {app} = setup();
  const html = app.agentRunCard({status:'success', pages_read:2, llm_calls_used:1,
    coverage:{files:[{name:'report.pdf',method:'text'}]}}, [
    {rule_id:'D-01',requirement:{executor:'deterministic',statement:'姓名已经填写'}},
    {rule_id:'S-01',requirement:{executor:'semantic',statement:'活动日期需一致'}},
    {rule_id:'H-01',requirement:{executor:'human_only',statement:'组织者人工核对'}},
  ], [
    {tool:'review.deterministic_rule',rule_id:'D-01',status:'satisfied',duration_ms:12,sequence:1,tool_version:'v1'},
    {tool:'review.semantic_rule',rule_id:'S-01',status:'unknown',duration_ms:800,simulation:true,sequence:2,tool_version:'v1'},
  ]);
  assert.match(html, /程序核验/);
  assert.match(html, /语义审核/);
  assert.match(html, /人工接手/);
  assert.match(html, /1 项规则 · 预算占用 1/);
  assert.match(html, /不会自行发布/);
  assert.match(html, /本次运行记录（2 项）/);
  assert.match(html, /<details class="card agent-run-card" open>/);
  assert.match(html, /姓名已经填写/);
  assert.match(html, /待人工确认/);
  assert.match(html, /第 1 步/);
  assert.match(html, /第 2 步/);
  assert.match(html, /· v1/);
  assert.doesNotMatch(html, /D-01|S-01/);
  assert.match(html, /演示模式：语义结果由离线脚本按样例生成，没有调用实时模型/);
  assert.match(app.agentRunCard({status:'success'}, []).toString(), /历史运行/);
});
test('team qualification metrics use team units and never call pending qualification no todos', () => {
  const {app,els}=setup(); els['wb-stats']=element();els['wb-list']=element();
  Object.assign(app.state,{wbTask:{mode:'open',subject_kind:'team',status:'collecting'},wbTaskId:1,
    wbCounts:{eligibility_pending:1},wbRows:[{subject_id:2,name:'示例队',formal:true,
    summary:'规则通过',eligibility:{required:true,status:'pending'}}]});
  app.paintWorkbench();
  assert.match(els['wb-stats'].innerHTML,/<span>资格待核（队）<\/span><strong>01<\/strong>/);
  assert.match(els['wb-list'].innerHTML,/核实资格后再验收/);
  assert.doesNotMatch(els['wb-list'].innerHTML,/暂无待办/);
});


test('a no-rule review shows qualification directly rather than an empty mobile column', () => {
  const {app,els}=setup(); app.state.reviewData={subject:{id:2,name:'示例队'},revision:{id:9,version:1},
    run:{status:'success'},rules:[],eligibility:{required:true,status:'pending',members:['甲','乙']},
    acceptance:{ready:false,accepted:false,blockers:['资格待核']}};
  app.paintReview(1,2);
  assert.match(els.rv.innerHTML,/no-rule-layout/);
  assert.doesNotMatch(els.rv.innerHTML,/review-list-col/);
  assert.match(els.rv.innerHTML,/独立核实资格/);
  assert.match(els.rv.innerHTML,/当前登记成员：甲、乙/);
  assert.match(els.rv.innerHTML,/review-workflow/);
  assert.match(els.rv.innerHTML,/本版本无规则/);
  assert.doesNotMatch(els.rv.innerHTML,/可能尚未检查/);
});


function designSetup(sharedStorage=storage()) {
  const test=setup(sharedStorage), {app,els,context}=test;
  for(const id of ['chat-in','clar-0','clar-extra','chat-scroll','design-input-hint','design-recovery','draft-state','agent-request-status','publish-summary','publish-consent','publish-confirm','publish-error','publish-dialog'])els[id]=element();
  context.timers=[];context.timerId=0;
  context.setTimeout=(fn,ms)=>{const id=++context.timerId;context.timers.push({id,fn,ms});return id;};
  context.clearTimeout=id=>{context.timers=context.timers.filter(t=>t.id!==id);};
  els['publish-dialog'].showModal=()=>els['publish-dialog'].open=true;
  els['publish-dialog'].close=()=>els['publish-dialog'].open=false;
  context.localStorage.setItem('ff_org_token','test-org');
  Object.assign(app.state,{designToken:'test-org',designOwnerId:7,designTaskId:1,taskId:1,designBaseId:10,
    designEpoch:1,designQuestions:[{question:'截止？'}],designRenderedBase:10,bpId:10,draftStatus:'draft',
    designDirty:false,designBlocking:[],agentBusy:false,chat:[],draft:{blueprint:{fields:[{id:'name',label:'姓名'}],slots:[],rules:[]},clarifications:[{question:'截止？'}]}});
  return test;
}
function savedDesign(context) { return JSON.parse(context.sessionStorage.getItem('ff_design:7:1')); }
function updatedDesign() { return {blueprint_version_id:11,version:2,status:'draft',draft:{blueprint:{fields:[{id:'name',label:'姓名'}],slots:[],rules:[]},clarifications:[],warnings:[]}}; }
function completedAgentRequest(id='req-test-00000000000000001') {
  const result=updatedDesign();
  return {request_id:id,status:'completed',result:{...result, draft:{...result.draft,blueprint:{...result.draft.blueprint}}}};
}
function latestDesign() {
  const result=updatedDesign();
  return {...result, task:{id:1,name:'任务',owner_id:7,status:'draft',mode:'roster',subject_kind:'individual'},
    source_text:'原始要求', versions:[{id:11,version:2,status:'draft'}], history:[],
    blocking:[], advisories:[], published:null};
}

test('design progress treats a new draft as unpublished even with a published baseline', () => {
  const {app}=designSetup();
  app.state.designPublished={id:3,version:1,blueprint:{fields:[{id:'name',label:'姓名'}],slots:[],rules:[]}};
  app.state.llmConfigured=true;
  app.applyDraft({blueprint_version_id:11,version:2,status:'draft',draft:{blueprint:{fields:[{id:'name',label:'姓名'}],slots:[],rules:[]},clarifications:[]},blocking:[],advisories:[]});
  let html=app.designProgressHtml();
  assert.doesNotMatch(html, /<span class="badge ok">已发布<\/span>/);
  assert.match(html, /组织者确认后才会生效/);
  app.applyDraft({blueprint_version_id:11,version:2,status:'published',draft:{blueprint:{fields:[{id:'name',label:'姓名'}],slots:[],rules:[]},clarifications:[]},blocking:[],advisories:[]});
  html=app.designProgressHtml();
  assert.match(html, /<span class="badge ok">已发布<\/span>/);
});

test('unsent design inputs restore by owner, task and base version and block publication', () => {
  const {app,els,context}=designSetup(); els['chat-in'].value='未发送要求';els['clar-0'].value='11 月';
  app.cacheDesignInputs(); assert.equal(app.canPublishDesign(),false);
  els['chat-in'].value='';els['clar-0'].value='';app.restoreDesignInputs();
  assert.equal(els['chat-in'].value,'未发送要求');assert.equal(els['clar-0'].value,'11 月');
  app.state.designOwnerId=8;app.restoreDesignInputs();assert.equal(els['chat-in'].value,'');
  app.state.designOwnerId=7;app.state.designTaskId=2;app.restoreDesignInputs();assert.equal(els['clar-0'].value,'');
  assert.equal(savedDesign(context).versions['10'].composer,'未发送要求');
});
test('new blueprint does not silently inherit old clarification answers and offers explicit recovery', () => {
  const {app,els}=designSetup();els['chat-in'].value='旧要求';els['clar-0'].value='旧答案';app.cacheDesignInputs();
  app.state.designBaseId=11;app.state.designQuestions=[{question:'新的问题？'}];app.restoreDesignInputs();
  assert.equal(els['chat-in'].value,'');assert.equal(els['clar-0'].value,'');
  assert.match(els['design-recovery'].innerHTML,/旧答案/);
  app.recoverDesignInput('10');assert.match(els['chat-in'].value,/旧要求/);assert.match(els['chat-in'].value,/截止？：旧答案/);
  assert.equal(els['clar-0'].value,'');
});
test('repainting agent messages preserves partially entered clarification answers', () => {
  const {app,els}=designSetup();els['clar-0'].value='只回答了一半';app.paintChat();
  assert.equal(els['clar-0'].value,'只回答了一半');
});
test('design storage failure retains memory input and tells the user refresh is risky', () => {
  const {app,els,context}=designSetup();context.sessionStorage.setItem=()=>{throw new Error('quota');};
  els['chat-in'].value='内存要求';app.cacheDesignInputs();els['chat-in'].value='';app.restoreDesignInputs();
  assert.equal(els['chat-in'].value,'内存要求');assert.equal(app.state.designCacheFailed,true);
  assert.match(els['design-input-hint'].textContent,/刷新或关闭前请复制/);
});
test('successful composer request preserves clarification input it did not send', async () => {
  const {app,els,context}=designSetup();els['chat-in'].value='新增字段';els['clar-0'].value='还没发送的答案';
  context.fetch=async(url,opts)=>url.endsWith('/agent-requests') ? response({request_id:opts.body.get('request_id'),status:'completed',result:updatedDesign()})
    : response(latestDesign());
  await app.runAgent('新增字段',{},'新增字段');
  const old=savedDesign(context).versions['10'];assert.equal(old.composer,'');assert.equal(old.answers['截止？'],'还没发送的答案');
  assert.match(els['design-recovery'].innerHTML,/还没发送的答案/);
});
test('successful clarification request preserves an unrelated unsent composer', async () => {
  const {app,els,context}=designSetup();els['chat-in'].value='另外的修改';els['clar-0'].value='11 月';
  context.fetch=async(url,opts)=>url.endsWith('/agent-requests') ? response({request_id:opts.body.get('request_id'),status:'completed',result:updatedDesign()})
    : response(latestDesign());
  await app.runAgent('截止？：11 月',{'截止？':'11 月'},'','clarifications');
  const old=savedDesign(context).versions['10'];assert.equal(old.composer,'另外的修改');assert.deepEqual(old.answers,{});
  assert.match(els['design-recovery'].innerHTML,/另外的修改/);
});
test('design Agent request is durably queued before polling and keeps the same idempotency key', async () => {
  const {app,els,context}=designSetup();els['chat-in'].value='收集姓名和活动日期';
  const calls=[];
  context.fetch=async(url,opts)=>{
    calls.push({url,opts});
    if(url.endsWith('/agent-requests')) return response({request_id:opts.body.get('request_id'),status:'queued'});
    if(url.endsWith('/agent-requests/'+app.state.agentRequest.requestId)) return response({request_id:app.state.agentRequest.requestId,status:'running'});
    throw new Error(`unexpected ${url}`);
  };
  await app.runAgent('收集姓名和活动日期',{},'收集姓名和活动日期');
  const requestId=app.state.agentRequest.requestId;
  assert.match(els['agent-request-status'].innerHTML,/已收到，正在等候处理/);
  assert.equal(savedDesign(context).pendingAgentRequest.requestId,requestId);
  assert.equal(calls[0].opts.body.get('base_blueprint_id'),'10');
  assert.ok(context.timers.length);
  app.retryAgent();
  assert.equal(app.state.agentRequest.requestId,requestId);
  assert.equal(calls.at(-1).opts.body.get('request_id'),requestId);
});
test('design Agent resumes after a page reload by checking the saved request id, not resubmitting', async () => {
  const shared=storage(), first=designSetup(shared), firstCalls=[];
  first.els['chat-in'].value='名单内同学提交团课报告';
  first.context.fetch=async(url,opts)=>{
    firstCalls.push({url,opts});
    if(url.endsWith('/agent-requests')) return response({request_id:opts.body.get('request_id'),status:'running'});
    if(url.includes('/agent-requests/')) return response({request_id:first.app.state.agentRequest.requestId,status:'running'});
    throw new Error(`unexpected ${url}`);
  };
  await first.app.runAgent('名单内同学提交团课报告',{},'名单内同学提交团课报告');
  const id=first.app.state.agentRequest.requestId;

  const reloaded=designSetup(shared), calls=[];
  reloaded.context.fetch=async(url,opts)=>{
    calls.push({url,opts});
    if(url.includes('/agent-requests/')) return response(completedAgentRequest(id));
    if(url==='/api/tasks/1/design') return response(latestDesign());
    throw new Error(`unexpected ${url}`);
  };
  reloaded.app.state.agentResumeStarted=false;
  await reloaded.app.resumePendingAgentRequest(reloaded.app.state.designEpoch,'test-org');
  assert.equal(reloaded.app.state.agentRequest,null);
  assert.equal(reloaded.app.state.bpId,11);
  assert.match(reloaded.els['chat-scroll'].innerHTML,/名单内同学提交团课报告/);
  assert.equal(calls.filter(x=>x.url.endsWith('/agent-requests')).length,0);
  assert.equal(savedDesign(reloaded.context).pendingAgentRequest,undefined);
});
test('stale design request reports latest-version conflict and requires explicit refresh', async () => {
  const {app,els,context}=designSetup();els['chat-in'].value='修改字段';
  context.fetch=async()=>response({detail:'草案已在另一页面更新；请回到最新版本核对后，再提交保留的修改内容'},409);
  await app.runAgent('修改字段',{},'修改字段');
  assert.equal(app.state.agentRequest.permanentError,true);
  assert.match(els['agent-request-status'].innerHTML,/草案已在别处更新/);
  assert.match(els['agent-request-status'].innerHTML,/刷新草案/);
  assert.doesNotMatch(els['agent-request-status'].innerHTML,/用原请求重试/);
  assert.equal(savedDesign(context).pendingAgentRequest.requestId,app.state.agentRequest.requestId);
});
test('missing model key preserves design input and avoids a futile retry prompt', async () => {
  const {app,els,context}=designSetup();
  els['chat-in'].value='收集春季活动报名材料';
  context.fetch=async(url)=>{
    if(url.endsWith('/agent-requests')) return response({request_id:app.state.agentRequest.requestId,
      status:'failed',error:'未配置模型密钥'});
    throw new Error(`unexpected ${url}`);
  };

  await app.runAgent('收集春季活动报名材料',{},'收集春季活动报名材料');

  assert.equal(els['chat-in'].value,'收集春季活动报名材料');
  assert.equal(savedDesign(context).versions['10'].composer,'收集春季活动报名材料');
  assert.match(app.state.chat.at(-1).mini,/可以先用下面的模板开始/);
  assert.match(app.state.chat.at(-1).mini,/配置好模型密钥后/);
  assert.equal(els['agent-request-status'].innerHTML,'');
  assert.doesNotMatch(els['chat-scroll'].innerHTML,/用原请求重试/);
});
test('design Agent resumes an ambiguous connection by looking up before re-enqueueing', async () => {
  const {app,els,context}=designSetup();els['chat-in'].value='恢复这条要求';app.cacheDesignInputs();
  let posts=0,gets=0;
  context.fetch=async(url,opts)=>{
    if(url.endsWith('/agent-requests')) {posts++;return response({request_id:opts.body.get('request_id'),status:'running'});}
    if(url.includes('/agent-requests/')) {gets++;return response({request_id:app.state.agentRequest.requestId,status:'running'});}
    throw new Error(`unexpected ${url}`);
  };
  await app.runAgent('恢复这条要求',{},'恢复这条要求');
  const requestId=app.state.agentRequest.requestId;
  app.state.agentRequest=null;app.state.agentBusy=false;app.state.agentResumeStarted=false;
  await app.resumePendingAgentRequest(app.state.designEpoch,'test-org');
  assert.equal(app.state.agentRequest.requestId,requestId);
  assert.equal(posts,1);assert.equal(gets,1);
});
test('design Agent reconnects with the same request id after an enqueue response is lost', async () => {
  const {app,els,context}=designSetup();els['chat-in'].value='断线后确认';
  let posts=0,gets=0;
  context.fetch=async(url,opts)=>{
    if(url.endsWith('/agent-requests')) {posts++; if(posts===1) throw new Error('network reset');
      return response({request_id:opts.body.get('request_id'),status:'queued'});}
    if(url.includes('/agent-requests/')) {gets++;return gets===1 ? response({detail:'还没有找到这次草案请求'},404) : response({request_id:app.state.agentRequest.requestId,status:'queued'});}
    throw new Error(`unexpected ${url}`);
  };
  await app.runAgent('断线后确认',{},'断线后确认');
  const id=app.state.agentRequest.requestId;
  assert.match(els['agent-request-status'].innerHTML,/即使网络中断/);
  assert.equal(savedDesign(context).pendingAgentRequest.requestId,id);
  await app.checkAgentRequestNow();
  assert.equal(posts,2);assert.equal(gets,1);
  assert.equal(context.timers.length,1);
});
test('design Agent pauses polling offline and resumes the same request on reconnect', async () => {
  const {app,els,context,windowListeners}=designSetup();els['chat-in'].value='网络恢复后继续确认';
  let posts=0,gets=0;
  context.navigator.onLine=false;
  context.fetch=async(url,opts)=>{
    if(url.endsWith('/agent-requests')) {posts++;throw new Error('network unavailable');}
    if(url.includes('/agent-requests/')) {gets++;return response({request_id:app.state.agentRequest.requestId,status:'queued'});}
    throw new Error(`unexpected ${url}`);
  };
  await app.runAgent('网络恢复后继续确认',{},'网络恢复后继续确认');
  const id=app.state.agentRequest.requestId;
  assert.equal(context.timers.length,0);
  assert.match(els['agent-request-status'].innerHTML,/网络已断开，等恢复后继续确认/);
  assert.equal(savedDesign(context).pendingAgentRequest.requestId,id);
  context.navigator.onLine=true;
  await windowListeners.online();
  assert.equal(posts,1);assert.equal(gets,1);
  assert.equal(app.state.agentRequest.requestId,id);
  assert.equal(context.timers.length,1);
});
test('failed and late design requests preserve input and cannot overwrite a new page', async () => {
  const {app,els,context}=designSetup();els['chat-in'].value='重试要求';els['clar-0'].value='未完答案';
  let calls=0;
  context.fetch=async(url,opts)=>{calls++; if(url.endsWith('/agent-requests')) return response({request_id:opts.body.get('request_id'),status:'failed',error:'网关断开；原草案没有更改。'}); throw new Error('Unexpected');};
  await app.runAgent('重试要求',{},'重试要求');
  assert.equal(els['chat-in'].value,'重试要求');assert.equal(els['clar-0'].value,'未完答案');
  const oldId=app.state.agentRequest.requestId;app.retryAgent();
  assert.equal(app.state.agentRequest.requestId,oldId);assert.equal(calls,2);
  const pending=deferred();context.fetch=async()=>pending.promise;
  const save=app.pollAgentRequest(app.state.agentRequest,app.state.designEpoch,'test-org','lookup');
  app.state.designEpoch++;app.state.bpId=77;els['chat-in'].value='另一页面';
  pending.resolve(response({request_id:oldId,status:'completed',result:updatedDesign()}));await save;
  assert.equal(app.state.bpId,77);assert.equal(els['chat-in'].value,'另一页面');
});
test('publication diff shows removed requirements and safely escapes descriptions', () => {
  const {app}=designSetup();const html=app.publishDiffHtml({published:{version:1,blueprint:{fields:[{id:'old',label:'<旧字段>',required:true}],slots:[],rules:[]}},
    draft:{blueprint:{fields:[],slots:[],rules:[],eligibility_required:true}},publish_impact:{fields:{removed:['old']},eligibility_required_changed:true}});
  assert.match(html,/相对已发布 v1/);assert.match(html,/移除字段/);assert.match(html,/&lt;旧字段&gt;/);assert.match(html,/资格前提：启用/);
});
test('design preview keeps published baseline changes visible for current and historical versions', () => {
  const {app}=designSetup();
  app.state.designPublished={id:3,version:1,blueprint:{fields:[{id:'name',label:'姓名'}],slots:[],rules:[]}};
  app.state.designPublishImpact={fields:{added:['email'],removed:[],changed:[]},slots:{added:[],removed:[],changed:[]},rules:{added:[],removed:[],changed:[]},summary:'fields+1'};
  app.state.draft={blueprint:{fields:[{id:'name',label:'姓名'},{id:'email',label:'<邮箱>'}],slots:[],rules:[]}};
  let html=app.designVersionImpactHtml();
  assert.match(html,/版本变化/);assert.match(html,/当前草案相对已发布 v1 的变化/);assert.match(html,/新增字段/);assert.match(html,/&lt;邮箱&gt;/);
  app.state.viewingVersion={id:2,version:2};
  app.state.viewingPublished=app.state.designPublished;
  app.state.viewingImpact=app.state.designPublishImpact;
  html=app.designVersionImpactHtml();
  assert.match(html,/v2 相对已发布 v1 的变化/);
});
test('publication submits reviewed baseline and locks the dialog after a competing publish', async () => {
  const {app,els,context}=designSetup();const fresh={...updatedDesign(),blueprint_version_id:10,published:{id:3,version:1,blueprint:{fields:[],slots:[],rules:[]}},publish_impact:{fields:{added:['name']}}};
  context.fetch=async()=>response(fresh);await app.publishBp(1);
  assert.equal(els['publish-dialog'].open,true);assert.equal(app.state.publishReview.publishedId,3);
  els['publish-consent'].checked=true;let sent;
  context.fetch=async(_,opts)=>{sent=opts.body;return response({detail:'已发布版本已变化'},409);};await app.confirmPublish();
  assert.equal(sent.get('expected_published_id'),'3');assert.equal(app.state.publishReview,null);
  assert.equal(els['publish-confirm'].disabled,true);assert.match(els['publish-error'].textContent,/已变化/);
});
test('viewing or reusing history cannot directly publish a frozen blueprint', () => {
  const {app}=designSetup();app.state.viewingVersion={id:3};assert.equal(app.canPublishDesign(),false);
  app.state.viewingVersion=null;app.state.designNeedsRevision=true;assert.equal(app.canPublishDesign(),false);
});


test('loading historical preview locks agent edits until the version response settles', async () => {
  const {app,context}=designSetup();const pending=deferred();let requests=0;
  context.fetch=async()=>{requests++;return pending.promise;};
  const loading=app.loadDesignVersion(1);assert.equal(app.state.agentBusy,true);
  await app.runAgent('不应与读版本并发',{},'修改');assert.equal(requests,1);
  pending.resolve(response({...updatedDesign(),blueprint_version_id:1,version:1,status:'published',source_text:'历史原始要求'}));await loading;
  assert.equal(app.state.agentBusy,false);assert.equal(app.state.viewingVersion.id,1);assert.equal(app.canPublishDesign(),false);
  app.useVersionAsBase();assert.equal(app.state.requirement,'历史原始要求');assert.equal(app.canPublishDesign(),false);
});

const reviewScope = c => c.repeat(64);
function reviewPage(scope, subject = 2, version = 1) {
  return {review_context:scope, subject:{id:subject,name:'主体'},revision:{id:40+version,version,receipt:'R'},
    members:[{id:1,name:'成员'}], rules:[{rule_id:'A',result:'manual_pending'}, {rule_id:'B',result:'unknown'}],
    acceptance:{ready:true,accepted:false,blockers:[]}};
}
async function openReview(env, page) {
  env.context.fetch=async()=>response(page);
  await env.app.viewReview(1,page.subject.id);
}
test('input is persisted immediately; a new VM restores both reasons after refresh', async () => {
  const shared=storage(), first=setup(shared), page=reviewPage(reviewScope('a'));
  await openReview(first,page);
  first.els['dc-type'].value='approve_exception';first.els['dc-reason'].value='规则依据';
  first.els['dc-exp'].value='2026-12-31T00:00:00Z';first.els['acceptance-reason'].value='独立验收依据';
  first.els['dc-reason'].listeners.input();
  const next=setup(shared);await openReview(next,page);
  assert.equal(next.els['dc-reason'].value,'规则依据');
  assert.equal(next.els['dc-type'].value,'approve_exception');
  assert.equal(next.els['acceptance-reason'].value,'独立验收依据');
  assert.match(next.els['review-draft-status'].textContent,/已恢复/);
  next.els['dc-reason'].value='';next.els['dc-reason'].listeners.input();
  const cleared=setup(shared);await openReview(cleared,page);
  assert.equal(cleared.els['dc-reason'].value,'');
  assert.equal(cleared.els['acceptance-reason'].value,'独立验收依据');
});
test('different account, subject, revision, blueprint, member and run contexts never restore a reason', async () => {
  const shared=storage(), first=setup(shared);
  await openReview(first,reviewPage(reviewScope('a')));
  first.els['dc-reason'].value='旧范围';first.els['acceptance-reason'].value='旧验收';
  first.els['dc-reason'].listeners.input();
  for (const scope of ['b','c','d','e','f','0']) {
    const next=setup(shared);await openReview(next,reviewPage(reviewScope(scope),3,2));
    assert.equal(next.els['dc-reason'].value,'');assert.equal(next.els['acceptance-reason'].value,'');
  }
});
test('restoration never trusts a cached rule scope or decision type', async () => {
  const shared=storage(), scope=reviewScope('a');
  shared.setItem('ff_review_drafts:v1',JSON.stringify({[scope]:{updatedAt:Date.now(),activeRule:'A',
    rules:{A:{'dc-rule':'B','dc-type':'accept_current','dc-reason':'保留文字'}},acceptanceReason:'验收'}}));
  const env=setup(shared);await openReview(env,reviewPage(scope));
  assert.notEqual(env.els['dc-rule'].value,'B');assert.notEqual(env.els['dc-type'].value,'accept_current');
  assert.equal(env.els['dc-reason'].value,'保留文字');
});
test('expired or malformed drafts are ignored; unavailable storage warns and retains memory', async () => {
  const scope=reviewScope('a');
  for (const raw of ['{broken', 'null', '[]', JSON.stringify({[scope]:{updatedAt:1,rules:{A:{'dc-reason':'expired'}}}})]) {
    const shared=storage();shared.setItem('ff_review_drafts:v1',raw);
    const env=setup(shared);await openReview(env,reviewPage(scope));assert.equal(env.els['dc-reason'].value,'');
  }
  const env=setup();await openReview(env,reviewPage(scope));
  env.context.sessionStorage.setItem=()=>{throw Error('unavailable');};
  env.els['dc-reason'].value='仍在内存';env.els['dc-reason'].listeners.input();
  assert.equal(env.app.state.reviewDrafts[scope].rules.A['dc-reason'],'仍在内存');
  assert.match(env.els['review-draft-status'].textContent,/请勿刷新/);
});
test('explicit discard clears only current context and survives reload', async () => {
  const shared=storage(), env=setup(shared), scope=reviewScope('a');
  await openReview(env,reviewPage(scope));env.els['dc-reason'].value='清除我';env.app.cacheReviewDraft();
  env.app.discardReviewDraft(1,2);
  const next=setup(shared);await openReview(next,reviewPage(scope));assert.equal(next.els['dc-reason'].value,'');
});
test('success clears only submitted reason; acceptance and other rules remain after reload', async () => {
  const shared=storage(), env=setup(shared), page=reviewPage(reviewScope('a'));
  await openReview(env,page);env.els['dc-type'].value='approve_exception';env.els['dc-reason'].value='提交我';
  env.els['acceptance-reason'].value='留给验收';env.app.cacheReviewDraft();
  let sent;env.context.fetch=async(url,opts)=>{
    if(opts?.method==='POST'){sent=new URLSearchParams(opts.body);return response({decision_id:1});}
    return response(page);
  };
  await env.app.submitDecision(1,2);
  assert.equal(sent.get('expected_review_context'),page.review_context);
  const next=setup(shared);await openReview(next,page);
  assert.equal(next.els['dc-reason'].value,'');assert.equal(next.els['acceptance-reason'].value,'留给验收');
});
test('logout removes persisted review notes', async () => {
  const env=setup();await openReview(env,reviewPage(reviewScope('a')));
  env.els['dc-reason'].value='私密理由';env.app.cacheReviewDraft();env.app.logout();
  assert.equal(env.context.sessionStorage.getItem('ff_review_drafts:v1'),null);
});

test('qualification drafts survive refresh and success clears only the submitted qualification reason', async () => {
  const shared=storage(), page=reviewPage(reviewScope('a'));
  page.eligibility={status:'pending',members:['演示成员'],members_hash:'members',required:true};
  const make=()=>{ const env=setup(shared); for(const id of ['eligibility-result','eligibility-reason','eligibility-exp','eligibility-submit'])env.els[id]=element(); return env; };
  const first=make();await openReview(first,page);
  first.els['eligibility-result'].value='eligible';first.els['eligibility-reason'].value='独立资格依据';
  first.els['eligibility-exp'].value='2026-12-31';first.els['dc-reason'].value='保留材料理由';
  first.els['acceptance-reason'].value='保留验收理由';first.els['eligibility-reason'].listeners.input();
  const next=make();await openReview(next,page);
  assert.equal(next.els['eligibility-reason'].value,'独立资格依据');assert.equal(next.els['eligibility-result'].value,'eligible');
  assert.equal(next.els['eligibility-exp'].value,'2026-12-31');
  next.context.fetch=async(_,opts)=>response(opts?.method==='POST'?{decision_id:1}:page);
  await next.app.submitDecision(1,2,'eligibility');
  const after=make();await openReview(after,page);
  assert.equal(after.els['eligibility-reason'].value,'');
  assert.equal(after.els['dc-reason'].value,'保留材料理由');assert.equal(after.els['acceptance-reason'].value,'保留验收理由');
});
test('late successful decision cannot clear newer edits even after reopening the same scope', async () => {
  const shared=storage(),env=setup(shared),page=reviewPage(reviewScope('a'));await openReview(env,page);
  env.els['dc-type'].value='confirm_pass';env.els['dc-reason'].value='旧请求理由';
  const pending=deferred();env.context.fetch=()=>pending.promise;
  const saving=env.app.submitDecision(1,2);
  env.app.state.reviewRequestId++;
  env.els['dc-reason'].value='重新打开后新写的理由';env.app.cacheReviewDraft();
  pending.resolve(response({decision_id:1}));await saving;
  const next=setup(shared);await openReview(next,page);
  assert.equal(next.els['dc-reason'].value,'重新打开后新写的理由');
});
test('conflict retains stored reasons through refresh of the old scope but not the new one', async () => {
  const shared=storage(),env=setup(shared),page=reviewPage(reviewScope('a'));await openReview(env,page);
  env.els['dc-type'].value='confirm_pass';env.els['dc-reason'].value='冲突未提交理由';
  env.context.fetch=async()=>response({detail:'scope changed'},409);await env.app.submitDecision(1,2);
  assert.equal(env.app.state.reviewConflict,true);
  const old=setup(shared);await openReview(old,page);assert.equal(old.els['dc-reason'].value,'冲突未提交理由');
  const fresh=setup(shared);await openReview(fresh,reviewPage(reviewScope('b')));assert.equal(fresh.els['dc-reason'].value,'');
});
test('late input events while a different scope is loading do not cache under either scope', async () => {
  const env=setup(),page=reviewPage(reviewScope('a'));await openReview(env,page);
  const oldListener=env.els['dc-reason'].listeners.input;
  env.els['dc-reason'].value='原主体理由';const pending=deferred();env.context.fetch=()=>pending.promise;
  const loading=env.app.viewReview(1,3);env.els['dc-reason'].value='过时事件';oldListener();
  pending.resolve(response(reviewPage(reviewScope('b'),3)));await loading;
  assert.equal(env.els['dc-reason'].value,'');
  assert.equal(env.app.state.reviewDrafts[page.review_context].rules.A['dc-reason'],'原主体理由');
});
test('review filter narrows the rule queue without changing the loaded evidence scope', async () => {
  const env=setup(),page=reviewPage(reviewScope('a'));
  page.rules=[{rule_id:'A',result:'unknown'},{rule_id:'B',result:'satisfied'},{rule_id:'C',result:'manual_pending'}];
  await openReview(env,page);
  env.app.setReviewFilter('pending',1,2);
  assert.equal(env.app.state.reviewFilter,'pending');
  assert.equal(env.app.state.reviewRule,'A');
  assert.match(env.els.rv.innerHTML,/只看待处理/);
  assert.match(env.els.rv.innerHTML,/C/);
  assert.doesNotMatch(env.els.rv.innerHTML,/data-review-rule="B"/);
  env.app.setReviewFilter('all',1,2);
  assert.equal(env.app.state.reviewFilter,'all');
  assert.match(env.els.rv.innerHTML,/data-review-rule="B"/);
});
test('review queue announces the selected rule and restores filter focus after repaint', async () => {
  const env=setup(),page=reviewPage(reviewScope('a'));
  page.rules=[{rule_id:'A',result:'unknown',severity:'blocking',requirement:{statement:'姓名需要人工核对'}},{rule_id:'B',result:'satisfied',severity:'advisory',requirement:{statement:'材料格式符合要求'}}];
  let focused=null;
  env.context.document.querySelector = selector => ({focus: () => {focused=selector;}});
  await openReview(env,page);
  assert.match(env.els.rv.innerHTML,/id="review-queue-status" role="status" aria-live="polite"/);
  assert.match(env.els.rv.innerHTML,/aria-label="姓名需要人工核对；待确认；阻塞验收"/);
  env.app.setReviewFilter('pending',1,2);
  assert.equal(focused,'[data-review-filter="pending"]');
  assert.match(env.els.rv.innerHTML,/当前显示 1 项待处理规则/);
  assert.match(source,/data-trace-filter="\$\{key\}"/);
  assert.match(source,/document\.querySelector\(`\[data-trace-filter=/);
});
test('review queue groups pending, problems, incomplete checks and satisfied rules', async () => {
  const env=setup(),page=reviewPage(reviewScope('a'));
  page.rules=[
    {rule_id:'pending',result:'unknown',requirement:{statement:'姓名需要人工核对'}},
    {rule_id:'problem',result:'issue',requirement:{statement:'报告期次不一致'}},
    {rule_id:'failed',result:'failed',requirement:{statement:'文件读取未完成'}},
    {rule_id:'done',result:'satisfied',requirement:{statement:'材料格式符合要求'}},
    {rule_id:'resolved-issue',result:'issue',decision:{decision:'confirm_pass',resolves:true},requirement:{statement:'人工已处理的问题'}},
    {rule_id:'resolved-failed',result:'failed',decision:{decision:'correct_false_positive',resolves:true},requirement:{statement:'人工已接手的未完成检查'}},
  ];
  await openReview(env,page);
  const html=env.els.rv.innerHTML;
  assert.match(html,/待人工/);assert.match(html,/有问题/);assert.match(html,/检查未完成/);assert.match(html,/已满足/);
  assert.ok(html.indexOf('待人工')<html.indexOf('有问题'));
  assert.ok(html.indexOf('<section class="review-group review-group-bad"')<html.indexOf('<section class="review-group review-group-info"'));
  assert.ok(html.indexOf('<section class="review-group review-group-info"')<html.indexOf('<section class="review-group review-group-ok"'));
  assert.match(html,/姓名需要人工核对/);assert.match(html,/文件读取未完成/);
  const doneStart=html.indexOf('aria-label="已满足"');
  assert.ok(doneStart > -1);
  assert.ok(html.indexOf('人工已处理的问题',doneStart) > doneStart);
  assert.ok(html.indexOf('人工已接手的未完成检查',doneStart) > doneStart);
});
test('review explains whether an incomplete semantic check needs configuration or a retry', async () => {
  const env = setup();
  const page = reviewPage(reviewScope('a'));
  page.rules = [{rule_id:'LLM-MISSING', result:'failed', severity:'blocking',
    explanation:'模型服务不可用，语义检查未完成：未配置 FORMFLOW_LLM_API_KEY'}];
  await openReview(env, page);
  assert.match(env.els.rv.innerHTML, /模型尚未配置，检查暂未开始/);
  assert.match(env.els.rv.innerHTML, /可以先按模板或人工核对/);
  assert.match(env.els.rv.innerHTML, /回任务列表查看模型配置提示/);

  page.rules[0].explanation = '模型服务不可用，语义检查未完成：网关 503';
  await openReview(env, page);
  assert.match(env.els.rv.innerHTML, /这次检查没有形成结论/);
  assert.match(env.els.rv.innerHTML, /可以稍后重新发起检查/);
  assert.match(env.els.rv.innerHTML, /回任务列表选择下一步/);
  assert.doesNotMatch(env.els.rv.innerHTML, /未配置 FORMFLOW_LLM_API_KEY/);
});
test('review evidence links only known current files and escapes long names and URLs', async () => {
  const env=setup(),page=reviewPage(reviewScope('a'));
  page.files=[{file_id:'file-1',name:'报告 <最终> 版本.txt',url:'/api/tasks/1/subjects/2/files/file-1?view=inline&x=<safe>',slot:'团课报告'}];
  page.rules=[{rule_id:'A',result:'issue',requirement:{statement:'材料需要核对'},evidence:[
    {file_id:'file-1',locator:'第 1 页',method:'文本',quote:'原文片段'},
    {file_id:'missing',locator:'第 2 页',method:'OCR',quote:'没有文件元数据'},
  ]}];
  await openReview(env,page);
  const html=env.els.rv.innerHTML;
  assert.match(html,/打开原件/);
  assert.match(html,/报告 &lt;最终&gt; 版本\.txt/);
  assert.match(html,/href="\/api\/tasks\/1\/subjects\/2\/files\/file-1\?view=inline&amp;x=&lt;safe&gt;"/);
  assert.match(html,/data-file-url="\/api\/tasks\/1\/subjects\/2\/files\/file-1\?view=inline&amp;x=&lt;safe&gt;"/);
  assert.match(html,/openReviewFile\(event,this\.dataset\.fileUrl\)/);
  assert.match(html,/target="_blank"/);assert.match(html,/rel="noreferrer"/);
  assert.equal((html.match(/evidence-file-link/g) || []).length, 1);
  assert.match(html,/没有文件元数据/);
});
test('long review queues keep all rules addressable and retain the next-pending shortcut', async () => {
  const env=setup(),page=reviewPage(reviewScope('a'));
  page.rules=Array.from({length:50},(_,i)=>({
    rule_id:`R-${String(i+1).padStart(2,'0')}`,
    result:i % 4 === 0 ? 'unknown' : i % 4 === 1 ? 'issue' : i % 4 === 2 ? 'failed' : 'satisfied',
    requirement:{statement:`第 ${i+1} 条需要核对的要求`,executor:i % 2 ? 'semantic' : 'deterministic'},
  }));
  await openReview(env,page);
  const html=env.els.rv.innerHTML;
  assert.equal((html.match(/class="review-rule-item/g) || []).length,50);
  assert.match(html,/下一待处理/);
  assert.match(html,/50 项/);
  assert.equal((html.match(/class="evidence-detail"/g) || []).length,1);
});
test('narrow review queues keep every rule group inside the single-column viewport', () => {
  assert.match(styleSource, /\.review-rules \{ flex-direction:column; overflow:visible; max-height:none; padding-bottom:0; \}/);
  assert.match(styleSource, /\.review-group \{ width:100%; min-width:0; \}/);
  assert.match(styleSource, /\.review-rule-item \{ width:100%; min-width:0; flex:none; \}/);
});
test('high zoom organizer controls can shrink instead of widening the page', () => {
  assert.match(styleSource, /@media\(max-width:420px\) \{[\s\S]*\.grid-chat > \*, \.wb-layout > \* \{ min-width:0; \}/);
  assert.match(styleSource, /\.draft-toolbar > div button \{ flex:1 1 0; min-width:0;/);
  assert.match(styleSource, /\.version-picker select \{ flex:1 1 auto; width:0; min-width:0; \}/);
  assert.match(styleSource, /\.task-filters \{ width:100%; min-width:0;/);
  assert.match(styleSource, /\.search-box input \{ flex:1 1 auto; width:0; min-width:0; \}/);
  assert.match(styleSource, /\.demo-route-signal-provenance \{ grid-template-columns:1fr; \}/);
});
test('demo review exposes the offline replay boundary and execution mode', async () => {
  const env=setup(), page=reviewPage(reviewScope('a'));
  env.els['review-retry']=element();
  page.run={id:17,status:'success',execution_mode:'offline_replay'};
  page.offline_replay={available:true,label:'离线脚本回放',description:'不调用外部模型'};
  await openReview(env,page);
  assert.match(env.els['review-retry'].innerHTML,/回放离线检查/);
  assert.match(env.els.rv.innerHTML,/离线脚本回放 · 不调用外部模型/);
  assert.match(env.els.rv.innerHTML,/沿同一 Skill、工具白名单、Harness 预算和审计链生成/);
});
test('next pending review skips completed and confirmed-issue rules; shortcuts explain the final gate', async () => {
test('submitter actions keep the primary action readable on narrow screens', () => {
  assert.match(source, /submit-action-reload/);
  assert.match(source, /submit-action-save/);
  assert.match(source, /submit-action-primary/);
  assert.match(source, /class="submit-primary-dock"><button class="submit-action-primary"/);
  assert.match(styleSource, /@media\(max-width:360px\)[\s\S]*submit-actions > button\.ghost\.sm\.submit-action-reload \{ min-height:42px/);
  assert.match(styleSource, /@media\(max-width:480px\)[\s\S]*submit-primary-dock \{[\s\S]*position:fixed/);
  assert.match(styleSource, /submit-primary-dock button \{[\s\S]*min-height:48px/);
});
test('submitter dock follows the visible viewport above a virtual keyboard', () => {
  const {context, document, visualViewport, viewportListeners} = setup();
  const style = document.documentElement.style;
  visualViewport.height = 500;
  context.syncSubmitDockViewport();
  assert.equal(style['--submit-dock-viewport-inset'], '344px');
  visualViewport.offsetTop = 24;
  context.syncSubmitDockViewport();
  assert.equal(style['--submit-dock-viewport-inset'], '320px');
  visualViewport.height = 844;
  visualViewport.offsetTop = 0;
  viewportListeners.resize();
  assert.equal(style['--submit-dock-viewport-inset'], '0px');
  assert.equal(typeof viewportListeners.scroll, 'function');
});
test('review summary explains when manual decisions are included in satisfied totals', async () => {
  const env=setup(), page=reviewPage(reviewScope('a'));
  page.rules=[{rule_id:'A',result:'satisfied',requirement:{statement:'机器已满足'}},{rule_id:'B',result:'issue',decision:{decision:'confirm_pass',resolves:true},requirement:{statement:'人工已处理'}}];
  await openReview(env,page);
  assert.match(env.els.rv.innerHTML,/已满足/);
  assert.match(env.els.rv.innerHTML,/含人工处理 1 项/);
});

test('review summary exposes the next organizer action before the long evidence flow', async () => {
  const env=setup(),page=reviewPage(reviewScope('a'));
  page.rules=[{rule_id:'A',result:'unknown',requirement:{statement:'需要人工核对的要求'}}];
  page.acceptance={ready:false,blockers:['还有一项待人工核对']};
  await openReview(env,page);
  assert.match(env.els.rv.innerHTML,/class="review-next-action review-next-action-warn"/);
  assert.match(env.els.rv.innerHTML,/先处理 1 项待人工核对/);
  assert.match(env.els.rv.innerHTML,/跳到下一项待处理/);
});

test('review summary points to acceptance when all material rules are handled', async () => {
  const env=setup(),page=reviewPage(reviewScope('a'));
  page.rules=[{rule_id:'A',result:'satisfied',requirement:{statement:'材料已满足'}}];
  page.acceptance={ready:true,blockers:[]};
  await openReview(env,page);
  assert.match(env.els.rv.innerHTML,/review-next-action-ok/);
  assert.match(env.els.rv.innerHTML,/材料规则已处理，可以验收本版本/);
  assert.match(env.els.rv.innerHTML,/查看验收/);
});
  const env=setup(),page=reviewPage(reviewScope('a'));
  page.rules=[{rule_id:'A',result:'unknown'},{rule_id:'B',result:'issue',decision:{decision:'confirm_issue'}},
    {rule_id:'C',result:'satisfied'},{rule_id:'D',result:'manual_pending'}];
  await openReview(env,page);env.els['dc-reason'].value='A 尚未提交';
  env.app.nextPendingReview(1,2);assert.equal(env.app.state.reviewRule,'D');
  env.app.nextPendingReview(1,2);assert.equal(env.app.state.reviewRule,'A');assert.equal(env.els['dc-reason'].value,'A 尚未提交');
  assert.match(env.els.rv.innerHTML,/2 项待决定/);assert.match(env.els.rv.innerHTML,/03<\/b> 验收版本/);
  assert.ok(env.els.rv.innerHTML.indexOf('id="review-decision"')<env.els.rv.innerHTML.indexOf('id="review-acceptance"'));
});
test('review route with no subject shows a Chinese empty state without making an API request', async () => {
  const env=setup();
  const result=await env.app.viewReview(1, undefined);
  assert.equal(result,false);
  assert.match(env.els.app.innerHTML,/先选一位提交者/);
  assert.match(env.els.app.innerHTML,/#\/workbench\/1/);
  assert.doesNotMatch(env.els.app.innerHTML,/Input should be a valid integer/);
});
test('a missing server review scope fails closed instead of reusing a revision-only draft', async () => {
  const env=setup(),page=reviewPage(null);await openReview(env,page);
  assert.equal(env.app.state.reviewContext,null);assert.match(env.els.rv.innerHTML,/复核范围缺失/);
});

test('creating a snapshot ignores repeated clicks while the request is pending', async () => {
  const env = setup();
  const button = env.els['create-snapshot'];
  button.innerHTML = '固定一份新快照';
  env.els['snap-kind'].value = 'formal';
  let resolveRequest;
  let requests = 0;
  env.context.fetch = () => {
    requests += 1;
    return new Promise(resolve => { resolveRequest = resolve; });
  };

  const first = env.context.createSnapshot(1);
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute('aria-busy'), 'true');
  await env.context.createSnapshot(1);
  assert.equal(requests, 1);

  resolveRequest({ok:false, status:503, text:async () => JSON.stringify({detail:'暂时不可用'})});
  await first;
  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute('aria-busy'), 'false');
  assert.equal(button.innerHTML, '固定一份新快照');
});
