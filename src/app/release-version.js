(() => {
  const version = '26.11.61';
  const cacheName = 'absen-sppg-hadirly-v102';
  globalThis.HADIRLY_RELEASE = Object.freeze({ version, cacheName });
})();

if (typeof document !== 'undefined') {
  void import('./navigation-state-guard.js').catch((error) => {
    console.warn('Navigation/state guard gagal dimuat.', error);
  });
}
