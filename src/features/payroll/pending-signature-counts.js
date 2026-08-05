(() => {
  const endpoint = 'https://szwwpnbbsmjsbzzcecyj.supabase.co/functions/v1/PendingSignatureCounts';
  let timer = null;
  let inFlight = false;

  function token() {
    try {
      if (typeof AppState !== 'undefined' && AppState?.token) return AppState.token;
    } catch {}
    return localStorage.getItem('auth_token') || '';
  }

  function setBadge(count) {
    const badge = document.getElementById('notification-count');
    if (!badge) return;
    const value = Math.max(0, Number(count) || 0);
    badge.textContent = value > 99 ? '99+' : String(value);
    badge.style.display = value ? 'inline-flex' : 'none';
    badge.setAttribute('aria-label', `${value} notifikasi perlu tindakan`);
    badge.title = `${value} slip menunggu tanda tangan penerima`;
  }

  function setAdminCount(count) {
    const value = Math.max(0, Number(count) || 0);
    const target = document.getElementById('ops-slip-count');
    if (target) target.textContent = String(value);
    document.querySelectorAll('[data-pending-signature-count]').forEach((node) => {
      node.textContent = String(value);
    });
  }

  async function refresh() {
    const authToken = token();
    if (!authToken || inFlight) return;
    inFlight = true;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: authToken }),
        cache: 'no-store',
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success === false) throw new Error(result.error || `HTTP ${response.status}`);
      const role = String(result.role || '').toUpperCase();
      if (role === 'USER') setBadge(result.ownCount ?? result.count ?? 0);
      else setAdminCount(result.count ?? 0);
    } catch (error) {
      console.warn('Hitungan TTD penerima gagal diperbarui', error);
    } finally {
      inFlight = false;
    }
  }

  function start() {
    refresh();
    if (timer) clearInterval(timer);
    timer = setInterval(refresh, 30000);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
  window.addEventListener('focus', refresh);
  window.addEventListener('absen:app-ready', start, { once: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
