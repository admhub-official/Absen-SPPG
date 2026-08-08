(() => {
  if (window.__HADIRLY_HTTP_ONLY_SESSION_BRIDGE__) return;
  window.__HADIRLY_HTTP_ONLY_SESSION_BRIDGE__ = true;

  const config = window.ABSEN_SUPABASE_CONFIG || {};
  const projectOrigin = (() => {
    try { return new URL(config.projectUrl).origin; } catch { return ''; }
  })();
  const canonicalOrigin = 'https://hadirly.org';
  const sessionMarker = '__HADIRLY_HTTP_ONLY_SESSION__';
  const csrfHeader = 'X-Hadirly-CSRF';
  const csrfValue = '1';
  const downstreamFetch = window.fetch.bind(window);
  const functionPrefix = '/functions/v1/';
  const proxyTargets = new Set([
    'AbsenV2','AttendanceLocation','PayrollUser','ProfileOps','DeviceTrust',
    'SecurityOps','ProductionReadiness','AttendanceCorrections','AttendanceImport','EmploymentContracts',
    'Complaints','DigitalIdentity','OperationsV2','WorkforceOps','PlatformOps',
    'ConfigCenter','PayrollListPage','SppgLocationConfig','SystemSettings'
  ]);
  const publicUnauthenticatedFunctions = new Set([
    'getPublicConfig',
    'getMasterData',
    'checkUsernameUnique',
    'registerUser',
    'verifyRegistrationOtp',
    'requestResetPassword',
    'requestResetPasswordByEmail',
    'verifyResetPasswordOtp',
    'resetPassword',
    'resendConfirmationEmail'
  ]);
  const persistentUserKeys = new Set([
    'success',
    'ID_User','idUser',
    'Username','username',
    'Role','role',
    'Nama_Lengkap','namaLengkap','nama',
    'Email','email',
    'SPPG','sppg',
    'Yayasan','yayasan',
    'Jabatan_Divisi','jabatanDivisi','jabatan_divisi',
    'Status_Aktif','statusAktif',
    'URL_Foto_Profil','urlFotoProfil',
    'Wajah_Terdaftar',
    'ID_Card_Digital_Tersedia',
    'QR_Code_Tersedia',
    'device'
  ]);
  const persistentDeviceKeys = new Set(['idDevice','ID_Device','username','Username_Device','lokasi','Lokasi_SPPG']);

  let exchangePromise = null;
  let restorePromise = null;

  function isCanonicalProduction() {
    return location.origin === canonicalOrigin;
  }

  function currentStoredToken() {
    try { return localStorage.getItem('auth_token') || ''; } catch { return ''; }
  }

  function sanitizePersistentUser(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const source = value.user && typeof value.user === 'object' && !Array.isArray(value.user) ? value.user : value;
    const safe = {};
    for (const [key, item] of Object.entries(source)) {
      if (!persistentUserKeys.has(key)) continue;
      if (key === 'device') {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const device = {};
        for (const [deviceKey, deviceValue] of Object.entries(item)) {
          if (persistentDeviceKeys.has(deviceKey)) device[deviceKey] = deviceValue;
        }
        safe.device = device;
        continue;
      }
      safe[key] = item;
    }
    return safe;
  }

  function installAuthUserStorageGuard() {
    if (window.__HADIRLY_AUTH_USER_STORAGE_GUARD__) return;
    window.__HADIRLY_AUTH_USER_STORAGE_GUARD__ = true;
    const nativeSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function guardedStorageSetItem(key, value) {
      if (this === localStorage && String(key) === 'auth_user') {
        try {
          value = JSON.stringify(sanitizePersistentUser(JSON.parse(String(value))));
        } catch {
          value = '{}';
        }
      }
      return nativeSetItem.call(this, key, value);
    };
    try {
      const existing = localStorage.getItem('auth_user');
      if (existing) localStorage.setItem('auth_user', existing);
    } catch {}
  }

  installAuthUserStorageGuard();

  function syncRuntimeToken(value) {
    try {
      if (typeof AppState !== 'undefined' && AppState) AppState.token = value;
    } catch {}
    try {
      if (window.AppState) window.AppState.token = value;
    } catch {}
  }

  function syncRuntimeUser(value) {
    try {
      if (typeof AppState !== 'undefined' && AppState) AppState.user = value;
    } catch {}
    try {
      if (window.AppState) window.AppState.user = value;
    } catch {}
  }

  function setMarker() {
    try { localStorage.setItem('auth_token', sessionMarker); } catch {}
    syncRuntimeToken(sessionMarker);
  }

  function persistSafeUser(value) {
    if (!value || typeof value !== 'object') return;
    const user = value.user && typeof value.user === 'object' ? value.user : value;
    try { localStorage.setItem('auth_user', JSON.stringify(sanitizePersistentUser(user))); } catch {}
    syncRuntimeUser(user);
  }

  function clearClientAuth() {
    try {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
    } catch {}
    syncRuntimeToken(null);
    syncRuntimeUser(null);
    try { window.clearApiResponseCache?.(); } catch {}
    try { window.HadirlySecurityContext?.resetDeviceContext?.(); } catch {}
    window.dispatchEvent(new CustomEvent('absen:session-changed', { detail: { authenticated: false, source: 'http-only-bff' } }));
  }

  function mutationHeaders(headersInit) {
    const headers = new Headers(headersInit || {});
    headers.set(csrfHeader, csrfValue);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return headers;
  }

  async function sameOriginApi(path, init = {}) {
    return downstreamFetch(new URL(path, location.origin), {
      ...init,
      headers: mutationHeaders(init.headers),
      credentials: 'same-origin',
      cache: 'no-store',
      referrerPolicy: 'same-origin'
    });
  }

  async function readCookieSession() {
    return downstreamFetch('/api/auth/session', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      referrerPolicy: 'same-origin'
    });
  }

  async function restoreCookieSession() {
    if (!isCanonicalProduction()) return false;
    if (restorePromise) return restorePromise;
    restorePromise = (async () => {
      try {
        const response = await readCookieSession();
        const payload = await response.clone().json().catch(() => ({}));
        if (response.ok && payload?.authenticated === true) {
          setMarker();
          persistSafeUser(payload.result);
          window.dispatchEvent(new CustomEvent('absen:session-changed', { detail: { authenticated: true, source: 'http-only-bff' } }));
          return true;
        }
        if (response.status === 401) clearClientAuth();
        return false;
      } catch {
        return false;
      } finally {
        restorePromise = null;
      }
    })();
    return restorePromise;
  }

  async function exchangeLegacySession() {
    if (!isCanonicalProduction()) return false;
    const stored = currentStoredToken();
    if (!stored || stored === sessionMarker) {
      if (stored === sessionMarker) syncRuntimeToken(sessionMarker);
      return stored === sessionMarker;
    }
    if (exchangePromise) return exchangePromise;

    exchangePromise = (async () => {
      try {
        const response = await sameOriginApi('/api/auth/exchange', {
          method: 'POST',
          body: JSON.stringify({ token: stored })
        });
        const body = await response.clone().json().catch(() => ({}));
        if (response.ok && body?.success !== false) {
          setMarker();
          window.dispatchEvent(new CustomEvent('absen:session-changed', { detail: { authenticated: true, source: 'http-only-bff' } }));
          return true;
        }
        clearClientAuth();
        return false;
      } catch {
        // Canonical production never keeps a raw legacy bearer when the cookie exchange
        // cannot be proven successful. Re-login is safer than retaining browser-readable secret material.
        clearClientAuth();
        return false;
      } finally {
        exchangePromise = null;
      }
    })();
    return exchangePromise;
  }

  function requestDetails(input, init) {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    if (!raw) return null;
    let url;
    try { url = new URL(raw, location.href); } catch { return null; }
    const method = String(init?.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    return { url, method, bodyText };
  }

  function functionName(body) {
    return String(body?.function || body?.functionName || body?.action || '').trim();
  }

  function responseWithJson(original, payload) {
    const headers = new Headers(original.headers);
    headers.set('Content-Type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(payload), {
      status: original.status,
      statusText: original.statusText,
      headers
    });
  }

  async function bffLogin(body) {
    const data = body?.data && typeof body.data === 'object' ? body.data : body;
    const response = await sameOriginApi('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: data?.email || data?.username || '',
        username: data?.username || data?.email || '',
        password: data?.password || ''
      })
    });
    const payload = await response.clone().json().catch(() => ({}));
    if (response.ok && payload?.success !== false && payload?.result && typeof payload.result === 'object') {
      setMarker();
      persistSafeUser(payload.result);
      payload.result = { ...payload.result, token: sessionMarker };
      window.dispatchEvent(new CustomEvent('absen:session-changed', { detail: { authenticated: true, source: 'http-only-bff' } }));
      return responseWithJson(response, payload);
    }
    return response;
  }

  async function bffSessionCheck() {
    const stored = currentStoredToken();
    if (stored && stored !== sessionMarker) await exchangeLegacySession();
    const response = await readCookieSession();
    const payload = await response.clone().json().catch(() => ({}));
    if (response.ok && payload?.authenticated === true) {
      setMarker();
      persistSafeUser(payload.result);
      return responseWithJson(response, {
        success: true,
        result: {
          valid: true,
          ...(payload.session && typeof payload.session === 'object' ? payload.session : {}),
          user: payload.result || null,
          token: sessionMarker
        }
      });
    }
    if (response.status === 401) clearClientAuth();
    return responseWithJson(response, {
      success: false,
      error: payload?.message || 'Sesi tidak valid atau telah berakhir.',
      code: payload?.code || 'SESSION_EXPIRED'
    });
  }

  async function bffLogout() {
    const stored = currentStoredToken();
    if (stored && stored !== sessionMarker) await exchangeLegacySession();
    const response = await sameOriginApi('/api/auth/logout', { method: 'POST', body: '{}' });
    clearClientAuth();
    return response;
  }

  async function bffProxy(target, body, sourceHeaders) {
    const stored = currentStoredToken();
    if (stored && stored !== sessionMarker) {
      const migrated = await exchangeLegacySession();
      if (!migrated) {
        return responseWithJson(new Response(null, { status: 401 }), {
          success: false,
          code: 'SESSION_MIGRATION_REQUIRED',
          message: 'Sesi lama tidak dapat diamankan. Silakan login kembali.'
        });
      }
    }
    const headers = mutationHeaders(sourceHeaders);
    const response = await downstreamFetch(`/api/functions/${encodeURIComponent(target)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
      credentials: 'same-origin',
      cache: 'no-store',
      referrerPolicy: 'same-origin'
    });
    if (response.status === 401) {
      const payload = await response.clone().json().catch(() => ({}));
      if (['SESSION_MISSING','SESSION_EXPIRED'].includes(String(payload?.code || ''))) clearClientAuth();
    }
    return response;
  }

  window.fetch = async function hadirlyHttpOnlyFetch(input, init = {}) {
    const details = requestDetails(input, init);
    if (!details || !projectOrigin || details.url.origin !== projectOrigin || !details.url.pathname.startsWith(functionPrefix)) {
      return downstreamFetch(input, init);
    }

    const target = decodeURIComponent(details.url.pathname.slice(functionPrefix.length).split('/')[0] || '');
    if (!proxyTargets.has(target) || details.method !== 'POST' || !details.bodyText) {
      return downstreamFetch(input, init);
    }

    if (!isCanonicalProduction()) return downstreamFetch(input, init);

    let body;
    try { body = JSON.parse(details.bodyText); }
    catch { return downstreamFetch(input, init); }

    const name = functionName(body);
    if (target === 'AbsenV2' && name === 'login') return bffLogin(body);
    if (target === 'AbsenV2' && name === 'logout') return bffLogout();
    if (target === 'AbsenV2' && name === 'checkSession') return bffSessionCheck();
    if (target === 'AbsenV2' && publicUnauthenticatedFunctions.has(name)) return downstreamFetch(input, init);

    return bffProxy(target, body, init.headers || (typeof input === 'object' ? input.headers : undefined));
  };

  window.HadirlyCookieSession = Object.freeze({
    marker: sessionMarker,
    productionRequired: true,
    publicUnauthenticatedFunctions,
    exchangeLegacySession,
    restoreCookieSession,
    clearClientAuth,
    sanitizePersistentUser,
    hasCompatibilityMarker: () => currentStoredToken() === sessionMarker
  });

  if (isCanonicalProduction()) {
    const stored = currentStoredToken();
    if (stored && stored !== sessionMarker) {
      exchangeLegacySession().then((ok) => { if (ok) restoreCookieSession().catch(() => {}); }).catch(() => {});
    } else {
      restoreCookieSession().catch(() => {});
    }
  }
})();
