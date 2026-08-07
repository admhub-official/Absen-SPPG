(() => {
  if (window.__ABSEN_EMPLOYMENT_CONTRACT_NAVIGATION__) return;
  window.__ABSEN_EMPLOYMENT_CONTRACT_NAVIGATION__ = true;

  const state = {
    signature: '',
    observer: null,
    bound: false,
    retryTimers: [],
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

  function openEmploymentView(view) {
    const api = window.AbsenEmploymentContracts;
    if (!api) return;
    if (view === 'employment-my') api.openMy?.();
    else if (view === 'employment-admin' && isAdmin()) api.openAdmin?.();
    else if (view === 'employment-master' && isAdmin()) api.openMaster?.();
    document.querySelector('#topbar-dropdown')?.classList.remove('active');
    document.querySelector('#mobile-more-menu')?.classList.remove('active');
    document.querySelector('#btn-topbar-profile')?.setAttribute('aria-expanded', 'false');
    document.querySelector('#btn-mobile-more')?.setAttribute('aria-expanded', 'false');
  }

  function makeAdminSidebarGroup() {
    const group = document.createElement('div');
    group.id = 'employment-contract-nav-group';
    group.className = 'employment-contract-admin-nav';
    group.dataset.contractNavOwner = 'session-sync-v2';
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
    group.dataset.contractNavOwner = 'session-sync-v2';
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

  function makeSentinel(id) {
    const sentinel = document.createElement('div');
    sentinel.id = id;
    sentinel.dataset.contractNavOwner = 'session-sync-v2';
    sentinel.hidden = true;
    sentinel.style.display = 'none';
    return sentinel;
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

  function syncNavigation() {
    const sidebar = document.querySelector('.app-nav');
    const mobile = document.querySelector('#mobile-more-menu');
    const personal = document.querySelector('#topbar-dropdown');
    if (!sidebar || !personal) return false;

    const previousBadge = document.querySelector('#employment-pending-badge');
    const previousBadgeText = previousBadge?.textContent || '0';
    const previousBadgeVisible = previousBadge?.style.display !== 'none' && previousBadgeText !== '0';

    document.querySelector('#employment-contract-nav-group')?.remove();
    document.querySelector('#employment-contract-mobile-nav')?.remove();
    document.querySelector('#employment-contract-personal-nav')?.remove();

    const authenticated = Boolean(token());
    if (authenticated) {
      const personalButton = makePersonalMenuItem();
      const divider = personal.querySelector('.app-topbar-dropdown-divider');
      personal.insertBefore(personalButton, divider || personal.lastElementChild || null);
    }

    if (authenticated && isAdmin()) {
      const sidebarGroup = makeAdminSidebarGroup();
      const sidebarAnchor = sidebar.querySelector('[data-view="admin-config"]');
      sidebar.insertBefore(sidebarGroup, sidebarAnchor || null);

      const badge = sidebarGroup.querySelector('#employment-pending-badge');
      if (badge && previousBadgeVisible) {
        badge.textContent = previousBadgeText;
        badge.style.display = 'inline-flex';
      }

      if (mobile) {
        const mobileGroup = makeMobileAdminGroup();
        const mobileAnchor = mobile.querySelector('[data-view="admin-config"]');
        mobile.insertBefore(mobileGroup, mobileAnchor || null);
      }
    } else {
      sidebar.appendChild(makeSentinel('employment-contract-nav-group'));
      if (mobile) mobile.appendChild(makeSentinel('employment-contract-mobile-nav'));
      document.querySelector('#view-employment-admin')?.remove();
      document.querySelector('#view-employment-master')?.remove();
    }

    return true;
  }

  function retrySync() {
    state.retryTimers.forEach((timer) => clearTimeout(timer));
    state.retryTimers = [0, 80, 250, 700, 1500].map((delay) => setTimeout(syncNavigation, delay));
  }

  function checkSessionTransition() {
    const next = sessionSignature();
    if (next === state.signature) return;
    state.signature = next;
    window.AbsenEmploymentContracts?.refresh?.();
    retrySync();
  }

  function bindOnce() {
    if (state.bound) return;
    state.bound = true;
    document.addEventListener('click', (event) => {
      const button = event.target.closest?.('[data-employment-view]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      openEmploymentView(button.dataset.employmentView);
    }, true);
    window.addEventListener('storage', checkSessionTransition);
    window.addEventListener('absen:session-changed', checkSessionTransition);
    window.addEventListener('absen:app-ready', () => {
      checkSessionTransition();
      retrySync();
    });
  }

  function observeSessionUi() {
    state.observer?.disconnect();
    const appLayout = document.querySelector('#app-layout');
    const roleLabel = document.querySelector('#topbar-profile-role');
    if (!appLayout && !roleLabel) return;
    state.observer = new MutationObserver(() => {
      checkSessionTransition();
      retrySync();
    });
    if (appLayout) state.observer.observe(appLayout, { attributes: true, attributeFilter: ['class'] });
    if (roleLabel) state.observer.observe(roleLabel, { childList: true, characterData: true, subtree: true });
  }

  function init() {
    bindOnce();
    state.signature = sessionSignature();
    observeSessionUi();
    retrySync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  window.AbsenEmploymentContractNavigation = Object.freeze({
    sync: syncNavigation,
    checkSession: checkSessionTransition,
  });
})();
