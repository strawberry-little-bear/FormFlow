/** Browser-level recovery check for submitter result reads. */
const { launchChromium } = require('./ux_browser.cjs');
const fs = require('fs');
const path = require('path');

const BASE = process.env.FORMFLOW_WALKTHROUGH_BASE || 'http://127.0.0.1:8000';
const OUT = process.env.FORMFLOW_WALKTHROUGH_OUT
  ? path.resolve(process.env.FORMFLOW_WALKTHROUGH_OUT)
  : path.resolve(__dirname, '../docs/ux-review-2026-10-25/round-9-results-reconnect');
fs.mkdirSync(OUT, { recursive: true });

const json = (route, body, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

(async () => {
  const browser = await launchChromium({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => localStorage.setItem('ff_sub_token', 'browser-recovery-fixture'));
  const page = await context.newPage();
  const consoleErrors = [];
  const injectedFailureConsoleErrors = [];
  const pageErrors = [];
  const requests = { results: 0 };
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (message.text().includes('503 (Service Unavailable)')) injectedFailureConsoleErrors.push(message.text());
    else consoleErrors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') return json(route, {
      subject: { id: 101, name: '赵六', kind: 'person' },
      task: {
        id: 1, name: '团课材料收集', status: 'collecting', timezone: 'Asia/Shanghai',
        first_deadline: '2026-10-26T12:00:00+08:00',
        correction_deadline: '2026-10-27T12:00:00+08:00',
      },
      blueprint: {
        fields: [{ id: 'name', label: '姓名', required: true, type: 'text' }],
        slots: [{ id: 'report', label: '活动报告', formats: ['pdf'], max_count: 1 }],
        rules: [],
      },
    });
    if (url.pathname === '/api/me/draft') return json(route, {
      fields: {}, slot_file_ids: {}, draft_version: 1, updated_at: null,
    });
    if (url.pathname === '/api/me/receipt') return json(route, {
      formal: true, revision: 1, receipt: 'FF-DEMO-001',
      formal_submitted_at: '2026-10-25T09:00:00+08:00', files: [],
    });
    if (url.pathname === '/api/me/results') {
      requests.results++;
      if (requests.results <= 2) return json(route, { detail: 'temporarily unavailable' }, 503);
      return json(route, {
        summary: '结果已更新', run_status: 'success', revision: 1,
        details: [], buckets: {}, coverage: {}, appeals: [],
      });
    }
    return json(route, { detail: `Unexpected API request: ${url.pathname}` }, 404);
  });

  try {
    await page.goto(`${BASE}/#/submit`, { waitUntil: 'networkidle' });
    if (!await page.getByText('结果暂时无法更新').count()) {
      console.log(JSON.stringify({
        url: page.url(),
        text: (await page.locator('body').innerText()).slice(0, 1200),
        requests,
        consoleErrors,
        pageErrors,
      }, null, 2));
    }
    await page.getByText('结果暂时无法更新').waitFor();
    await page.screenshot({ path: path.join(OUT, 'results-offline.png'), fullPage: true });
    const before = await page.locator('#my-results').innerText();
    const firstReconnect = page.waitForResponse(response => response.url().includes('/api/me/results'));
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    const firstReconnectResponse = await firstReconnect;
    await page.getByText('结果暂时无法更新').waitFor();
    const afterFailedReconnect = await page.locator('#my-results').innerText();
    const nextStepAfterFailedReconnect = await page.locator('#submit-next-step').innerText();
    const secondReconnect = page.waitForResponse(response => response.url().includes('/api/me/results'));
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    const secondReconnectResponse = await secondReconnect;
    await page.getByText('结果已更新').waitFor();
    const after = await page.locator('#my-results').innerText();
    await page.screenshot({ path: path.join(OUT, 'results-reconnected.png'), fullPage: true });
    const report = {
      base: BASE,
      api: 'intercepted with deterministic submitter fixtures',
      resultRequests: requests.results,
      offlineNoticeShown: before.includes('结果暂时无法更新'),
      firstReconnectStatus: firstReconnectResponse.status(),
      retryableFailureRetained: afterFailedReconnect.includes('结果暂时无法更新')
        && nextStepAfterFailedReconnect.includes('当前核对结果暂时读不到')
        && !nextStepAfterFailedReconnect.includes('正在读取这份提交的核对结果'),
      secondReconnectStatus: secondReconnectResponse.status(),
      recovered: after.includes('结果已更新'),
      injectedFailureConsoleErrors,
      consoleErrors,
      pageErrors,
    };
    fs.writeFileSync(path.join(OUT, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
    if (requests.results !== 3 || !report.offlineNoticeShown || firstReconnectResponse.status() !== 503
      || !report.retryableFailureRetained || secondReconnectResponse.status() !== 200 || !report.recovered
      || consoleErrors.length || pageErrors.length) {
      throw new Error(`Recovery assertion failed: ${JSON.stringify(report)}`);
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
