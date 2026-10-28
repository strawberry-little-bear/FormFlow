const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const helperPath = require.resolve('../scripts/ux_browser.cjs');
const mockModule = path.resolve(__dirname, 'fixtures/playwright-launch-mock.cjs');

test('browser launcher uses the configured Playwright module and Chromium executable', async () => {
  const previousModule = process.env.FORMFLOW_PLAYWRIGHT_MODULE;
  const previousExecutable = process.env.FORMFLOW_CHROMIUM_EXECUTABLE;
  process.env.FORMFLOW_PLAYWRIGHT_MODULE = mockModule;
  process.env.FORMFLOW_CHROMIUM_EXECUTABLE = process.execPath;
  delete require.cache[helperPath];

  try {
    const { launchChromium } = require(helperPath);
    assert.deepEqual(await launchChromium({ headless: true }), {
      headless: true,
      executablePath: process.execPath,
    });
  } finally {
    if (previousModule === undefined) delete process.env.FORMFLOW_PLAYWRIGHT_MODULE;
    else process.env.FORMFLOW_PLAYWRIGHT_MODULE = previousModule;
    if (previousExecutable === undefined) delete process.env.FORMFLOW_CHROMIUM_EXECUTABLE;
    else process.env.FORMFLOW_CHROMIUM_EXECUTABLE = previousExecutable;
    delete require.cache[helperPath];
  }
});

test('browser launcher rejects a configured Chromium path that does not exist', async () => {
  const previousModule = process.env.FORMFLOW_PLAYWRIGHT_MODULE;
  const previousExecutable = process.env.FORMFLOW_CHROMIUM_EXECUTABLE;
  process.env.FORMFLOW_PLAYWRIGHT_MODULE = mockModule;
  process.env.FORMFLOW_CHROMIUM_EXECUTABLE = path.join(__dirname, 'missing-chromium.exe');
  delete require.cache[helperPath];

  try {
    const { launchChromium } = require(helperPath);
    await assert.rejects(launchChromium(), /FORMFLOW_CHROMIUM_EXECUTABLE does not exist/);
  } finally {
    if (previousModule === undefined) delete process.env.FORMFLOW_PLAYWRIGHT_MODULE;
    else process.env.FORMFLOW_PLAYWRIGHT_MODULE = previousModule;
    if (previousExecutable === undefined) delete process.env.FORMFLOW_CHROMIUM_EXECUTABLE;
    else process.env.FORMFLOW_CHROMIUM_EXECUTABLE = previousExecutable;
    delete require.cache[helperPath];
  }
});
