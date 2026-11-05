/**
 * Requirements Agent showcase walkthrough.
 *
 * Creates an isolated task, uploads a fictional notice/roster/template pack,
 * verifies that the server keeps private source-material ids, and checks the
 * no-model-key downgrade path in the design UI.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchChromium } = require('./ux_browser.cjs');

const BASE = (process.env.FORMFLOW_WALKTHROUGH_BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
const OUT = process.env.FORMFLOW_WALKTHROUGH_OUT
  ? path.resolve(process.env.FORMFLOW_WALKTHROUGH_OUT)
  : path.join(os.tmpdir(), `formflow-requirements-materials-${Date.now()}`);

function writeFixture(dir, name, content) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const fixtures = path.join(OUT, 'fixtures');
  fs.mkdirSync(fixtures, { recursive: true });
  const files = {
    notice: writeFixture(fixtures, 'notice.txt', [
      '2026 秋季创新赛报名通知',
      '适用对象：名单中的参赛者。',
      '请在 2026-11-20 18:00 前提交报名表和项目说明 PDF，各 1 份。',
      '项目说明需要包含问题、方案和分工；不清楚的要求交由组织者确认。',
    ].join('\n')),
    roster: writeFixture(fixtures, 'roster.csv', [
      '姓名,学号,学院',
      '张三,20260001,计算机学院',
      '李四,20260002,设计学院',
    ].join('\n')),
    template: writeFixture(fixtures, 'application-template.txt', [
      '报名表模板',
      '必填：姓名、学号、学院、项目名称。',
      '材料槽位：报名表 PDF、项目说明 PDF。',
    ].join('\n')),
  };

  const browser = await launchChromium({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  const badResponses = [];
  const agentRequests = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().startsWith(BASE) && response.status() >= 400) {
      badResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on('request', request => {
    if (request.method() !== 'POST' || !request.url().includes('/draft/agent-requests')) return;
    const body = request.postData() || '';
    const form = new URLSearchParams(body);
    let sourceIds = [];
    try { sourceIds = JSON.parse(form.get('source_material_ids') || '[]'); } catch { /* report below */ }
    agentRequests.push({
      url: request.url(),
      requestId: form.get('request_id') || '',
      sourceIds,
      requirement: form.get('requirement') || '',
    });
  });

  const report = {
    base: BASE,
    output: OUT,
    fixtures: Object.fromEntries(Object.entries(files).map(([kind, file]) => [kind, path.basename(file)])),
    taskId: null,
    sourceMaterials: [],
    agentRequests,
    noModelKey: {},
    mobile: [],
    errors,
    badResponses,
  };

  try {
    await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
    await page.locator('button.demo-btn').click();
    await page.waitForURL('**/#/tasks');
    const presentationToggle = page.locator('#presentation-toggle');
    if (await presentationToggle.getAttribute('aria-pressed') === 'true') await presentationToggle.click();

    await page.getByRole('button', { name: /新建收集任务/ }).click();
    const taskName = `requirements-materials-walkthrough-${Date.now()}`;
    await page.locator('#tk-name').fill(taskName);
    await page.locator('#create-submit').click();
    await page.waitForURL(/#\/design\/\d+$/);
    report.taskId = Number(new URL(page.url()).hash.match(/design\/(\d+)/)?.[1]);
    await page.getByRole('heading', { name: '把要求，变成好用的收集表' }).waitFor();
    await page.getByText('来源资料包', { exact: false }).waitFor();
    await page.waitForFunction(() => {
      const inputs = [...document.querySelectorAll('#source-pack input[type="file"]')];
      return inputs.length === 4 && inputs.every(input => !input.disabled);
    });

    const uploads = [
      ['上传报名通知', files.notice, 'source-files-notice'],
      ['上传适用名单', files.roster, 'source-files-roster'],
      ['上传报名模板', files.template, 'source-files-template'],
    ];
    for (const [label, file, listId] of uploads) {
      const input = page.locator(`input[aria-label="${label}"]`);
      await input.waitFor({ state: 'visible' });
      await input.setInputFiles(file);
      await page.waitForFunction(id => {
        const text = document.getElementById(id)?.innerText || '';
        return text.includes('notice') || text.includes('roster') || text.includes('template')
          || text.includes('报名') || text.includes('名单');
      }, listId);
    }
    await page.waitForFunction(() => (document.querySelector('#source-materials-state')?.innerText || '').includes('服务器已保存 3 份资料'));

    const taskId = report.taskId;
    const sourceResponse = await page.evaluate(async id => {
      const token = localStorage.getItem('ff_org_token') || '';
      const response = await fetch(`/api/tasks/${id}/source-materials`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return response.json();
    }, taskId);
    report.sourceMaterials = sourceResponse.items || [];
    await page.locator('#chat-in').fill('请根据通知、名单和模板整理报名收集任务，保留每条要求的来源位置，并把冲突和不确定内容列为待确认。');
    await page.locator('#chat-send').click();

    await page.waitForFunction(() => {
      const body = document.body.innerText;
      return body.includes('现在还没有接入 AI 模型') || body.includes('配置好模型密钥后')
        || body.includes('模型未配置');
    }, null, { timeout: 30000 });
    const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    report.noModelKey = {
      saysModelMissing: /没有接入 AI 模型|未配置模型密钥|模型未配置/.test(bodyText),
      explainsFallback: /模板|手动|配置好模型密钥/.test(bodyText),
      hasRetryButton: await page.getByRole('button', { name: '用原请求重试' }).count() > 0,
      pageText: bodyText,
    };

    await page.screenshot({ path: path.join(OUT, 'design-no-model-key.png'), fullPage: true });
    const desktop = await page.evaluate(() => ({
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      sourceState: document.querySelector('#source-materials-state')?.innerText || '',
      designText: document.querySelector('#draft-panel')?.innerText || '',
    }));
    report.desktop = desktop;
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(100);
      const state = await page.evaluate(() => ({
        width: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        sourcePackVisible: !!document.querySelector('#source-pack'),
        fallbackVisible: /没有接入 AI 模型|未配置模型密钥|配置好模型密钥/.test(document.body.innerText),
      }));
      report.mobile.push(state);
      await page.screenshot({ path: path.join(OUT, `design-${width}.png`), fullPage: true });
    }

    fs.writeFileSync(path.join(OUT, 'result.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    const failures = [];
    if (!Number.isInteger(report.taskId)) failures.push('created task id is missing');
    if (report.sourceMaterials.length !== 3) failures.push('server did not retain all three source materials');
    if (report.sourceMaterials.some(item => !/^src_/.test(item.id))) failures.push('source material ids are not private src_* ids');
    if (agentRequests.length !== 1) failures.push('expected one Agent request');
    const ids = new Set(report.sourceMaterials.map(item => item.id));
    if (agentRequests.length === 1 && agentRequests[0].sourceIds.length !== 3) failures.push('Agent request omitted source material ids');
    if (agentRequests.length === 1 && agentRequests[0].sourceIds.some(id => !ids.has(id))) failures.push('Agent request contained an unknown source material id');
    if (!report.noModelKey.saysModelMissing || !report.noModelKey.explainsFallback) failures.push('no-model-key fallback copy is missing');
    if (report.noModelKey.hasRetryButton) failures.push('no-model-key state exposes an invalid retry button');
    if (desktop.scrollWidth > desktop.width) failures.push('desktop page overflows horizontally');
    if (report.mobile.some(item => item.scrollWidth > item.width || !item.sourcePackVisible || !item.fallbackVisible)) failures.push('mobile design route is clipped or loses the fallback state');
    if (errors.length) failures.push('browser errors were reported');
    if (badResponses.length) failures.push('failed HTTP responses were reported');
    if (failures.length) throw new Error(failures.join('; '));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch(error => {
  console.error(`Requirements materials walkthrough failed: ${error.message}`);
  process.exitCode = 1;
});
