(() => {
  const IDS = [
    'notification-wrap',
    'btn-notifications',
    'notification-panel',
    'notification-count',
    'notification-list'
  ];

  function removeLegacyNotificationUi() {
    IDS.forEach((id) => document.getElementById(id)?.remove());
    document.querySelectorAll('.notification-wrap,.notification-button,.notification-panel,.notification-count')
      .forEach((node) => node.remove());
  }

  // Hentikan pemuatan ulang notifikasi legacy yang hanya digunakan oleh lonceng lama.
  try {
    window.loadUserNotifications = async () => undefined;
  } catch {}

  removeLegacyNotificationUi();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', removeLegacyNotificationUi, { once: true });
  }

  // Jaga agar renderer legacy tidak menyisipkan kembali kontrol setelah pergantian view/login.
  const observer = new MutationObserver(removeLegacyNotificationUi);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
})();
