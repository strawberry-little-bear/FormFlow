/** Exercise the submitter flow against an isolated demo seed. */
const { launchChromium } = require('./ux_browser.cjs');
const fs = require('fs');
const path = require('path');

const BASE = process.env.FORMFLOW_WALKTHROUGH_BASE || 'http://127.0.0.1:8000';
const CREDENTIAL = process.env.FORMFLOW_WALKTHROUGH_CREDENTIAL;
const SUBJECT_NAME = process.env.FORMFLOW_WALKTHROUGH_SUBJECT || '赵六';
const OUT = process.env.FORMFLOW_WALKTHROUGH_OUT
  ? path.resolve(process.env.FORMFLOW_WALKTHROUGH_OUT)
  : path.resolve(__dirname, '../docs/ux-review-2026-10-25/submitter-full');

if (!CREDENTIAL) {
  console.error(`Set FORMFLOW_WALKTHROUGH_CREDENTIAL to the credential for ${SUBJECT_NAME}.`);
  process.exit(2);
}

fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await launchChromium({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  const pageErrors = [];
  const badResponses = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => {
    if (response.url().startsWith(BASE) && response.status() >= 400) {
      badResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  try {
    await page.goto(`${BASE}/#/login?role=sub`, { waitUntil: 'networkidle' });
    await page.locator('#tab-sub').click();
    await page.locator('#lg-cred').fill(CREDENTIAL);
    await page.locator('button:has-text("进入我的提交空间")').click();
    await page.getByText('填写与上传').waitFor();
    await page.screenshot({ path: path.join(OUT, 'submitter-form-before.png'), fullPage: true });

    await page.locator('#field-name').fill(SUBJECT_NAME);
    await page.locator('#field-term').fill('2026 秋季第 1 期');
    await page.locator('#field-class_name').fill('二班');
    await page.locator('#file-report').setInputFiles({
      name: `${SUBJECT_NAME}_团课报告.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from(`姓名：${SUBJECT_NAME}\n期次：2026 秋季第 1 期\n活动内容：参加本期团课并完成学习。\n个人收获：对主题有了更系统的理解。`, 'utf8'),
    });
    const selectedFileVisible = await page.locator('.file-picker-wrap:has(#file-report) .file-picker-name').innerText();
    if (selectedFileVisible !== `${SUBJECT_NAME}_团课报告.txt`) {
      throw new Error(`Selected file name was not shown: ${selectedFileVisible}`);
    }

    const uploadResponse = page.waitForResponse(response =>
      response.url().includes('/api/me/files') && response.request().method() === 'POST');
    await page.locator('#upload-report').click();
    const uploaded = await uploadResponse;
    if (!uploaded.ok()) throw new Error(`Upload failed with HTTP ${uploaded.status()}: ${await uploaded.text()}`);
    await page.locator('#slot-files-report .file-chip-name').getByText(`${SUBJECT_NAME}_团课报告.txt`, { exact: true }).waitFor();

    const draftResponse = page.waitForResponse(response =>
      response.url().includes('/api/me/draft') && response.request().method() === 'POST');
    await page.locator('button:has-text("保存草稿")').click();
    const saved = await draftResponse;
    if (!saved.ok()) throw new Error(`Draft save failed with HTTP ${saved.status()}: ${await saved.text()}`);
    await page.waitForFunction(() => document.querySelector('#draft-hint')?.textContent.includes('已保存到服务器'));
    await page.screenshot({ path: path.join(OUT, 'submitter-draft-saved.png'), fullPage: true });

    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#submode-chat').click();
    await page.getByText('核对一下再提交', { exact: false }).waitFor();
    const restoredDraftSkipsUploadedSlot = await page.locator('#sub-chat-scroll').innerText()
      .then(text => text.includes('核对一下再提交') && !text.includes('第 1/1 项材料'));
    if (!restoredDraftSkipsUploadedSlot) {
      throw new Error('Restored guide did not skip the already-uploaded material.');
    }
    await page.screenshot({ path: path.join(OUT, 'submitter-draft-restored-guide.png'), fullPage: true });

    const submitResponse = page.waitForResponse(response =>
      response.url().includes('/api/me/submit') && response.request().method() === 'POST');
    await page.locator('button:has-text("提交材料并开始核对")').click();
    const submitted = await submitResponse;
    if (!submitted.ok()) throw new Error(`Formal submit failed with HTTP ${submitted.status()}: ${await submitted.text()}`);
    await page.getByText(/已正式提交 · v1/).waitFor();
    await page.getByText('提交时间').waitFor();
    const formalGuidanceVisible = await page.getByText('补正与回执', { exact: true }).count() === 1
      && await page.getByText('提交前核对', { exact: true }).count() === 0;
    if (!formalGuidanceVisible) throw new Error('Formal submission still shows pre-submission guidance.');
    await page.screenshot({ path: path.join(OUT, 'submitter-receipt.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: 'networkidle' });
    const mobile = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
    }));
    await page.screenshot({ path: path.join(OUT, 'submitter-receipt-390.png'), fullPage: true });

    const report = {
      base: BASE,
      generatedAt: new Date().toISOString(),
      path: ['credential login', 'complete fields', 'upload file', 'save server draft', 'reload draft', 'verify guide skips uploaded material', 'formal submit', 'read receipt'],
      uploadStatus: uploaded.status(),
      selectedFileVisible,
      draftStatus: saved.status(),
      restoredDraftSkipsUploadedSlot,
      submitStatus: submitted.status(),
      receiptVisible: await page.getByText(/已正式提交 · v1/).count() > 0,
      formalGuidanceVisible,
      mobile,
      consoleErrors,
      pageErrors,
      badResponses,
    };
    fs.writeFileSync(path.join(OUT, 'submitter-results.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    if (!report.receiptVisible || !report.formalGuidanceVisible || mobile.document > mobile.viewport || consoleErrors.length || pageErrors.length || badResponses.length) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
