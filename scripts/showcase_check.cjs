/**
 * Read-only browser harness for the hackathon showcase path.
 *
 * The demo server must already be running. The command intentionally uses the
 * seeded demo login and does not mutate task data; it only navigates routes,
 * checks the visible state, and emits a small machine-readable report.
 */
const fs = require('node:fs');
const path = require('node:path');
const { launchChromium } = require('./ux_browser.cjs');

const BASE = (process.env.FORMFLOW_SHOWCASE_BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
const OUT = process.env.FORMFLOW_SHOWCASE_OUT
  ? path.resolve(process.env.FORMFLOW_SHOWCASE_OUT)
  : null;
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 950 },
  { name: 'laptop-768', width: 1366, height: 768 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-320', width: 320, height: 760 },
];

const ROUTES = [
  { name: 'tasks', hash: '#/tasks', required: ['我的任务', '进入展示视图', '新建收集任务'] },
  { name: 'design', hash: '#/design/1', required: ['需求设计', 'CURRENT RUN'] },
  { name: 'workbench', hash: '#/workbench/1', required: ['收集工作台', '下一步'] },
  { name: 'review', hash: '#/review/1/2', required: ['逐条核对证据', 'NEXT ACTION'] },
  { name: 'delivery', hash: '#/delivery/1', required: ['交付与归档', '固定快照'] },
  { name: 'roster-invalid', hash: '#/roster/9999', required: ['名册暂时无法读取', '重试加载名册'] },
  { name: 'review-invalid', hash: '#/review/1/9999', required: ['检查结果暂时无法读取', '重试加载'] },
];

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function captureRouteEvidence(page, viewport, route) {
  const pageState = await page.evaluate(() => ({
    hash: location.hash,
    heading: document.querySelector('main#app h1, main#app h2, main#app [data-page-title]')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    scrollY: Math.round(window.scrollY),
    headingBounds: (() => {
      const heading = document.querySelector('main#app h1, main#app h2, main#app [data-page-title]');
      if (!heading) return null;
      const rect = heading.getBoundingClientRect();
      return {top: Math.round(rect.top), bottom: Math.round(rect.bottom)};
    })(),
    headingInViewport: (() => {
      const heading = document.querySelector('main#app h1, main#app h2, main#app [data-page-title]');
      if (!heading) return false;
      const rect = heading.getBoundingClientRect();
      return rect.top >= -4 && rect.bottom <= window.innerHeight;
    })(),
    activeNav: (() => {
      const nav = document.querySelector('#nav');
      const active = nav?.querySelector('a.active');
      if (!nav || !active) return {exists: false, visible: false, scrollLeft: 0};
      const navRect = nav.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      return {
        exists: true,
        visible: activeRect.left >= navRect.left - 1 && activeRect.right <= navRect.right + 1,
        scrollLeft: Math.round(nav.scrollLeft),
        label: active.textContent.replace(/\s+/g, ' ').trim(),
      };
    })(),
  }));
  const screenshot = OUT
    ? path.posix.join('screenshots', viewport.name, `${route.name}.png`)
    : null;
  if (screenshot) {
    const file = path.join(OUT, ...screenshot.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file });
  }
  return { ...pageState, screenshot };
}

function routeUrl(hash) {
  return `${BASE}/${hash}`;
}

async function waitForPaint(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  // The SPA renders the shell first, then paints the API response.
  await page.waitForTimeout(700);
}

async function waitForRouteSurface(page, route) {
  const required = JSON.stringify(route.required || []);
  await page.waitForFunction(({ requiredText }) => {
    const body = document.body?.innerText || '';
    const requiredItems = JSON.parse(requiredText);
    const hasRequired = requiredItems.every(text => body.includes(text));
    const hasExpectedFailure = body.includes('暂时无法读取');
    return hasRequired || hasExpectedFailure;
  }, { requiredText: required }, { timeout: 5000 }).catch(() => {});
}

