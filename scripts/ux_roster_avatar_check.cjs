const fs = require('node:fs');
const path = require('node:path');
const { launchChromium } = require('./ux_browser.cjs');

const base = process.env.FORMFLOW_WALKTHROUGH_BASE || 'http://127.0.0.1:8000';
const output = process.env.FORMFLOW_WALKTHROUGH_OUT
  ? path.resolve(process.env.FORMFLOW_WALKTHROUGH_OUT)
  : path.resolve(__dirname, '../docs/ux-review-2026-10-25/round-26-roster-avatar');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await launchChromium({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  const pageErrors = [];
  const badResponses = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => {
    if (response.url().startsWith(base) && response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
  });

  try {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('button.demo-btn').click();
    await page.waitForURL('**/#/tasks');
    const checks = [];
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await page.goto(`${base}/#/roster/1`, { waitUntil: 'networkidle' });
      await page.locator('.roster-person > .wb-avatar').first().waitFor();
      const check = await page.evaluate(() => {
        const avatar = document.querySelector('.roster-person > .wb-avatar');
        const style = getComputedStyle(avatar);
        return {
          viewport: document.documentElement.clientWidth,
          document: document.documentElement.scrollWidth,
          text: avatar.textContent,
          display: style.display,
          fontSize: style.fontSize,
          alignItems: style.alignItems,
          justifyContent: style.justifyContent,
          whiteSpace: style.whiteSpace,
          box: Math.round(avatar.getBoundingClientRect().width),
        };
      });
      check.width = width;
      checks.push(check);
      await page.screenshot({ path: path.join(output, `roster-${width}.png`), fullPage: true });
    }

    const failures = checks.filter(check => check.document > check.viewport
      || check.display !== 'flex' || check.alignItems !== 'center'
      || check.justifyContent !== 'center' || check.fontSize !== '13px'
      || check.whiteSpace !== 'normal' || !check.text);
    const report = { base, generatedAt: new Date().toISOString(), checks, failures, consoleErrors, pageErrors, badResponses };
    fs.writeFileSync(path.join(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    if (failures.length || consoleErrors.length || pageErrors.length || badResponses.length) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
