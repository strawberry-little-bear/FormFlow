/**
 * Browser walkthrough from a new organizer task to a submitter's first page.
 * Run only against a disposable or isolated demo database.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchChromium } = require('./ux_browser.cjs');

const BASE = (process.env.FORMFLOW_WALKTHROUGH_BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
const OUT = process.env.FORMFLOW_WALKTHROUGH_OUT
  ? path.resolve(process.env.FORMFLOW_WALKTHROUGH_OUT)
  : path.join(os.tmpdir(), `formflow-first-task-entry-${Date.now()}`);

async function dimensions(page) {
  return page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launchChromium({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  const badResponses = [];
  const agentPosts = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
  });
  page.on('request', request => {
    if (request.method() === 'POST' && /\/api\/agent\/requests(?:\?|$)/.test(request.url())) {
      agentPosts.push(request.url());
    }
  });

  try {
    await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
    await page.locator('button.demo-btn').click();
    await page.waitForURL('**/#/tasks');
    const presentationToggle = page.locator('#presentation-toggle');
    if (await presentationToggle.getAttribute('aria-pressed') === 'true') await presentationToggle.click();

    await page.getByRole('button', { name: /新建收集任务/ }).click();
    const taskName = `first-task-entry-${Date.now()}`;
    await page.locator('#tk-name').fill(taskName);
    await page.locator('#create-submit').click();
    await page.waitForURL(/#\/design\/\d+$/);
    await page.getByRole('heading', { name: '把要求，变成好用的收集表' }).waitFor();
    await page.getByRole('button', { name: /团课报告/ }).click();
    await page.getByText('模板已准备好，这只是个起点，不是最终要求。').waitFor();
    await page.locator('#draft-panel .version-picker select').waitFor({ state: 'visible' });

    const designMobile = [];
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(100);
      const state = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        inputs: [...document.querySelectorAll('.time-policy-editor input[type="datetime-local"]')]
          .map(input => ({ id: input.id, height: input.getBoundingClientRect().height })),
      }));
      designMobile.push(state);
      await page.screenshot({ path: path.join(OUT, `design-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });

    const taskId = Number(new URL(page.url()).hash.match(/design\/(\d+)/)?.[1]);
    const publishButton = page.locator('[data-publish]');
    await publishButton.waitFor({ state: 'visible' });
    if (await publishButton.isDisabled()) {
      const readiness = await page.locator('#draft-panel').innerText();
      throw new Error(`template draft is not publishable: ${readiness.replace(/\s+/g, ' ').slice(-500)}`);
    }
    await publishButton.click();
    await page.locator('#publish-dialog').waitFor({ state: 'visible' });
    await page.locator('#publish-consent').check();
    await page.locator('#publish-confirm').click();
    await page.locator('#publish-dialog').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('#draft-state')?.innerText.includes('已发布'));
    const published = await page.locator('#draft-state').innerText();

    await page.goto(`${BASE}/#/roster/${taskId}`, { waitUntil: 'networkidle' });
    await page.locator('#roster-raw').fill('新建任务演示提交者,2026 演示班');
    await page.getByRole('button', { name: /导入名册/ }).click();
    await page.getByText('新建任务演示提交者', { exact: true }).waitFor();
    await page.locator('[data-roster-entry]').click();
    const credentialNode = page.locator('#grant-out .credential-card code');
    await credentialNode.waitFor({ state: 'visible' });
    const credential = (await credentialNode.innerText()).trim();
    if (!credential) throw new Error('one-time submitter credential was not displayed');

    const rosterState = await page.evaluate(() => ({
      entries: [...document.querySelectorAll('.roster-row')].map(row => row.innerText.replace(/\s+/g, ' ').trim()),
      issuedCount: document.querySelector('#roster-filter [data-roster-filter="issued"] span')?.innerText || '0',
      credentialNotice: document.querySelector('#grant-out .field-help')?.innerText || '',
    }));
    await page.screenshot({ path: path.join(OUT, 'organizer-roster.png'), fullPage: true });

    const submitterPage = await context.newPage();
    await submitterPage.goto(`${BASE}/#/login?role=sub`, { waitUntil: 'networkidle' });
    await submitterPage.locator('#lg-cred').fill(credential);
    await submitterPage.getByRole('button', { name: '进入我的提交空间' }).click();
    await submitterPage.waitForURL('**/#/submit');
    await submitterPage.locator('main#app h1').waitFor();
    const submitter = await submitterPage.evaluate(() => ({
      title: document.querySelector('main#app h1')?.innerText.replace(/\s+/g, ' ').trim() || '',
      body: document.querySelector('main#app')?.innerText.replace(/\s+/g, ' ').trim() || '',
      primaryAction: document.querySelector('.submit-action-primary')?.innerText.replace(/\s+/g, ' ').trim() || '',
      dimensions: { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
    }));
    await submitterPage.screenshot({ path: path.join(OUT, 'submitter-entry.png'), fullPage: true });

    const mobile = [];
    for (const width of [390, 320]) {
      await submitterPage.setViewportSize({ width, height: 844 });
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(100);
      mobile.push({ submitter: await dimensions(submitterPage), roster: await dimensions(page) });
      await page.screenshot({ path: path.join(OUT, `organizer-roster-${width}.png`), fullPage: true });
      await submitterPage.screenshot({ path: path.join(OUT, `submitter-entry-${width}.png`), fullPage: true });
    }

    const result = {
      base: BASE,
      taskId,
      taskName,
      published,
      designMobile,
      rosterState,
      submitter,
      mobile,
      agentPosts,
      errors,
      badResponses,
      output: OUT,
    };
    fs.writeFileSync(path.join(OUT, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);

    const failures = [];
    if (!Number.isInteger(taskId)) failures.push('created task id is missing');
    if (!published.includes('已发布')) failures.push('template version was not published');
    if (designMobile.some(item => item.inputs.length !== 3 || item.inputs.some(input => input.height < 44))) {
      failures.push('design time policy inputs do not all meet the 44px minimum height');
    }
    if (designMobile.some(item => item.scrollWidth > item.width)) failures.push('design page overflows horizontally on mobile');
    if (!rosterState.entries.some(entry => entry.includes('新建任务演示提交者') && entry.includes('已发放'))) {
      failures.push('roster does not show the imported submitter as issued');
    }
    if (!rosterState.credentialNotice.includes('私下渠道')) failures.push('one-time credential guidance is missing');
    if (!submitter.title || !submitter.body.includes('新建任务演示提交者')) failures.push('submitter did not reach their own submission space');
    if (!submitter.primaryAction.includes('完成登记与上传材料')) failures.push(`incomplete submitter primary action is misleading: ${submitter.primaryAction}`);
    if (submitter.dimensions.scrollWidth > submitter.dimensions.clientWidth) failures.push('submitter page overflows horizontally');
    if (mobile.some(item => item.submitter.scrollWidth > item.submitter.width || item.roster.scrollWidth > item.roster.width)) {
      failures.push('roster or submitter page overflows on mobile');
    }
    if (agentPosts.length) failures.push('offline path unexpectedly posted an AI request');
    if (errors.length) failures.push('browser raised console or page errors');
    if (badResponses.length) failures.push('browser received failed HTTP responses');
    if (failures.length) throw new Error(failures.join('; '));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(`Walkthrough failed: ${error.message}`);
  process.exitCode = 1;
});