async function inspectAccessibilitySurface(page) {
  return page.evaluate(() => {
    const visible = node => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };
    const labelledBy = node => (node.getAttribute('aria-labelledby') || '')
      .split(/\s+/)
      .map(id => document.getElementById(id)?.textContent || '')
      .join(' ')
      .trim();
    const explicitLabel = node => {
      const id = node.id;
      return node.closest('label')?.textContent?.trim()
        || (id && [...document.querySelectorAll('label[for]')]
          .find(label => label.htmlFor === id)?.textContent?.trim())
        || '';
    };
    const controls = [...document.querySelectorAll(
      'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"]'
    )].filter(visible);
    const unnamed = controls
      .filter(node => {
        const name = node.getAttribute('aria-label')
          || labelledBy(node)
          || explicitLabel(node)
          || node.getAttribute('title')
          || node.textContent?.replace(/\s+/g, ' ').trim()
          || '';
        return !name;
      })
      .map(node => `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}`);
    const unlabeledFields = controls
      .filter(node => ['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName))
      .filter(node => !node.getAttribute('aria-label')
        && !labelledBy(node)
        && !explicitLabel(node))
      .map(node => `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}`);
    const main = document.querySelector('main#app');
    const heading = main?.querySelector('h1, h2, [data-page-title]');
    return {
      interactiveCount: controls.length,
      unnamed,
      unlabeledFields,
      hasRouteFocusTarget: !!heading || main?.getAttribute('tabindex') === '-1',
    };
  });
}

async function inspectDesignScroll(page, viewport) {
  if (viewport.width <= 980) return null;
  await page.evaluate(() => window.scrollTo(0, Math.min(560, document.documentElement.scrollHeight - window.innerHeight)));
  await page.waitForTimeout(150);
  const result = await page.evaluate(() => {
    const panel = document.querySelector('#design-chat');
    const heading = panel?.querySelector('.agent-heading');
    const rect = panel?.getBoundingClientRect();
    const headingRect = heading?.getBoundingClientRect();
    return {
      scrollY: Math.round(window.scrollY),
      position: panel ? getComputedStyle(panel).position : '',
      top: rect ? Math.round(rect.top) : null,
      bottom: rect ? Math.round(rect.bottom) : null,
      panelInViewport: !!rect && rect.top >= 0 && rect.bottom <= window.innerHeight,
      headingInViewport: !!headingRect && headingRect.top >= 0 && headingRect.bottom <= window.innerHeight,
    };
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  return {
    ...result,
    ok: result.scrollY > 0 && result.position === 'sticky' && result.panelInViewport && result.headingInViewport,
  };
}

async function enterDemo(page, viewport) {
  await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
  await waitForPaint(page);
  const button = page.locator('button.demo-btn');
  const loginEvidence = await captureRouteEvidence(page, viewport, {name: 'login'});
  const loginSurface = {
    ...loginEvidence,
    hasDemoEntry: await button.isVisible().catch(() => false),
    demoEntryInViewport: await button.evaluate(node => {
      const rect = node.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight;
    }).catch(() => false),
    accessibility: await inspectAccessibilitySurface(page),
    overflow: await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    })),
  };
  loginSurface.ok = loginSurface.hash === '#/login'
    && !!loginSurface.heading
    && loginSurface.headingInViewport
    && loginSurface.hasDemoEntry
    && loginSurface.demoEntryInViewport
    && !loginSurface.overflow.overflow
    && !loginSurface.accessibility.unnamed.length
    && !loginSurface.accessibility.unlabeledFields.length;
  if (!loginSurface.ok) throw new Error(`登录首屏验收失败：${JSON.stringify(loginSurface)}`);
  if (!await button.count()) throw new Error('登录页缺少“体验演示环境”入口');
  await button.click();
  await page.waitForURL('**/#/tasks', { timeout: 10000 });
  await waitForPaint(page);
  return loginSurface;
}

