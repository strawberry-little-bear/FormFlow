/**
 * Browser walkthrough for creating a task and starting its first offline template draft.
 * The target server must use a disposable or isolated demo database.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchChromium } = require('./ux_browser.cjs');

const BASE = (process.env.FORMFLOW_WALKTHROUGH_BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
const OUT = process.env.FORMFLOW_WALKTHROUGH_OUT
  ? path.resolve(process.env.FORMFLOW_WALKTHROUGH_OUT)
  : path.join(os.tmpdir(), `formflow-new-task-template-${Date.now()}`);

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launchChromium({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  const badResponses = [];
  const agentPosts = [];
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
    if (await presentationToggle.getAttribute('aria-pressed') === 'true') {
      await presentationToggle.click();
    }

    await page.getByRole('button', { name: /\u65b0\u5efa\u6536\u96c6\u4efb\u52a1/ }).click();
    const taskName = `offline-template-walkthrough-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
    await page.locator('#tk-name').fill(taskName);
    await page.locator('#create-submit').click();
    await page.waitForURL(/#\/design\/\d+$/);
    await page.getByRole('heading', { name: '\u628a\u8981\u6c42\uff0c\u53d8\u6210\u597d\u7528\u7684\u6536\u96c6\u8868' }).waitFor();
    await page.getByRole('button', { name: /\u56e2\u8bfe\u62a5\u544a/ }).click();
    await page.getByText('\u6a21\u677f\u5df2\u51c6\u5907\u597d\uff0c\u8fd9\u53ea\u662f\u4e2a\u8d77\u70b9\uff0c\u4e0d\u662f\u6700\u7ec8\u8981\u6c42\u3002').waitFor();
    await page.locator('#draft-panel .version-picker select').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#draft-panel .version-picker select')?.options.length > 0);

    const taskId = Number(new URL(page.url()).hash.match(/design\/(\d+)/)?.[1]);
    const desktop = await page.evaluate(() => ({
      title: document.querySelector('main#app h1')?.textContent?.replace(/\s+/g, ' ').trim() || '',
      draftText: document.querySelector('#draft-panel')?.innerText?.replace(/\s+/g, ' ').trim() || '',
      versionOptions: document.querySelectorAll('#draft-panel .version-picker option').length,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    await page.screenshot({ path: path.join(OUT, 'design-desktop.png') });

    const mobile = [];
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(100);
      const state = await page.evaluate(() => ({
        width: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        titleVisible: (() => {
          const rect = document.querySelector('main#app h1')?.getBoundingClientRect();
          return !!rect && rect.top >= 0 && rect.bottom <= window.innerHeight;
        })(),
        templateVisible: document.body.innerText.includes('\u6a21\u677f\u5df2\u51c6\u5907\u597d\uff0c\u8fd9\u53ea\u662f\u4e2a\u8d77\u70b9\uff0c\u4e0d\u662f\u6700\u7ec8\u8981\u6c42\u3002'),
      }));
      mobile.push(state);
      await page.screenshot({ path: path.join(OUT, `design-${width}.png`), fullPage: true });
    }

    const result = {
      base: BASE,
      taskId,
      taskName,
      desktop,
      mobile,
      agentPosts,
      errors,
      badResponses,
      output: OUT,
    };
    fs.writeFileSync(path.join(OUT, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);

    const failures = [];
    if (!Number.isInteger(taskId)) failures.push('created task id is missing');
    if (!desktop.draftText.includes('\u56e2\u8bfe\u62a5\u544a')) failures.push('template draft content is missing');
    if (desktop.versionOptions < 1) failures.push('draft version history is missing');
    if (desktop.scrollWidth > desktop.clientWidth) failures.push('desktop page overflows horizontally');
    if (mobile.some(item => item.scrollWidth > item.width || !item.titleVisible || !item.templateVisible)) {
      failures.push('mobile route is clipped, overflows, or lost the template confirmation');
    }
    if (agentPosts.length) failures.push('offline template path unexpectedly posted an AI request');
    if (errors.length) failures.push('browser raised page errors');
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
