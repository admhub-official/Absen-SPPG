(() => {
  if (window.__ABSEN_LOCATION_FLOW_INSTALLED__) return;

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
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback(value);
      };

      const timeoutId = setTimeout(() => {
        if (best && Number.isFinite(best.accuracy) && best.accuracy <= MAX_GPS_ACCURACY_METER) {
          finish(resolve, best);
          return;
        }
        finish(reject, new Error(
          `Akurasi GPS belum memadai (${best?.accuracy ?? '-'} m, maksimal ${MAX_GPS_ACCURACY_METER} m). ` +
          'Gunakan ponsel dengan lokasi presisi aktif atau pindah ke area terbuka.'
        ));
      }, GPS_TIMEOUT_MS);

      status('Mengunci lokasi GPS…');
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          const sample = normalizePosition(position);
          if (!Number.isFinite(sample.lat) || !Number.isFinite(sample.lng)) return;
          if (!best || (Number.isFinite(sample.accuracy) && sample.accuracy < best.accuracy)) best = sample;
          status(`Mengunci lokasi GPS… akurasi terbaik ${best?.accuracy ?? '-'} m`);
          if (
            Number.isFinite(best?.accuracy) &&
            best.accuracy <= MAX_GPS_ACCURACY_METER &&
            Date.now() - startedAt >= GPS_STABILIZE_MS
          ) {
            finish(resolve, best);
          }
        },
        (error) => finish(reject, new Error(locationErrorMessage(error))),
        { enableHighAccuracy: true, timeout: GPS_TIMEOUT_MS, maximumAge: 0 }
      );
    });
  }

  function installFlow() {
    if (window.__ABSEN_LOCATION_FLOW_INSTALLED__) return true;
    const sharedApiCall = window.apiCall;
    if (typeof sharedApiCall !== 'function') return false;

    window.__ABSEN_LOCATION_FLOW_INSTALLED__ = true;

    window.getCurrentPositionPromise = async function getValidatedAttendancePosition() {
      verifiedPosition = null;
      try {
        const coords = await acquireBestPosition();
        const check = await sharedApiCall('checkAttendanceLocation', {
          lat: coords.lat,
          lng: coords.lng,
          accuracy: coords.accuracy,
          locationCapturedAt: coords.capturedAt
        });
        if (check?.valid === false) {
          throw new Error(check.message || `Anda berada di luar radius lokasi SPPG (${check.jarak ?? '-'} m).`);
        }
        verifiedPosition = coords;
        status(`Lokasi valid · jarak ${check?.jarak ?? 0} m · akurasi ${coords.accuracy ?? '-'} m`);
        return coords;
      } catch (error) {
        verifiedPosition = null;
        status(error?.message || 'Lokasi tidak dapat divalidasi.');
        throw error;
      }
    };

    window.apiCall = async function attendanceAwareApiCall(functionName, payload = {}) {
      if (functionName !== 'recordAbsensiSelf') return sharedApiCall(functionName, payload);
      if (!verifiedPosition) throw new Error('Lokasi belum diverifikasi. Buka ulang pemindaian absensi.');

      try {
        return await sharedApiCall(functionName, {
          ...payload,
          lat: verifiedPosition.lat,
          lng: verifiedPosition.lng,
          accuracy: verifiedPosition.accuracy,
          locationCapturedAt: verifiedPosition.capturedAt
        });
      } finally {
        verifiedPosition = null;
      }
    };
    return true;
  }

  if (!installFlow()) {
    window.addEventListener('load', installFlow, { once: true });
  }
})();
