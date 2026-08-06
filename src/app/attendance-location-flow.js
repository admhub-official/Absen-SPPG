(() => {
  const MAX_GPS_ACCURACY_METER = 100;
  const GPS_TIMEOUT_MS = 25000;
  const GPS_STABILIZE_MS = 2500;
  let verifiedPosition = null;

  function status(message) {
    const node = document.getElementById('absen-facecam-status');
    if (node) node.textContent = message;
  }

  function locationErrorMessage(error) {
    if (error?.code === 1) return 'Izin lokasi ditolak. Aktifkan izin lokasi presisi untuk aplikasi ini.';
    if (error?.code === 2) return 'Lokasi GPS tidak tersedia. Aktifkan GPS dan coba lagi.';
    if (error?.code === 3) return 'Pencarian lokasi terlalu lama. Pastikan GPS aktif lalu coba lagi.';
    return error?.message || 'Gagal membaca lokasi GPS.';
  }

  function normalizePosition(position) {
    return {
      lat: Number(position.coords.latitude),
      lng: Number(position.coords.longitude),
      accuracy: Number.isFinite(position.coords.accuracy) ? Math.round(position.coords.accuracy) : null,
      capturedAt: new Date(position.timestamp || Date.now()).toISOString()
    };
  }

  function acquireBestPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Perangkat atau browser ini tidak mendukung layanan lokasi.'));
        return;
      }

      let best = null;
      let watchId = null;
      let settled = false;
      const startedAt = Date.now();

      const cleanup = () => {
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        clearTimeout(timeoutId);
      };
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn(value);
      };

      const timeoutId = setTimeout(() => {
        if (best && Number.isFinite(best.accuracy) && best.accuracy <= MAX_GPS_ACCURACY_METER) {
          finish(resolve, best);
        } else {
          finish(reject, new Error(`Akurasi GPS belum memadai (${best?.accuracy ?? '-'} m, maksimal ${MAX_GPS_ACCURACY_METER} m). Gunakan ponsel dengan lokasi presisi aktif atau pindah ke area terbuka.`));
        }
      }, GPS_TIMEOUT_MS);

      status('Mengunci lokasi GPS…');
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          const sample = normalizePosition(position);
          if (!Number.isFinite(sample.lat) || !Number.isFinite(sample.lng)) return;
          if (!best || (Number.isFinite(sample.accuracy) && sample.accuracy < best.accuracy)) best = sample;
          status(`Mengunci lokasi GPS… akurasi terbaik ${best?.accuracy ?? '-'} m`);
          if (Number.isFinite(best?.accuracy) && best.accuracy <= MAX_GPS_ACCURACY_METER && Date.now() - startedAt >= GPS_STABILIZE_MS) {
            finish(resolve, best);
          }
        },
        (error) => finish(reject, new Error(locationErrorMessage(error))),
        { enableHighAccuracy: true, timeout: GPS_TIMEOUT_MS, maximumAge: 0 }
      );
    });
  }

  async function directApiCall(functionName, payload = {}) {
    const config = window.ABSEN_SUPABASE_CONFIG;
    const token = localStorage.getItem('auth_token');
    if (!config?.projectUrl || !config?.functionName || !token) {
      throw new Error('Sesi atau konfigurasi API tidak tersedia. Silakan login kembali.');
    }
    const response = await fetch(`${config.projectUrl.replace(/\/$/, '')}/functions/v1/${encodeURIComponent(config.functionName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ function: functionName, data: { ...payload, token } })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.success === false) throw new Error(body?.error || body?.message || 'Permintaan absensi gagal.');
    return body?.result;
  }

  function installFlow() {
    const previousApiCall = window.apiCall;
    if (typeof previousApiCall !== 'function') return false;

    window.getCurrentPositionPromise = async function getValidatedAttendancePosition() {
      verifiedPosition = null;
      const coords = await acquireBestPosition();
      const check = await directApiCall('checkAttendanceLocation', {
        lat: coords.lat,
        lng: coords.lng,
        accuracy: coords.accuracy
      });
      if (check?.valid === false) throw new Error(check.message || `Anda berada di luar radius lokasi SPPG (${check.jarak ?? '-'} m).`);
      verifiedPosition = coords;
      status(`Lokasi valid · jarak ${check?.jarak ?? 0} m · akurasi ${coords.accuracy ?? '-'} m`);
      return coords;
    };

    window.apiCall = async function attendanceCompatibleApiCall(functionName, payload = {}) {
      if (functionName !== 'recordAbsensiSelf') return previousApiCall(functionName, payload);
      if (!verifiedPosition) throw new Error('Lokasi belum diverifikasi. Buka ulang pemindaian absensi.');
      try {
        return await directApiCall(functionName, {
          ...payload,
          lat: verifiedPosition.lat,
          lng: verifiedPosition.lng,
          accuracy: verifiedPosition.accuracy,
          locationCapturedAt: verifiedPosition.capturedAt,
          idempotencyKey: payload.idempotencyKey || crypto.randomUUID()
        });
      } finally {
        verifiedPosition = null;
      }
    };
    return true;
  }

  if (!installFlow()) {
    window.addEventListener('load', () => installFlow(), { once: true });
  }
})();
