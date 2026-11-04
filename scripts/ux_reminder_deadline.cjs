/** Read-only reminder-draft walkthrough for the local fictional demo seed. */
const { launchChromium } = require('./ux_browser.cjs');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.FORMFLOW_WALKTHROUGH_BASE || 'http://127.0.0.1:8000';
const OUT = process.env.FORMFLOW_WALKTHROUGH_OUT
  ? path.resolve(process.env.FORMFLOW_WALKTHROUGH_OUT)
  : path.resolve(__dirname, '../docs/ux-review-2026-10-25/round-21-reminder-deadline');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await launchChromium({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [], pageErrors = [], badResponses = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => {
    if (response.url().startsWith(BASE) && response.status() >= 400) {
      badResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  try {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.locator('button.demo-btn').click();
    await page.waitForURL('**/#/tasks');
    await page.goto(`${BASE}/#/workbench/1`, { waitUntil: 'networkidle' });
    await page.locator('#remind-content').waitFor();

    const desktop = await page.locator('#remind-content').inputValue();
    if (!/首次截止时间 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(desktop)) {
      throw new Error(`Reminder draft did not include a formatted first deadline: ${desktop}`);
    }
    await page.screenshot({ path: path.join(OUT, 'workbench-reminder-desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    const mobile = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      reminderText: document.querySelector('#remind-content')?.value || '',
    }));
    if (mobile.viewport !== mobile.document) throw new Error(`Horizontal overflow at 390px: ${JSON.stringify(mobile)}`);
    if (mobile.reminderText !== desktop) throw new Error('Reminder draft changed after resizing to mobile.');
    await page.screenshot({ path: path.join(OUT, 'workbench-reminder-390.png'), fullPage: true });

    const result = { base: BASE, desktopDraft: desktop, mobile, consoleErrors, pageErrors, badResponses,
      mutationPerformed: false };
    fs.writeFileSync(path.join(OUT, 'browser-results.json'), JSON.stringify(result, null, 2) + '\n');
    if (consoleErrors.length || pageErrors.length || badResponses.length) {
      throw new Error(`Browser errors detected: ${JSON.stringify(result)}`);
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exit(1); });
