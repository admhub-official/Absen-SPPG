window.ABSEN_SUPABASE_CONFIG = Object.freeze({
  projectUrl: 'https://szwwpnbbsmjsbzzcecyj.supabase.co',
  functionName: 'AbsenV2'
});

(() => {
  let lastGpsPosition = null;
  const IDEMPOTENT_FUNCTIONS = new Set(['recordAbsensiSelf', 'recordAbsensi']);

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

  window.addEventListener('DOMContentLoaded', () => {
    const originalApiCall = window.apiCall;
    if (typeof originalApiCall === 'function') {
      window.apiCall = async function integrityAwareApiCall(functionName, payload = {}) {
        if (functionName === 'recordAbsensiSelf' && lastGpsPosition) {
          payload = {
            ...payload,
            lat: lastGpsPosition.lat,
            lng: lastGpsPosition.lng,
            accuracy: lastGpsPosition.accuracy
          };
        }

        if (IDEMPOTENT_FUNCTIONS.has(functionName)) {
          payload = {
            ...payload,
            idempotencyKey: getOrCreateIdempotencyKey(functionName)
          };
        }

        const result = await originalApiCall(functionName, payload);
        if (IDEMPOTENT_FUNCTIONS.has(functionName)) clearIdempotencyKey(functionName);
        return result;
      };
    }

    window.getCurrentPositionPromise = function getValidatedAttendancePosition() {
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
              : null
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

        const validation = await window.apiCall('checkAttendanceLocation', {
          token,
          lat: coords.lat,
          lng: coords.lng,
          accuracy: coords.accuracy
        });

        if (!validation?.valid) {
          throw new Error(validation?.message || 'Lokasi Anda tidak memenuhi radius absensi.');
        }

        lastGpsPosition = coords;
        const status = document.getElementById('absen-facecam-status');
        if (status) {
          status.textContent = `Lokasi valid (${validation.jarak ?? 0} m dari titik SPPG)`;
        }
        return coords;
      }).catch((error) => {
        lastGpsPosition = null;
        showLocationMessage(error?.message || 'Lokasi tidak dapat divalidasi.');
        throw error;
      });
    };
  });
})();
