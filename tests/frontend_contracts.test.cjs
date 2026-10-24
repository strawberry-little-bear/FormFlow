const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app/static/app.js'), 'utf8')
  .replace(/\nroute\(\);\s*$/, '\n');
const styleSource = fs.readFileSync(path.join(__dirname, '../app/static/style.css'), 'utf8');

function storage() {
  const data = new Map();
  return {getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,String(v)), removeItem: k => data.delete(k)};
}
function element(value = '') {
  return {value, innerHTML: '', textContent: '', dataset: {}, disabled: false, isConnected: true,
    classList: {toggle() {}}, attributes: {}, listeners: {},
    toggleAttribute(k, on) {this.attributes[k]=on;this.disabled=!!on;}, remove() {},
    setAttribute(k, v) {this.attributes[k] = v;}, addEventListener(k, fn) {this.listeners[k] = fn;},
    querySelectorAll() {return [];}, scrollIntoView() {this.scrolled = true;},
    insertAdjacentHTML(_, html) {this.innerHTML = html + this.innerHTML;},
    focus() {this.focused = true;}, setSelectionRange(start, end) {this.selectionStart = start; this.selectionEnd = end;}};
}
function setup(sharedStorage = storage()) {
  const els = Object.fromEntries(['sub', 'draft-hint', 'flash', 'receipt-out', 'decision-submit', 'presentation-toggle',
    'review-conflict', 'dc-type', 'dc-rule', 'dc-reason', 'dc-exp', 'acceptance-reason', 'acceptance-submit',
    'review-draft-status', 'submission-errors', 'field-error-name', 'dl', 'delivery-history-list', 'delivery-history-more-error', 'snap-view', 'app', 'rv', 'rv-name', 'my-results', 'submit-next-step', 'nav', 'role-label', 'wb-next-step', 'btn-logout', 'workspace-agent-mode', 'workspace-agent-status'].map(id => [id, element()]));
  const fields = [Object.assign(element('old'), {dataset: {field:'name'}})];
  els['field-name'] = fields[0];
  const body = Object.assign(element(), {dataset: {page: 'tasks'}});
  const document = {body, getElementById: id => els[id] || null,
    querySelectorAll: sel => sel === '[data-field]' ? fields : [], querySelector: () => null};
  const context = vm.createContext({document, localStorage: storage(), sessionStorage: sharedStorage,
    window: {addEventListener() {}}, location: {hash:'#/submit'}, Intl, URLSearchParams, FormData,
    setTimeout, clearTimeout, confirm: () => true, console,
    fetch: async () => {throw new Error('Unexpected request');}});
  vm.runInContext(source + '\nthis.app = {state, useVersionAsBase, loadDesignVersion, cacheDesignInputs, restoreDesignInputs, recoverDesignInput, paintChat, runAgent, runExport, deliveryHistoryHtml, loadDeliveryHistory, inspectSnapshot, paintSnapshot, canPublishDesign, publishDiffHtml, designVersionImpactHtml, publishBp, confirmPublish, revokeDecision, confirmRevokeDecision, paintWorkbench, filterWorkbench, fmtTime, fmtTimeShort, designReadinessHtml, draftFingerprint, collectDraftFields, cacheSubmissionDraft, paintSubmitterNextStep, submitterNextStepHtml, setSubMode, refreshSlotConditions, wbMatches, api, submitDecision, saveDraft, doSubmit, uploadSlot, deleteSlotFile, cacheReviewDraft, discardReviewDraft, logout, nextPendingReview, setReviewFilter, setReviewTraceFilter, selectReviewRule, viewReview, reviewRevisionHistoryHtml, paintReview, renderNav, loadMyResults, refreshWorkbench, paintReminder, chooseWorkbenchNextStep, workbenchNextStepHtml, agentRunCard, agentTourHtml, submitterGuidance, ruleCard, receiptFilesHtml, submissionIssues, checkAgentRequestNow, resumePendingAgentRequest, savePendingAgentRequest, agentRequestProgressHtml, retryAgent, pollAgentRequest, showSubmissionIssues, initSubChat, demoRouteTask, demoRouteHtml, renderDemoRoute, paintWorkspaceAgentStatus, viewLogin, readPresentationMode, applyPresentationMode, setPresentationMode, togglePresentationMode};', context);
  Object.assign(context.app.state, {routeEpoch: 1, me:{task:{id:1, status:'collecting', timezone:'Asia/Shanghai'},subject:{id:2}},
    draftVersion:1, fileMeta:{}, sub:{mode:'chat',phase:'fields',fIdx:0, fields:[{id:'name'}],slots:[],answers:{}}});
  context.localStorage.setItem('ff_sub_token', 'test-only-credential');
  return {context, app:context.app, els, fields};
}
function response(data, status = 200) {
  return {ok:status < 400,status,text:async()=>JSON.stringify(data),json:async()=>data};
}
function deferred() {
  let resolve; const promise = new Promise(r => {resolve=r;}); return {promise,resolve};
}

