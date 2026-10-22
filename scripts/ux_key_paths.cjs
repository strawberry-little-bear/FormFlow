/**
 * 关键交互路径：新建任务弹窗、无模型密钥时提交需求的降级、催交面板。
 */
const { chromium } = require('C:/Users/18428/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core');
const fs = require('fs');
const OUT = 'E:/FormFlow/docs/ux-review-2026-10-23';
const BASE = 'http://127.0.0.1:8000';
const EXEC = 'C:/Users/18428/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await chromium.launch({ executablePath: EXEC, headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const bad = [], errs = [];
  page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
  page.on('pageerror', e => errs.push(e.message));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.locator('button.demo-btn').click();
  await page.waitForTimeout(2500);

  // 1. 新建任务弹窗
  console.log('[1] 新建任务弹窗');
  await page.locator('button:has-text("新建收集任务")').first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/dialog-create.png`, fullPage: false });
  const dlgText = (await page.innerText('dialog')).replace(/\s+/g, ' ');
  console.log('   ', dlgText.substring(0, 260));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // 2. 无模型密钥时提交需求
  console.log('[2] 无密钥时提交需求（降级路径）');
  await page.goto(BASE + '/#/design/1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.locator('#chat-in').fill('我想收集下个月的社团活动报名，需要姓名、学号，还有一份活动方案 PDF');
  await page.locator('#chat-send').click();
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}/design-no-llm.png`, fullPage: true });
  const chatText = (await page.innerText('#chat-scroll')).replace(/\s+/g, ' ');
  console.log('   对话:', chatText.substring(0, 420));

  // 3. 工作台催交面板
  console.log('[3] 工作台催交');
  await page.goto(BASE + '/#/workbench/1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/workbench-remind.png`, fullPage: true });

  console.log('\n[网络错误]', bad.length ? [...new Set(bad)].join('\n') : '(无)');
  console.log('[页面异常]', errs.length ? errs.join('\n') : '(无)');
  await b.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