async function exitPresentationToTaskList(page) {
  const exit = page.locator('button[aria-label="退出展示视图并查看我的任务"]');
  if (!await exit.count()) throw new Error('展示首页缺少“查看我的任务”入口');
  const showcaseVisibleInPresentation = await page.evaluate(() => {
    const section = document.querySelector('.agent-tour');
    return document.body.classList.contains('presentation-mode')
      && !!section && getComputedStyle(section).display !== 'none';
  });
  await exit.click();
  await waitForPaint(page);
  await page.waitForFunction(() => {
    const taskSection = document.querySelector('.task-section');
    if (!taskSection) return false;
    const rect = taskSection.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  }, null, { timeout: 5000 }).catch(() => {});
  const taskListState = await page.evaluate(() => {
    const taskSection = document.querySelector('.task-section');
    const style = taskSection ? getComputedStyle(taskSection) : null;
    const rect = taskSection?.getBoundingClientRect();
    return {
      exitedPresentation: !document.body.classList.contains('presentation-mode'),
      taskHomeExtrasHidden: ['#demo-route', '.workspace-intro', '.workspace-runtime-strip', '.agent-tour'].every(selector => {
        const element = document.querySelector(selector);
        return !element || getComputedStyle(element).display === 'none';
      }),
      taskListVisible: !!taskSection && style?.display !== 'none' && style?.visibility !== 'hidden',
      taskListInViewport: !!rect && rect.top >= 0 && rect.bottom <= window.innerHeight,
      taskListFocused: document.activeElement === taskSection,
      taskListLabel: taskSection?.getAttribute('aria-label') || '',
      taskListBounds: rect ? {top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height)} : null,
      hasTaskHeading: document.body.innerText.includes('我的任务'),
    };
  });
  return {...taskListState, showcaseVisibleInPresentation};
}

