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

function minimalPdf(text) {
  const escaped = text.replace(/[()\\]/g, '\\$&');
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

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
  const submitPosts = [];
  const observePage = (observedPage, name) => {
    observedPage.on('console', message => {
      if (message.type() === 'error') errors.push(`${name}: ${message.text()}`);
    });
    observedPage.on('pageerror', error => errors.push(`${name}: ${error.message}`));
    observedPage.on('response', response => {
      if (response.status() >= 400) badResponses.push(`${name}: ${response.status()} ${response.url()}`);
    });
    observedPage.on('request', request => {
      if (request.method() === 'POST' && /\/api\/agent\/requests(?:\?|$)/.test(request.url())) {
        agentPosts.push(`${name}: ${request.url()}`);
      }
      if (request.method() === 'POST' && /\/api\/me\/submit(?:\?|$)/.test(request.url())) {
        submitPosts.push(`${name}: ${request.url()}`);
      }
    });
  };
  observePage(page, 'organizer');

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
    observePage(submitterPage, 'submitter');
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

    const primary = submitterPage.locator('.submit-action-primary');
    await primary.click();
    await submitterPage.locator('#submission-errors').waitFor({ state: 'visible' });
    const incompleteState = await submitterPage.evaluate(() => ({
      errors: document.querySelector('#submission-errors')?.innerText.replace(/\s+/g, ' ').trim() || '',
      focused: document.activeElement?.id || '',
      submitCount: document.querySelector('#submission-errors')?.innerText.includes('还有 4 项需要核对') || false,
    }));
    if (submitPosts.length) throw new Error('incomplete first submission unexpectedly reached the submit API');

    await submitterPage.locator('#field-name').fill('新建任务演示提交者');
    await submitterPage.locator('#field-term').fill('2026 秋季第 1 期');
    await submitterPage.locator('#field-class_name').fill('2026 演示班');
    await submitterPage.locator('#file-report').setInputFiles({
      name: 'first-task-demo-report.pdf',
      mimeType: 'application/pdf',
      buffer: minimalPdf('First task demo report for subject 6'),
    });
    const uploadResponsePromise = submitterPage.waitForResponse(response =>
      response.url().includes('/api/me/files') && response.request().method() === 'POST');
    await submitterPage.locator('#upload-report').click();
    const uploadResponse = await uploadResponsePromise;
    if (!uploadResponse.ok()) throw new Error(`first task PDF upload failed with HTTP ${uploadResponse.status()}`);
    await submitterPage.locator('#slot-files-report .file-chip-name').getByText('first-task-demo-report.pdf', { exact: true }).waitFor();
    await submitterPage.screenshot({ path: path.join(OUT, 'submitter-form-complete.png'), fullPage: true });

    const draftResponsePromise = submitterPage.waitForResponse(response =>
      response.url().includes('/api/me/draft') && response.request().method() === 'POST');
    await submitterPage.getByRole('button', { name: /保存草稿/ }).click();
    const draftResponse = await draftResponsePromise;
    if (!draftResponse.ok()) throw new Error(`first task draft save failed with HTTP ${draftResponse.status()}`);
    await submitterPage.waitForFunction(() => document.querySelector('#draft-hint')?.textContent.includes('已保存到服务器'));

    const formalSubmitPromise = submitterPage.waitForResponse(response =>
      response.url().includes('/api/me/submit') && response.request().method() === 'POST');
    await submitterPage.locator('.submit-action-primary').click();
    const formalSubmit = await formalSubmitPromise;
    if (!formalSubmit.ok()) throw new Error(`first task formal submit failed with HTTP ${formalSubmit.status()}`);
    await submitterPage.getByText(/已正式提交 · v1/).waitFor();
    await submitterPage.screenshot({ path: path.join(OUT, 'submitter-first-receipt.png'), fullPage: true });
    const firstReceipt = await submitterPage.evaluate(() => ({
      body: document.querySelector('main#app')?.innerText.replace(/\s+/g, ' ').trim() || '',
      heading: document.querySelector('#my-results-heading')?.innerText.replace(/\s+/g, ' ').trim() || '',
    }));

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
      incompleteState,
      firstReceipt,
      uploadStatus: uploadResponse.status(),
      draftStatus: draftResponse.status(),
      formalSubmitStatus: formalSubmit.status(),
      submitPosts,
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
    if (!incompleteState.submitCount || !incompleteState.errors.includes('请填写「姓名」') || !incompleteState.errors.includes('请上传「团课报告」')) {
      failures.push(`incomplete first submission did not explain the missing inputs: ${incompleteState.errors}`);
    }
    if (!firstReceipt.body.includes('已正式提交 · v1')) failures.push('new-task submitter did not receive the formal receipt');
    if (submitPosts.length !== 1) failures.push(`expected exactly one valid formal submit request, got ${submitPosts.length}`);
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
