(() => {
  const version = '26.11.62';
  const cacheName = 'absen-sppg-hadirly-v103';
  globalThis.HADIRLY_RELEASE = Object.freeze({ version, cacheName });
})();

if (typeof document !== 'undefined') {
  void import('./navigation-state-guard.js').catch((error) => {
    console.warn('Navigation/state guard gagal dimuat.', error);
  });
}
