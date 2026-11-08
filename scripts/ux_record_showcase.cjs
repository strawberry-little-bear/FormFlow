/** Record a subtitle-led browser tour using fictional data in an isolated demo seed. */
const fs = require('node:fs');
const path = require('node:path');
const { launchChromium } = require('./ux_browser.cjs');

const BASE = (process.env.FORMFLOW_WALKTHROUGH_BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
const OUTPUT = path.resolve(process.env.FORMFLOW_VIDEO_OUT || 'formflow-showcase.webm');
const DESIGN_TASK_ID = Number(process.env.FORMFLOW_VIDEO_DESIGN_TASK_ID || 3);
const CROSS_TASK_ID = Number(process.env.FORMFLOW_VIDEO_CROSS_TASK_ID || 2);
const REVIEW_SUBJECT_ID = Number(process.env.FORMFLOW_VIDEO_REVIEW_SUBJECT_ID || 7);
const DELIVERY_TASK_ID = Number(process.env.FORMFLOW_VIDEO_DELIVERY_TASK_ID || 4);
const SUBMITTER_CREDENTIAL = process.env.FORMFLOW_VIDEO_SUBMITTER_CREDENTIAL || '';

async function hold(page, ms = 3500) {
  await page.waitForTimeout(ms);
}

async function installShowcaseChrome(page) {
  await page.addStyleTag({ content: `
    #ff-video-chrome { position:fixed; inset:0; z-index:2147483647; pointer-events:none; font-family:"Noto Sans SC","Microsoft YaHei",sans-serif; }
    #ff-video-progress { position:absolute; left:0; top:0; height:4px; width:0; background:linear-gradient(90deg,#7655d8,#31a98a); box-shadow:0 0 18px rgba(118,85,216,.6); transition:width .45s ease; }
    #ff-video-chapter { position:absolute; left:36px; top:28px; display:flex; align-items:center; gap:10px; padding:10px 14px; color:#fff; background:rgba(26,24,39,.9); border:1px solid rgba(255,255,255,.16); border-radius:10px; box-shadow:0 8px 24px rgba(15,13,29,.22); }
    #ff-video-chapter b { font-size:11px; letter-spacing:.12em; color:#d4c9ff; }
    #ff-video-chapter strong { font-size:15px; letter-spacing:0; }
    #ff-video-subtitle { position:absolute; left:50%; bottom:28px; transform:translateX(-50%); max-width:900px; padding:10px 18px; color:#fff; text-align:center; font-size:19px; line-height:1.5; background:rgba(26,24,39,.94); border:1px solid rgba(255,255,255,.18); border-radius:9px; box-shadow:0 8px 24px rgba(15,13,29,.26); text-shadow:0 1px 2px rgba(0,0,0,.5); }
    #ff-video-callout { position:absolute; right:36px; top:28px; max-width:320px; padding:11px 14px; color:#2a2047; background:#f2edff; border:1px solid #cdbff5; border-radius:9px; box-shadow:0 8px 24px rgba(70,50,130,.18); opacity:0; transform:translateY(-6px); transition:opacity .25s ease,transform .25s ease; }
    #ff-video-callout.show { opacity:1; transform:translateY(0); }
    #ff-video-callout b { display:block; margin-bottom:3px; font-size:12px; }
    #ff-video-callout span { display:block; font-size:11px; line-height:1.45; }
    .ff-video-focus { outline:3px solid #7b5ce1 !important; outline-offset:5px !important; box-shadow:0 0 0 7px rgba(123,92,225,.18),0 0 28px rgba(123,92,225,.42) !important; animation:ff-video-pulse 1.6s ease-in-out infinite; }
    @keyframes ff-video-pulse { 0%,100% { filter:brightness(1); } 50% { filter:brightness(1.08); } }
  `});
  await page.evaluate(() => {
    const root = document.createElement('div');
    root.id = 'ff-video-chrome';
    root.innerHTML = '<div id="ff-video-progress"></div><div id="ff-video-chapter"><b></b><strong></strong></div><div id="ff-video-callout"><b></b><span></span></div><div id="ff-video-subtitle"></div>';
    document.body.append(root);
  });
}

async function showStage(page, { step, title, subtitle, callout = '', focus = '', progress = 0 }) {
  await page.evaluate(({ step, title, subtitle, callout, focus, progress }) => {
    document.querySelectorAll('.ff-video-focus').forEach(node => node.classList.remove('ff-video-focus'));
    const progressNode = document.getElementById('ff-video-progress');
    const chapter = document.getElementById('ff-video-chapter');
    const subtitleNode = document.getElementById('ff-video-subtitle');
    const calloutNode = document.getElementById('ff-video-callout');
    if (progressNode) progressNode.style.width = `${progress}%`;
    if (chapter) { chapter.querySelector('b').textContent = `0${step} / 05`; chapter.querySelector('strong').textContent = title; }
    if (subtitleNode) subtitleNode.textContent = subtitle;
    if (calloutNode) {
      calloutNode.querySelector('b').textContent = callout ? 'FormFlow Agent' : '';
      calloutNode.querySelector('span').textContent = callout;
      calloutNode.classList.toggle('show', !!callout);
    }
    if (focus) document.querySelectorAll(focus).forEach(node => node.classList.add('ff-video-focus'));
  }, { step, title, subtitle, callout, focus, progress });
}

async function main() {
  if (!SUBMITTER_CREDENTIAL) throw new Error('Set FORMFLOW_VIDEO_SUBMITTER_CREDENTIAL to a fictional seed credential.');
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  const browser = await launchChromium({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: path.dirname(OUTPUT), size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();
  const video = page.video();

  try {
    await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
    await installShowcaseChrome(page);
    await showStage(page, {
      step: 1, title: '从资料开始', progress: 10,
      subtitle: '把通知、名单、模板和链接交给需求 Agent。',
      callout: '自然语言 + 文件 + 链接，都可以从聊天框进入。',
      focus: 'button.demo-btn',
    });
    await hold(page, 2500);
    await page.locator('button.demo-btn').click();
    await page.waitForURL('**/#/tasks');

    await page.goto(`${BASE}/#/design/${DESIGN_TASK_ID}`, { waitUntil: 'networkidle' });
    await installShowcaseChrome(page);
    await page.locator('#draft-panel').waitFor({ state: 'visible' });
    await showStage(page, {
      step: 2, title: '和 Agent 对话', progress: 30,
      subtitle: '需求 Agent 先归纳对象、字段、材料与核验规则。',
      callout: 'Skill 负责整理方法，Harness 限制范围、预算和失败边界。',
      focus: '#design-chat, #chat-scroll',
    });
    await hold(page, 4500);

    const replayButton = page.locator('#offline-replay-action button');
    if (await replayButton.count()) {
      await showStage(page, {
        step: 2, title: '生成第一版草案', progress: 38,
        subtitle: '没有模型密钥时，演示路径也会明确停下，不伪装成实时模型。',
        callout: '离线回放沿同一请求队列与发布门槛运行，不调用外部模型。',
        focus: '#offline-replay-action',
      });
      await replayButton.click();
      await page.waitForFunction(() => {
        const text = document.querySelector('#draft-panel')?.innerText || '';
        return text.includes('登记信息') || text.includes('提交材料');
      }, null, { timeout: 30000 });
      await hold(page, 2500);
    }

    const clarOption = page.locator('#clar-card .clar-option').first();
    if (await clarOption.count()) {
      await showStage(page, {
        step: 2, title: '回答关键疑问', progress: 48,
        subtitle: '有歧义时，Agent 给出可选路径；组织者做最终决定。',
        callout: '不确定内容停在“待澄清”，不会偷偷变成硬性要求。',
        focus: '#clar-card',
      });
      await hold(page, 3500);
      await clarOption.click().catch(() => {});
    }

    await showStage(page, {
      step: 3, title: '实时预览收集表', progress: 58,
      subtitle: '右侧预览随草案更新，发布前仍由组织者核对并确认。',
      callout: '每条规则保留来源，字段、材料和时间策略都可编辑。',
      focus: '#draft-panel',
    });
    await hold(page, 4500);

    await page.goto(`${BASE}/#/workbench/${CROSS_TASK_ID}`, { waitUntil: 'networkidle' });
    await installShowcaseChrome(page);
    await page.locator('#wb-list .wb-row').first().waitFor({ state: 'visible' });
    await showStage(page, {
      step: 4, title: '收集进度一目了然', progress: 72,
      subtitle: '工作台把应交、已提交、免交和已验收分开，下一步指向具体的人。',
      callout: '催交面板会排除已提交、免交和已过截止的对象。',
      focus: '#wb-list, .workbench-summary',
    });
    await hold(page, 4000);

    await page.goto(`${BASE}/#/review/${CROSS_TASK_ID}/${REVIEW_SUBJECT_ID}`, { waitUntil: 'networkidle' });
    await installShowcaseChrome(page);
    await page.getByText('逐条核对证据', { exact: false }).waitFor();
    await showStage(page, {
      step: 4, title: '跨文件找证据', progress: 83,
      subtitle: '审核 Agent 按条核验姓名、学号、格式和材料内容，并给出原文位置。',
      callout: '程序做确定性检查，模型负责理解；证据不足就交给人工确认。',
      focus: '.review-rule, .review-subject, #review-list',
    });
    await hold(page, 5500);

    await page.evaluate(credential => {
      localStorage.setItem('ff_sub_token', credential);
      location.hash = '#/submit';
    }, SUBMITTER_CREDENTIAL);
    await page.getByText('登记字段', { exact: false }).waitFor();
    await showStage(page, {
      step: 5, title: '提交者知道下一步', progress: 92,
      subtitle: '提交者看到自己的字段、材料槽位、回执和补正入口。',
      callout: '上传不等于正式提交；每一步状态都能回到任务记录。',
      focus: '#submit-form, .submit-progress, .receipt-card',
    });
    await hold(page, 4500);

    await page.evaluate(taskId => { location.hash = `#/delivery/${taskId}`; }, DELIVERY_TASK_ID);
    await page.getByRole('heading', { name: '交付与归档' }).waitFor();
    await showStage(page, {
      step: 5, title: '确认后交付归档', progress: 100,
      subtitle: '组织者确认结果后生成快照、CSV 与 ZIP，交付范围可追溯。',
      callout: 'FormFlow 把要求、证据和交付串成一条可复核的链路。',
      focus: '#delivery-snapshot, .delivery-export, .snapshot-card',
    });
    await hold(page, 6000);
  } finally {
    await context.close();
    await browser.close();
  }

  const recordedPath = await video.path();
  if (path.resolve(recordedPath) !== OUTPUT) fs.renameSync(recordedPath, OUTPUT);
  console.log(JSON.stringify({ output: OUTPUT, bytes: fs.statSync(OUTPUT).size }));
}

main().catch(error => {
  console.error(`Showcase recording failed: ${error.message}`);
  process.exitCode = 1;
});
