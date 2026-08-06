(() => {
  if (window.__LEGACY_NOTIFICATIONS_DISABLED__) return;
  window.__LEGACY_NOTIFICATIONS_DISABLED__ = true;

  const IDS = [
    'notification-wrap',
    'btn-notifications',
    'notification-panel',
    'notification-count',
    'notification-list'
  ];
  const SELECTOR = [
    '.notification-wrap',
    '.notification-button',
    '.notification-panel',
    '.notification-count',
    '[data-cc-bell]',
    '.cc-bell',
    '.cc-notification-panel',
    '[data-cc-banner]',
    '.cc-banner'
  ].join(',');

  function removeLegacyNotificationUi() {
    IDS.forEach((id) => document.getElementById(id)?.remove());
    document.querySelectorAll(SELECTOR).forEach((node) => node.remove());
  }

  function scheduleCleanup() {
    [0, 100, 350, 1000, 2500].forEach((delay) => window.setTimeout(removeLegacyNotificationUi, delay));
  }

  // Menonaktifkan loader lama tanpa memelihara observer global permanen.
  window.loadUserNotifications = async () => undefined;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleCleanup, { once: true });
  } else {
    scheduleCleanup();
  }

  window.addEventListener('absen:app-ready', scheduleCleanup);
  window.addEventListener('absen:session-changed', scheduleCleanup);
  window.addEventListener('hashchange', scheduleCleanup);
})();