test('deadline formatting uses task timezone, never browser timezone', () => {
  const {app} = setup();
  assert.equal(app.fmtTime('2026-11-08T10:00:00Z'), '2026-11-08 18:00 Asia/Shanghai');
  assert.equal(app.fmtTime('2026-11-08T10:00:00'), app.fmtTime('2026-11-08T18:00:00+08:00'));
  assert.equal(app.fmtTime('2026-11-08T10:00:00Z','America/New_York'), '2026-11-08 05:00 America/New_York');
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
});
test('demo route renders server lifecycle progress and the next stop', () => {
  const {app} = setup();
  const html = app.demoRouteHtml({id:7, name:'演示任务', status:'collecting', demo_route:{
    completed:2, total:4,
    next:{title:'检查并接手', href:'#/workbench/7', detail:'已验收 1/4 个主体'},
    steps:[
      {key:'design', title:'整理要求', detail:'正式蓝图已发布', status:'done', href:'#/design/7'},
      {key:'roster', title:'发放凭证', detail:'5/5 位已安排', status:'done', href:'#/roster/7'},
      {key:'review', title:'检查并接手', detail:'已验收 1/4 个主体', status:'current', href:'#/workbench/7'},
      {key:'delivery', title:'固定交付', detail:'验收完成后固定快照', status:'upcoming', href:'#/delivery/7'},
    ],
    review_signal:{subject_name:'李四', run_id:12, status:'success', pages_read:2,
      deterministic_rules:1, semantic_rules:2, human_rules:1, pending_rules:2,
      coverage_complete:true, coverage_gaps:0, llm_calls_used:1,
      run_source:'simulation',
       trace:[{tool:'review.deterministic_rule', sequence:1, status:'satisfied', simulation:true, duration_ms:3},
         {tool:'review.semantic_rule', sequence:2, status:'unknown', simulation:true, duration_ms:18},
         {tool:'review.semantic_rule', sequence:3, status:'issue', simulation:true, duration_ms:21}],
      focus_rule:{rule_id:'r_term_match', statement:'报告期次须为 2026 秋季第 1 期', status:'待确认', executor:'semantic'}},
  }});
  assert.match(html, /2\/4 站已完成/);
  assert.match(html, /整理要求[\s\S]*已完成/);
  assert.match(html, /检查并接手[\s\S]*现在处理/);
  assert.match(html, /aria-current="step"/);
  assert.match(html, /当前焦点[\s\S]*检查并接手/);
  assert.match(html, /完成后[\s\S]*固定交付/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow="2"/);
  assert.match(html, /进入检查并接手/);
  assert.doesNotMatch(html, /下一站：检查并接手/);
  assert.match(html, /真实复核运行/);
  assert.match(html, /运行 #12 · 李四/);
  assert.match(html, /本次运行来源/);
  assert.match(html, /离线演示结果/);
  assert.match(html, /没有调用实时模型/);
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
});
test('showcase run source stays separate from model configuration', () => {
  const {app} = setup();
  const base = {id:7, name:'演示任务', status:'collecting', demo_route:{completed:2, total:4,
    next:{title:'检查并接手', href:'#/review/7/2', detail:'已验收 1/4 个主体'},
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
    next:{title:'检查并接手', href:'#/review/7/2', detail:'已验收 1/4 个主体'},
    steps:[{key:'design',title:'整理要求',status:'done',href:'#/design/7'},
      {key:'roster',title:'发放凭证',status:'done',href:'#/roster/7'},
      {key:'review',title:'检查并接手',status:'current',href:'#/review/7/2'},
      {key:'delivery',title:'固定交付',status:'upcoming',href:'#/delivery/7'}],
    review_signal:{status:'success', run_id:2, subject_name:'李四', run_source:'simulation',
      trace:[{tool:'review.deterministic_rule', sequence:1, status:'satisfied', simulation:true, duration_ms:3},
        {tool:'review.semantic_rule', sequence:2, status:'unknown', simulation:true, duration_ms:18}]}}});
  assert.match(html, /运行回放/);
  assert.match(html, /skill \/ harness 已记录 2 步/);
  assert.match(html, /程序规则/);
  assert.match(html, /离线语义/);
  assert.doesNotMatch(html, /隐藏推理|原始材料/);
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
  const routeIndex = source.indexOf('<div id="demo-route"');
  const runtimeIndex = source.indexOf('class="workspace-runtime-strip"');
  assert.ok(routeIndex >= 0 && runtimeIndex > routeIndex, 'showcase route should lead the agent explanation');
  assert.equal((source.match(/id="demo-route"/g) || []).length, 1, 'task page should mount one demo route container');
});
test('presentation entry opens the agent tour and focuses the current stop', () => {
  const {app, context, els} = setup();
  const details = element();
  const summary = element();
  const currentStop = element();
  details.open = false;
  details.querySelector = selector => selector === 'summary' ? summary : null;
  context.document.querySelector = selector => {
    if (selector === '.agent-tour details') return details;
    if (selector === '.demo-route-focus .button-link') return currentStop;
    return null;
  };
  app.setPresentationMode(true);
  assert.equal(details.open, true);
  assert.equal(summary.attributes['aria-expanded'], 'true');
  assert.equal(currentStop.focused, true);
  app.setPresentationMode(false);
  assert.equal(els['presentation-toggle'].focused, true);
  assert.match(source, /details\.addEventListener\("toggle"/);
});
test('agent walkthrough makes the constrained execution path visible', () => {
  const {app} = setup();
  const offline = app.agentTourHtml(false);
  assert.match(offline, /AGENT WALKTHROUGH/);
  assert.match(offline, /<details>/);
  assert.match(offline, /<summary aria-expanded="false">/);
  assert.doesNotMatch(offline, /<details open>/);
  assert.match(offline, /review_one_submission/);
  assert.match(offline, /AgentToolHarness|受限工具运行时/);
  assert.match(offline, /review\.deterministic_rule/);
  assert.match(offline, /当前未连接外部 MCP adapter/);
  assert.match(offline, /组织者做最终决定/);
  const online = app.agentTourHtml(true);
  assert.match(online, /模型已接入/);
  assert.match(online, /语义审核仍受工具白名单/);
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
  assert.match(els['receipt-out'].innerHTML,/R1/);
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
test('a late review failure cannot flash an error onto a different page', async () => {
  const {app,context,els}=setup();const pending=deferred();context.fetch=()=>pending.promise;
  const loading=app.viewReview(1,2);app.state.routeEpoch++;
  pending.resolve(response({detail:'old failure'},500));await loading;
  assert.equal(els.flash.innerHTML,'');
});
test('dual identity navigation reflects the current role and review highlights workbench', () => {
  const {app,context,els}=setup();context.localStorage.setItem('ff_org_token','org-test');
  app.renderNav();assert.equal(els['role-label'].textContent,'提交者');
  assert.match(els.nav.innerHTML,/切换到组织者/);assert.doesNotMatch(els.nav.innerHTML,/需求设计/);
  context.location.hash='#/review/1/2';app.renderNav();
  assert.equal(els['role-label'].textContent,'组织者');
  assert.match(els.nav.innerHTML, /href="#\/workbench\/1" aria-current="page"/);
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
test('submitter progress summarizes buckets in plain language rather than exposing rule IDs', async () => {
  const {app,context,els}=setup();
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
  assert.doesNotMatch(els['my-results'].innerHTML,/阻塞:r_term_match|待确认:r_name_clear|人工:r_final_review/);
  assert.match(els['my-results'].innerHTML,/想补充说明，或请组织者再看一眼/);
  assert.match(els['my-results'].innerHTML,/报告期次与活动期次一致/);
  assert.doesNotMatch(els['my-results'].innerHTML,/技术分析文字/);
});
test('submitter next-step band follows draft and review state without inventing a second status', () => {
  const {app} = setup();
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
  html = app.submitterNextStepHtml({formal:true, summary:'规则通过'});
  assert.match(html,/材料检查已完成/);
  html = app.submitterNextStepHtml({formal:true});
  assert.match(html,/正在读取这份提交的核对结果/);
  html = app.submitterNextStepHtml({formal:true, readOnly:true, summary:'已验收'});
  assert.match(html,/查看已提交版本与核对记录/);
  assert.match(styleSource,/\.submit-next-step/);
});
test('result load failure is visible and does not replace existing results', async () => {
  const {app,context,els}=setup();els['my-results'].innerHTML='existing receipt and results';
  context.fetch=async()=>response({detail:'offline'},503);await app.loadMyResults();
  assert.match(els['my-results'].innerHTML,/重试加载结果/);
  assert.match(els['my-results'].innerHTML,/existing receipt and results/);
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
  assert.match(els['delivery-history-list'].innerHTML,/重新生成 CSV \+ ZIP/);
  await app.loadDeliveryHistory(7,true);
  assert.equal(requested[1],'/api/tasks/7/snapshots?limit=20&offset=20');
  assert.doesNotMatch(els['delivery-history-list'].innerHTML,/加载更早记录/);
});
test('an old snapshot can be reopened from its immutable manifest', async () => {
  const {app,context,els}=setup();
  context.localStorage.setItem('ff_org_token','test-owner-token');
  context.fetch=async url=>{
    assert.equal(url,'/api/snapshots/12');
    return response({snapshot_id:12,manifest:JSON.stringify({kind:'formal',totals:{subjects:1,included:1,excluded:0},blueprint_version_id:2,
      entries:[{name:'张三 <组>',revision:1,included:true,excluded_reason:'',files:[{file_id:'f1'}]}]})});
  };
  await app.inspectSnapshot(12);
  assert.match(els['snap-view'].innerHTML,/SNAPSHOT #12/);
  assert.match(els['snap-view'].innerHTML,/张三 &lt;组&gt;/);
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
  assert.match(els['wb-stats'].innerHTML,/查看资格待核，1队/);
  assert.match(els['wb-stats'].innerHTML,/资格待核（队）/);
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
  assert.ok(html.indexOf('有问题')<html.indexOf('检查未完成'));
  assert.ok(html.indexOf('检查未完成')<html.indexOf('已满足'));
  assert.match(html,/姓名需要人工核对/);assert.match(html,/文件读取未完成/);
  const doneStart=html.indexOf('aria-label="已满足"');
  assert.ok(doneStart > -1);
  assert.ok(html.indexOf('人工已处理的问题',doneStart) > doneStart);
  assert.ok(html.indexOf('人工已接手的未完成检查',doneStart) > doneStart);
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
test('next pending review skips completed and confirmed-issue rules; shortcuts explain the final gate', async () => {
  const env=setup(),page=reviewPage(reviewScope('a'));
  page.rules=[{rule_id:'A',result:'unknown'},{rule_id:'B',result:'issue',decision:{decision:'confirm_issue'}},
    {rule_id:'C',result:'satisfied'},{rule_id:'D',result:'manual_pending'}];
  await openReview(env,page);env.els['dc-reason'].value='A 尚未提交';
  env.app.nextPendingReview(1,2);assert.equal(env.app.state.reviewRule,'D');
  env.app.nextPendingReview(1,2);assert.equal(env.app.state.reviewRule,'A');assert.equal(env.els['dc-reason'].value,'A 尚未提交');
  assert.match(env.els.rv.innerHTML,/2 项待决定/);assert.match(env.els.rv.innerHTML,/03<\/b> 验收版本/);
  assert.ok(env.els.rv.innerHTML.indexOf('id="review-decision"')<env.els.rv.innerHTML.indexOf('id="review-acceptance"'));
});
test('a missing server review scope fails closed instead of reusing a revision-only draft', async () => {
  const env=setup(),page=reviewPage(null);await openReview(env,page);
  assert.equal(env.app.state.reviewContext,null);assert.match(env.els.flash.innerHTML,/复核范围缺失/);
});
