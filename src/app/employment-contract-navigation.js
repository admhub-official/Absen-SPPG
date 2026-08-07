(() => {
  if (window.__ABSEN_EMPLOYMENT_CONTRACT_NAVIGATION__) return;
  window.__ABSEN_EMPLOYMENT_CONTRACT_NAVIGATION__ = true;

  const state = {
    signature: '',
    bound: false,
  };

  const token = () => localStorage.getItem('auth_token') || '';
  const currentUser = () => {
    try { return JSON.parse(localStorage.getItem('auth_user') || 'null') || {}; }
    catch { return {}; }
  };
  const normalizedRole = () => String(currentUser()?.role || currentUser()?.Role || '')
    .trim().toUpperCase().replace(/_/g, ' ');
  const isAdmin = () => ['ADMIN', 'SUPER ADMIN'].includes(normalizedRole());
  const userId = () => String(currentUser()?.idUser || currentUser()?.ID_User || '');
  const sessionSignature = () => `${token() ? 'AUTH' : 'GUEST'}:${userId()}:${normalizedRole()}`;
  const notify = (message, type = 'error') => {
    if (typeof window.showAlert === 'function') window.showAlert(message, type);
    else console[type === 'error' ? 'error' : 'log'](message);
  };

  const viewMethod = Object.freeze({
    'employment-my': 'openMy',
    'employment-admin': 'openAdmin',
    'employment-master': 'openMaster',
  });

  function closeMenus() {
    document.querySelector('#topbar-dropdown')?.classList.remove('active');
    document.querySelector('#mobile-more-menu')?.classList.remove('active');
    document.querySelector('#btn-topbar-profile')?.setAttribute('aria-expanded', 'false');
    document.querySelector('#btn-mobile-more')?.setAttribute('aria-expanded', 'false');
  }

  function forceViewVisible(view) {
    const target = document.querySelector(`#view-${view}`);
    if (!target) return false;
    document.querySelectorAll('.app-view').forEach((node) => {
      node.classList.toggle('hidden', node !== target);
    });
    document.querySelectorAll('[data-employment-view]').forEach((button) => {
      const active = button.dataset.employmentView === view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    return true;
  }

  async function waitForController() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (window.AbsenEmploymentContracts) return window.AbsenEmploymentContracts;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    return null;
  }

  async function openEmploymentView(view) {
    if (!viewMethod[view]) return false;
    if ((view === 'employment-admin' || view === 'employment-master') && !isAdmin()) {
      notify('Menu ini hanya dapat diakses oleh ADMIN/SUPER ADMIN.', 'warning');
      return false;
    }

    const api = await waitForController();
    const method = viewMethod[view];
    if (!api || typeof api[method] !== 'function') {
      notify('Modul Perjanjian Kerja belum siap. Muat ulang aplikasi lalu coba kembali.');
      return false;
    }

    try {
      api[method]();
      forceViewVisible(view);
      requestAnimationFrame(() => forceViewVisible(view));
      closeMenus();
      if (!document.querySelector(`#view-${view}`)) {
        notify('Halaman Perjanjian Kerja gagal dipasang. Silakan muat ulang aplikasi.');
        return false;
      }
      return true;
    } catch (error) {
      console.error('Employment contract navigation failed', error);
      notify(error?.message || 'Halaman Perjanjian Kerja gagal dibuka.');
      return false;
    }
  }

  function makeAdminSidebarGroup() {
    const group = document.createElement('div');
    group.id = 'employment-contract-nav-group';
    group.className = 'employment-contract-admin-nav';
    group.dataset.contractNavOwner = 'session-sync-v4';
    group.innerHTML = `
      <button class="app-nav-item admin-only-nav" data-employment-view="employment-admin" type="button">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/><path d="M9 13h8M9 17h8"/></svg>
        <span>Perjanjian Kerja</span>
        <span class="employment-contract-nav-badge" id="employment-pending-badge" style="display:none">0</span>
      </button>
      <button class="app-nav-item admin-only-nav" data-employment-view="employment-master" type="button">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/></svg>
        <span>Master</span>
      </button>`;
    return group;
  }

  function makeMobileAdminGroup() {
    const group = document.createElement('div');
    group.id = 'employment-contract-mobile-nav';
    group.className = 'employment-contract-mobile-admin-nav';
    group.dataset.contractNavOwner = 'session-sync-v4';
    group.innerHTML = `
      <button class="mobile-more-menu-item" data-employment-view="employment-admin" type="button">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/></svg>
        Perjanjian Kerja
      </button>
      <button class="mobile-more-menu-item" data-employment-view="employment-master" type="button">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/></svg>
        Master
      </button>`;
    return group;
  }

  function makePersonalMenuItem() {
    const button = document.createElement('button');
    button.id = 'employment-contract-personal-nav';
    button.className = 'app-topbar-dropdown-item';
    button.type = 'button';
    button.dataset.employmentView = 'employment-my';
    button.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/><path d="M9 13h8M9 17h8"/></svg>
      Perjanjian Kerja Saya`;
    return button;
  }

  function ensurePersonalNavigation(personal, authenticated) {
    const current = document.querySelector('#employment-contract-personal-nav');
    if (!authenticated) {
      current?.remove();
      return;
    }
    if (current && personal.contains(current)) return;
    current?.remove();
    const button = makePersonalMenuItem();
    const divider = personal.querySelector('.app-topbar-dropdown-divider');
    personal.insertBefore(button, divider || personal.lastElementChild || null);
  }

  function ensureAdminNavigation(sidebar, mobile, authorized) {
    let sidebarGroup = document.querySelector('#employment-contract-nav-group');
    let mobileGroup = document.querySelector('#employment-contract-mobile-nav');

    if (!authorized) {
      sidebarGroup?.remove();
      mobileGroup?.remove();
      document.querySelector('#view-employment-admin')?.remove();
      document.querySelector('#view-employment-master')?.remove();
      return;
    }

    if (!sidebarGroup || !sidebar.contains(sidebarGroup)) {
      sidebarGroup?.remove();
      sidebarGroup = makeAdminSidebarGroup();
      const sidebarAnchor = sidebar.querySelector('[data-view="admin-config"]');
      sidebar.insertBefore(sidebarGroup, sidebarAnchor || null);
    }

    if (mobile && (!mobileGroup || !mobile.contains(mobileGroup))) {
      mobileGroup?.remove();
      mobileGroup = makeMobileAdminGroup();
      const mobileAnchor = mobile.querySelector('[data-view="admin-config"]');
      mobile.insertBefore(mobileGroup, mobileAnchor || null);
    }
  }

  function syncNavigation() {
    const sidebar = document.querySelector('.app-nav');
    const mobile = document.querySelector('#mobile-more-menu');
    const personal = document.querySelector('#topbar-dropdown');
    if (!sidebar || !personal) return false;

    const authenticated = Boolean(token());
    ensurePersonalNavigation(personal, authenticated);
    ensureAdminNavigation(sidebar, mobile, authenticated && isAdmin());
    return true;
  }

  function checkSessionTransition() {
    const next = sessionSignature();
    const changed = next !== state.signature;
    state.signature = next;
    if (changed) window.AbsenEmploymentContracts?.refresh?.();
    syncNavigation();
  }

  function bindOnce() {
    if (state.bound) return;
    state.bound = true;
    document.addEventListener('click', (event) => {
      const button = event.target.closest?.('[data-employment-view]');
      if (!button) return;
      event.preventDefault();
      void openEmploymentView(button.dataset.employmentView);
    }, true);
    window.addEventListener('storage', checkSessionTransition);
    window.addEventListener('absen:session-changed', checkSessionTransition);
    window.addEventListener('absen:app-ready', checkSessionTransition);
  }

  function init() {
    bindOnce();
    state.signature = sessionSignature();
    syncNavigation();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  window.AbsenEmploymentContractNavigation = Object.freeze({
    sync: syncNavigation,
    checkSession: checkSessionTransition,
    open: openEmploymentView,
    forceViewVisible,
  });
})();