async function main() {
  const browser = await launchChromium({ headless: true });
  const report = {
    base: BASE,
    generatedAt: new Date().toISOString(),
    viewports: [],
    passed: true,
  };

  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const page = await context.newPage();
      const errors = [];
      const badResponses = [];
      let activeRoute = null;
      page.on('console', message => {
        if (message.type() === 'error' && !activeRoute?.expectedFailure) errors.push(message.text());
      });
      page.on('pageerror', error => {
        if (!activeRoute?.expectedFailure) errors.push(`PAGEERROR: ${error.message}`);
      });
      page.on('response', response => {
        // The two invalid routes intentionally return 404 and are checked as
        // UI failures below, so exclude their expected responses from noise.
        if (response.url().startsWith(BASE) && response.status() >= 400 && !activeRoute?.expectedFailure) {
          badResponses.push(`${response.status()} ${response.url()}`);
        }
      });

      const viewportReport = { ...viewport, loginSurface: null, routes: [], overflow: null, presentationExit: null, errors, badResponses };
      try {
        viewportReport.loginSurface = await enterDemo(page, viewport);
        viewportReport.presentationExit = await exitPresentationToTaskList(page);
        for (const route of ROUTES) {
          activeRoute = route;
          activeRoute.expectedFailure = route.name.endsWith('-invalid');
          if (page.url().endsWith(route.hash)) {
            await page.goto(routeUrl('#/design/1'), { waitUntil: 'networkidle' }).catch(() => {});
            await waitForPaint(page);
          }
          await page.goto(routeUrl(route.hash), { waitUntil: 'networkidle' }).catch(() => {});
          await waitForPaint(page);
          await waitForRouteSurface(page, route);
          const bodyText = cleanText(await page.locator('body').innerText().catch(() => ''));
          const missing = route.required.filter(text => !bodyText.includes(text));
          const loadingStuck = /正在读取(?:任务|名册|检查结果|交付|主体)/.test(bodyText)
            && !/暂时无法读取/.test(bodyText);
          const overflow = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          }));
          const accessibility = await inspectAccessibilitySurface(page);
          const taskFilterState = route.name === 'tasks'
            ? await page.evaluate(() => [...document.querySelectorAll('.task-filters [data-filter]')]
              .map(button => ({filter: button.dataset.filter, pressed: button.getAttribute('aria-pressed')})))
            : null;
          const rosterRecovery = route.name === 'roster-invalid'
            ? await page.evaluate(() => {
              const state = document.querySelector('#roster-load-state');
              const rect = state?.getBoundingClientRect();
              const controls = [...document.querySelectorAll('.roster-import input, .roster-import textarea, .roster-import button, .roster-list > .section-heading button, #roster-filter button')];
              return {
                noticeVisible: !!state && !!rect && rect.top >= 0 && rect.bottom <= window.innerHeight,
                noticeText: state?.innerText?.replace(/\\s+/g, ' ').trim() || '',
                controlsDisabled: controls.length > 0 && controls.every(control => control.disabled),
              };
            })
            : null;
          const evidence = await captureRouteEvidence(page, viewport, route);
          const taskFilterInteraction = route.name === 'tasks'
            ? await (async () => {
              const interactions = [];
              for (const filter of ['collecting', 'draft', 'done', 'all']) {
                await page.locator(`.task-filters [data-filter="${filter}"]`).click();
                interactions.push(await page.evaluate(expected => {
                  const buttons = [...document.querySelectorAll('.task-filters [data-filter]')];
                  const pressed = buttons.filter(button => button.getAttribute('aria-pressed') === 'true');
                  return {
                    filter: expected,
                    selected: pressed.map(button => button.dataset.filter),
                    exactlyOneSelected: pressed.length === 1,
                    expectedSelected: pressed.length === 1 && pressed[0].dataset.filter === expected,
                  };
                }, filter));
              }
              return interactions;
            })()
            : null;
          const designScroll = route.name === 'design' ? await inspectDesignScroll(page, viewport) : null;
          viewportReport.routes.push({
            name: route.name,
            hash: route.hash,
            actualHash: evidence.hash,
            heading: evidence.heading,
            scrollY: evidence.scrollY,
            headingBounds: evidence.headingBounds,
            headingInViewport: evidence.headingInViewport,
            activeNav: evidence.activeNav,
            screenshot: evidence.screenshot,
            designScroll,
            taskFilterState,
            taskFilterInteraction,
            ok: missing.length === 0 && !loadingStuck
              && evidence.hash === route.hash && !!evidence.heading
              && evidence.scrollY <= 2 && evidence.headingInViewport
              && evidence.activeNav.exists && evidence.activeNav.visible
              && (!taskFilterState || (taskFilterState.length === 4
                && taskFilterState.filter(item => item.pressed === 'true').length === 1
                && taskFilterState.find(item => item.filter === 'all')?.pressed === 'true'))
              && (!taskFilterInteraction || (taskFilterInteraction.length === 4
                && taskFilterInteraction.every(item => item.exactlyOneSelected && item.expectedSelected)))
              && (!rosterRecovery || (rosterRecovery.noticeVisible
                && rosterRecovery.noticeText.includes('名册暂时无法读取')
                && rosterRecovery.controlsDisabled))
              && (!designScroll || designScroll.ok),
            missing,
            loadingStuck,
            overflow,
            accessibility,
            rosterRecovery,
          });
        }
        viewportReport.overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        }));
      } finally {
        await context.close();
      }
      report.viewports.push(viewportReport);
    }
  } finally {
    await browser.close();
  }

  for (const viewport of report.viewports) {
    if (!viewport.loginSurface?.ok || viewport.overflow?.overflow || viewport.errors.length || viewport.badResponses.length
      || !viewport.presentationExit?.exitedPresentation
      || !viewport.presentationExit?.showcaseVisibleInPresentation
      || !viewport.presentationExit?.taskHomeExtrasHidden
      || !viewport.presentationExit?.taskListVisible
      || !viewport.presentationExit?.taskListInViewport
      || !viewport.presentationExit?.taskListFocused
      || viewport.presentationExit?.taskListLabel !== '我的任务列表'
      || !viewport.presentationExit?.hasTaskHeading) {
      report.passed = false;
    }
    if (viewport.routes.some(route => !route.ok
      || route.overflow?.overflow
      || route.actualHash !== route.hash
      || !route.heading
      || route.scrollY > 2
      || !route.headingInViewport
      || !route.activeNav?.exists
      || !route.activeNav?.visible
      || route.accessibility?.unnamed?.length
      || route.accessibility?.unlabeledFields?.length
      || !route.accessibility?.hasRouteFocusTarget)) report.passed = false;
  }

  const output = `${JSON.stringify(report, null, 2)}\n`;
  process.stdout.write(output);
  if (OUT) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'showcase-results.json'), output, 'utf8');
  }
  if (!report.passed) process.exitCode = 1;
}

main().catch(error => {
  console.error(`SHOWCASE_CHECK_FAILED: ${error.message}`);
  process.exitCode = 1;
});

