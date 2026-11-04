/** Optional read-only Axe accessibility sweep for the local demo. */
const fs = require('node:fs');
const path = require('node:path');
const { launchChromium } = require('./ux_browser.cjs');

const BASE = process.env.FORMFLOW_ACCESSIBILITY_BASE || 'http://127.0.0.1:8000';
const SUBMITTER_CREDENTIAL = process.env.FORMFLOW_ACCESSIBILITY_CREDENTIAL?.trim() || '';
const OUT = process.env.FORMFLOW_ACCESSIBILITY_OUT
  ? path.resolve(process.env.FORMFLOW_ACCESSIBILITY_OUT)
  : null;

function resolveAxe() {
  const override = process.env.FORMFLOW_AXE_MODULE?.trim();
  const candidates = override ? [override] : ['axe-core'];
  for (const candidate of candidates) {
    try {
      return require.resolve(candidate, { paths: [process.cwd(), __dirname] });
    } catch {
      continue;
    }
  }
  throw new Error('Axe is optional; install axe-core outside project dependencies or set FORMFLOW_AXE_MODULE.');
}

async function summarizePage(page) {
  return page.evaluate(async () => {
    const { violations, incomplete } = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    });
    const summarizeAxeNode = node => {
      const summarizeChecks = checks => checks.map(check => ({
        id: check.id,
        impact: check.impact,
        message: check.message,
        data: check.data,
      }));
      return {
        target: node.target,
        html: node.html?.slice(0, 320),
        summary: node.failureSummary,
        checks: {
          any: summarizeChecks(node.any || []),
          all: summarizeChecks(node.all || []),
          none: summarizeChecks(node.none || []),
        },
      };
    };
    const summarizeIncomplete = item => ({
      id: item.id,
      impact: item.impact,
      help: item.help,
      helpUrl: item.helpUrl,
      nodes: item.nodes.map(summarizeAxeNode),
    });
    return {
      title: document.title,
      violations: violations.map(item => ({
        id: item.id,
        impact: item.impact,
        help: item.help,
        helpUrl: item.helpUrl,
        nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary })),
      })),
      incomplete: incomplete.map(summarizeIncomplete),
    };
  });
}

async function main() {
  const axePath = resolveAxe();
  const browser = await launchChromium({ headless: true });
  const errors = { console: [], page: [], responses: [] };
  const scans = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') errors.console.push(message.text()); });
  page.on('pageerror', error => errors.page.push(error.message));
  page.on('response', response => {
    if (response.url().startsWith(BASE) && response.status() >= 400) {
      errors.responses.push(`${response.status()} ${response.url()}`);
    }
  });

  const scan = async (label, route) => {
    await page.goto(`${BASE}/${route}`, { waitUntil: 'networkidle' });
    // The SPA may repaint route data after the document has gone network-idle.
    await page.waitForTimeout(1000);
    await page.addScriptTag({ path: axePath });
    const result = await summarizePage(page);
    scans.push({ label, route, ...result });
  };

  try {
    await scan('login-organizer', '#/login');
    await page.locator('button.demo-btn').click();
    await page.waitForURL('**/#/tasks');
    for (const [label, route] of [
      ['tasks', '#/tasks'],
      ['design', '#/design/1'],
      ['roster', '#/roster/1'],
      ['workbench', '#/workbench/1'],
      ['review', '#/review/1/2'],
      ['delivery', '#/delivery/1'],
    ]) await scan(label, route);

    await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
    await page.locator('#tab-sub').click();
    await page.addScriptTag({ path: axePath });
    const submitter = await summarizePage(page);
    scans.push({ label: 'submitter-entry', route: '#/login (submitter tab)', ...submitter });

    if (SUBMITTER_CREDENTIAL) {
      await page.locator('#lg-cred').fill(SUBMITTER_CREDENTIAL);
      await page.locator('button:has-text("进入我的提交空间")').click();
      await page.locator('#field-name').waitFor();
      await page.addScriptTag({ path: axePath });
      const submitterForm = await summarizePage(page);
      scans.push({ label: 'submitter-form', route: 'authenticated submitter form', ...submitterForm });
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const report = {
    base: BASE,
    generatedAt: new Date().toISOString(),
    standard: 'WCAG 2.1/2.2 A/AA automated checks via axe-core',
    scans,
    errors,
    violationCount: scans.reduce((sum, item) => sum + item.violations.length, 0),
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (OUT) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'accessibility-results.json'), json);
  }
  process.stdout.write(json);
  if (report.violationCount || Object.values(errors).some(items => items.length)) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exit(1); });
