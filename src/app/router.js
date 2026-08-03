export function createRouter({ onRoute } = {}) {
  const listeners = new Set();
  const notify = (route) => {
    listeners.forEach((listener) => listener(route));
    onRoute?.(route);
  };
  const current = () => window.location.hash.replace(/^#\/?/, '') || 'dashboard';
  const navigate = (route, options = {}) => {
    const next = String(route || 'dashboard').replace(/^#\/?/, '');
    if (options.replace) history.replaceState(null, '', `#/${next}`);
    else window.location.hash = `#/${next}`;
    notify(next);
  };
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  window.addEventListener('hashchange', () => notify(current()));
  return Object.freeze({ current, navigate, subscribe });
}
