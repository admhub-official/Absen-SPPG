(() => {
  if (window.AbsenSidebarCollapse) return;

  const STORAGE_KEY = 'absen_sidebar_collapsed';
  const DESKTOP = window.matchMedia('(min-width: 901px)');

  function app() { return document.getElementById('app-layout'); }
  function sidebar() { return app()?.querySelector('.app-sidebar') || null; }
  function topbar() { return app()?.querySelector('.app-topbar') || null; }

  function labelNavigation() {
    const node = sidebar();
    if (!node) return;
    node.querySelectorAll('.app-nav-item,.sidebar-absen-btn').forEach((item) => {
      const label = String(item.textContent || '').replace(/\s+/g, ' ').trim();
      if (label) {
        item.setAttribute('aria-label', item.getAttribute('aria-label') || label);
        item.setAttribute('title', item.getAttribute('title') || label);
      }
    });
  }

  function apply(collapsed) {
    const layout = app();
    if (!layout) return;
    layout.classList.toggle('sidebar-is-collapsed', Boolean(collapsed) && DESKTOP.matches);
    const button = layout.querySelector('.sidebar-toggle-button');
    button?.setAttribute('aria-expanded', String(!layout.classList.contains('sidebar-is-collapsed')));
  }

  function toggle() {
    if (!DESKTOP.matches) return;
    const collapsed = !app()?.classList.contains('sidebar-is-collapsed');
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    apply(collapsed);
  }

  function ensureButton() {
    const layout = app();
    const bar = topbar();
    if (!layout || !bar) return;

    if (!DESKTOP.matches) {
      layout.classList.remove('sidebar-is-collapsed');
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
      button.addEventListener('click', toggle);
      bar.prepend(button);
    }
    apply(localStorage.getItem(STORAGE_KEY) === '1');
  }

  function schedule() {
    [0, 80, 240, 600].forEach((delay) => window.setTimeout(ensureButton, delay));
  }

  const observer = new MutationObserver(() => window.requestAnimationFrame(ensureButton));
  function init() {
    schedule();
    observer.observe(document.getElementById('app-layout') || document.body, { childList: true, subtree: true });
    DESKTOP.addEventListener?.('change', ensureButton);
    window.addEventListener('absen:app-ready', schedule);
    window.addEventListener('absen:session-changed', schedule);
    window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
  }

  window.AbsenSidebarCollapse = Object.freeze({ init, toggle, refresh: ensureButton });
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init, { once: true }) : init();
})();
