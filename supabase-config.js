window.ABSEN_SUPABASE_CONFIG = Object.freeze({
  projectUrl: 'https://szwwpnbbsmjsbzzcecyj.supabase.co',
  functionName: 'AbsenV2',
  deviceTrustFunctionName: 'DeviceTrust'
});

(() => {
  let lastGpsPosition = null;
  let attendanceChallenge = null;
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
    return {
      deviceKey,
      deviceName: `${platform} · ${browser}`,
      platform,
      browser
    };
  }

  async function callDeviceTrust(action, payload = {}) {
    const token = localStorage.getItem('auth_token');
    if (!token) throw new Error('Sesi login tidak tersedia.');
    const response = await fetch(
      `${window.ABSEN_SUPABASE_CONFIG.projectUrl}/functions/v1/${window.ABSEN_SUPABASE_CONFIG.deviceTrustFunctionName}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, token, ...payload })
      }
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.success === false) {
      throw new Error(body?.message || 'Gagal memproses identitas perangkat.');
    }
    return body?.result;
  }

  async function ensureDeviceRegistered() {
    if (registeredDevice) return registeredDevice;
    registeredDevice = await callDeviceTrust('registerDevice', deviceMetadata());
    return registeredDevice;
  }

  window.getMyAttendanceDevices = () => callDeviceTrust('listMyDevices');
  window.revokeMyAttendanceDevice = (deviceId) => callDeviceTrust('revokeMyDevice', { deviceId });
  window.reviewAttendanceDevice = (deviceId, status, reason) => callDeviceTrust('reviewDevice', { deviceId, status, reason });
  window.getAttendanceDeviceReviewQueue = (status = 'PENDING') => callDeviceTrust('listReviewQueue', { status });

  function showLocationMessage(message) {
    window.setTimeout(() => {
      if (typeof window.closeAbsenScan === 'function') window.closeAbsenScan();
      const status = document.getElementById('absen-facecam-status');
      if (status) status.textContent = message;
    }, 0);
  }

  function getOrCreateIdempotencyKey(functionName) {
    const storageKey = `absen:idempotency:${functionName}`;
    try {
      const current = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      if (current?.key && Number(current.expiresAt) > Date.now()) return current.key;
      const key = crypto.randomUUID();
      sessionStorage.setItem(storageKey, JSON.stringify({ key, expiresAt: Date.now() + 2 * 60 * 1000 }));
      return key;
    } catch {
      return crypto.randomUUID();
    }
  }

  function clearIdempotencyKey(functionName) {
    try {
      sessionStorage.removeItem(`absen:idempotency:${functionName}`);
    } catch {
      // Browser dengan storage terbatas tetap dapat melanjutkan operasi.
    }
  }

  function resetAttendanceSecurityState() {
    lastGpsPosition = null;
    attendanceChallenge = null;
  }

  window.addEventListener('DOMContentLoaded', () => {
    const originalApiCall = window.apiCall;
    if (typeof originalApiCall === 'function') {
      window.apiCall = async function securityAwareApiCall(functionName, payload = {}) {
        if (localStorage.getItem('auth_token')) {
          try { await ensureDeviceRegistered(); } catch (error) { console.warn('Device registration deferred', error); }
        }

        payload = { ...payload, deviceKey, deviceId: registeredDevice?.Device_ID || registeredDevice?.deviceId || null };

        if (functionName === 'recordAbsensiSelf') {
          if (!lastGpsPosition || !attendanceChallenge?.challengeId) {
            throw new Error('Verifikasi lokasi telah kedaluwarsa. Periksa lokasi kembali.');
          }
          if (new Date(attendanceChallenge.expiresAt).getTime() <= Date.now()) {
            resetAttendanceSecurityState();
            throw new Error('Verifikasi lokasi telah kedaluwarsa. Periksa lokasi kembali.');
          }
          payload = {
            ...payload,
            lat: lastGpsPosition.lat,
            lng: lastGpsPosition.lng,
            accuracy: lastGpsPosition.accuracy,
            locationCapturedAt: lastGpsPosition.capturedAt,
            challengeId: attendanceChallenge.challengeId
          };
        }

        if (IDEMPOTENT_FUNCTIONS.has(functionName)) {
          payload = { ...payload, idempotencyKey: getOrCreateIdempotencyKey(functionName) };
        }

        const result = await originalApiCall(functionName, payload);
        if (IDEMPOTENT_FUNCTIONS.has(functionName)) clearIdempotencyKey(functionName);
        if (functionName === 'recordAbsensiSelf') resetAttendanceSecurityState();
        return result;
      };
    }

    if (localStorage.getItem('auth_token')) {
      ensureDeviceRegistered().catch((error) => console.warn('Device registration pending', error));
    }

    window.getCurrentPositionPromise = function getValidatedAttendancePosition() {
      resetAttendanceSecurityState();
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('Perangkat atau browser ini tidak mendukung layanan lokasi.'));
          return;
        }

        navigator.geolocation.getCurrentPosition(
          (position) => resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: Number.isFinite(position.coords.accuracy)
              ? Math.round(position.coords.accuracy)
              : null,
            capturedAt: new Date(position.timestamp || Date.now()).toISOString()
          }),
          (error) => {
            const message = error?.code === 1
              ? 'Izin lokasi ditolak. Aktifkan izin lokasi untuk aplikasi ini.'
              : error?.code === 2
                ? 'Lokasi GPS tidak tersedia. Aktifkan GPS dan coba lagi.'
                : error?.code === 3
                  ? 'Pencarian lokasi terlalu lama. Pastikan GPS aktif lalu coba lagi.'
                  : 'Gagal membaca lokasi GPS.';
            reject(new Error(message));
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
      }).then(async (coords) => {
        const token = localStorage.getItem('auth_token');
        if (!token || typeof window.apiCall !== 'function') {
          throw new Error('Sesi login tidak tersedia. Silakan login kembali.');
        }
        if (!Number.isFinite(coords.accuracy) || coords.accuracy > 60) {
          throw new Error(`Akurasi GPS belum memadai (${coords.accuracy ?? '-'} m). Pindah ke area terbuka dan coba lagi.`);
        }

        const device = await ensureDeviceRegistered();
        if (device?.Status === 'BLOCKED' || device?.Status === 'REVOKED') {
          throw new Error('Perangkat ini telah diblokir atau dicabut. Hubungi Admin.');
        }

        const challenge = await window.apiCall('createAttendanceChallenge', {
          token,
          lat: coords.lat,
          lng: coords.lng,
          accuracy: coords.accuracy,
          locationCapturedAt: coords.capturedAt
        });

        if (!challenge?.challengeId) {
          throw new Error('Challenge presensi gagal dibuat. Periksa lokasi kembali.');
        }

        lastGpsPosition = coords;
        attendanceChallenge = challenge;
        const distance = challenge.location?.distance;
        const riskLabel = challenge.riskLevel === 'HIGH'
          ? ' · perlu peninjauan'
          : challenge.riskLevel === 'MEDIUM'
            ? ' · akurasi sedang'
            : '';
        const trustLabel = device?.Status === 'PENDING' ? ' · perangkat menunggu persetujuan' : '';
        const status = document.getElementById('absen-facecam-status');
        if (status) {
          status.textContent = `Lokasi valid (${distance ?? 0} m dari titik SPPG)${riskLabel}${trustLabel}`;
        }
        return coords;
      }).catch((error) => {
        resetAttendanceSecurityState();
        showLocationMessage(error?.message || 'Lokasi tidak dapat divalidasi.');
        throw error;
      });
    };
  });
})();
