(() => {
  if (window.__HADIRLY_SESSION_REQUEST_ABORT__) return;
  window.__HADIRLY_SESSION_REQUEST_ABORT__ = true;

  const downstreamFetch = window.fetch.bind(window);
  const config = window.ABSEN_SUPABASE_CONFIG || {};
  const projectOrigin = (() => {
    try { return new URL(config.projectUrl).origin; } catch { return ''; }
  })();
  const publicFunctions = new Set([
    'getPublicConfig',
    'getMasterData',
    'checkUsernameUnique',
    'registerUser',
    'verifyRegistrationOtp',
    'requestResetPassword',
    'requestResetPasswordByEmail',
    'verifyResetPasswordOtp',
    'resetPassword',
    'resendConfirmationEmail',
    'login'
  ]);

  let controller = new AbortController();
  let generation = 0;

  function requestDetails(input, init = {}) {
    const raw = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input instanceof Request
          ? input.url
          : input?.url;
    if (!raw) return null;
    let url;
    try { url = new URL(raw, window.location.href); } catch { return null; }
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : '';
    return { url, method, body };
  }

  function payloadFunctionName(body) {
    if (!body) return '';
    try {
      const parsed = JSON.parse(body);
      return String(parsed?.function || parsed?.functionName || parsed?.action || '').trim();
    } catch {
      return '';
    }
  }

  function isPublicUnauthenticated(details) {
    if (!details) return false;
    if (details.url.origin === window.location.origin && details.url.pathname === '/api/auth/login') return true;
    if (projectOrigin && details.url.origin === projectOrigin && details.url.pathname.startsWith('/functions/v1/')) {
      return publicFunctions.has(payloadFunctionName(details.body));
    }
    return false;
  }

  function isSessionBoundRequest(input, init = {}) {
    const details = requestDetails(input, init);
    if (!details || isPublicUnauthenticated(details)) return false;
    if (details.url.origin === window.location.origin && details.url.pathname.startsWith('/api/')) return true;
    return Boolean(projectOrigin && details.url.origin === projectOrigin && details.url.pathname.startsWith('/functions/v1/'));
  }

  function combinedSignal(existingSignal, sessionSignal) {
    if (!existingSignal) return sessionSignal;
    if (existingSignal.aborted) return existingSignal;
    if (typeof AbortSignal.any === 'function') return AbortSignal.any([existingSignal, sessionSignal]);

    const merged = new AbortController();
    const forwardAbort = (signal) => {
      if (merged.signal.aborted) return;
      try { merged.abort(signal.reason); }
      catch { merged.abort(); }
    };
    existingSignal.addEventListener('abort', () => forwardAbort(existingSignal), { once: true });
    sessionSignal.addEventListener('abort', () => forwardAbort(sessionSignal), { once: true });
    return merged.signal;
  }

  window.fetch = function sessionBoundFetch(input, init = {}) {
    if (!isSessionBoundRequest(input, init)) return downstreamFetch(input, init);
    const existingSignal = init?.signal || (input instanceof Request ? input.signal : null);
    const signal = combinedSignal(existingSignal, controller.signal);
    return downstreamFetch(input, { ...init, signal });
  };

  function rotate(reason = 'SESSION_CHANGED') {
    const previous = controller;
    controller = new AbortController();
    generation += 1;
    if (!previous.signal.aborted) {
      try { previous.abort(new DOMException(reason, 'AbortError')); }
      catch { previous.abort(); }
    }
    return generation;
  }

  window.addEventListener('absen:session-changed', (event) => {
    const authenticated = event?.detail?.authenticated;
    rotate(authenticated === true ? 'SESSION_AUTHENTICATED' : 'SESSION_ENDED');
  });
  window.addEventListener('pagehide', () => rotate('PAGE_HIDDEN'), { once: true });

  window.HadirlySessionRequestAbort = Object.freeze({
    rotate,
    abortPending: rotate,
    generation: () => generation,
    isSessionBoundRequest
  });
})();
