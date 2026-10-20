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
    setAttribute(k, v) {this.attributes[k] = v;}, addEventListener(k, fn) {this.listeners[k] = fn;},
    querySelectorAll() {return [];}, scrollIntoView() {this.scrolled = true;},
    insertAdjacentHTML(_, html) {this.innerHTML = html + this.innerHTML;},
    focus() {this.focused = true;}, setSelectionRange(start, end) {this.selectionStart = start; this.selectionEnd = end;}};
}
function setup() {
  const els = Object.fromEntries(['sub', 'draft-hint', 'flash', 'receipt-out', 'decision-submit',
    'review-conflict', 'dc-type', 'dc-rule', 'dc-reason', 'dc-exp', 'acceptance-reason', 'acceptance-submit',
    'submission-errors', 'field-error-name', 'app', 'rv', 'rv-name', 'my-results', 'nav', 'role-label', 'btn-logout'].map(id => [id, element()]));
  const fields = [Object.assign(element('old'), {dataset: {field:'name'}})];
  els['field-name'] = fields[0];
  const document = {getElementById: id => els[id] || null,
    querySelectorAll: sel => sel === '[data-field]' ? fields : [], querySelector: () => null};
  const context = vm.createContext({document, localStorage: storage(), sessionStorage: storage(),
    window: {addEventListener() {}}, location: {hash:'#/submit'}, Intl, URLSearchParams, FormData,
    setTimeout, clearTimeout, confirm: () => true, console,
    fetch: async () => {throw new Error('Unexpected request');}});
  vm.runInContext(source + '\nthis.app = {state, revokeDecision, confirmRevokeDecision, paintWorkbench, filterWorkbench, fmtTime, draftFingerprint, collectDraftFields, cacheSubmissionDraft, setSubMode, refreshSlotConditions, wbMatches, api, submitDecision, saveDraft, doSubmit, uploadSlot, cacheReviewDraft, selectReviewRule, viewReview, paintReview, renderNav, loadMyResults, refreshWorkbench, paintReminder, submissionIssues, showSubmissionIssues, initSubChat};', context);
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
  app.state.reviewContext='1:2:41';app.state.reviewRule='A';
  els['dc-reason'].value='only A';els['acceptance-reason'].value='separate acceptance';
  app.selectReviewRule('B',1,2);els['dc-reason'].value='only B';
  app.selectReviewRule('A',1,2);
  assert.equal(els['dc-reason'].value,'only A');
  assert.equal(els['acceptance-reason'].value,'separate acceptance');
  assert.equal(app.state.reviewDrafts['1:2:41'].rules.B['dc-reason'],'only B');
  app.state.reviewContext='1:3:42';app.state.reviewRule='A';els['dc-reason'].value='other subject';
  app.cacheReviewDraft();
  assert.equal(app.state.reviewDrafts['1:2:41'].rules.A['dc-reason'],'only A');
  assert.equal(app.state.reviewDrafts['1:3:42'].rules.A['dc-reason'],'other subject');
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
  app.state.reviewContext='1:2:41';app.state.reviewRule='A';
  els['dc-type'].value='confirm_issue';els['dc-reason'].value='original';
  const pending=deferred();context.fetch=()=>pending.promise;
  const saving=app.submitDecision(1,2);app.selectReviewRule('B',1,2);
  assert.equal(app.state.reviewRule,'A');
  app.state.reviewContext='1:3:45';els['dc-reason'].value='other context';
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
  app.state.reviewContext='1:2:0'; app.state.reviewData={decisions:[{id:7,decision:'exempt'}]};
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
  app.state.reviewContext='1:2:3'; app.state.reviewData={subject:{id:2,name:'用户'},revision:{id:3,version:1},
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
  app.state.reviewContext='1:2:9'; app.state.reviewData={revision:{id:9},eligibility:{members_hash:'verified-members'}};
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
  app.state.reviewContext='1:2:9'; app.state.reviewData={revision:{id:9},eligibility:{members_hash:'members'}};
  els['eligibility-result'].value='pending'; els['eligibility-reason'].value='还需核实';
  app.cacheReviewDraft(); assert.equal(app.state.reviewDrafts['1:2:9'].eligibility['eligibility-reason'],'还需核实');
  const pending=deferred(); context.fetch=async()=>pending.promise;
  const save=app.submitDecision(1,2,'eligibility'); app.state.reviewContext='1:3:10';
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
  assert.doesNotMatch(els.rv.innerHTML,/可能尚未检查/);
});
