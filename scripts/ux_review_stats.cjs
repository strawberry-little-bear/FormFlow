const { launchChromium } = require('./ux_browser.cjs');
const BASE = process.env.FORMFLOW_WALKTHROUGH_BASE || 'http://127.0.0.1:8000';

(async () => {
  const browser = await launchChromium({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.locator('button.demo-btn').click();
  await page.waitForTimeout(1500);

  for (const [sid, name] of [[4, '赵六（2 条 failed）'], [2, '李四（1 issue 2 unknown）'], [3, '王五（2 unknown）']]) {
    await page.goto(`${BASE}/#/review/1/${sid}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const stats = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('.rev-stat, .review-stat, [class*="stat"]').forEach(el => {
        const t = el.innerText.replace(/\s+/g, ' ').trim();
        if (t && t.length < 40) out.push(t);
      });
      return out.slice(0, 12);
    });
    console.log(`\n=== ${name} ===`);
    console.log('统计条:', JSON.stringify(stats));
    const ruleRows = await page.evaluate(() => {
      const rows = [];
      document.querySelectorAll('.rule-row, .rev-rule, [data-rule-id]').forEach(el => {
        rows.push(el.innerText.replace(/\s+/g, ' ').trim().slice(0, 90));
      });
      return rows.slice(0, 10);
    });
    console.log('规则行:', JSON.stringify(ruleRows, null, 1));
    const btns = await page.evaluate(() =>
      [...document.querySelectorAll('button')].map(b => b.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 20));
    console.log('按钮:', JSON.stringify(btns));
  }
  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
