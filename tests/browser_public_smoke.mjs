import { chromium } from 'playwright';

const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const users = new Map([
  ['user-a@example.test', { token: 'token-user-a', ID_User: 'USR-A', Email: 'user-a@example.test', Role: 'USER', Nama_Lengkap: 'User Smoke A', SPPG: 'SPPG A', Wajah_Terdaftar: true }],
  ['admin@example.test', { token: 'token-admin', ID_User: 'ADM-A', Email: 'admin@example.test', Role: 'ADMIN', Nama_Lengkap: 'Admin Smoke', SPPG: 'SPPG A', Wajah_Terdaftar: true }],
  ['super@example.test', { token: 'token-super', ID_User: 'SUP-A', Email: 'super@example.test', Role: 'SUPER ADMIN', Nama_Lengkap: 'Super Smoke', SPPG: 'PUSAT', Wajah_Terdaftar: true }],
]);
let currentUser = null;

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

async function expectOnlyAppView(id) {
  await page.waitForFunction((targetId) => {
    const views = [...document.querySelectorAll('.app-view')];
    const visible = views.filter((node) => !node.classList.contains('hidden'));
    return visible.length === 1 && visible[0]?.id === targetId;
  }, id, { timeout: 10_000 });
}

async function login(email, expectedView) {
  await expectOnlyAuthPage('page-login');
  await page.fill('#login-email', email);
  await page.fill('#login-password', 'smoke-password');
  await page.click('#btn-login');
  await page.waitForSelector('#app-layout.active', { timeout: 10_000 });
  await expectOnlyAppView(expectedView);
}

async function logout() {
  await page.waitForFunction(() => Boolean(window.HadirlyLogout?.logout), null, { timeout: 10_000 });
  await page.evaluate(() => window.HadirlyLogout.logout());
  await page.waitForSelector('#auth-layout:not(.hidden)', { timeout: 10_000 });
  await expectOnlyAuthPage('page-login');
  const appActive = await page.locator('#app-layout').evaluate((node) => node.classList.contains('active'));
  if (appActive) fail('logout left application layout active');
}

try {
  await page.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    } catch {}

    const loader = { loadFromUri: async () => {} };
    window.faceapi = {
      nets: {
        tinyFaceDetector: loader,
        faceLandmark68Net: loader,
        faceRecognitionNet: loader,
        faceExpressionNet: loader,
      },
      TinyFaceDetectorOptions: class TinyFaceDetectorOptions {},
      detectSingleFace: () => ({
        withFaceLandmarks: () => ({
          withFaceExpressions: () => ({
            withFaceDescriptor: async () => null,
          }),
        }),
      }),
    };

    try {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition(success) {
            success({ coords: { latitude: -6.2, longitude: 106.8, accuracy: 5 } });
          },
        },
      });
    } catch {}

    try {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          async getUserMedia() {
            const canvas = document.createElement('canvas');
            canvas.width = 16;
            canvas.height = 16;
            const stream = canvas.captureStream(1);
            window.__smokeCaptureCanvas = canvas;
            window.__smokeMediaStream = stream;
            return stream;
          },
        },
      });
    } catch {}

    try {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject');
      if (descriptor?.set) {
        Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
          configurable: true,
          get: descriptor.get,
          set(value) {
            descriptor.set.call(this, value);
            setTimeout(() => this.onloadedmetadata?.(), 0);
          },
        });
      }
    } catch {}
  });

  await page.route('**/functions/v1/**', async (route) => {
    const request = route.request();
    let raw = {};
    try { raw = request.postDataJSON() || {}; } catch {}
    const payload = raw?.payload && typeof raw.payload === 'object' ? raw.payload : raw;
    const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
    const name = String(payload?.function || payload?.functionName || payload?.action || data?.action || '');

    let result = {};
    if (name === 'getPublicConfig') {
      result = { url: 'https://project.supabase.co', anonKey: 'public-smoke-key' };
    } else if (name === 'login') {
      const selected = users.get(String(data?.email || data?.username || '').toLowerCase());
      if (!selected) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'SMOKE_USER_NOT_FOUND' }) });
        return;
      }
      currentUser = { ...selected };
      result = { ...currentUser };
    } else if (name === 'logout') {
      result = { success: true };
      currentUser = null;
    } else if (name === 'getProfilLengkap') {
      result = { user: currentUser ? { ...currentUser } : null };
    } else if (name === 'checkSession') {
      result = currentUser ? { valid: true, user: { ...currentUser } } : { valid: false };
    } else if (name === 'recordAbsensiSelf') {
      result = { success: true, message: 'Masuk', nama: currentUser?.Nama_Lengkap || 'Smoke User', waktu: '08:00' };
    } else if (name === 'getUserNotificationsV2') {
      result = { items: [], unreadCount: 0 };
    } else if (name === 'registerDevice') {
      result = { Device_ID: 'SMOKE-DEVICE' };
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, result }),
    });
  });

  await page.goto(`${baseUrl}/#register`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForSelector('#auth-layout:not(.hidden)', { timeout: 10_000 });
  await page.waitForFunction(() => Boolean(window.HadirlyNavigationState && window.HadirlySessionRequestAbort), null, { timeout: 10_000 });
  await expectOnlyAuthPage('page-register');

  // Startup checkSession tidak boleh menimpa direct register deep-link.
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

  // USER session, camera lifecycle, dan timer redirect tidak boleh mengambil alih navigasi baru.
  await login('user-a@example.test', 'view-dashboard');
  await page.evaluate(() => window.switchView('absen-scan'));
  await expectOnlyAppView('view-absen-scan');
  await page.waitForFunction(() => Boolean(window.__smokeMediaStream?.getTracks?.().length), null, { timeout: 10_000 });
  const liveBefore = await page.evaluate(() => window.__smokeMediaStream.getTracks().every((track) => track.readyState === 'live'));
  if (!liveBefore) fail('fake camera stream was not live after entering attendance scan');

  await page.evaluate(async () => {
    await window.handleAbsenScanComplete(new Float32Array([0.1, 0.2, 0.3]));
    window.switchView('pengaduan');
  });
  await expectOnlyAppView('view-pengaduan');
  const endedAfterLeave = await page.evaluate(() => window.__smokeMediaStream.getTracks().every((track) => track.readyState === 'ended'));
  if (!endedAfterLeave) fail('camera stream remained live after leaving attendance scan');
  await page.waitForTimeout(5_300);
  await expectOnlyAppView('view-pengaduan');

  await logout();
  const profileAfterLogout = await page.locator('#profil-nama').textContent();
  if (String(profileAfterLogout || '').trim() !== '-') fail('user profile DOM was not scrubbed on logout');

  // ADMIN and SUPER ADMIN must land on their role-specific dashboards after the previous USER session.
  await login('admin@example.test', 'view-admin-dashboard');
  await logout();
  await login('super@example.test', 'view-super-dashboard');
  await logout();

  console.log('Browser smoke passed: auth history, cross-session role routing, camera cleanup, and redirect-timer isolation.');
} finally {
  await browser.close();
}
