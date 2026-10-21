const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app/static/app.js'), 'utf8')
  .replace(/\nroute\(\);\s*$/, '\n');

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
  const els = Object.fromEntries(['sub', 'draft-hint', 'flash', 'receipt-out', 'decision-submit',
    'review-conflict', 'dc-type', 'dc-rule', 'dc-reason', 'dc-exp', 'acceptance-reason', 'acceptance-submit',
    'review-draft-status', 'submission-errors', 'field-error-name', 'app', 'rv', 'rv-name', 'my-results', 'nav', 'role-label', 'btn-logout'].map(id => [id, element()]));
  const fields = [Object.assign(element('old'), {dataset: {field:'name'}})];
  els['field-name'] = fields[0];
  const document = {getElementById: id => els[id] || null,
    querySelectorAll: sel => sel === '[data-field]' ? fields : [], querySelector: () => null};
  const context = vm.createContext({document, localStorage: storage(), sessionStorage: sharedStorage,
    window: {addEventListener() {}}, location: {hash:'#/submit'}, Intl, URLSearchParams, FormData,
    setTimeout, clearTimeout, confirm: () => true, console,
    fetch: async () => {throw new Error('Unexpected request');}});
  vm.runInContext(source + '\nthis.app = {state, useVersionAsBase, loadDesignVersion, cacheDesignInputs, restoreDesignInputs, recoverDesignInput, paintChat, runAgent, canPublishDesign, publishDiffHtml, publishBp, confirmPublish, revokeDecision, confirmRevokeDecision, paintWorkbench, filterWorkbench, fmtTime, draftFingerprint, collectDraftFields, cacheSubmissionDraft, setSubMode, refreshSlotConditions, wbMatches, api, submitDecision, saveDraft, doSubmit, uploadSlot, cacheReviewDraft, discardReviewDraft, logout, nextPendingReview, selectReviewRule, viewReview, paintReview, renderNav, loadMyResults, refreshWorkbench, paintReminder, submissionIssues, showSubmissionIssues, initSubChat};', context);
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
test('late upload cannot attach a previous subject file to the current subject', async () => {
  const {app,context,els} = setup();els['file-r']={files:[new Blob(['test'])],value:'file'};
  const pending=deferred();context.fetch=()=>pending.promise;
  const uploaded=app.uploadSlot('r');app.state.routeEpoch++;app.state.me.subject.id=99;
  pending.resolve(response({file_id:'old-subject-file'}));await uploaded;
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
  assert.match(els.rv.innerHTML,/确认问题（需补正）/);
  assert.match(els.rv.innerHTML,/请选择核对结论/);
  assert.match(els.rv.innerHTML,/人工核对通过/);
  context.fetch=async()=>response({summary:'待补正',buckets:{blocking:['H']},details:app.state.reviewData.rules});
  await app.loadMyResults();
  assert.match(els['my-results'].innerHTML,/待办事项（1）/);
  assert.match(els['my-results'].innerHTML,/内容仍有问题/);
  assert.doesNotMatch(els['my-results'].innerHTML,/已通过 1 项/);
});
test('human resolution moves raw unknown out of submitter todo without hiding evidence', async () => {
  const {app,els,context} = setup();
  context.fetch=async()=>response({summary:'规则通过（待人工验收）',buckets:{},details:[{
    rule_id:'R',result:'unknown',explanation:'机器原先未读到',evidence:[{quote:'原文已核对'}],
    decision:{decision:'confirm_pass',reason:'人工核对原文通过',resolves:true}}]});
  await app.loadMyResults();
  assert.doesNotMatch(els['my-results'].innerHTML,/待办事项/);
  assert.match(els['my-results'].innerHTML,/已通过 1 项/);
  assert.match(els['my-results'].innerHTML,/人工核对原文通过/);
  assert.match(els['my-results'].innerHTML,/机器原先未读到/);
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


function designSetup() {
  const test=setup(), {app,els,context}=test;
  for(const id of ['chat-in','clar-0','clar-extra','chat-scroll','design-input-hint','design-recovery','draft-state','publish-summary','publish-consent','publish-confirm','publish-error','publish-dialog'])els[id]=element();
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
  context.fetch=async()=>response(updatedDesign());await app.runAgent('新增字段',{},'新增字段');
  const old=savedDesign(context).versions['10'];assert.equal(old.composer,'');assert.equal(old.answers['截止？'],'还没发送的答案');
  assert.match(els['design-recovery'].innerHTML,/还没发送的答案/);
});
test('successful clarification request preserves an unrelated unsent composer', async () => {
  const {app,els,context}=designSetup();els['chat-in'].value='另外的修改';els['clar-0'].value='11 月';
  context.fetch=async()=>response(updatedDesign());await app.runAgent('截止？：11 月',{'截止？':'11 月'},'','clarifications');
  const old=savedDesign(context).versions['10'];assert.equal(old.composer,'另外的修改');assert.deepEqual(old.answers,{});
  assert.match(els['design-recovery'].innerHTML,/另外的修改/);
});
test('failed and late design requests cannot lose edits or overwrite a new page', async () => {
  const {app,els,context}=designSetup();els['chat-in'].value='重试要求';els['clar-0'].value='未完答案';
  context.fetch=async()=>response({detail:'模型不可用'},503);await app.runAgent('重试要求',{},'重试要求');
  assert.equal(els['chat-in'].value,'重试要求');assert.equal(els['clar-0'].value,'未完答案');
  const pending=deferred();context.fetch=async()=>pending.promise;
  const save=app.runAgent('重试要求',{},'重试要求');app.state.designEpoch++;app.state.bpId=77;els['chat-in'].value='另一页面';
  pending.resolve(response(updatedDesign()));await save;
  assert.equal(app.state.bpId,77);assert.equal(els['chat-in'].value,'另一页面');
});
test('publication diff shows removed requirements and safely escapes descriptions', () => {
  const {app}=designSetup();const html=app.publishDiffHtml({published:{version:1,blueprint:{fields:[{id:'old',label:'<旧字段>',required:true}],slots:[],rules:[]}},
    draft:{blueprint:{fields:[],slots:[],rules:[],eligibility_required:true}},publish_impact:{fields:{removed:['old']},eligibility_required_changed:true}});
  assert.match(html,/相对已发布 v1/);assert.match(html,/移除字段/);assert.match(html,/&lt;旧字段&gt;/);assert.match(html,/资格前提：启用/);
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
