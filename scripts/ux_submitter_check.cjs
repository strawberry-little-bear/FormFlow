/**
 * 提交者端走查：登录 → 表单 → 保存草稿 → 提交前核对。
 */
const { launchChromium } = require('./ux_browser.cjs');
const fs = require('fs');
const path = require('path');
const OUT = process.env.FORMFLOW_WALKTHROUGH_OUT
  ? path.resolve(process.env.FORMFLOW_WALKTHROUGH_OUT)
  : path.resolve(__dirname, '../docs/ux-review-2026-10-23');
const BASE = process.env.FORMFLOW_WALKTHROUGH_BASE || 'http://127.0.0.1:8000';
const CRED = process.argv[2];
if (!CRED) {
  console.error('缺少提交凭证。用法：node scripts/ux_submitter_check.cjs <种子脚本输出的提交凭证>');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await launchChromium({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const bad = [];
  page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  await page.goto(BASE + '/#/login', { waitUntil: 'networkidle' });
  await page.locator('#tab-sub').click();
  await page.waitForTimeout(300);
  await page.locator('#lg-cred').fill(CRED);
  await page.locator('button:has-text("进入我的提交空间")').click();
  await page.waitForTimeout(2500);

  console.log('[提交者首页]', page.url());
  await page.screenshot({ path: `${OUT}/submitter-home.png`, fullPage: true });
  let t = (await page.innerText('body')).replace(/\s+/g, ' ');
  console.log('  ', t.substring(120, 460));

  // 表单区
  console.log('[表单区]');
  await page.screenshot({ path: `${OUT}/submitter-form.png`, fullPage: true });

  // 移动端
  const m = await b.newContext({ viewport: { width: 390, height: 844 } });
  const mp = await m.newPage();
  await mp.goto(BASE + '/#/login', { waitUntil: 'networkidle' });
  await mp.locator('#tab-sub').click();
  await mp.locator('#lg-cred').fill(CRED);
  await mp.locator('button:has-text("进入我的提交空间")').click();
  await mp.waitForTimeout(2200);
  await mp.screenshot({ path: `${OUT}/submitter-mobile.png`, fullPage: true });
  const ov = await mp.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  console.log('[移动端 390px]', JSON.stringify(ov), ov.sw > ov.cw ? '❌ 横向溢出' : '✓ 无溢出');

  console.log('\n[网络错误]', bad.length ? [...new Set(bad)].join('\n') : '(无)');
  console.log('[页面异常]', errs.length ? errs.join('\n') : '(无)');
  await b.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
