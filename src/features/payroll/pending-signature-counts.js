(() => {
  const projectUrl = window.APP_CONFIG?.projectUrl || window.ABSEN_SUPABASE_CONFIG?.projectUrl || 'https://szwwpnbbsmjsbzzcecyj.supabase.co';
  const endpoint = `${String(projectUrl).replace(/\/$/, '')}/functions/v1/PendingSignatureCounts`;
  const refreshIntervalMs = 30000;
  let timer = null;
  let inFlight = false;
  let started = false;
  let lastExactCount = 0;

  function token() {
    try {
      if (window.AppState?.token) return window.AppState.token;
    } catch {}
    return localStorage.getItem('auth_token') || '';
  }

  function setBadge(count) {
    const badge = document.getElementById('notification-count');
    if (!badge) return;
    const value = Math.max(0, Number(count) || 0);
    lastExactCount = value;
    badge.textContent = value > 99 ? '99+' : String(value);
    badge.style.display = value ? 'inline-flex' : 'none';
    badge.dataset.exactPayrollCount = String(value);
    badge.setAttribute('aria-label', `${value} slip menunggu tanda tangan penerima`);
    badge.title = `${value} slip menunggu tanda tangan penerima`;
  }

  function protectBadge() {
    const badge = document.getElementById('notification-count');
    if (!badge || !badge.dataset.exactPayrollCount) return;
    const value = Math.max(lastExactCount, Number(badge.dataset.exactPayrollCount) || 0);
    const expected = value > 99 ? '99+' : String(value);
    if (badge.textContent !== expected) badge.textContent = expected;
    if (value) badge.style.display = 'inline-flex';
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
    if (!authToken || inFlight || document.visibilityState === 'hidden') return;
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
    if (started) return;
    started = true;
    refresh();
    timer = window.setInterval(() => {
      refresh();
      protectBadge();
    }, refreshIntervalMs);
  }

  function stop() {
    if (timer) window.clearInterval(timer);
    timer = null;
    started = false;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
  window.addEventListener('focus', refresh);
  window.addEventListener('beforeunload', stop, { once: true });
  window.addEventListener('absen:app-ready', start, { once: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
