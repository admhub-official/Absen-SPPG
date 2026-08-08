const GUARD_KEY = '__ABSEN_NAV_STATE_GUARD_V1__';

if (!globalThis[GUARD_KEY]) {
  globalThis[GUARD_KEY] = true;

  const initialAuthHash = window.location.hash.replace(/^#/, '');
  let preserveRegisterBootRoute = initialAuthHash === 'register';
  let bootSessionResult = null;
  let logoutInProgress = false;
  let scanGeneration = 0;
  let faceRegistrationGeneration = 0;

  function legacyBinding(name) {
    try { return (0, eval)(name); }
    catch { return null; }
  }

  function activeToken() {
    const state = legacyBinding('AppState');
    return String(state?.token || localStorage.getItem('auth_token') || '');
  }

  function clearTimer(value, interval = false) {
    if (!value) return;
    if (interval) clearInterval(value);
    else clearTimeout(value);
  }

  function clearAbsenRedirectTimer() {
    const state = legacyBinding('AppState');
    if (!state?.absenRedirectTimer) return;
    clearTimeout(state.absenRedirectTimer);
    state.absenRedirectTimer = null;
  }

  function roleCanOpenView(view) {
    if (view === 'super-dashboard' || view === 'admin-config') {
      return typeof globalThis.isSuperAdminUser === 'function' && globalThis.isSuperAdminUser();
    }
    if (String(view).startsWith('admin-')) {
      return typeof globalThis.isAdmin === 'function' && globalThis.isAdmin();
    }
    return true;
  }

  function normalizeDashboardView(view) {
    if (view !== 'dashboard' || typeof globalThis.isAdmin !== 'function' || !globalThis.isAdmin()) return view;
    return typeof globalThis.isSuperAdminUser === 'function' && globalThis.isSuperAdminUser()
      ? 'super-dashboard'
      : 'admin-dashboard';
  }

  function scrubSessionDom() {
    document.querySelectorAll('.app-view').forEach((node) => node.classList.add('hidden'));
    document.querySelectorAll('.modal-overlay.active').forEach((node) => node.classList.remove('active'));

    const textValues = {
      'dashboard-greeting': 'Selamat datang!',
      'admin-dashboard-greeting': 'Selamat datang!',
      'dash-total-hari-kerja': '0',
      'dash-total-gaji': 'Rp 0',
      'dash-total-slip': '0',
      'dash-admin-total-karyawan': '0',
      'dash-admin-datang-hari-ini': '0',
      'dash-admin-pulang-hari-ini': '0',
      'dash-admin-payroll-bulan-ini': '0',
      'super-total-sppg': '0',
      'super-attendance-rate': '0%',
      'super-payroll-total': 'Rp 0',
      'super-admin-count': '0',
      'config-admin-count': '0',
      'config-access-count': '0',
      'config-sppg-count': '0',
      'notification-count': '0'
    };
    Object.entries(textValues).forEach(([id, value]) => {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    });

    const notificationCount = document.getElementById('notification-count');
    if (notificationCount) notificationCount.style.display = 'none';

    const htmlValues = {
      'dashboard-notification-list': '<div class="belum-absen-empty">Memuat notifikasi...</div>',
      'notification-list': '<div class="belum-absen-empty">Belum ada notifikasi.</div>',
      'dash-riwayat-list': '<div class="belum-absen-empty">Memuat riwayat...</div>',
      'my-payroll-profile': '',
      'my-activity-list': '<div class="loading-state"><span class="spinner"></span>Memuat aktivitas...</div>',
      'my-complaint-list': '<div class="loading-state"><span class="spinner"></span>Memuat riwayat...</div>',
      'admin-complaint-list': '<div class="loading-state"><span class="spinner"></span>Memuat inbox...</div>',
      'users-grid-container': '',
      'log-list-container': '',
      'super-sppg-body': '<tr><td colspan="7"><div class="table-empty">Memuat data...</div></td></tr>'
    };
    Object.entries(htmlValues).forEach(([id, value]) => {
      const node = document.getElementById(id);
      if (node) node.innerHTML = value;
    });

    const profileIds = [
      'profil-nama','profil-role','profil-idcard','p-id-user','p-id-card','p-nama','p-username','p-tempat-lahir',
      'p-tanggal-lahir','p-jk','p-email','p-wa','p-sppg','p-yayasan','p-jabatan','p-mulai-kerja','p-gaji','p-bank',
      'p-nomor-rekening','p-rekening','p-role','p-status-akun','p-status-wajah','p-id-card-digital','p-qr-code',
      'p-persetujuan-data','p-created-at','p-updated-at','topbar-profile-name','topbar-profile-role'
    ];
    profileIds.forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.textContent = '-';
    });
    ['profil-avatar','topbar-avatar'].forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.textContent = '-';
    });
  }

  function resetLegacyState({ preserveAuth = false } = {}) {
    const appState = legacyBinding('AppState');
    const adminState = legacyBinding('AdminState');
    const featureState = legacyBinding('FeatureState');
    const cropState = legacyBinding('CropState');

    try { globalThis.stopPresenceHeartbeat?.(); } catch {}
    try { globalThis.stopAbsenRealtime?.(); } catch {}
    try { globalThis.closeAbsenScan?.(); } catch {}
    try { globalThis.closeDaftarWajah?.(); } catch {}
    try { globalThis.closeRiskConfirmation?.(null); } catch {}
    try { globalThis.closeCropModal?.(); } catch {}

    if (appState) {
      ['resendTimerRegister','resendTimerReset','resendTimerProfilePassword'].forEach((key) => {
        clearTimer(appState[key], true);
        appState[key] = null;
      });
      clearTimer(appState.absenRedirectTimer);
      appState.absenRedirectTimer = null;
      appState.currentView = 'dashboard';
      appState.pendingRegisterEmail = '';
      appState.pendingResetEmail = '';
      appState.pendingResetToken = '';
      appState.profilePasswordEmail = '';
      appState.profilePasswordResetToken = '';
      appState.notifications = [];
      if (!preserveAuth) {
        appState.token = null;
        appState.user = null;
      }
    }

    if (adminState) {
      adminState.allAbsen = [];
      adminState.filteredAbsen = [];
      adminState.absenPage = 1;
      adminState.absenTotal = 0;
      adminState.attendanceValidationTab = 'ALL';
      adminState.attendanceSelected?.clear?.();
      adminState.allUsers = [];
      adminState.filteredUsers = [];
      adminState.userPage = 1;
      adminState.userTotal = 0;
      adminState.userFilterOptions = {};
      adminState.selectedUser = null;
      adminState.allLogs = [];
      adminState.filteredLogs = [];
      adminState.logPage = 1;
      adminState.realtimeChannel = null;
    }

    if (featureState) {
      featureState.adminComplaints = [];
      featureState.filteredAdminComplaints = [];
      featureState.adminConfiguration = null;
      featureState.myActivity = [];
      featureState.payrollEmployees = [];
      featureState.payrollSelected?.clear?.();
      featureState.payrollPreview = {};
      featureState.payrollHistory = [];
      featureState.payrollActiveTab = 'publish';
      featureState.payrollHistoryLoaded = false;
      featureState.payrollSignatureDrawn = { accountant: false, head: false };
      featureState.payrollSignatureReady?.clear?.();
      featureState.recipientSignatureDrawn = false;
      featureState.recipientSignatureReady = false;
      featureState.recipientSlipId = '';
      featureState.superOverview = null;
      featureState.systemSettingTab = 'access';
    }

    if (cropState) {
      cropState.img = null;
      cropState.dragging = false;
    }

    try { globalThis.clearApiResponseCache?.(); } catch {}
    scrubSessionDom();
  }

  function installApiSessionGuard() {
    if (globalThis.__ABSEN_API_SESSION_GUARD__) return;
    const baseApiCall = globalThis.apiCall;
    if (typeof baseApiCall !== 'function') return;
    globalThis.__ABSEN_API_SESSION_GUARD__ = true;

    globalThis.apiCall = async function sessionBoundApiCall(functionName, payload = {}, options = {}) {
      const requestToken = String(payload?.token || localStorage.getItem('auth_token') || '');
      const appState = legacyBinding('AppState');
      const viewAtStart = appState?.currentView || '';
      const sessionBound = Boolean(requestToken) && functionName !== 'logout';
      const result = await baseApiCall(functionName, payload, options);

      if (sessionBound) {
        const currentToken = String(localStorage.getItem('auth_token') || legacyBinding('AppState')?.token || '');
        if (currentToken !== requestToken) {
          window.setTimeout(() => {
            const state = legacyBinding('AppState');
            if (!state?.token || state.currentView !== viewAtStart || viewAtStart === 'absen-scan') return;
            const target = document.getElementById(`view-${viewAtStart}`);
            if (target && !target.classList.contains('hidden')) globalThis.switchView?.(viewAtStart);
          }, 0);
          const error = new Error('Respons diabaikan karena sesi pengguna sudah berubah.');
          error.name = 'AbortError';
          error.code = 'SESSION_CHANGED';
          throw error;
        }
      }
      return result;
    };
  }

  function installNavigationGuard() {
    const appState = legacyBinding('AppState');
    if (!appState || typeof globalThis.switchView !== 'function' || typeof globalThis.navigateTo !== 'function') return false;

    const baseSwitchView = globalThis.switchView;
    const baseShowAuth = globalThis.showAuth;
    const baseCheckSession = globalThis.checkSession;
    const baseOpenAbsenScan = globalThis.openAbsenScan;
    const baseCloseAbsenScan = globalThis.closeAbsenScan;
    const baseAbsenLoop = globalThis.absenScanDetectLoop;
    const baseOpenFaceRegistration = globalThis.openDaftarWajah;
    const baseCloseFaceRegistration = globalThis.closeDaftarWajah;
    const baseFaceLoop = globalThis.faceRegDetectLoop;

    if (typeof baseCheckSession === 'function') {
      globalThis.checkSession = async function guardedCheckSession(...args) {
        const result = await baseCheckSession.apply(this, args);
        bootSessionResult = result;
        return result;
      };
    }

    globalThis.navigateTo = function guardedNavigateTo(page, options = {}) {
      let route = String(page || '').trim();
      const state = legacyBinding('AppState');

      if (route === 'login' && preserveRegisterBootRoute && bootSessionResult === false && !state?.token) {
        route = 'register';
        preserveRegisterBootRoute = false;
        options = { ...options, history: false };
      }

      const target = document.getElementById(`page-${route}`);
      if (!target) {
        console.error('Auth page tidak ditemukan:', route);
        return false;
      }

      document.querySelectorAll('.auth-page').forEach((node) => node.classList.add('hidden'));
      target.classList.remove('hidden');

      if (options.history !== false) {
        const hash = `#${route}`;
        const replace = options.replace === true || window.location.hash === hash;
        history[replace ? 'replaceState' : 'pushState']({ p: route }, '', hash);
      }
      return true;
    };

    globalThis.switchView = function guardedSwitchView(requestedView) {
      const state = legacyBinding('AppState');
      if (!state?.token) return false;

      const view = normalizeDashboardView(String(requestedView || '').trim());
      const target = document.getElementById(`view-${view}`);
      if (!target) {
        console.error('View tidak ditemukan:', view);
        return false;
      }
      if (!roleCanOpenView(view)) {
        console.warn('Navigasi ditolak untuk role aktif:', view);
        return false;
      }

      if (view === 'absen-scan' && state.currentView === 'absen-scan' && !target.classList.contains('hidden')) return true;

      if (state.currentView === 'absen-scan' && view !== 'absen-scan') {
        clearAbsenRedirectTimer();
        try { globalThis.closeAbsenScan?.(); } catch {}
      }

      return baseSwitchView.call(this, view);
    };

    if (typeof baseShowAuth === 'function') {
      globalThis.showAuth = function guardedShowAuth(...args) {
        clearAbsenRedirectTimer();
        try { globalThis.stopAbsenRealtime?.(); } catch {}
        try { globalThis.closeAbsenScan?.(); } catch {}
        try { globalThis.closeDaftarWajah?.(); } catch {}
        return baseShowAuth.apply(this, args);
      };
    }

    if (typeof baseCloseAbsenScan === 'function') {
      globalThis.closeAbsenScan = function guardedCloseAbsenScan(...args) {
        scanGeneration += 1;
        clearAbsenRedirectTimer();
        return baseCloseAbsenScan.apply(this, args);
      };
    }

    if (typeof baseOpenAbsenScan === 'function') {
      globalThis.openAbsenScan = async function guardedOpenAbsenScan(...args) {
        const state = legacyBinding('AppState');
        if (!state?.token || state.currentView !== 'absen-scan') return;
        const generation = ++scanGeneration;
        await baseOpenAbsenScan.apply(this, args);
        const current = legacyBinding('AppState');
        if (generation !== scanGeneration || !current?.token || current.currentView !== 'absen-scan') {
          try { baseCloseAbsenScan.call(this); } catch {}
        }
      };
    }

    if (typeof baseAbsenLoop === 'function') {
      globalThis.absenScanDetectLoop = async function guardedAbsenScanDetectLoop(...args) {
        const state = legacyBinding('AppState');
        const scanState = legacyBinding('AbsenScanState');
        if (!state?.token || state.currentView !== 'absen-scan' || !scanState?.stream) return;
        return baseAbsenLoop.apply(this, args);
      };
    }

    if (typeof baseCloseFaceRegistration === 'function') {
      globalThis.closeDaftarWajah = function guardedCloseFaceRegistration(...args) {
        faceRegistrationGeneration += 1;
        return baseCloseFaceRegistration.apply(this, args);
      };
    }

    if (typeof baseOpenFaceRegistration === 'function') {
      globalThis.openDaftarWajah = async function guardedOpenFaceRegistration(...args) {
        const state = legacyBinding('AppState');
        if (!state?.token) return;
        const generation = ++faceRegistrationGeneration;
        await baseOpenFaceRegistration.apply(this, args);
        const current = legacyBinding('AppState');
        const modalActive = document.getElementById('modal-daftar-wajah')?.classList.contains('active');
        if (generation !== faceRegistrationGeneration || !current?.token || !modalActive) {
          try { baseCloseFaceRegistration.call(this); } catch {}
        }
      };
    }

    if (typeof baseFaceLoop === 'function') {
      globalThis.faceRegDetectLoop = async function guardedFaceRegistrationLoop(...args) {
        const state = legacyBinding('AppState');
        const faceState = legacyBinding('FaceRegState');
        const modalActive = document.getElementById('modal-daftar-wajah')?.classList.contains('active');
        if (!state?.token || !modalActive || !faceState?.stream) return;
        return baseFaceLoop.apply(this, args);
      };
    }

    globalThis.handleAbsenScanComplete = async function guardedAbsenScanComplete(descriptor) {
      const state = legacyBinding('AppState');
      const scanState = legacyBinding('AbsenScanState');
      if (!state?.token || state.currentView !== 'absen-scan') return;
      const sessionToken = state.token;

      const status = document.getElementById('absen-facecam-status');
      if (status) status.textContent = 'Memverifikasi...';
      const overlay = document.getElementById('absen-result-overlay');
      const icon = document.getElementById('absen-result-icon');
      const title = document.getElementById('absen-result-title');
      const detail = document.getElementById('absen-result-detail');

      try {
        const idUser = state.user?.idUser || state.user?.ID_User;
        const result = await globalThis.apiCall('recordAbsensiSelf', {
          token: sessionToken,
          idUser,
          faceDescriptorScan: Array.from(descriptor),
          lat: scanState?.coords ? scanState.coords.lat : null,
          lng: scanState?.coords ? scanState.coords.lng : null
        });
        const current = legacyBinding('AppState');
        if (!current?.token || current.token !== sessionToken || current.currentView !== 'absen-scan') return;

        if (result?.success) {
          overlay?.classList.add('show', 'success');
          overlay?.classList.remove('error');
          if (icon) icon.textContent = '✓';
          if (title) title.textContent = `Absen ${result.message} Berhasil`;
          if (detail) detail.textContent = `${result.nama || ''} • ${result.waktu || ''}`;
        } else {
          overlay?.classList.add('show', 'error');
          overlay?.classList.remove('success');
          if (icon) icon.textContent = '✕';
          if (title) title.textContent = 'Absen Gagal';
          if (detail) detail.textContent = result?.message || 'Silakan coba lagi';
        }
      } catch (error) {
        const current = legacyBinding('AppState');
        if (!current?.token || current.token !== sessionToken || current.currentView !== 'absen-scan') return;
        overlay?.classList.add('show', 'error');
        overlay?.classList.remove('success');
        if (icon) icon.textContent = '✕';
        if (title) title.textContent = 'Absen Gagal';
        if (detail) detail.textContent = error?.message || 'Terjadi kesalahan';
      }

      const current = legacyBinding('AppState');
      if (!current?.token || current.token !== sessionToken || current.currentView !== 'absen-scan') return;
      clearAbsenRedirectTimer();
      current.absenRedirectTimer = window.setTimeout(() => {
        const latest = legacyBinding('AppState');
        if (!latest?.token || latest.token !== sessionToken || latest.currentView !== 'absen-scan') return;
        globalThis.closeAbsenScan?.();
        const destination = typeof globalThis.isSuperAdminUser === 'function' && globalThis.isSuperAdminUser()
          ? 'super-dashboard'
          : typeof globalThis.isAdmin === 'function' && globalThis.isAdmin()
            ? 'admin-dashboard'
            : 'dashboard';
        globalThis.switchView?.(destination);
      }, 5000);
    };

    const syncAuthRoute = () => {
      const state = legacyBinding('AppState');
      if (state?.token) return;
      const route = window.location.hash.replace(/^#/, '') || 'login';
      if (document.getElementById(`page-${route}`)) globalThis.navigateTo(route, { history: false });
      else globalThis.navigateTo('login', { replace: true });
    };
    window.addEventListener('popstate', syncAuthRoute);
    window.addEventListener('hashchange', syncAuthRoute);

    return true;
  }

  async function guardedLogout() {
    if (logoutInProgress) return;
    logoutInProgress = true;
    const appState = legacyBinding('AppState');
    const token = String(appState?.token || localStorage.getItem('auth_token') || '');

    try {
      try { globalThis.stopAbsenRealtime?.(); } catch {}
      try { globalThis.closeAbsenScan?.(); } catch {}
      try { globalThis.closeDaftarWajah?.(); } catch {}
      clearAbsenRedirectTimer();

      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      sessionStorage.clear();
      resetLegacyState();
      window.dispatchEvent(new CustomEvent('absen:session-changed', { detail: { authenticated: false } }));
      globalThis.showAuth?.();
      globalThis.navigateTo?.('login', { replace: true });

      if (token) {
        try { await globalThis.apiCall?.('logout', { token }); }
        catch (error) { console.warn('Server session revoke failed during logout.', error); }
      }
    } finally {
      logoutInProgress = false;
    }
  }

  function installLogoutInterceptor() {
    if (globalThis.__ABSEN_LOGOUT_INTERCEPTOR__) return;
    globalThis.__ABSEN_LOGOUT_INTERCEPTOR__ = true;
    globalThis.handleLogout = guardedLogout;
    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest('#btn-logout') : null;
      if (!target) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void guardedLogout();
    }, true);
  }

  function install(attempt = 0) {
    installApiSessionGuard();
    const navigationReady = installNavigationGuard();
    installLogoutInterceptor();
    if (!navigationReady && attempt < 40) window.setTimeout(() => install(attempt + 1), 25);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => install(), { once: true });
  } else {
    install();
  }
}
