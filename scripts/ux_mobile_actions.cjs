/** Measure mobile action-row layout on the submitter page. */
const { launchChromium } = require('./ux_browser.cjs');
const path = require('path');
const fs = require('fs');
const BASE = process.env.FORMFLOW_WALKTHROUGH_BASE || 'http://127.0.0.1:8000';
const OUT = path.resolve(__dirname, '../docs/ux-review-2026-10-26');

(async () => {
  const b = await launchChromium({ headless: true });
  for (const width of [390, 320]) {
    const ctx = await b.newContext({ viewport: { width, height: 844 } });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/#/login?role=sub`, { waitUntil: 'networkidle' });
    await p.locator('#tab-sub').click();
    await p.locator('#lg-cred').fill(process.env.CRED);
    await p.locator('button:has-text("进入我的提交空间")').click();
    await p.getByText('填写与上传').waitFor();
    await p.waitForTimeout(800);

    const info = await p.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].filter(b => /提交材料|保存草稿|重新加载/.test(b.innerText));
      return btns.map(b => {
        const r = b.getBoundingClientRect();
        const cs = getComputedStyle(b);
        const lines = Math.round(r.height / parseFloat(cs.lineHeight || 18));
        return { text: b.innerText.replace(/\s+/g, ' ').trim(), w: Math.round(r.width), h: Math.round(r.height), lines };
      });
    });
    console.log(`\n=== ${width}px ===`);
    info.forEach(i => console.log(`  ${i.text} → ${i.w}×${i.h}px, 约 ${i.lines} 行`));

    const h1 = await p.evaluate(() => {
      const el = document.querySelector('h1');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { text: el.innerText.replace(/\s+/g, ' ').trim(), h: Math.round(r.height), w: Math.round(r.width) };
    });
    console.log('  h1:', JSON.stringify(h1));

    // capture just the action row
    const row = p.locator('button:has-text("提交材料")').first();
    if (await row.count()) {
      await row.scrollIntoViewIfNeeded();
      const box = await row.boundingBox();
      if (box) {
        const x = Math.max(0, box.x - 20);
        const y = Math.max(0, box.y - 30);
        const right = Math.min(width, box.x + box.width + 40);
        const bottom = box.y + box.height + 30;
        await p.screenshot({
          path: path.join(OUT, `submitter-actions-${width}.png`),
          clip: { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) },
        });
        console.log('  saved actions clip');
      }
    }
    await ctx.close();
  }
  await b.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
