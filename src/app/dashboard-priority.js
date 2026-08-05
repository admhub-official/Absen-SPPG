(() => {
  if (window.AbsenDashboardPriority) return;

  const KPI_LABELS = ['hari kerja lengkap', 'total gaji diterima', 'slip gaji diterbitkan'];

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
    return [...document.querySelectorAll('#app-layout.active *')]
      .filter(visible)
      .find((node) => text(node) === label) || null;
  }

  function findCard(labelNode) {
    if (!labelNode) return null;
    const known = labelNode.closest(
      '.dashboard-kpi-card,.kpi-card,.stat-card,.metric-card,.summary-card,.dashboard-stat,.dashboard-card,.card'
    );
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

    const attendance = [...root.querySelectorAll('section,article,div')]
      .filter(visible)
      .find((node) => {
        const value = text(node);
        return value.includes('datang') && value.includes('pulang') && labelCount(node) === 0;
      });
    if (attendance?.parentElement === root) return { mode: 'before', node: attendance };
    return { mode: 'prepend', node: root };
  }

  function moveKpisUp() {
    const cards = KPI_LABELS.map((label) => findCard(findLabel(label))).filter(Boolean);
    const uniqueCards = [...new Set(cards)];
    if (uniqueCards.length < 2) return false;

    const root = activeDashboard(uniqueCards);
    if (!root || !visible(root)) return false;

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

    uniqueCards.forEach((card) => container.appendChild(card));
    return true;
  }

  function schedule() {
    [0, 80, 250, 600, 1200].forEach((delay) => window.setTimeout(moveKpisUp, delay));
  }

  function init() {
    schedule();
    const app = document.getElementById('app-layout') || document.body;
    const observer = new MutationObserver(() => window.requestAnimationFrame(moveKpisUp));
    observer.observe(app, { childList: true, subtree: true });
    window.addEventListener('hashchange', schedule);
    window.addEventListener('absen:app-ready', schedule);
    window.addEventListener('absen:session-changed', schedule);
    window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
  }

  window.AbsenDashboardPriority = Object.freeze({ init, refresh: moveKpisUp });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();