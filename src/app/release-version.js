(() => {
  const version = '26.11.69';
  const cacheName = 'absen-sppg-hadirly-v110';
  globalThis.HADIRLY_RELEASE = Object.freeze({ version, cacheName });
})();

if (typeof document !== 'undefined') {
  void Promise.all([
    import('./session-request-abort.js'),
    import('./navigation-state-guard.js')
  ]).catch((error) => {
    console.warn('Session/navigation guard gagal dimuat.', error);
  });
}
