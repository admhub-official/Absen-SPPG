(() => {
  if (window.NotificationSettingSync) return;
  const endpoint = `${window.ABSEN_SUPABASE_CONFIG.projectUrl}/functions/v1/ConfigCenter`;
  let running = false;
  let timer = null;

  function isSuperAdmin() {
    try {
      const user = JSON.parse(localStorage.getItem('auth_user') || 'null');
      return Boolean(localStorage.getItem('auth_token')) && String(user?.role || user?.Role || '').toUpperCase().replace(/_/g, ' ').trim() === 'SUPER ADMIN';
    } catch { return false; }
  }

  function apply(enabled) {
    document.querySelectorAll('[data-setting-key="notification.global_announcement"]').forEach((button) => {
      button.classList.toggle('active', Boolean(enabled));
      button.setAttribute('aria-checked', String(Boolean(enabled)));
      button.dataset.backendSynced = 'true';
    });
  }

  async function sync() {
    if (!isSuperAdmin() || running || !document.querySelector('[data-setting-key="notification.global_announcement"]')) return;
    running = true;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'adminNotificationConfig', token: localStorage.getItem('auth_token') }),
        cache: 'no-store',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.success === false) throw new Error(body.message || 'Pengaturan pengumuman gagal dibaca.');
      apply(Boolean(body.result?.enabled));
    } catch (error) {
      console.warn('Pengumuman Global gagal disinkronkan', error);
    } finally {
      running = false;
    }
  }

  function schedule(delay = 60) {
    clearTimeout(timer);
    timer = window.setTimeout(sync, delay);
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-setting-tab="notification"]')) schedule(80);
    if (event.target.closest('[data-setting-key="notification.global_announcement"]')) schedule(700);
  });
  window.addEventListener('absen:app-ready', () => schedule(250));
  window.addEventListener('absen:session-changed', () => schedule(250));
  new MutationObserver(() => schedule(100)).observe(document.body, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => schedule(250), { once: true });
  else schedule(250);
  window.NotificationSettingSync = Object.freeze({ sync });
})();
