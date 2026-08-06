(() => {
  if (window.AbsenDashboardPriority) return;

  const STORAGE_KEY = 'absen_sidebar_collapsed';
  const DESKTOP = window.matchMedia('(min-width: 901px)');

  function layout() { return document.getElementById('app-layout'); }
  function sidebar() { return layout()?.querySelector('.app-sidebar') || null; }
  function topbar() { return layout()?.querySelector('.app-topbar') || null; }

  function labelNavigation() {
    const node = sidebar();
    if (!node) return;
    node.querySelectorAll('.app-nav-item,.sidebar-absen-btn').forEach((item) => {
      const label = String(item.textContent || '').replace(/\s+/g, ' ').trim();
      if (!label) return;
      if (!item.getAttribute('aria-label')) item.setAttribute('aria-label', label);
      if (!item.getAttribute('title')) item.setAttribute('title', label);
    });
  }

  function apply(collapsed) {
    const app = layout();
    if (!app) return;
    app.classList.toggle('sidebar-is-collapsed', Boolean(collapsed) && DESKTOP.matches);
    app.querySelector('.sidebar-toggle-button')?.setAttribute('aria-expanded', String(!app.classList.contains('sidebar-is-collapsed')));
  }

  function toggleSidebar() {
    if (!DESKTOP.matches) return;
    const collapsed = !layout()?.classList.contains('sidebar-is-collapsed');
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    apply(collapsed);
  }

  function refresh() {
    const app = layout();
    const bar = topbar();
    if (!app || !bar) return;

    if (!DESKTOP.matches) {
      app.classList.remove('sidebar-is-collapsed');
      bar.querySelector('.sidebar-toggle-button')?.remove();
      return;
    }

    labelNavigation();
    let button = bar.querySelector('.sidebar-toggle-button');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'sidebar-toggle-button';
      button.setAttribute('aria-label', 'Ciutkan atau tampilkan sidebar');
      button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
      button.addEventListener('click', toggleSidebar);
      bar.prepend(button);
    }
    apply(localStorage.getItem(STORAGE_KEY) === '1');
  }

  function schedule() {
    [0, 80, 240, 600].forEach((delay) => window.setTimeout(refresh, delay));
  }

  function init() {
    schedule();
    const observer = new MutationObserver(() => window.requestAnimationFrame(refresh));
    observer.observe(layout() || document.body, { childList: true, subtree: true });
    DESKTOP.addEventListener?.('change', refresh);
    window.addEventListener('absen:app-ready', schedule);
    window.addEventListener('absen:session-changed', schedule);
    window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
  }

  window.AbsenDashboardPriority = Object.freeze({ init, refresh, toggleSidebar });
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init, { once: true }) : init();
})();
