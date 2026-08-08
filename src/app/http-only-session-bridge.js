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

  let exchangePromise = null;

  function isCanonicalProduction() {
    return location.origin === canonicalOrigin;
  }

  function currentStoredToken() {
    try { return localStorage.getItem('auth_token') || ''; } catch { return ''; }
  }

  function syncRuntimeToken(value) {
    try {
      if (typeof AppState !== 'undefined' && AppState) AppState.token = value;
    } catch {}
    try {
      if (window.AppState) window.AppState.token = value;
    } catch {}
  }

  function setMarker() {
    try { localStorage.setItem('auth_token', sessionMarker); } catch {}
    syncRuntimeToken(sessionMarker);
  }

  function clearClientAuth() {
    try {
      if (localStorage.getItem('auth_token') === sessionMarker) localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
    } catch {}
    syncRuntimeToken(null);
    try {
      if (typeof AppState !== 'undefined' && AppState) AppState.user = null;
    } catch {}
    try {
      if (window.AppState) window.AppState.user = null;
    } catch {}
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
        if (response.status === 401 || response.status === 410) clearClientAuth();
        return false;
      } catch {
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
      payload.result = { ...payload.result, token: sessionMarker };
      window.dispatchEvent(new CustomEvent('absen:session-changed', { detail: { authenticated: true, source: 'http-only-bff' } }));
      return responseWithJson(response, payload);
    }
    return response;
  }

  async function bffSessionCheck() {
    await exchangeLegacySession();
    const response = await downstreamFetch('/api/auth/session', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      referrerPolicy: 'same-origin'
    });
    const payload = await response.clone().json().catch(() => ({}));
    if (response.ok && payload?.authenticated === true) {
      setMarker();
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
    await exchangeLegacySession();
    const response = await sameOriginApi('/api/auth/logout', { method: 'POST', body: '{}' });
    clearClientAuth();
    return response;
  }

  async function bffProxy(target, body, sourceHeaders) {
    await exchangeLegacySession();
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

    return bffProxy(target, body, init.headers || (typeof input === 'object' ? input.headers : undefined));
  };

  window.HadirlyCookieSession = Object.freeze({
    marker: sessionMarker,
    productionRequired: true,
    exchangeLegacySession,
    clearClientAuth,
    hasCompatibilityMarker: () => currentStoredToken() === sessionMarker
  });

  if (isCanonicalProduction()) {
    const stored = currentStoredToken();
    if (stored === sessionMarker) syncRuntimeToken(sessionMarker);
    else if (stored) exchangeLegacySession().catch(() => {});
  }
})();
