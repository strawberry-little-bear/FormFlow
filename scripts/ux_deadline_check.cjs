/** Verify submitter-facing deadline rendering against the task timezone. */
const { launchChromium } = require('./ux_browser.cjs');
const path = require('path');
const fs = require('fs');

const BASE = process.env.FORMFLOW_WALKTHROUGH_BASE || 'http://127.0.0.1:8000';
const OUT = path.resolve(__dirname, '../docs/ux-review-2026-10-26');
const CREDENTIAL = process.env.CRED?.trim();
fs.mkdirSync(OUT, { recursive: true });

if (!CREDENTIAL) {
  console.error('Set CRED to the submitter credential before running this check.');
  process.exit(1);
}

(async () => {
  const b = await launchChromium({ headless: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await p.goto(`${BASE}/#/login?role=sub`, { waitUntil: 'networkidle' });
    await p.locator('#tab-sub').click();
    await p.locator('#lg-cred').fill(CREDENTIAL);
    await p.locator('button:has-text("进入我的提交空间")').click();
    await p.getByText('填写与上传').waitFor();
    await p.screenshot({ path: path.join(OUT, 'submitter-deadlines.png'), fullPage: true });

    const text = (await p.innerText('body')).replace(/\s+/g, ' ');
    const matches = text.match(/[^ ]{0,10}(截止|截止时间)[^ ]{0,40}/g) || [];
    console.log('页面里的截止时间文案:');
    [...new Set(matches)].forEach(m => console.log('  ·', m));
    console.log('\n时区出现次数:', (text.match(/Asia\/Shanghai/g) || []).length);

    const me = await p.evaluate(async () => {
      const token = localStorage.getItem('ff_sub_token') || '';
      const r = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
      let body = null;
      try { body = await r.json(); } catch { /* keep the status as the useful error */ }
      return { status: r.status, body };
    });
    if (me.status !== 200 || !me.body?.task) {
      throw new Error(`/api/me failed after submitter login (HTTP ${me.status})`);
    }
    const { task } = me.body;
    if (!task.timezone || !task.first_deadline || !task.correction_deadline) {
      throw new Error('task response is missing timezone or deadline fields');
    }
    const deadlineDates = [task.first_deadline, task.correction_deadline].map(value => {
      const date = new Date(value);
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: task.timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
      return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
    });
    if (!deadlineDates.every(value => text.includes(value))) {
      throw new Error(`page is missing task-timezone deadlines: ${deadlineDates.join(', ')}`);
    }
    console.log('\n/api/me task:', JSON.stringify(task));
    console.log('已验证页面显示任务时区下的截止时间:', deadlineDates.join('；'));
  } finally {
    await b.close();
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
