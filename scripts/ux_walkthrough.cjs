/**
 * 用 Playwright 直接走查 FormFlow 界面并截图。
 * 规避 agent-browser daemon 在 Windows 上的 about:blank 问题。
 */
const { chromium } = require('C:/Users/18428/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:8000';
const OUT = 'E:/FormFlow/docs/ux-review-2026-10-23';
const EXEC = 'C:/Users/18428/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';

fs.mkdirSync(OUT, { recursive: true });

async function shot(page, name, full = true) {
  const p = path.join(OUT, name + '.png');
  await page.screenshot({ path: p, fullPage: full });
  console.log('  saved', name + '.png');
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  // 1. 登录页
  console.log('[1] 登录页');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await shot(page, 'login');
  const loginText = await page.innerText('body');
  console.log('  文本片段:', loginText.replace(/\s+/g, ' ').substring(0, 200));

  // 2. 点「体验演示环境」
  console.log('[2] 点击体验演示环境');
  const demoBtn = page.locator('button.demo-btn');
  if (await demoBtn.count()) {
    await demoBtn.click();
    await page.waitForTimeout(2500);
    await shot(page, 'tasks');
    console.log('  当前 URL:', page.url());
    console.log('  任务页文本:', (await page.innerText('body')).replace(/\s+/g, ' ').substring(0, 300));
    const presentationToggle = page.locator('#presentation-toggle');
    if (await presentationToggle.isVisible().catch(() => false) && await presentationToggle.getAttribute('aria-pressed') === 'true') {
      await presentationToggle.click();
      await page.waitForTimeout(300);
    }
  } else {
    console.log('  ! 未找到演示按钮');
  }

  // 3. 进入任务工作台
  console.log('[3] 进入工作台');
  const enterLink = page.locator('a.task-enter').first();
  if (await enterLink.count()) {
    await enterLink.click();
    await page.waitForTimeout(2000);
    await shot(page, 'workbench');
    console.log('  URL:', page.url());
  } else {
    console.log('  ! 未找到任务入口');
  }

  // 4. 导航各页面
  const routes = [
    ['#/tasks', 'tasks-nav'],
    ['#/design/1', 'design'],
    ['#/workbench/1', 'workbench-nav'],
    ['#/roster/1', 'roster'],
    ['#/review/1', 'review'],
    ['#/delivery/1', 'delivery'],
  ];
  console.log('[4] 遍历页面');
  for (const [hash, name] of routes) {
    await page.goto(BASE + '/' + hash, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(1200);
    await shot(page, name);
    const t = (await page.innerText('body').catch(() => '')).replace(/\s+/g, ' ').substring(0, 150);
    console.log(`  ${hash} -> ${t}`);
  }

  // 5. 移动端 390px
  console.log('[5] 移动端 390px');
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mp = await mobile.newPage();
  await mp.goto(BASE + '/#/login', { waitUntil: 'networkidle' });
  await mp.waitForTimeout(800);
  await shot(mp, 'login-mobile');
  const overflow = await mp.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  console.log('  横向溢出检查:', JSON.stringify(overflow));

  console.log('\n=== 控制台错误 ===');
  console.log(errors.length ? errors.slice(0, 10).join('\n') : '(无)');

  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
