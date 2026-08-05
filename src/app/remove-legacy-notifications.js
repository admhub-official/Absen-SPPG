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
    document.querySelectorAll(
      '.notification-wrap,.notification-button,.notification-panel,.notification-count,[data-cc-bell],.cc-bell,.cc-notification-panel,[data-cc-banner],.cc-banner'
    ).forEach((node) => node.remove());
  }

  window.loadUserNotifications = async () => undefined;
  removeLegacyNotificationUi();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', removeLegacyNotificationUi, { once: true });
  }

  const observer = new MutationObserver(removeLegacyNotificationUi);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
})();