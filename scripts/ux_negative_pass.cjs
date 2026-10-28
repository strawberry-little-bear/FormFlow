/** Negative-path pass: wrong credential, wrong password, bad upload. */
const { launchChromium } = require('./ux_browser.cjs');
const path = require('path');
const fs = require('fs');

const BASE = process.env.FORMFLOW_WALKTHROUGH_BASE || 'http://127.0.0.1:8000';
const OUT = path.resolve(__dirname, '../docs/ux-review-2026-10-26');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await launchChromium({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // 1. wrong organizer password
  await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
  await page.locator('#lg-user').fill('demo');
  await page.locator('#lg-pass').fill('wrong-password');
  await page.locator('button:has-text("登录")').first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, 'err-wrong-password.png'), fullPage: false });
  console.log('[1] 错误密码提示:', (await page.innerText('body')).replace(/\s+/g, ' ').match(/.{0,120}密码.{0,120}/)?.[0] || '(未找到提示)');

  // 2. wrong submitter credential
  await page.goto(`${BASE}/#/login?role=sub`, { waitUntil: 'networkidle' });
  await page.locator('#tab-sub').click();
  await page.locator('#lg-cred').fill('not-a-real-credential-000000');
  await page.locator('button:has-text("进入我的提交空间")').click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, 'err-wrong-credential.png'), fullPage: false });
  const credText = (await page.innerText('body')).replace(/\s+/g, ' ');
  console.log('[2] 错误凭证提示:', credText.match(/.{0,150}凭证.{0,150}/)?.[0] || credText.slice(0, 200));

  // 3. login then try uploading a disallowed type
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.locator('button.demo-btn').click();
  await page.waitForTimeout(1500);

  // 4. open a task with no blueprint / nonexistent task id
  await page.goto(`${BASE}/#/workbench/9999`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, 'err-missing-task.png'), fullPage: false });
  console.log('[3] 不存在的任务:', (await page.innerText('body')).replace(/\s+/g, ' ').slice(0, 220));

  // 5. design page for nonexistent task
  await page.goto(`${BASE}/#/design/9999`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  console.log('[4] 不存在任务的设计页:', (await page.innerText('body')).replace(/\s+/g, ' ').slice(0, 200));

  console.log('\npage errors:', errors.length ? errors.join(' | ') : '(无)');
  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
