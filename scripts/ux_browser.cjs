const fs = require('node:fs');

function loadPlaywright() {
  const override = process.env.FORMFLOW_PLAYWRIGHT_MODULE?.trim();
  const candidates = override ? [override] : ['playwright', 'playwright-core'];
  for (const candidate of candidates) {
    let resolved;
    try {
      resolved = require.resolve(candidate, { paths: [process.cwd(), __dirname] });
    } catch {
      continue;
    }
    return require(resolved);
  }
  throw new Error(
    'Browser walkthrough dependency not found. Install Playwright with '
    + '`npm install --no-save --package-lock=false playwright` and run '
    + '`npx playwright install chromium`, or set FORMFLOW_PLAYWRIGHT_MODULE.',
  );
}

async function launchChromium(options = {}) {
  const { chromium } = loadPlaywright();
  const executablePath = process.env.FORMFLOW_CHROMIUM_EXECUTABLE?.trim();
  if (executablePath && !fs.existsSync(executablePath)) {
    throw new Error(`FORMFLOW_CHROMIUM_EXECUTABLE does not exist: ${executablePath}`);
  }
  return chromium.launch({
    ...options,
    ...(executablePath ? { executablePath } : {}),
  });
}

module.exports = { launchChromium };
