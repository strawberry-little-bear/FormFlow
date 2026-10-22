/**
 * 复核页专项走查：使用正确的 subject_id，并捕获网络错误。
 */
const { chromium } = require('C:/Users/18428/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core');
const fs = require('fs');
const OUT = 'E:/FormFlow/docs/ux-review-2026-10-23';
const BASE = 'http://127.0.0.1:8000';
const EXEC = 'C:/Users/18428/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const netErrors = [];
  page.on('response', r => { if (r.status() >= 400) netErrors.push(r.status() + ' ' + r.url()); });

  // 登录
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.locator('button.demo-btn').click();
  await page.waitForTimeout(2500);

  // 正确的复核路由
  for (const sid of [1, 2, 3]) {
    console.log(`[review/${sid}]`);
    await page.goto(`${BASE}/#/review/1/${sid}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/review-s${sid}.png`, fullPage: true });
    const t = (await page.innerText('body')).replace(/\s+/g, ' ');
    const hasError = /Input should be|unable to parse|Not Found/i.test(t);
    console.log('  ', hasError ? '❌ 有原始报错' : '✓ 正常', '|', t.substring(140, 340));
  }

  // 缺失 subject 的路由（预期问题）
  console.log('[review/1 缺少 subject]');
  await page.goto(`${BASE}/#/review/1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/review-missing-subject.png`, fullPage: true });
  const t = (await page.innerText('body')).replace(/\s+/g, ' ');
  console.log('   文本:', t.substring(0, 300));

  // 提交者端
  console.log('[提交者端]');
  await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.locator('#tab-sub').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/login-submitter.png`, fullPage: true });

  console.log('\n=== 网络错误 ===');
  console.log(netErrors.length ? [...new Set(netErrors)].join('\n') : '(无)');
  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
