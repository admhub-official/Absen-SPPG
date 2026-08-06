(() => {
  if (window.SuperAdminSettingsHub) return;

  const STORAGE_KEY = 'absen:super-admin-settings-tab';
  const VALID_TABS = new Set(['overview', 'admin', 'attendance', 'import', 'system']);
  const state = {
    activeTab: VALID_TABS.has(sessionStorage.getItem(STORAGE_KEY))
      ? sessionStorage.getItem(STORAGE_KEY)
      : 'overview',
    scheduled: false,
    healthRequest: 0,
  };

  const config = window.ABSEN_SUPABASE_CONFIG || {};
  const projectUrl = String(config.projectUrl || '').replace(/\/$/, '');

  function currentUser() {
    try { return JSON.parse(localStorage.getItem('auth_user') || 'null'); }
    catch { return null; }
  }

  function role() {
    return String(currentUser()?.role || currentUser()?.Role || '')
      .trim()
      .toUpperCase()
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ');
  }

  function isSuperAdmin() {
    return Boolean(localStorage.getItem('auth_token')) && role() === 'SUPER ADMIN';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function normalizedText(node) {
    return String(node?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function setButtonLabel(button, label) {
    if (!button) return;
    const spans = button.querySelectorAll(':scope > span');
    if (spans.length) {
      spans[spans.length - 1].textContent = label;
      return;
    }
    const textNodes = [...button.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE);
    const target = textNodes.findLast?.((node) => String(node.nodeValue || '').trim()) || textNodes[textNodes.length - 1];
    if (target) target.nodeValue = ` ${label}`;
    else button.append(document.createTextNode(label));
  }

  function renameAndConsolidateMenus() {
    const desktop = document.querySelector('.app-nav [data-view="admin-config"]');
    const mobile = document.querySelector('#mobile-more-menu [data-view="admin-config"]');
    setButtonLabel(desktop, 'Pusat Pengaturan');
    setButtonLabel(mobile, 'Pusat Pengaturan');
    desktop?.setAttribute('aria-label', 'Buka Pusat Pengaturan SUPER ADMIN');
    mobile?.setAttribute('aria-label', 'Buka Pusat Pengaturan SUPER ADMIN');

    document.querySelectorAll('[data-config-center-menu],[data-attendance-import-menu]').forEach((node) => {
      node.dataset.settingsHubManaged = 'true';
      node.setAttribute('aria-hidden', 'true');
      node.tabIndex = -1;
    });
  }

  function backendStatusCard(key, title, description) {
    return `<article class="sa-settings-health-card" data-health-card="${key}">
      <div>
        <span class="sa-settings-health-dot is-loading" data-health-dot="${key}" aria-hidden="true"></span>
        <strong>${escapeHtml(title)}</strong>
      </div>
      <p>${escapeHtml(description)}</p>
      <span class="sa-settings-health-label" data-health-label="${key}">Memeriksa backend...</span>
    </article>`;
  }

  function overviewMarkup() {
    return `<section id="sa-settings-overview" class="sa-settings-section sa-settings-overview" data-sa-settings-section="overview">
      <div class="sa-settings-hero">
        <div>
          <span class="sa-settings-eyebrow">PUSAT KONTROL SUPER ADMIN</span>
          <h2>Pengaturan terklasifikasi berdasarkan fungsi</h2>
          <p>Gunakan tab utama untuk berpindah area. Tab tingkat kedua hanya dipakai untuk pengaturan yang setara, sedangkan proses berurutan tetap memakai alur langkah.</p>
        </div>
        <button class="btn btn-secondary btn-sm" type="button" data-sa-refresh-health>Muat Status Backend</button>
      </div>
      <div class="sa-settings-module-grid">
        <button type="button" class="sa-settings-module" data-sa-open-tab="admin">
          <span class="sa-settings-module-icon" aria-hidden="true">A</span>
          <strong>Admin & Akses</strong>
          <small>Role akun, cakupan SPPG, dan akses operasional.</small>
        </button>
        <button type="button" class="sa-settings-module" data-sa-open-tab="attendance">
          <span class="sa-settings-module-icon" aria-hidden="true">W</span>
          <strong>Absensi</strong>
          <small>Scan wajah, lokasi, geofence, dan kebijakan presensi.</small>
        </button>
        <button type="button" class="sa-settings-module" data-sa-open-tab="import">
          <span class="sa-settings-module-icon" aria-hidden="true">U</span>
          <strong>Data Absensi</strong>
          <small>Upload file, validasi, pemetaan akun, dan duplikat.</small>
        </button>
        <button type="button" class="sa-settings-module" data-sa-open-tab="system">
          <span class="sa-settings-module-icon" aria-hidden="true">S</span>
          <strong>Sistem</strong>
          <small>Menu, payroll, notifikasi, keamanan, dan sesi.</small>
        </button>
      </div>
      <div class="sa-settings-health-grid" aria-label="Status koneksi backend pengaturan">
        ${backendStatusCard('admin', 'Konfigurasi Admin', 'Endpoint getAdminConfiguration dan data akses SPPG.')}
        ${backendStatusCard('attendance', 'Konfigurasi Absensi', 'Edge Function ConfigCenter dan kebijakan scan wajah.')}
        ${backendStatusCard('import', 'Upload Data Absensi', 'Edge Function AttendanceImport dan izin role.')}
      </div>
    </section>`;
  }

  function adminIntroMarkup() {
    return `<section id="sa-settings-admin-intro" class="sa-settings-section sa-settings-intro-card" data-sa-settings-section="admin">
      <div>
        <span class="sa-settings-eyebrow">ADMIN & AKSES</span>
        <h2>Kelola siapa dapat mengakses SPPG</h2>
        <p>Urutan yang disarankan: tentukan role akun, berikan cakupan SPPG, lalu periksa mapping aktif. Seluruh formulir dan tabel lama tetap digunakan agar kontrak backend tidak berubah.</p>
      </div>
      <div class="sa-settings-quick-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-sa-scroll-card="berikan cakupan sppg">Cakupan SPPG</button>
        <button type="button" class="btn btn-secondary btn-sm" data-sa-scroll-card="pengaturan role akun">Role Akun</button>
        <button type="button" class="btn btn-secondary btn-sm" data-sa-system-tab="menu">Visibilitas Menu</button>
      </div>
    </section>`;
  }

  function attendanceMarkup() {
    return `<section id="sa-settings-attendance" class="sa-settings-section" data-sa-settings-section="attendance">
      <div class="sa-settings-intro-card">
        <div>
          <span class="sa-settings-eyebrow">ABSENSI & VALIDASI</span>
          <h2>Aturan presensi dalam satu area</h2>
          <p>Scan wajah menentukan ketersediaan fitur, sedangkan lokasi dan geofence menentukan tempat absensi yang valid. Keduanya tetap tersimpan pada backend masing-masing.</p>
        </div>
      </div>
      <div class="sa-settings-operation-grid">
        <article class="sa-settings-operation-card">
          <span class="sa-settings-operation-number">01</span>
          <h3>Scan Wajah</h3>
          <p>Aktifkan atau nonaktifkan berdasarkan SPPG dan pengecualian karyawan.</p>
          <button type="button" class="btn btn-primary" data-sa-open-face>Buka Scan Wajah</button>
        </article>
        <article class="sa-settings-operation-card">
          <span class="sa-settings-operation-number">02</span>
          <h3>Lokasi & Geofence</h3>
          <p>Atur titik koordinat, radius, status lokasi, dan titik cadangan.</p>
          <button type="button" class="btn btn-secondary" data-sa-open-geofence>Buka Geofence</button>
        </article>
        <article class="sa-settings-operation-card">
          <span class="sa-settings-operation-number">03</span>
          <h3>Kebijakan Absensi</h3>
          <p>Buka pengaturan operasional absensi yang sudah tersedia pada konfigurasi sistem.</p>
          <button type="button" class="btn btn-secondary" data-sa-system-tab="attendance">Buka Kebijakan</button>
        </article>
        <article class="sa-settings-operation-card">
          <span class="sa-settings-operation-number">04</span>
          <h3>Keamanan Perangkat</h3>
          <p>Kelola kebijakan sesi dan perangkat tepercaya tanpa mencampurnya dengan scan wajah.</p>
          <button type="button" class="btn btn-secondary" data-sa-system-tab="security">Buka Keamanan</button>
        </article>
      </div>
    </section>`;
  }

  function importMarkup() {
    return `<section id="sa-settings-import" class="sa-settings-section" data-sa-settings-section="import">
      <div class="sa-settings-intro-card">
        <div>
          <span class="sa-settings-eyebrow">DATA ABSENSI</span>
          <h2>Upload menggunakan alur langkah, bukan tab</h2>
          <p>Upload file, pemetaan nama, dan penyimpanan merupakan proses berurutan. Karena itu proses tetap berada dalam satu dialog agar pengguna tidak melewatkan validasi.</p>
        </div>
        <button type="button" class="btn btn-primary" data-sa-open-import>Mulai Upload Data</button>
      </div>
      <ol class="sa-settings-flow" aria-label="Alur upload data absensi">
        <li><span>1</span><div><strong>Pilih sumber</strong><small>Pilih SPPG, file Excel, dan kebijakan data yang sama.</small></div></li>
        <li><span>2</span><div><strong>Validasi & pemetaan</strong><small>Cocokkan nama mesin dengan satu atau beberapa akun.</small></div></li>
        <li><span>3</span><div><strong>Simpan ke Absensi</strong><small>Backend memvalidasi cakupan SPPG dan mencegah duplikasi.</small></div></li>
      </ol>
      <div class="sa-settings-note">
        <strong>Pemisahan tanggung jawab</strong>
        <p>Izin upload tetap dikendalikan oleh <code>Attendance_Import_Role_Config</code>. Pusat Pengaturan hanya menjadi pintu masuk dan tidak melewati validasi backend.</p>
      </div>
    </section>`;
  }

  function systemIntroMarkup() {
    return `<section id="sa-settings-system-intro" class="sa-settings-section sa-settings-intro-card" data-sa-settings-section="system">
      <div>
        <span class="sa-settings-eyebrow">SISTEM & KEBIJAKAN</span>
        <h2>Tab tingkat kedua untuk kategori yang setara</h2>
        <p>Visibilitas menu, payroll, notifikasi, dan keamanan tetap menggunakan tab yang sudah ada. Kontrol ini tidak dicampur dengan proses upload atau konfigurasi scan wajah.</p>
      </div>
    </section>`;
  }

  function ensureStructure(view) {
    const toolbar = view.querySelector(':scope > .feature-toolbar');
    if (!toolbar) return false;

    toolbar.querySelector('.page-title')?.replaceChildren(document.createTextNode('Pusat Pengaturan'));
    toolbar.querySelector('.page-subtitle')?.replaceChildren(document.createTextNode('Konfigurasi SUPER ADMIN yang dikelompokkan berdasarkan fungsi dan alur kerja'));

    let tabs = view.querySelector(':scope > #sa-settings-tabs');
    if (!tabs) {
      tabs = document.createElement('div');
      tabs.id = 'sa-settings-tabs';
      tabs.className = 'sa-settings-tabs';
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', 'Kategori Pusat Pengaturan');
      tabs.innerHTML = `
        <button type="button" role="tab" data-sa-settings-tab="overview">Ringkasan</button>
        <button type="button" role="tab" data-sa-settings-tab="admin">Admin & Akses</button>
        <button type="button" role="tab" data-sa-settings-tab="attendance">Absensi</button>
        <button type="button" role="tab" data-sa-settings-tab="import">Data Absensi</button>
        <button type="button" role="tab" data-sa-settings-tab="system">Sistem</button>`;
      toolbar.insertAdjacentElement('afterend', tabs);
      tabs.querySelectorAll('[data-sa-settings-tab]').forEach((button) => {
        button.addEventListener('click', () => setActiveTab(button.dataset.saSettingsTab));
      });
    }

    const fragments = [
      ['sa-settings-overview', overviewMarkup()],
      ['sa-settings-admin-intro', adminIntroMarkup()],
      ['sa-settings-attendance', attendanceMarkup()],
      ['sa-settings-import', importMarkup()],
      ['sa-settings-system-intro', systemIntroMarkup()],
    ];
    let anchor = tabs;
    fragments.forEach(([id, markup]) => {
      let node = view.querySelector(`:scope > #${id}`);
      if (!node) {
        anchor.insertAdjacentHTML('afterend', markup);
        node = anchor.nextElementSibling;
      }
      anchor = node;
    });

    bindHubActions(view);
    return true;
  }

  function classifyNode(node) {
    if (!(node instanceof HTMLElement)) return '';
    if (node.matches('.feature-toolbar,#sa-settings-tabs')) return '';
    if (node.dataset.saSettingsSection) return node.dataset.saSettingsSection;
    if (node.classList.contains('config-overview')) return 'overview';
    if (node.id === 'sppg-location-config-root') return 'attendance';

    const text = normalizedText(node);
    if (!text) return '';
    if (/berikan cakupan sppg|cakupan akses saat ini|pengaturan role akun/.test(text)) return 'admin';
    if (/kebijakan & konfigurasi aktif/.test(text)) return 'system';
    if (/kualitas data|anomali|kelengkapan profil|indikator kualitas/.test(text)) return 'overview';
    if (/lokasi & geofence sppg/.test(text)) return 'attendance';
    return 'admin';
  }

  function classifyExistingSections(view) {
    [...view.children].forEach((node) => {
      const category = classifyNode(node);
      if (category) node.dataset.saSettingsSection = category;
    });
  }

  function applyActiveTab(view) {
    view.querySelectorAll('[data-sa-settings-tab]').forEach((button) => {
      const active = button.dataset.saSettingsTab === state.activeTab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });

    [...view.children].forEach((node) => {
      const category = node.dataset?.saSettingsSection;
      if (!category) return;
      node.hidden = category !== state.activeTab;
    });
  }

  function setActiveTab(tab, options = {}) {
    if (!VALID_TABS.has(tab)) return;
    state.activeTab = tab;
    sessionStorage.setItem(STORAGE_KEY, tab);
    const view = document.getElementById('view-admin-config');
    if (!view) return;
    classifyExistingSections(view);
    applyActiveTab(view);
    if (tab === 'overview') refreshBackendHealth();
    if (tab === 'attendance') window.setTimeout(() => window.SppgLocationConfig?.load?.(), 80);
    if (options.scroll !== false) view.querySelector('#sa-settings-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function findCardByText(query) {
    const view = document.getElementById('view-admin-config');
    if (!view) return null;
    const needle = String(query || '').toLowerCase();
    return [...view.querySelectorAll('.feature-card,.admin-card')]
      .find((node) => normalizedText(node).includes(needle)) || null;
  }

  function openSystemTab(name) {
    setActiveTab('system');
    window.setTimeout(() => {
      const button = document.querySelector(`[data-setting-tab="${CSS.escape(name)}"]`);
      button?.click();
      button?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }, 80);
  }

  function openFaceConfiguration() {
    const trigger = document.querySelector('[data-config-center-menu]');
    if (trigger) {
      trigger.click();
      return;
    }
    window.showAlert?.('Modul konfigurasi scan wajah belum selesai dimuat. Coba kembali.', 'warning');
  }

  function openAttendanceImport() {
    if (typeof window.openAttendanceImport === 'function') {
      window.openAttendanceImport();
      return;
    }
    const trigger = document.querySelector('[data-attendance-import-menu]');
    if (trigger) trigger.click();
    else window.showAlert?.('Modul upload data absensi belum selesai dimuat. Coba kembali.', 'warning');
  }

  function openGeofence() {
    setActiveTab('attendance', { scroll: false });
    window.SppgLocationConfig?.load?.();
    window.setTimeout(() => {
      const root = document.getElementById('sppg-location-config-root');
      if (root) root.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else window.showAlert?.('Modul lokasi dan geofence sedang dimuat.', 'warning');
    }, 180);
  }

  function bindHubActions(view) {
    if (view.dataset.saSettingsBound === 'true') return;
    view.dataset.saSettingsBound = 'true';
    view.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-sa-open-tab]');
      if (tab) { setActiveTab(tab.dataset.saOpenTab); return; }
      if (event.target.closest('[data-sa-refresh-health]')) { refreshBackendHealth(); return; }
      if (event.target.closest('[data-sa-open-face]')) { openFaceConfiguration(); return; }
      if (event.target.closest('[data-sa-open-import]')) { openAttendanceImport(); return; }
      if (event.target.closest('[data-sa-open-geofence]')) { openGeofence(); return; }
      const system = event.target.closest('[data-sa-system-tab]');
      if (system) { openSystemTab(system.dataset.saSystemTab); return; }
      const scroll = event.target.closest('[data-sa-scroll-card]');
      if (scroll) {
        setActiveTab('admin', { scroll: false });
        window.setTimeout(() => findCardByText(scroll.dataset.saScrollCard)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
      }
    });
  }

  async function post(functionName, body) {
    if (!projectUrl) throw new Error('URL Supabase belum tersedia.');
    const response = await fetch(`${projectUrl}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.success === false) throw new Error(payload?.message || payload?.error || 'Backend tidak tersedia.');
    return payload?.result;
  }

  function setHealth(key, status, label) {
    document.querySelectorAll(`[data-health-dot="${key}"]`).forEach((node) => {
      node.className = `sa-settings-health-dot is-${status}`;
    });
    document.querySelectorAll(`[data-health-label="${key}"]`).forEach((node) => {
      node.textContent = label;
    });
  }

  async function refreshBackendHealth() {
    if (!isSuperAdmin()) return;
    const requestId = ++state.healthRequest;
    ['admin', 'attendance', 'import'].forEach((key) => setHealth(key, 'loading', 'Memeriksa backend...'));
    const token = localStorage.getItem('auth_token');

    const adminPromise = typeof window.apiCall === 'function'
      ? window.apiCall('getAdminConfiguration', { token })
      : Promise.reject(new Error('Gateway aplikasi belum siap.'));
    const attendancePromise = post('ConfigCenter', { action: 'adminConfig', token });
    const importPromise = post('AttendanceImport', { action: 'config', token });

    const [adminResult, attendanceResult, importResult] = await Promise.allSettled([
      adminPromise,
      attendancePromise,
      importPromise,
    ]);
    if (requestId !== state.healthRequest) return;

    if (adminResult.status === 'fulfilled') {
      const admins = adminResult.value?.adminAccounts?.length || 0;
      const mappings = (adminResult.value?.access || []).filter((row) => row.Aktif === true || String(row.Aktif).toLowerCase() === 'true').length;
      setHealth('admin', 'success', `Terhubung · ${admins} akun admin · ${mappings} akses aktif`);
    } else setHealth('admin', 'error', adminResult.reason?.message || 'Gagal terhubung');

    if (attendanceResult.status === 'fulfilled') {
      const policies = attendanceResult.value?.policies?.length || 0;
      const sppg = attendanceResult.value?.sppg?.length || 0;
      setHealth('attendance', 'success', `Terhubung · ${policies} kebijakan · ${sppg} SPPG`);
    } else setHealth('attendance', 'error', attendanceResult.reason?.message || 'Gagal terhubung');

    if (importResult.status === 'fulfilled') {
      const allowed = Boolean(importResult.value?.roleConfig?.Menu_Enabled && importResult.value?.roleConfig?.Can_Upload);
      const scopes = importResult.value?.scopes?.length || 0;
      setHealth('import', allowed ? 'success' : 'warning', `${allowed ? 'Diizinkan' : 'Izin upload nonaktif'} · ${scopes} cakupan SPPG`);
    } else setHealth('import', 'error', importResult.reason?.message || 'Gagal terhubung');
  }

  function enhance() {
    const superAdmin = isSuperAdmin();
    document.documentElement.classList.toggle('sa-settings-hub-active', superAdmin);
    if (!superAdmin) return;

    renameAndConsolidateMenus();
    const view = document.getElementById('view-admin-config');
    if (!view || !ensureStructure(view)) return;
    classifyExistingSections(view);
    applyActiveTab(view);
  }

  function schedule() {
    if (state.scheduled) return;
    state.scheduled = true;
    window.requestAnimationFrame(() => {
      state.scheduled = false;
      enhance();
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('absen:app-ready', schedule);
  window.addEventListener('absen:session-changed', schedule);
  window.addEventListener('storage', (event) => {
    if (event.key === 'auth_token' || event.key === 'auth_user') schedule();
  });
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-view="admin-config"]')) window.setTimeout(() => {
      enhance();
      if (state.activeTab === 'overview') refreshBackendHealth();
    }, 100);
  }, true);

  window.SuperAdminSettingsHub = Object.freeze({
    openTab: setActiveTab,
    refresh: () => { enhance(); refreshBackendHealth(); },
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
  else schedule();
})();
