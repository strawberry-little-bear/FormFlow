/** Keyboard-only smoke check for the organizer and submitter routes. */
const fs = require('node:fs');
const path = require('node:path');
const { launchChromium } = require('./ux_browser.cjs');

const BASE = (process.env.FORMFLOW_KEYBOARD_BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
const CREDENTIAL = process.env.FORMFLOW_KEYBOARD_CREDENTIAL?.trim() || '';
const OUT = process.env.FORMFLOW_KEYBOARD_OUT ? path.resolve(process.env.FORMFLOW_KEYBOARD_OUT) : null;
const ROUTES = [
  ['tasks', '#/tasks'],
  ['design', '#/design/1'],
  ['roster', '#/roster/1'],
  ['workbench', '#/workbench/1'],
  ['review', '#/review/1/2'],
  ['delivery', '#/delivery/1'],
];

async function visibleInteractives(page, root = 'main#app') {
  return page.locator(`${root} a[href],${root} button:not([disabled]),${root} input:not([disabled]),${root} select:not([disabled]),${root} textarea:not([disabled]),${root} [tabindex]:not([tabindex="-1"])`).evaluateAll(nodes => nodes
    .filter(node => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return node.tabIndex >= 0 && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
        && !node.closest('[hidden],[aria-hidden="true"],details:not([open])');
    })
    .map(node => ({ key: (() => {

      const label = (node.getAttribute('aria-label') || node.textContent || '').replace(/\s+/g, ' ').trim();
      return `${node.tagName.toLowerCase()}#${node.id || ''}:${label.slice(0, 80)}`;
    })(), tag: node.tagName.toLowerCase(), id: node.id || '' })));
}

async function tabAudit(page, label) {
  const expected = await visibleInteractives(page);
  const reached = new Set();
  const hiddenFocus = [];
  await page.locator('main#app').focus();
  await page.waitForTimeout(350);
  for (let i = 0; i < 180; i += 1) {
    await page.keyboard.press('Tab');
    const state = await page.evaluate(() => {
      const node = document.activeElement;
      if (!node || node === document.body) return { body: true };
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      const label = (node.getAttribute('aria-label') || node.textContent || '').replace(/\s+/g, ' ').trim();
      return {
        body: false,
        key: `${node.tagName.toLowerCase()}#${node.id || ''}:${label.slice(0, 80)}`,
        hidden: style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0
          || !!node.closest('[hidden],[aria-hidden="true"]'),
      };
    });
    if (state.body) break;
    reached.add(state.key);
    if (state.hidden) hiddenFocus.push(state.key);
  }
  const missing = expected.filter(item => !reached.has(item.key));
  return { label, expectedCount: expected.length, reachedCount: reached.size, missing, hiddenFocus };
}

async function main() {
  const browser = await launchChromium({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  const failures = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().startsWith(BASE) && response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  const report = { base: BASE, generatedAt: new Date().toISOString(), organizer: [], submitter: null, errors, failures };
  try {
    await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
    await page.locator('button.demo-btn').click();
    await page.waitForURL('**/#/tasks');
    await page.waitForTimeout(500);
    const presentationToggle = page.locator('#presentation-toggle');
    if (await presentationToggle.isVisible().catch(() => false) && await presentationToggle.getAttribute('aria-pressed') === 'true') {
      await presentationToggle.click();
      await page.waitForTimeout(250);
    }
    for (const [label, hash] of ROUTES) {
      await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      report.organizer.push(await tabAudit(page, label));
    }

    if (CREDENTIAL) {
      await page.goto(`${BASE}/#/login?role=sub`, { waitUntil: 'networkidle' });
      await page.locator('#tab-sub').click();
      await page.locator('#lg-cred').fill(CREDENTIAL);
      await page.locator('button:has-text("进入我的提交空间")').click();
      await page.locator('#field-name').waitFor();
      report.submitter = await tabAudit(page, 'submitter-form');
    }
  } finally {
    await context.close();
    await browser.close();
  }
  if (OUT) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'keyboard-results.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  const audits = [...report.organizer, report.submitter].filter(Boolean);
  if (errors.length || failures.length || audits.some(item => item.missing.length || item.hiddenFocus.length)) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exit(1); });
