window.ABSEN_SUPABASE_CONFIG = Object.freeze({
  projectUrl: 'https://szwwpnbbsmjsbzzcecyj.supabase.co',
  functionName: 'AbsenV2',
  deviceTrustFunctionName: 'DeviceTrust',
  attendanceLocationFunctionName: 'AttendanceLocation',
  payrollUserFunctionName: 'PayrollUser',
  complaintsFunctionName: 'Complaints',
  digitalIdentityFunctionName: 'DigitalIdentity'
});

(() => {
  if (window.__ABSEN_SECURITY_CONFIGURED__) return;
  window.__ABSEN_SECURITY_CONFIGURED__ = true;

  let registeredDevice = null;
  const IDEMPOTENT_FUNCTIONS = new Set(['recordAbsensiSelf', 'recordAbsensi']);
  const PAYROLL_WORKFLOW_FUNCTIONS = new Set([
    'prosesPayroll',
    'getMyPayroll',
    'getSlipDownloadUrl',
    'signPayrollReceipt'
  ]);
  const COMPLAINT_WORKFLOW_FUNCTIONS = new Set([
    'kirimPengaduan',
    'getRiwayatPengaduanSaya',
    'getNotifikasiAdmin',
    'getDaftarPengaduan',
    'tandaiSudahDibaca',
    'simpanTanggapanAdmin',
    'updateComplaintTicketV2',
    'closeMyComplaintTicketV2'
  ]);
  const DIGITAL_IDENTITY_WORKFLOW_FUNCTIONS = new Set([
    'getMyDigitalIdentity',
    'generateMyDigitalIdentity',
    'regenerateMyDigitalIdentity',
    'getIdCardAdminOverview',
    'approveIdCardRequests'
  ]);
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

  async function callPayrollWorkflow(functionName, payload = {}) {
    const token = payload.token || localStorage.getItem('auth_token');
    if (!token) throw new Error('Sesi login tidak tersedia.');
    const functionSlug = window.ABSEN_SUPABASE_CONFIG.payrollUserFunctionName || 'PayrollUser';
    const response = await fetch(
      `${window.ABSEN_SUPABASE_CONFIG.projectUrl}/functions/v1/${functionSlug}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ function: functionName, data: { ...payload, token } }),
        cache: 'no-store'
      }
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.success === false) {
      throw new Error(body?.error || body?.message || 'Workflow payroll tidak tersedia.');
    }
    return body?.result;
  }

  async function callComplaintWorkflow(functionName, payload = {}) {
    const token = payload.token || localStorage.getItem('auth_token');
    if (!token) throw new Error('Sesi login tidak tersedia.');
    const functionSlug = window.ABSEN_SUPABASE_CONFIG.complaintsFunctionName || 'Complaints';
    const isSubmission = functionName === 'kirimPengaduan';
    const complaintPayload = {
      ...payload,
      token,
      ...(isSubmission
        ? { idempotencyKey: payload.idempotencyKey || getOrCreateIdempotencyKey('kirimPengaduan') }
        : {})
    };
    const response = await fetch(
      `${window.ABSEN_SUPABASE_CONFIG.projectUrl}/functions/v1/${functionSlug}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ function: functionName, data: complaintPayload }),
        cache: 'no-store'
      }
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.success === false) {
      const requestHint = body?.requestId ? ` (${body.requestId})` : '';
      throw new Error(`${body?.error || body?.message || 'Workflow pengaduan tidak tersedia.'}${requestHint}`);
    }
    if (isSubmission) clearIdempotencyKey('kirimPengaduan');
    return body?.result;
  }

  async function callDigitalIdentityWorkflow(functionName, payload = {}) {
    const token = payload.token || localStorage.getItem('auth_token');
    if (!token) throw new Error('Sesi login tidak tersedia.');
    const functionSlug = window.ABSEN_SUPABASE_CONFIG.digitalIdentityFunctionName || 'DigitalIdentity';
    const response = await fetch(
      `${window.ABSEN_SUPABASE_CONFIG.projectUrl}/functions/v1/${functionSlug}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ function: functionName, data: { ...payload, token } }),
        cache: 'no-store'
      }
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.success === false) {
      const requestHint = body?.requestId ? ` (${body.requestId})` : '';
      throw new Error(`${body?.error || body?.message || 'Layanan QR dan ID Card tidak tersedia.'}${requestHint}`);
    }
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
        if (DIGITAL_IDENTITY_WORKFLOW_FUNCTIONS.has(functionName)) {
          return callDigitalIdentityWorkflow(functionName, payload);
        }
        if (COMPLAINT_WORKFLOW_FUNCTIONS.has(functionName)) {
          return callComplaintWorkflow(functionName, payload);
        }
        if (PAYROLL_WORKFLOW_FUNCTIONS.has(functionName)) {
          return callPayrollWorkflow(functionName, payload);
        }
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

import('./src/app/bootstrap.js?v=26.11.35').catch((error) => {
  console.warn('Frontend modular gagal dimuat; aplikasi utama tetap berjalan.', error);
});
