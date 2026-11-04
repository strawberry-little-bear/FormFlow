/** Read-only browser walkthrough for the 2026-10-25 presentation review. */
const { launchChromium } = require('./ux_browser.cjs');
const fs = require('fs');
const path = require('path');

const BASE = process.env.FORMFLOW_WALKTHROUGH_BASE || 'http://127.0.0.1:8000';
const OUT = process.env.FORMFLOW_WALKTHROUGH_OUT
  ? path.resolve(process.env.FORMFLOW_WALKTHROUGH_OUT)
  : path.resolve(__dirname, '../docs/ux-review-2026-10-25');
fs.mkdirSync(OUT, { recursive: true });

async function capture(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}

(async () => {
  const browser = await launchChromium({ headless: true });
  const consoleErrors = [];
  const pageErrors = [];
  const badResponses = [];
  const results = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => {
    if (response.url().startsWith(BASE) && response.status() >= 400) {
      badResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  const measure = async (label, viewport, route, screenshot) => {
    await page.setViewportSize(viewport);
    await page.goto(`${BASE}/${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 220),
    }));
    results.push({ label, route, width: viewport.width, ...dimensions });
    if (screenshot) await capture(page, screenshot);
  };

  try {
    await measure('login-desktop', { width: 1440, height: 1000 }, '#/login', 'login-desktop');
    await measure('login-mobile', { width: 390, height: 844 }, '#/login', 'login-mobile');
    await measure('login-320', { width: 320, height: 740 }, '#/login', 'login-320');

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.locator('button.demo-btn').click();
    await page.waitForURL('**/#/tasks');
    await page.waitForTimeout(300);

    const routes = [
      ['tasks', '#/tasks'],
      ['design', '#/design/1'],
      ['roster', '#/roster/1'],
      ['workbench', '#/workbench/1'],
      ['review', '#/review/1/2'],
      ['delivery', '#/delivery/1'],
    ];
    for (const [name, route] of routes) {
      await measure(`${name}-desktop`, { width: 1440, height: 1000 }, route, `${name}-desktop`);
    }
    await measure('review-missing-subject', { width: 1440, height: 1000 }, '#/review/1', 'review-missing-subject');
    const missingSubject = results.at(-1);
    if (!missingSubject.body.includes('先选一位提交者')) {
      throw new Error('Missing-subject route did not show the expected Chinese empty state.');
    }
    for (const [name, route] of [['tasks', '#/tasks'], ['design', '#/design/1'], ['workbench', '#/workbench/1'], ['review', '#/review/1/2']]) {
      await measure(`${name}-390`, { width: 390, height: 844 }, route, `${name}-390`);
      await measure(`${name}-320`, { width: 320, height: 740 }, route, `${name}-320`);
    }

    await page.goto(`${BASE}/#/tasks`, { waitUntil: 'networkidle' });
    const agentShortcut = page.locator('button.presentation-agent-jump');
    if (await agentShortcut.isVisible()) {
      await agentShortcut.click();
      await page.waitForFunction(() => {
        const section = document.querySelector('.agent-tour');
        const details = section?.querySelector('details');
        const top = section?.getBoundingClientRect().top;
        return details?.open && document.activeElement === section && top >= 0 && top < 200;
      }, null, { timeout: 3000 });
      const tourState = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        tourTop: Math.round(document.querySelector('.agent-tour').getBoundingClientRect().top),
        detailsOpen: document.querySelector('.agent-tour details').open,
        focusInTour: document.activeElement === document.querySelector('.agent-tour'),
      }));
      results.push({ label: 'agent-tour-shortcut-320', route: '#/tasks', width: 320, ...tourState });
      await page.screenshot({ path: path.join(OUT, 'agent-tour-shortcut-320.png') });
    } else {
      throw new Error('Agent architecture shortcut was not visible in the mobile presentation view.');
    }

    const submitterContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const submitterPage = await submitterContext.newPage();
    submitterPage.on('console', message => { if (message.type() === 'error') consoleErrors.push(`submitter: ${message.text()}`); });
    submitterPage.on('pageerror', error => pageErrors.push(`submitter: ${error.message}`));
    submitterPage.on('response', response => {
      if (response.url().startsWith(BASE) && response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
    });
    await submitterPage.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
    await submitterPage.locator('#tab-sub').click();
    const submitterSize = await submitterPage.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 220),
    }));
    results.push({ label: 'submitter-entry-390', route: submitterPage.url(), width: 390, ...submitterSize });
    await capture(submitterPage, 'submitter-entry-390');
    await submitterContext.close();

    const report = {
      base: BASE,
      generatedAt: new Date().toISOString(),
      results,
      consoleErrors,
      pageErrors,
      badResponses,
      horizontalOverflow: results.filter(item => item.document > item.viewport),
      missingSubjectEmptyState: missingSubject.body.includes('先选一位提交者'),
    };
    fs.writeFileSync(path.join(OUT, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
