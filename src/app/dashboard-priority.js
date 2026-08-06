(() => {
  if (window.AbsenDashboardPriority) return;

  const KPI_LABELS = ['hari kerja lengkap', 'total gaji diterima', 'slip gaji diterbitkan'];
  const COLLAPSE_KEY = 'absen_sidebar_collapsed';
  const DESKTOP_QUERY = '(min-width: 901px)';

  function ensureLayoutStyles() {
    if (document.getElementById('dashboard-fluid-overrides')) return;
    const style = document.createElement('style');
    style.id = 'dashboard-fluid-overrides';
    style.textContent = `
      #app-layout.active .dashboard-fluid-root{width:100%!important;max-width:none!important;display:block!important;min-width:0!important}
      #app-layout.active .dashboard-fluid-root>*{width:100%!important;max-width:none!important;min-width:0!important}
      #app-layout.active .dashboard-fluid-root>:first-child:not(#dashboard-kpi-priority){max-width:900px!important}
      #app-layout.active .dashboard-fluid-root #dashboard-kpi-priority{width:100%!important;max-width:none!important}
      #app-layout.active .dashboard-fluid-root #dashboard-kpi-priority~*{width:100%!important;max-width:none!important}
      #app-layout.active .dashboard-fluid-root section,#app-layout.active .dashboard-fluid-root article{max-width:none!important}
      @media(min-width:901px){
        #app-layout.active .app-main>.app-content,#app-layout.active .app-main>.main-content,#app-layout.active .app-main main{width:100%!important;max-width:1380px!important;margin-inline:auto!important}
      }
      @media(max-width:900px){
        #app-layout.active .app-sidebar,.sidebar-toggle-button,.sidebar-mobile-backdrop{display:none!important}
        #app-layout.active .app-main{width:100%!important;max-width:none!important;margin:0!important}
        #app-layout.active .app-topbar{padding-inline:1rem!important}
        #app-layout.active .dashboard-fluid-root>:first-child:not(#dashboard-kpi-priority){max-width:none!important}
        #app-layout.active .dashboard-fluid-root{padding-bottom:5.5rem!important}
      }
    `;
    document.head.appendChild(style);
  }

  function text(node) {
    return String(node?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function visible(node) {
    if (!(node instanceof HTMLElement)) return false;
    const style = getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
  }

  function labelCount(node) {
    const content = text(node);
    return KPI_LABELS.filter((label) => content.includes(label)).length;
  }

  function findLabel(label) {
    return [...document.querySelectorAll('#app-layout.active *')].filter(visible).find((node) => text(node) === label) || null;
  }

  function findCard(labelNode) {
    if (!labelNode) return null;
    const known = labelNode.closest('.dashboard-kpi-card,.kpi-card,.stat-card,.metric-card,.summary-card,.dashboard-stat,.dashboard-card,.card');
    if (known && labelCount(known) === 1) return known;
    let current = labelNode.parentElement;
    let candidate = current;
    while (current && current.id !== 'app-layout') {
      if (labelCount(current) > 1) break;
      candidate = current;
      const parent = current.parentElement;
      if (!parent || labelCount(parent) > 1) break;
      current = parent;
    }
    return candidate;
  }

  function activeDashboard(cards) {
    const first = cards[0];
    if (!first) return null;
    return first.closest('.app-view:not(.hidden),[data-view]:not(.hidden),main,.main-content,.app-content') ||
      document.querySelector('#app-layout.active .main-content,#app-layout.active .app-content');
  }

  function insertionPoint(root) {
    const heading = [...root.querySelectorAll('h1,h2')].find((node) => /dashboard|ringkasan|beranda/i.test(text(node)));
    const header = heading?.closest('header,.page-header,.dashboard-header,.section-header') || heading?.parentElement;
    if (header && header.parentElement === root) return { mode: 'after', node: header };
    const attendance = [...root.querySelectorAll('section,article,div')].filter(visible).find((node) => {
      const value = text(node);
      return value.includes('datang') && value.includes('pulang') && labelCount(node) === 0;
    });
    if (attendance?.parentElement === root) return { mode: 'before', node: attendance };
    return { mode: 'prepend', node: root };
  }

  function markIcon(card) {
    card.querySelectorAll(':scope > .dashboard-kpi-priority-icon').forEach((node) => node.classList.remove('dashboard-kpi-priority-icon'));
    const icon = [...card.children].find((child) => {
      if (!(child instanceof HTMLElement)) return false;
      return Boolean(child.querySelector('svg,img') || child.matches('.kpi-icon,.stat-icon,.metric-icon,.dashboard-kpi-icon')) && text(child).length <= 3;
    });
    icon?.classList.add('dashboard-kpi-priority-icon');
  }

  function moveKpisUp() {
    ensureLayoutStyles();
    const cards = KPI_LABELS.map((label) => findCard(findLabel(label))).filter(Boolean);
    const uniqueCards = [...new Set(cards)];
    if (uniqueCards.length < 2) return false;
    const root = activeDashboard(uniqueCards);
    if (!root || !visible(root)) return false;
    root.classList.add('dashboard-fluid-root');
    let container = root.querySelector(':scope > #dashboard-kpi-priority');
    if (!container) {
      container = document.createElement('section');
      container.id = 'dashboard-kpi-priority';
      container.className = 'dashboard-kpi-priority';
      container.setAttribute('aria-label', 'Ringkasan kehadiran dan gaji');
      const point = insertionPoint(root);
      if (point.mode === 'after') point.node.insertAdjacentElement('afterend', container);
      else if (point.mode === 'before') point.node.insertAdjacentElement('beforebegin', container);
      else root.prepend(container);
    }
    uniqueCards.forEach((card) => {
      card.classList.add('dashboard-kpi-priority-card');
      markIcon(card);
      container.appendChild(card);
    });
    return true;
  }

  function labelNavigationItems(sidebar) {
    sidebar.querySelectorAll('.app-nav-item,.sidebar-absen-btn').forEach((item) => {
      const label = String(item.textContent || '').replace(/\s+/g, ' ').trim();
      if (label && !item.getAttribute('aria-label')) item.setAttribute('aria-label', label);
      if (label && !item.getAttribute('title')) item.setAttribute('title', label);
    });
  }

  function removeMobileSidebarUi() {
    document.querySelectorAll('.sidebar-toggle-button,.sidebar-mobile-backdrop').forEach((node) => node.remove());
    const sidebar = document.querySelector('#app-layout .app-sidebar');
    sidebar?.classList.remove('sidebar-mobile-open', 'sidebar-collapsed');
  }

  function toggleSidebar() {
    if (!matchMedia(DESKTOP_QUERY).matches) return;
    const sidebar = document.querySelector('#app-layout .app-sidebar');
    if (!sidebar) return;
    const collapsed = sidebar.classList.toggle('sidebar-collapsed');
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    document.querySelector('.sidebar-toggle-button')?.setAttribute('aria-expanded', String(!collapsed));
    window.dispatchEvent(new Event('resize'));
  }

  function ensureSidebarToggle() {
    ensureLayoutStyles();
    if (!matchMedia(DESKTOP_QUERY).matches) {
      removeMobileSidebarUi();
      return false;
    }
    const app = document.getElementById('app-layout');
    const sidebar = app?.querySelector('.app-sidebar');
    const topbar = app?.querySelector('.app-topbar');
    if (!sidebar || !topbar) return false;
    labelNavigationItems(sidebar);
    if (localStorage.getItem(COLLAPSE_KEY) === '1') sidebar.classList.add('sidebar-collapsed');
    let button = topbar.querySelector('.sidebar-toggle-button');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'sidebar-toggle-button';
      button.setAttribute('aria-label', 'Ciutkan atau tampilkan sidebar');
      button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
      button.addEventListener('click', toggleSidebar);
      topbar.prepend(button);
    }
    button.setAttribute('aria-expanded', String(!sidebar.classList.contains('sidebar-collapsed')));
    return true;
  }

  function schedule() {
    ensureLayoutStyles();
    [0, 80, 250, 600, 1200].forEach((delay) => window.setTimeout(() => {
      moveKpisUp();
      ensureSidebarToggle();
    }, delay));
  }

  function init() {
    ensureLayoutStyles();
    schedule();
    const app = document.getElementById('app-layout') || document.body;
    const observer = new MutationObserver(() => window.requestAnimationFrame(() => {
      moveKpisUp();
      ensureSidebarToggle();
    }));
    observer.observe(app, { childList: true, subtree: true });
    window.addEventListener('hashchange', schedule);
    window.addEventListener('resize', ensureSidebarToggle);
    window.addEventListener('absen:app-ready', schedule);
    window.addEventListener('absen:session-changed', schedule);
    window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
  }

  window.AbsenDashboardPriority = Object.freeze({ init, refresh: moveKpisUp, toggleSidebar });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();