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
    const correctionButton = page.locator('.submit-action-primary');
    const unchangedCorrectionDisabled = await correctionButton.isDisabled();
    if (!unchangedCorrectionDisabled || !await correctionButton.getByText('当前版本已提交').count()) {
      throw new Error('Unchanged formal content still offers a correction submission.');
    }
    const nameField = page.locator('#field-name');
    await nameField.fill(SUBJECT_NAME + '（更正）');
    await page.waitForFunction(() => !document.querySelector('.submit-action-primary')?.disabled);
    const editedCorrectionEnabled = !await correctionButton.isDisabled();
    await nameField.fill(SUBJECT_NAME);
    await page.waitForFunction(() => document.querySelector('.submit-action-primary')?.disabled);
    if (!editedCorrectionEnabled) throw new Error('Changing formal content did not enable correction submission.');
    await page.screenshot({ path: path.join(OUT, 'submitter-receipt.png'), fullPage: true });

    const checkResultsJump = async width => {
      const button = page.locator('button:has-text("查看核对记录")').first();
      if (!await button.count()) throw new Error(`正式提交后缺少核对记录入口：${width}px`);
      await button.click();
      await page.waitForFunction(() => {
        const target = document.querySelector('#my-results-card');
        const heading = document.querySelector('#my-results-heading');
        const topbar = document.querySelector('.topbar');
        if (!target || !heading || document.activeElement !== target) return false;
        const headingRect = heading.getBoundingClientRect();
        const topbarRect = topbar?.getBoundingClientRect();
        const topbarBottom = topbar && getComputedStyle(topbar).display !== 'none' ? topbarRect.bottom : 0;
        const targetTop = target.getBoundingClientRect().top;
        return headingRect.top >= topbarBottom && headingRect.bottom <= innerHeight && targetTop <= 180;
      });
      const evidence = await page.evaluate(() => {
        const target = document.querySelector('#my-results-card');
        const heading = document.querySelector('#my-results-heading');
        const topbar = document.querySelector('.topbar');
        const targetRect = target.getBoundingClientRect();
        const headingRect = heading.getBoundingClientRect();
        const topbarRect = topbar?.getBoundingClientRect();
        return {
          viewport: document.documentElement.clientWidth,
          focused: document.activeElement === target,
          targetTop: Math.round(targetRect.top),
          headingTop: Math.round(headingRect.top),
          headingBottom: Math.round(headingRect.bottom),
          topbarBottom: topbar && getComputedStyle(topbar).display !== 'none' ? Math.round(topbarRect.bottom) : 0,
          accessibleName: target.getAttribute('aria-labelledby') === 'my-results-heading' ? heading.textContent.trim() : '',
          scrollMarginTop: getComputedStyle(target).scrollMarginTop,
        };
      });
      const visibleBelowStickyBar = evidence.headingTop >= evidence.topbarBottom
        && evidence.headingBottom <= (await page.evaluate(() => innerHeight));
      if (!evidence.focused || !evidence.accessibleName || !visibleBelowStickyBar) {
        throw new Error(`核对记录跳转未将标题和焦点带入可见区域：${JSON.stringify(evidence)}`);
      }
      return evidence;
    };

    const resultsNavigation = { desktop: await checkResultsJump(1440) };

    const mobile = [];
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.reload({ waitUntil: 'networkidle' });
      const measurement = await page.evaluate(() => {
        const button = document.querySelector('.submit-primary-dock button');
        const dock = document.querySelector('.submit-primary-dock');
        const resultsHeading = document.querySelector('#my-results-heading');
        const rect = button?.getBoundingClientRect();
        const headingRect = resultsHeading?.getBoundingClientRect();
        return {
          viewport: document.documentElement.clientWidth,
          document: document.documentElement.scrollWidth,
          actionHeight: rect ? Math.round(rect.height) : 0,
          dockActiveAtPageTop: dock?.classList.contains('is-docked') || false,
          resultsHeadingVisibleAtPageTop: !!headingRect && headingRect.top >= 0 && headingRect.bottom <= window.innerHeight,
        };
      });
      if (measurement.dockActiveAtPageTop) {
        throw new Error(`页面顶部仍错误显示固定提交栏：${JSON.stringify(measurement)}`);
      }
      await page.locator('.submit-form-card').scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.querySelector('.submit-primary-dock')?.classList.contains('is-docked'));
      const actionVisible = await page.evaluate(() => {
        const rect = document.querySelector('.submit-primary-dock button')?.getBoundingClientRect();
        return !!rect && rect.top >= 0 && rect.bottom <= window.innerHeight;
      });
      measurement.actionVisibleInForm = actionVisible;
      mobile.push({ width, ...measurement });
      if (width === 320) resultsNavigation.mobile320 = await checkResultsJump(width);
      await page.screenshot({
        path: path.join(OUT, `submitter-receipt-${width}.png`),
        fullPage: true,
      });
    }

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
      unchangedCorrectionDisabled,
      editedCorrectionEnabled,
      resultsNavigation,
      mobile,
      consoleErrors,
      pageErrors,
      badResponses,
    };
    fs.writeFileSync(path.join(OUT, 'submitter-results.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    const mobilePassed = mobile.length === 2 && mobile.every(viewport =>
      viewport.viewport === viewport.width
      && viewport.document === viewport.width
      && !viewport.dockActiveAtPageTop
      && viewport.actionVisibleInForm
      && viewport.actionHeight >= 48
    );
    if (!report.receiptVisible || !report.formalGuidanceVisible || !unchangedCorrectionDisabled || !editedCorrectionEnabled || !mobilePassed || consoleErrors.length || pageErrors.length || badResponses.length) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
