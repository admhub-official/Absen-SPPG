(() => {
  if (window.AbsenOperationalNotifications) return;

  const endpoint = `${window.ABSEN_SUPABASE_CONFIG.projectUrl}/functions/v1/ConfigCenter`;
  const state = { items: [], unread: 0, loading: false };

  const token = () => localStorage.getItem('auth_token');
  const appActive = () => document.getElementById('app-layout')?.classList.contains('active');
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

  async function call(action, payload = {}) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token: token(), ...payload })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) throw new Error(body.message || 'Gagal memuat notifikasi.');
    return body.result;
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  function kindOf(item) {
    if (String(item.ID_Notification || '').startsWith('op:slip:')) return 'slip';
    if (String(item.ID_Notification || '').startsWith('op:pengaduan:')) return 'pengaduan';
    return 'umum';
  }

  function iconFor(kind) {
    if (kind === 'slip') return '✍️';
    if (kind === 'pengaduan') return '💬';
    return '🔔';
  }

  function ensureUi() {
    if (!token() || !appActive()) {
      document.getElementById('operational-notification-root')?.remove();
      return null;
    }
    let root = document.getElementById('operational-notification-root');
    if (root) return root;
    const topbar = document.querySelector('.app-topbar');
    if (!topbar) return null;

    root = document.createElement('div');
    root.id = 'operational-notification-root';
    root.className = 'operational-notification-root';
    root.innerHTML = `
      <button type="button" class="operational-notification-button" aria-label="Buka notifikasi" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>
        <span class="operational-notification-badge" hidden>0</span>
      </button>
      <section class="operational-notification-panel" aria-label="Daftar notifikasi">
        <header class="operational-notification-header">
          <h3>Notifikasi</h3>
          <button type="button" class="operational-notification-mark-all">Tandai semua dibaca</button>
        </header>
        <div class="operational-notification-list"></div>
      </section>`;

    const profile = topbar.querySelector('.app-topbar-profile');
    if (profile) topbar.insertBefore(root, profile);
    else topbar.appendChild(root);

    const button = root.querySelector('.operational-notification-button');
    const panel = root.querySelector('.operational-notification-panel');
    button.addEventListener('click', () => {
      const active = panel.classList.toggle('active');
      button.setAttribute('aria-expanded', String(active));
      if (active) load();
    });
    root.querySelector('.operational-notification-mark-all').addEventListener('click', markAllRead);
    return root;
  }

  function render() {
    const root = ensureUi();
    if (!root) return;
    const badge = root.querySelector('.operational-notification-badge');
    badge.textContent = state.unread > 99 ? '99+' : String(state.unread);
    badge.hidden = state.unread < 1;

    const list = root.querySelector('.operational-notification-list');
    if (state.loading) {
      list.innerHTML = '<div class="operational-notification-empty">Memuat notifikasi…</div>';
      return;
    }
    if (!state.items.length) {
      list.innerHTML = '<div class="operational-notification-empty">Tidak ada notifikasi baru.</div>';
      return;
    }
    list.innerHTML = state.items.map((item) => {
      const kind = kindOf(item);
      return `<button type="button" class="operational-notification-item ${item.Read ? '' : 'unread'}" data-id="${escapeHtml(item.ID_Notification)}" data-kind="${kind}">
        <span class="operational-notification-item-icon">${iconFor(kind)}</span>
        <span class="operational-notification-copy"><strong>${escapeHtml(item.Title)}</strong><p>${escapeHtml(item.Message)}</p></span>
        <span><span class="operational-notification-time">${escapeHtml(formatTime(item.Created_At))}</span><span class="operational-notification-dot"></span></span>
      </button>`;
    }).join('');
    list.querySelectorAll('.operational-notification-item').forEach((button) => {
      button.addEventListener('click', () => openItem(button.dataset.id));
    });
  }

  async function load() {
    if (!token() || state.loading) return;
    state.loading = true;
    render();
    try {
      const result = await call('getNotifications');
      state.items = result.items || [];
      state.unread = Number(result.unread || 0);
    } catch (error) {
      console.warn('Notifikasi gagal dimuat', error);
      state.items = [];
      state.unread = 0;
    } finally {
      state.loading = false;
      render();
    }
  }

  async function markRead(item) {
    if (!item || item.Read) return;
    item.Read = true;
    state.unread = Math.max(0, state.unread - 1);
    render();
    try { await call('markRead', { id: item.ID_Notification }); }
    catch (error) { console.warn('Status baca notifikasi gagal disimpan', error); }
  }

  async function markAllRead() {
    const unread = state.items.filter((item) => !item.Read);
    await Promise.all(unread.map((item) => markRead(item)));
  }

  function clickView(view) {
    const selectors = [
      `[data-view="${view}"]`,
      `[data-route="${view}"]`,
      `[data-target-view="${view}"]`,
      `#nav-${view}`,
      `#btn-${view}`
    ];
    for (const selector of selectors) {
      const target = document.querySelector(selector);
      if (target instanceof HTMLElement) {
        target.click();
        return true;
      }
    }
    return false;
  }

  function navigate(item) {
    const view = String(item.Action_View || 'dashboard');
    const aliases = view === 'payroll-saya'
      ? ['payroll-saya', 'payroll', 'slip-gaji']
      : view === 'pengaduan'
        ? ['pengaduan', 'aduan']
        : [view];

    let handled = false;
    for (const alias of aliases) {
      if (typeof window.showView === 'function') {
        try { window.showView(alias); handled = true; break; } catch {}
      }
      if (clickView(alias)) { handled = true; break; }
    }
    if (!handled) window.location.hash = `#/${aliases[0]}`;

    window.setTimeout(() => {
      const id = CSS.escape(String(item.Entity_ID || ''));
      const entity = document.querySelector(`[data-id="${id}"],[data-slip-id="${id}"],[data-pengaduan-id="${id}"],#${id}`);
      entity?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      entity?.classList.add('notification-target-highlight');
      window.setTimeout(() => entity?.classList.remove('notification-target-highlight'), 2200);
    }, 500);
  }

  async function openItem(id) {
    const item = state.items.find((entry) => String(entry.ID_Notification) === String(id));
    if (!item) return;
    await markRead(item);
    document.querySelector('.operational-notification-panel')?.classList.remove('active');
    document.querySelector('.operational-notification-button')?.setAttribute('aria-expanded', 'false');
    navigate(item);
  }

  function sync() {
    ensureUi();
    if (token() && appActive()) load();
  }

  document.addEventListener('click', (event) => {
    const root = document.getElementById('operational-notification-root');
    if (root && !root.contains(event.target)) {
      root.querySelector('.operational-notification-panel')?.classList.remove('active');
      root.querySelector('.operational-notification-button')?.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  window.addEventListener('absen:app-ready', sync);
  window.addEventListener('absen:session-changed', sync);
  window.setInterval(() => { if (!document.hidden) load(); }, 60000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync, { once: true });
  else sync();

  window.AbsenOperationalNotifications = Object.freeze({ load, sync });
})();