/** Verify submitter-facing deadline rendering against the task timezone. */
const { launchChromium } = require('./ux_browser.cjs');
const path = require('path');
const fs = require('fs');

const BASE = process.env.FORMFLOW_WALKTHROUGH_BASE || 'http://127.0.0.1:8000';
const OUT = path.resolve(__dirname, '../docs/ux-review-2026-10-26');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await launchChromium({ headless: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto(`${BASE}/#/login?role=sub`, { waitUntil: 'networkidle' });
  await p.locator('#tab-sub').click();
  await p.locator('#lg-cred').fill(process.env.CRED);
  await p.locator('button:has-text("进入我的提交空间")').click();
  await p.getByText('填写与上传').waitFor();
  await p.screenshot({ path: path.join(OUT, 'submitter-deadlines.png'), fullPage: true });

  const text = (await p.innerText('body')).replace(/\s+/g, ' ');
  const matches = text.match(/[^ ]{0,10}(截止|截止时间)[^ ]{0,40}/g) || [];
  console.log('页面里的截止时间文案:');
  [...new Set(matches)].forEach(m => console.log('  ·', m));
  console.log('\n时区出现次数:', (text.match(/Asia\/Shanghai/g) || []).length);

  const me = await p.evaluate(async () => {
    const r = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + (localStorage.getItem('ff_cred') || '') } });
    return r.ok ? r.json() : { error: r.status };
  }).catch(() => ({ error: 'fetch failed' }));
  console.log('\n/api/me task:', JSON.stringify(me.task || me));
  await b.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
