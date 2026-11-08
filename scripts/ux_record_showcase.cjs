/** Record a short browser tour using fictional data in an isolated demo seed. */
const fs = require('node:fs');
const path = require('node:path');
const { launchChromium } = require('./ux_browser.cjs');

const BASE = (process.env.FORMFLOW_WALKTHROUGH_BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
const OUTPUT = path.resolve(process.env.FORMFLOW_VIDEO_OUT || 'formflow-showcase.webm');
const DESIGN_TASK_ID = Number(process.env.FORMFLOW_VIDEO_DESIGN_TASK_ID || 3);
const CROSS_TASK_ID = Number(process.env.FORMFLOW_VIDEO_CROSS_TASK_ID || 2);
const REVIEW_SUBJECT_ID = Number(process.env.FORMFLOW_VIDEO_REVIEW_SUBJECT_ID || 7);
const DELIVERY_TASK_ID = Number(process.env.FORMFLOW_VIDEO_DELIVERY_TASK_ID || 4);
const SUBMITTER_CREDENTIAL = process.env.FORMFLOW_VIDEO_SUBMITTER_CREDENTIAL || '';

async function hold(page, ms = 5000) {
  await page.waitForTimeout(ms);
}

async function main() {
  if (!SUBMITTER_CREDENTIAL) throw new Error('Set FORMFLOW_VIDEO_SUBMITTER_CREDENTIAL to a fictional seed credential.');
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  const browser = await launchChromium({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: path.dirname(OUTPUT), size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();
  const video = page.video();

  try {
    await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
    await hold(page, 2500);
    await page.locator('button.demo-btn').click();
    await page.waitForURL('**/#/tasks');
    await hold(page);

    await page.goto(`${BASE}/#/design/${DESIGN_TASK_ID}`, { waitUntil: 'networkidle' });
    await page.locator('#draft-panel').waitFor({ state: 'visible' });
    await hold(page, 6500);

    await page.goto(`${BASE}/#/workbench/${CROSS_TASK_ID}`, { waitUntil: 'networkidle' });
    await page.locator('#wb-list .wb-row').first().waitFor({ state: 'visible' });
    await hold(page, 5500);

    await page.goto(`${BASE}/#/review/${CROSS_TASK_ID}/${REVIEW_SUBJECT_ID}`, { waitUntil: 'networkidle' });
    await page.getByText('逐条核对证据', { exact: false }).waitFor();
    await hold(page, 7000);

    await page.evaluate(credential => {
      localStorage.setItem('ff_sub_token', credential);
      location.hash = '#/submit';
    }, SUBMITTER_CREDENTIAL);
    await page.getByText('登记字段', { exact: false }).waitFor();
    await hold(page, 6500);

    await page.evaluate(taskId => { location.hash = `#/delivery/${taskId}`; }, DELIVERY_TASK_ID);
    await page.getByRole('heading', { name: '交付与归档' }).waitFor();
    await hold(page, 6500);
  } finally {
    await context.close();
    await browser.close();
  }

  const recordedPath = await video.path();
  if (path.resolve(recordedPath) !== OUTPUT) fs.renameSync(recordedPath, OUTPUT);
  console.log(JSON.stringify({ output: OUTPUT, bytes: fs.statSync(OUTPUT).size }));
}

main().catch(error => {
  console.error(`Showcase recording failed: ${error.message}`);
  process.exitCode = 1;
});
