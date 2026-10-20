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
    classList: {toggle() {}}, setAttribute() {}, addEventListener() {}};
}
function setup() {
  const els = Object.fromEntries(['sub', 'draft-hint', 'flash', 'receipt-out', 'decision-submit',
    'review-conflict', 'dc-type', 'dc-rule', 'dc-reason', 'dc-exp'].map(id => [id, element()]));
  const fields = [Object.assign(element('old'), {dataset: {field:'name'}})];
  const document = {getElementById: id => els[id] || null,
    querySelectorAll: sel => sel === '[data-field]' ? fields : [], querySelector: () => null};
  const context = vm.createContext({document, localStorage: storage(), sessionStorage: storage(),
    window: {addEventListener() {}}, location: {hash:'#/submit'}, Intl, URLSearchParams, FormData,
    setTimeout, clearTimeout, confirm: () => true, console,
    fetch: async () => {throw new Error('Unexpected request');}});
  vm.runInContext(source + '\nthis.app = {state, fmtTime, draftFingerprint, collectDraftFields, cacheSubmissionDraft, setSubMode, refreshSlotConditions, wbMatches, api, submitDecision, saveDraft, doSubmit, uploadSlot};', context);
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
