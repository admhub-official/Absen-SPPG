(() => {
  if (window.AbsenDashboardPriority) return;

  const KPI_LABELS = ['hari kerja lengkap', 'total gaji diterima', 'slip gaji diterbitkan'];

  function text(node) {
    return String(node?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function visible(node) {
    if (!(node instanceof HTMLElement)) return false;
    const style = getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function findDashboardRoot() {
    const candidates = [...document.querySelectorAll('.app-view,[data-view],main,.main-content')]
      .filter(visible)
      .filter((node) => /dashboard/i.test(node.id || '') || /dashboard/i.test(node.dataset?.view || '') || node.querySelector('h1,h2')?.textContent?.toLowerCase().includes('dashboard'));
    return candidates[0] || document.querySelector('.main-content');
  }

  function closestCard(node) {
    return node.closest('.dashboard-kpi-card,.kpi-card,.stat-card,.metric-card,.dashboard-card,.card') || node.parentElement;
  }

  function commonParent(cards) {
    if (!cards.length) return null;
    let parent = cards[0].parentElement;
    while (parent && !cards.every((card) => parent.contains(card))) parent = parent.parentElement;
    return parent;
  }

  function moveKpisUp() {
    const root = findDashboardRoot();
    if (!root) return;

    const cards = KPI_LABELS.map((label) => {
      const labelNode = [...root.querySelectorAll('*')].find((node) => text(node) === label);
      return labelNode ? closestCard(labelNode) : null;
    }).filter(Boolean);
    if (cards.length < 2) return;

    const container = commonParent(cards);
    if (!container || container === root || container.dataset.dashboardPriority === 'done') return;

    const heading = [...root.querySelectorAll('h1,h2')].find((node) => /dashboard/i.test(text(node)));
    const headerBlock = heading?.closest('header,.page-header,.dashboard-header') || heading?.parentElement;
    if (!headerBlock || !headerBlock.parentElement) return;

    headerBlock.insertAdjacentElement('afterend', container);
    container.dataset.dashboardPriority = 'done';
    container.classList.add('dashboard-kpi-priority');
  }

  function init() {
    moveKpisUp();
    const app = document.getElementById('app-layout') || document.querySelector('.app-main');
    if (!app) return;
    const observer = new MutationObserver(() => window.requestAnimationFrame(moveKpisUp));
    observer.observe(app, { childList: true, subtree: true });
    window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
    window.addEventListener('hashchange', () => window.setTimeout(moveKpisUp, 50));
  }

  window.AbsenDashboardPriority = Object.freeze({ init, refresh: moveKpisUp });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();