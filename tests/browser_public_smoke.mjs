import { chromium } from 'playwright';

const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

function fail(message) {
  throw new Error(message);
}

async function expectOnlyAuthPage(id) {
  await page.waitForFunction((targetId) => {
    const pages = [...document.querySelectorAll('.auth-page')];
    const visible = pages.filter((node) => !node.classList.contains('hidden'));
    return visible.length === 1 && visible[0]?.id === targetId;
  }, id, { timeout: 10_000 });
}

try {
  await page.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    } catch {}
  });

  await page.route('**/functions/v1/AbsenV2', async (route) => {
    const request = route.request();
    let body = {};
    try { body = request.postDataJSON() || {}; } catch {}
    const name = String(body?.function || body?.functionName || body?.action || '');

    if (name === 'getPublicConfig') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          result: { url: 'https://project.supabase.co', anonKey: 'public-smoke-key' },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, result: {} }),
    });
  });

  await page.goto(`${baseUrl}/#register`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForSelector('#auth-layout:not(.hidden)', { timeout: 10_000 });
  await expectOnlyAuthPage('page-register');

  // Beri waktu startup checkSession selesai; direct register tidak boleh ditimpa ke login.
  await page.waitForTimeout(800);
  await expectOnlyAuthPage('page-register');

  await page.click('#btn-to-login');
  await expectOnlyAuthPage('page-login');
  if (page.url().split('#')[1] !== 'login') fail('login navigation did not synchronize URL hash');

  await page.click('#btn-to-register');
  await expectOnlyAuthPage('page-register');
  if (page.url().split('#')[1] !== 'register') fail('register navigation did not synchronize URL hash');

  await page.goBack({ waitUntil: 'domcontentloaded' });
  await expectOnlyAuthPage('page-login');

  await page.evaluate(() => { window.location.hash = '#route-that-does-not-exist'; });
  await page.waitForFunction(() => window.location.hash === '#login', null, { timeout: 10_000 });
  await expectOnlyAuthPage('page-login');

  const appLayoutActive = await page.locator('#app-layout').evaluate((node) => node.classList.contains('active'));
  if (appLayoutActive) fail('logged-out public smoke unexpectedly activated the application layout');

  console.log('Browser public smoke passed: register deep-link, auth view isolation, history, and invalid-route recovery.');
} finally {
  await browser.close();
}
