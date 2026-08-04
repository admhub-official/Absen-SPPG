export function createAppStore(initialState = {}) {
  let state = Object.freeze({ route: 'dashboard', loading: false, error: null, ...initialState });
  const listeners = new Set();
  const getState = () => state;
  const setState = (patch) => {
    const value = typeof patch === 'function' ? patch(state) : patch;
    state = Object.freeze({ ...state, ...value });
    listeners.forEach((listener) => listener(state));
    window.dispatchEvent(new CustomEvent('absen:state-change', { detail: state }));
    return state;
  };
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return Object.freeze({ getState, setState, subscribe });
}
