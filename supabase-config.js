window.ABSEN_SUPABASE_CONFIG = Object.freeze({
  projectUrl: 'https://szwwpnbbsmjsbzzcecyj.supabase.co',
  functionName: 'AbsenV2',
  deviceTrustFunctionName: 'DeviceTrust'
});

(() => {
  if (window.__ABSEN_SECURITY_CONFIGURED__) return;
  window.__ABSEN_SECURITY_CONFIGURED__ = true;

  let registeredDevice = null;
  const IDEMPOTENT_FUNCTIONS = new Set(['recordAbsensiSelf', 'recordAbsensi']);
  const DEVICE_KEY_STORAGE = 'absen:device-key:v1';

  function getOrCreateDeviceKey() {
    try {
      const existing = localStorage.getItem(DEVICE_KEY_STORAGE);
      if (existing && existing.length >= 32) return existing;
      const key = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
      localStorage.setItem(DEVICE_KEY_STORAGE, key);
      return key;
    } catch {
      return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
    }
  }

  const deviceKey = getOrCreateDeviceKey();

  function deviceMetadata() {
    const ua = navigator.userAgent || '';
    const platform = navigator.userAgentData?.platform || navigator.platform || 'Unknown';
    let browser = 'Browser';
    if (/Edg\//.test(ua)) browser = 'Microsoft Edge';
    else if (/Chrome\//.test(ua)) browser = 'Google Chrome';
    else if (/Firefox\//.test(ua)) browser = 'Mozilla Firefox';
    else if (/Safari\//.test(ua)) browser = 'Safari';
    return { deviceKey, deviceName: `${platform} · ${browser}`, platform, browser };
  }

  async function callDeviceTrust(action, payload = {}) {
    const token = localStorage.getItem('auth_token');
    if (!token) throw new Error('Sesi login tidak tersedia.');
    const response = await fetch(
      `${window.ABSEN_SUPABASE_CONFIG.projectUrl}/functions/v1/${window.ABSEN_SUPABASE_CONFIG.deviceTrustFunctionName}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, token, ...payload }) }
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.success === false) throw new Error(body?.message || 'Gagal memproses identitas perangkat.');
    return body?.result;
  }

  async function ensureDeviceRegistered() {
    if (registeredDevice) return registeredDevice;
    registeredDevice = await callDeviceTrust('registerDevice', deviceMetadata());
    return registeredDevice;
  }

  function getOrCreateIdempotencyKey(functionName) {
    const storageKey = `absen:idempotency:${functionName}`;
    try {
      const current = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      if (current?.key && Number(current.expiresAt) > Date.now()) return current.key;
      const key = crypto.randomUUID();
      sessionStorage.setItem(storageKey, JSON.stringify({ key, expiresAt: Date.now() + 2 * 60 * 1000 }));
      return key;
    } catch { return crypto.randomUUID(); }
  }

  function clearIdempotencyKey(functionName) {
    try { sessionStorage.removeItem(`absen:idempotency:${functionName}`); } catch {}
  }

  window.getMyAttendanceDevices = () => callDeviceTrust('listMyDevices');
  window.revokeMyAttendanceDevice = (deviceId) => callDeviceTrust('revokeMyDevice', { deviceId });
  window.reviewAttendanceDevice = (deviceId, status, reason) => callDeviceTrust('reviewDevice', { deviceId, status, reason });
  window.getAttendanceDeviceReviewQueue = (status = 'PENDING') => callDeviceTrust('listReviewQueue', { status });

  window.addEventListener('DOMContentLoaded', () => {
    const originalApiCall = window.apiCall;
    if (typeof originalApiCall === 'function' && !window.__ABSEN_API_WRAPPED__) {
      window.__ABSEN_API_WRAPPED__ = true;
      window.apiCall = async function securityAwareApiCall(functionName, payload = {}) {
        if (localStorage.getItem('auth_token')) {
          try { await ensureDeviceRegistered(); } catch (error) { console.warn('Device registration deferred', error); }
        }
        const securedPayload = {
          ...payload,
          deviceKey,
          deviceId: registeredDevice?.Device_ID || registeredDevice?.deviceId || null,
          ...(IDEMPOTENT_FUNCTIONS.has(functionName) ? { idempotencyKey: payload.idempotencyKey || getOrCreateIdempotencyKey(functionName) } : {})
        };
        const result = await originalApiCall(functionName, securedPayload);
        if (IDEMPOTENT_FUNCTIONS.has(functionName)) clearIdempotencyKey(functionName);
        return result;
      };
    }
    if (localStorage.getItem('auth_token')) ensureDeviceRegistered().catch((error) => console.warn('Device registration pending', error));
  });
})();

import('./src/app/bootstrap.js?v=26.11.30').catch((error) => {
  console.warn('Frontend modular gagal dimuat; aplikasi utama tetap berjalan.', error);
});
