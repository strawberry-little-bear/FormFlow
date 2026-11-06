/**
 * Cross-material showcase walkthrough for the isolated demo seed.
 *
 * It checks both sides of the second showcase task:
 * - organizer review sees per-rule evidence for materials A/B;
 * - submitter sees the formal receipt and only organizer-owned follow-up work.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchChromium } = require('./ux_browser.cjs');

const BASE = (process.env.FORMFLOW_WALKTHROUGH_BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
const TASK_ID = Number.parseInt(process.env.FORMFLOW_CROSS_TASK_ID || '2', 10);
const CREDENTIAL = process.env.FORMFLOW_CROSS_CREDENTIAL || '';
const SUBJECT_IDS_FROM_ENV = (process.env.FORMFLOW_CROSS_SUBJECT_IDS || '')
  .split(',').map(value => Number.parseInt(value.trim(), 10)).filter(Number.isInteger);
const OUT = process.env.FORMFLOW_WALKTHROUGH_OUT
  ? path.resolve(process.env.FORMFLOW_WALKTHROUGH_OUT)
  : path.join(os.tmpdir(), `formflow-cross-material-${Date.now()}`);

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launchChromium({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  const badResponses = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().startsWith(BASE) && response.status() >= 400) {
      badResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  const report = {
    base: BASE,
    taskId: TASK_ID,
    organizer: { reviews: [] },
    submitter: null,
    errors,
    badResponses,
    output: OUT,
  };

  try {
    await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
    await page.locator('button.demo-btn').click();
    await page.waitForTimeout(500);

    // Subject ids are database-global, so discover the task's actual review
    // links instead of assuming they start at 1 in a fresh database.
    let subjectIds = SUBJECT_IDS_FROM_ENV;
    if (!subjectIds.length) {
      await page.goto(`${BASE}/#/workbench/${TASK_ID}`, { waitUntil: 'networkidle' });
      // The workbench renders its loading shell first and fills the rows after
      // the authenticated API response arrives.  Waiting on a fixed timeout
      // made this walkthrough race the real page and report a false failure.
      await page.locator('#wb-list .wb-row').first().waitFor({ state: 'visible' });
      subjectIds = await page.locator(`a[href^="#/review/${TASK_ID}/"]`).evaluateAll(nodes => {
        const ids = nodes.map(node => Number.parseInt(node.getAttribute('href').split('/').pop(), 10));
        return [...new Set(ids)].filter(Number.isInteger);
      });
    }
    if (!subjectIds.length) throw new Error(`no review links found for task ${TASK_ID}`);

    report.subjectIds = subjectIds;
    for (const subjectId of subjectIds) {
      await page.goto(`${BASE}/#/review/${TASK_ID}/${subjectId}`, { waitUntil: 'networkidle' });
      await page.getByText('逐条核对证据', { exact: false }).waitFor();
      await page.waitForTimeout(500);
      const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      const evidenceCount = await page.locator('[data-evidence], .evidence-row, .review-evidence').count();
      const review = {
        subjectId,
        text,
        hasCrossMaterialLabels: text.includes('材料 A') && text.includes('材料 B'),
        hasEvidenceLocation: /p\.\s*1|第\s*1\s*页|原文位置/.test(text),
        hasOrganizerNextStep: text.includes('组织者处理建议') || text.includes('组织者待办'),
        evidenceCount,
      };
      report.organizer.reviews.push(review);
      await page.screenshot({ path: path.join(OUT, `review-${subjectId}.png`), fullPage: true });
    }

    if (CREDENTIAL) {
      await page.goto(`${BASE}/#/login?role=sub`, { waitUntil: 'networkidle' });
      await page.locator('#tab-sub').click();
      await page.locator('#lg-cred').fill(CREDENTIAL);
      await page.locator('button:has-text("进入我的提交空间")').click();
      await page.getByText('登记字段', { exact: false }).waitFor();
      await page.waitForTimeout(500);
      const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      report.submitter = {
        hash: await page.evaluate(() => location.hash),
        hasIdentityFields: ['姓名', '学号', '班级'].every(label => text.includes(label)),
        hasBothMaterialSlots: text.includes('报名材料 A') && text.includes('报名材料 B'),
        hasReceipt: text.includes('已正式提交') && text.includes('提交时间'),
        hasOrganizerLane: text.includes('组织者待办'),
        saysNoSubmitterWork: text.includes('暂时没有需要你处理的事项'),
      };
      await page.screenshot({ path: path.join(OUT, 'submitter.png'), fullPage: true });
    }

    fs.writeFileSync(path.join(OUT, 'result.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    const failures = [];
    if (report.organizer.reviews.length !== report.subjectIds.length) failures.push('not all review routes were visited');
    for (const review of report.organizer.reviews) {
      if (!review.hasCrossMaterialLabels) failures.push(`review ${review.subjectId} lacks A/B material labels`);
      if (!review.hasEvidenceLocation) failures.push(`review ${review.subjectId} lacks evidence locations`);
      if (!review.hasOrganizerNextStep) failures.push(`review ${review.subjectId} lacks organizer next step`);
    }
    if (CREDENTIAL && (!report.submitter || report.submitter.hash !== '#/submit'
      || !report.submitter.hasIdentityFields || !report.submitter.hasBothMaterialSlots
      || !report.submitter.hasReceipt || !report.submitter.hasOrganizerLane
      || !report.submitter.saysNoSubmitterWork)) {
      failures.push('submitter lane does not separate organizer work from submitter work');
    }
    if (errors.length) failures.push('browser errors were reported');
    if (badResponses.length) failures.push('failed HTTP responses were reported');
    if (failures.length) throw new Error(failures.join('; '));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch(error => {
  console.error(`Cross-material walkthrough failed: ${error.message}`);
  process.exitCode = 1;
});
