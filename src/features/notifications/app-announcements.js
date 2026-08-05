(() => {
  const projectUrl = String(window.APP_CONFIG?.projectUrl || window.ABSEN_SUPABASE_CONFIG?.projectUrl || 'https://szwwpnbbsmjsbzzcecyj.supabase.co').replace(/\/$/, '');
  const endpoint = `${projectUrl}/functions/v1/ConfigCenter`;
  const state = { loading: false, timer: null, lastSoundId: '' };
  const token = () => window.AppState?.token || localStorage.getItem('auth_token') || '';
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));

  async function call(action, payload = {}) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token: token(), ...payload }),
      cache: 'no-store',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) throw new Error(body.message || 'Gagal membaca pengumuman.');
    return body.result;
  }

  function dashboardHost() {
    return ['view-user-dashboard', 'view-admin-dashboard', 'view-super-dashboard']
      .map((id) => document.getElementById(id))
      .find((node) => node && !node.classList.contains('hidden') && !node.hidden)
      || document.querySelector('.app-content, .page-content, main');
  }

  function ensureHost() {
    let host = document.getElementById('app-announcement-banner-host');
    const parent = dashboardHost();
    if (!parent) return null;
    if (!host) {
      host = document.createElement('section');
      host.id = 'app-announcement-banner-host';
      host.className = 'app-announcement-banner-host';
    }
    if (host.parentElement !== parent) parent.prepend(host);
    return host;
  }

  function playSound(item) {
    if (!item.Play_Sound || state.lastSoundId === item.ID_Notification) return;
    state.lastSoundId = item.ID_Notification;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 760;
      gain.gain.setValueAtTime(0.06, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.22);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.22);
    } catch {}
  }

  async function markRead(id) {
    if (!id) return;
    await call('markRead', { id });
    document.querySelector(`[data-announcement-id="${CSS.escape(String(id))}"]`)?.remove();
    window.loadUserNotifications?.();
  }

  function navigate(view) {
    if (!view || view === 'dashboard') return;
    const trigger = document.querySelector(`[data-view="${CSS.escape(view)}"]`);
    if (trigger instanceof HTMLElement) trigger.click();
  }

  function render(items) {
    const host = ensureHost();
    if (!host) return;
    const banners = (items || []).filter((item) => item.Show_Banner && !item.Read).slice(0, 3);
    host.innerHTML = banners.map((item) => `
      <article class="app-announcement-banner priority-${esc(String(item.Priority || 'NORMAL').toLowerCase())}" data-announcement-id="${esc(item.ID_Notification)}">
        <div class="app-announcement-icon" aria-hidden="true">!</div>
        <div class="app-announcement-content">
          <strong>${esc(item.Title)}</strong>
          <p>${esc(item.Message)}</p>
        </div>
        <div class="app-announcement-actions">
          ${item.Action_View && item.Action_View !== 'dashboard' ? `<button type="button" data-announcement-open="${esc(item.Action_View)}">Buka</button>` : ''}
          <button type="button" data-announcement-close aria-label="Tandai sudah dibaca">×</button>
        </div>
      </article>`).join('');
    banners.forEach(playSound);
  }

  async function refresh() {
    if (!token() || state.loading || document.visibilityState === 'hidden') return;
    state.loading = true;
    try {
      const result = await call('getNotifications');
      render(result?.items || []);
    } catch (error) {
      console.warn('Pengumuman aplikasi gagal dimuat', error);
    } finally {
      state.loading = false;
    }
  }

  document.addEventListener('click', async (event) => {
    const banner = event.target.closest?.('[data-announcement-id]');
    if (!banner) return;
    const id = banner.dataset.announcementId;
    const open = event.target.closest?.('[data-announcement-open]');
    const close = event.target.closest?.('[data-announcement-close]');
    if (!open && !close) return;
    try {
      await markRead(id);
      if (open) navigate(open.dataset.announcementOpen);
    } catch (error) {
      console.warn('Gagal menandai pengumuman dibaca', error);
    }
  }, true);

  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  window.addEventListener('absen:app-ready', refresh, { once: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh, { once: true }); else refresh();
  state.timer = window.setInterval(refresh, 60000);
  window.addEventListener('beforeunload', () => clearInterval(state.timer), { once: true });
})();
