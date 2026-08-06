(() => {
  if (window.__ABSEN_LOCATION_FLOW_V2__) return;
  window.__ABSEN_LOCATION_FLOW_V2__ = true;

  const GPS_TIMEOUT_MS = 25000;
  let verifiedContext = null;
  let installTimer = null;

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

  function endpoint() {
    const config = window.ABSEN_SUPABASE_CONFIG || {};
    const projectUrl = String(config.projectUrl || '').replace(/\/$/, '');
    const functionName = String(config.attendanceLocationFunctionName || 'AttendanceLocation');
    if (!projectUrl) throw new Error('Konfigurasi backend lokasi belum tersedia.');
    return `${projectUrl}/functions/v1/${functionName}`;
  }

  async function locationCall(action, payload = {}) {
    const token = payload.token || localStorage.getItem('auth_token');
    if (!token) throw new Error('Sesi login tidak tersedia.');
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, action, token }),
      cache: 'no-store',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.success === false) {
      throw new Error(body?.message || body?.error || 'Backend lokasi absensi tidak tersedia.');
    }
    return body?.result;
  }

  function acquirePosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Perangkat atau browser ini tidak mendukung layanan lokasi.'));
        return;
      }
      status('Membaca lokasi GPS perangkat…');
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const latitude = Number(position.coords.latitude);
          const longitude = Number(position.coords.longitude);
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            reject(new Error('Koordinat GPS perangkat tidak valid.'));
            return;
          }
          resolve({
            lat: latitude,
            lng: longitude,
            accuracy: Number.isFinite(position.coords.accuracy) ? Math.round(position.coords.accuracy) : null,
            capturedAt: new Date(position.timestamp || Date.now()).toISOString(),
          });
        },
        (error) => reject(new Error(locationErrorMessage(error))),
        { enableHighAccuracy: true, timeout: GPS_TIMEOUT_MS, maximumAge: 0 },
      );
    });
  }

  async function prepareLocation() {
    verifiedContext = null;
    const policy = await locationCall('policy');
    if (policy?.required === false) {
      verifiedContext = {
        lat: null,
        lng: null,
        accuracy: null,
        capturedAt: new Date().toISOString(),
        geofenceRequired: false,
        referenceName: policy.referenceName || 'Geofence dinonaktifkan',
        radius: null,
      };
      status(policy.message || 'Geofence dinonaktifkan oleh SUPER ADMIN.');
      return verifiedContext;
    }
    if (policy?.configured === false) {
      throw new Error(policy.message || 'Lokasi SPPG belum dikonfigurasi oleh SUPER ADMIN.');
    }

    const coords = await acquirePosition();
    const check = await locationCall('check', {
      lat: coords.lat,
      lng: coords.lng,
      accuracy: coords.accuracy,
      locationCapturedAt: coords.capturedAt,
    });
    if (check?.valid === false) {
      throw new Error(check.message || `Anda berada di luar radius lokasi SPPG (${check.jarak ?? '-'} m).`);
    }

    verifiedContext = {
      ...coords,
      geofenceRequired: true,
      referenceName: check?.referenceName || check?.titikReferensi || policy.referenceName,
      radius: check?.radius ?? policy.radius ?? null,
      distance: check?.distance ?? check?.jarak ?? null,
    };
    status(`Lokasi valid · jarak ${verifiedContext.distance ?? 0} m · radius ${verifiedContext.radius ?? '-'} m`);
    return verifiedContext;
  }

  function installFlow() {
    if (window.__ABSEN_LOCATION_FLOW_INSTALLED__) return true;
    const sharedApiCall = window.apiCall;
    if (typeof sharedApiCall !== 'function') return false;

    window.__ABSEN_LOCATION_FLOW_INSTALLED__ = true;
    window.getCurrentPositionPromise = async function getBackendValidatedAttendancePosition() {
      try {
        return await prepareLocation();
      } catch (error) {
        verifiedContext = null;
        status(error?.message || 'Lokasi tidak dapat divalidasi.');
        throw error;
      }
    };

    window.apiCall = async function backendLocationAwareApiCall(functionName, payload = {}) {
      if (functionName !== 'recordAbsensiSelf') return sharedApiCall(functionName, payload);

      try {
        if (!verifiedContext) {
          const policy = await locationCall('policy', { token: payload.token });
          if (policy?.required !== false) {
            throw new Error('Lokasi belum diverifikasi. Buka ulang pemindaian absensi.');
          }
          verifiedContext = {
            lat: null,
            lng: null,
            accuracy: null,
            capturedAt: new Date().toISOString(),
            geofenceRequired: false,
          };
        }

        return await locationCall('record', {
          ...payload,
          lat: verifiedContext.lat,
          lng: verifiedContext.lng,
          accuracy: verifiedContext.accuracy,
          locationCapturedAt: verifiedContext.capturedAt,
        });
      } finally {
        verifiedContext = null;
      }
    };
    return true;
  }

  function scheduleInstall() {
    clearTimeout(installTimer);
    installTimer = window.setTimeout(() => {
      if (!installFlow()) scheduleInstall();
    }, 120);
  }

  if (!installFlow()) scheduleInstall();
  window.addEventListener('absen:app-ready', scheduleInstall);
  window.addEventListener('absen:session-changed', () => {
    verifiedContext = null;
    scheduleInstall();
  });
})();
