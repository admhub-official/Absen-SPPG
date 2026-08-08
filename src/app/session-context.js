(() => {
  if (window.__HADIRLY_SESSION_CONTEXT__) return;
  window.__HADIRLY_SESSION_CONTEXT__ = true;

  function appState() {
    try {
      if (typeof AppState !== 'undefined' && AppState) return AppState;
    } catch {}
    return window.AppState || null;
  }

  function token() {
    const runtime = appState()?.token;
    if (runtime) return String(runtime);
    const cookieSession = window.HadirlyCookieSession;
    if (cookieSession?.hasCompatibilityMarker?.()) return String(cookieSession.marker || '');
    return '';
  }

  function user() {
    return appState()?.user || null;
  }

  function authenticated() {
    return Boolean(token());
  }

  window.HadirlySessionContext = Object.freeze({ token, user, authenticated });
})();
