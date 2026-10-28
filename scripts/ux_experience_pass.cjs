/** Experience pass: review + delivery pages with real data, desktop + mobile. */
const { launchChromium } = require('./ux_browser.cjs');
const fs = require('fs');
const path = require('path');

const BASE = process.env.FORMFLOW_WALKTHROUGH_BASE || 'http://127.0.0.1:8000';
const OUT = path.resolve(__dirname, '../docs/ux-review-2026-10-26');
fs.mkdirSync(OUT, { recursive: true });

const shot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
  console.log('  saved', name + '.png');
};

(async () => {
  const browser = await launchChromium({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const errors = [];
  const bad = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('response', r => {
    if (r.url().startsWith(BASE) && r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
  });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.locator('button.demo-btn').click();
  await page.waitForTimeout(2000);

  // review with data (subject 2 = 李四, has issue + unknown)
  console.log('[1] 复核页 · 李四');
  await page.goto(`${BASE}/#/review/1/2`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, 'review-lisi');
  const reviewText = (await page.innerText('body')).replace(/\s+/g, ' ');
  console.log('  ', reviewText.substring(0, 400));

  // review with failed rules (subject 4 = 赵六, no LLM key)
  console.log('[2] 复核页 · 赵六（无模型密钥）');
  await page.goto(`${BASE}/#/review/1/4`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, 'review-zhaoliu-nollm');
  const zlText = (await page.innerText('body')).replace(/\s+/g, ' ');
  const hasRetry = await page.locator('button:has-text("重试")').count();
  const hasManual = await page.locator('button:has-text("转人工")').count();
  console.log('  重试按钮数:', hasRetry, '转人工按钮数:', hasManual);
  console.log('  ', zlText.substring(0, 300));

  // delivery after snapshot
  console.log('[3] 交付页 · 已有快照');
  await page.goto(`${BASE}/#/delivery/1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, 'delivery-with-snapshot');
  console.log('  ', (await page.innerText('body')).replace(/\s+/g, ' ').substring(0, 300));

  // workbench
  console.log('[4] 工作台');
  await page.goto(`${BASE}/#/workbench/1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await shot(page, 'workbench-live');

  // mobile review
  console.log('[5] 移动端复核 390');
  const m = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mp = await m.newPage();
  await mp.goto(BASE, { waitUntil: 'networkidle' });
  await mp.locator('button.demo-btn').click();
  await mp.waitForTimeout(1800);
  await mp.goto(`${BASE}/#/review/1/2`, { waitUntil: 'networkidle' });
  await mp.waitForTimeout(1500);
  await shot(mp, 'review-390');
  const ov = await mp.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  console.log('  横向溢出:', JSON.stringify(ov));

  console.log('\n=== console errors ===');
  console.log(errors.length ? errors.slice(0, 10).join('\n') : '(无)');
  console.log('=== bad responses ===');
  console.log(bad.length ? bad.slice(0, 10).join('\n') : '(无)');
  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
