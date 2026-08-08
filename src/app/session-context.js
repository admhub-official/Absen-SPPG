(() => {
  if (window.__HADIRLY_SESSION_CONTEXT__) return;
  window.__HADIRLY_SESSION_CONTEXT__ = true;

  function token() {
    const runtime = window.AppState?.token;
    if (runtime) return String(runtime);
    const cookieSession = window.HadirlyCookieSession;
    if (cookieSession?.hasCompatibilityMarker?.()) return String(cookieSession.marker || '');
    return '';
  }

  function user() {
    return window.AppState?.user || null;
  }

  function authenticated() {
    return Boolean(token());
  }

  window.HadirlySessionContext = Object.freeze({ token, user, authenticated });
})();
