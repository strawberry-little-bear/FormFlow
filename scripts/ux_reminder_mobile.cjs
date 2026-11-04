/** Reminder + mobile submitter experience pass. */
const { launchChromium } = require('./ux_browser.cjs');
const path = require('path');
const fs = require('fs');

const BASE = process.env.FORMFLOW_WALKTHROUGH_BASE || 'http://127.0.0.1:8000';
const OUT = path.resolve(__dirname, '../docs/ux-review-2026-10-26');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await launchChromium({ headless: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));

  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.locator('button.demo-btn').click();
  await p.waitForTimeout(1500);

  console.log('[1] 工作台催交区');
  await p.goto(`${BASE}/#/workbench/1`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const reminder = await p.evaluate(() => {
    const el = document.querySelector('#remind-panel, #remind-panel');
    return el ? el.innerText.replace(/\s+/g, ' ').trim() : '(未找到催交区)';
  });
  console.log('  ', reminder.slice(0, 400));

  // click the generate-reminder button
  const genBtn = p.locator('button:has-text("生成催交通知")').first();
  if (await genBtn.count()) {
    await genBtn.click();
    await p.waitForTimeout(1500);
    const after = await p.evaluate(() => {
      const el = document.querySelector('#remind-panel');
      return el ? el.innerText.replace(/\s+/g, ' ').trim() : '';
    });
    console.log('  点击后:', after.slice(0, 400));
    await p.screenshot({ path: path.join(OUT, 'reminder-generated.png'), fullPage: true });
  } else {
    console.log('  ! 未找到生成催交通知按钮');
  }

  // uncheck all subjects then try generating
  const boxes = await p.locator('#remind-panel input[type=checkbox]').count();
  console.log('  催交勾选框数量:', boxes);

  // mobile submitter
  console.log('[2] 移动端提交者 390');
  const m = await b.newContext({ viewport: { width: 390, height: 844 } });
  const mp = await m.newPage();
  await mp.goto(`${BASE}/#/login?role=sub`, { waitUntil: 'networkidle' });
  await mp.locator('#tab-sub').click();
  await mp.locator('#lg-cred').fill(process.env.CRED);
  await mp.locator('button:has-text("进入我的提交空间")').click();
  await mp.getByText('填写与上传').waitFor();
  await mp.screenshot({ path: path.join(OUT, 'submitter-390.png'), fullPage: true });
  const ov = await mp.evaluate(() => ({ w: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  console.log('  横向溢出:', JSON.stringify(ov));

  console.log('\npage errors:', errs.length ? errs.join(' | ') : '(无)');
  await b.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
