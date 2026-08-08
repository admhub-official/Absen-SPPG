(() => {
  if (window.__HADIRLY_LOGOUT_GUARD__) return;
  window.__HADIRLY_LOGOUT_GUARD__ = true;

  const TIMEOUT_MS = 3500;
  let busy = false;

  function timeout(ms) {
    return new Promise((_, reject) => setTimeout(() => reject(new Error('LOGOUT_TIMEOUT')), ms));
  }

  function clearClientSession() {
    try { window.clearApiResponseCache?.(); } catch {}
    try { window.HadirlyUpdateSafety?.markClean?.(); } catch {}
    try {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
    } catch {}
    try {
      // sessionStorage hanya berisi state sementara Hadirly per-tab
      // (idempotency key, marker reload PWA, dan state workflow sementara).
      sessionStorage.clear();
    } catch {}

    try { window.HadirlyNavigationState?.resetSessionState?.(); } catch {}

    if (window.AppState) {
      window.AppState.token = null;
      window.AppState.user = null;
      if (Array.isArray(window.AppState.notifications)) window.AppState.notifications = [];
    }

    window.dispatchEvent(new CustomEvent('absen:session-changed', { detail: { authenticated: false } }));
  }

  async function logout() {
    if (busy) return;
    busy = true;
    const token = window.AppState?.token || localStorage.getItem('auth_token') || '';
    try {
      // Putus request privat dari sesi lama terlebih dahulu, lalu gunakan controller
      // generasi baru untuk request revoke logout itu sendiri.
      try { window.HadirlySessionRequestAbort?.rotate?.('LOGOUT_START'); } catch {}
      if (token && typeof window.apiCall === 'function') {
        await Promise.race([
          window.apiCall('logout', { token }, { force: true }),
          timeout(TIMEOUT_MS)
        ]);
      }
    } catch (error) {
      console.warn('Server session revoke gagal; client session tetap dibersihkan.', error);
    } finally {
      clearClientSession();
      try {
        if (typeof window.showAuth === 'function') window.showAuth();
        if (typeof window.navigateTo === 'function') window.navigateTo('login');
        else location.hash = '#login';
      } finally {
        busy = false;
      }
    }
  }

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('#btn-logout') : null;
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    logout();
  }, true);

  window.HadirlyLogout = Object.freeze({ logout, clearClientSession });
})();
