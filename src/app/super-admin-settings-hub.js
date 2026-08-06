(() => {
  if (window.SuperAdminSettingsHub) return;

  const STORAGE_KEY = 'absen:super-admin-settings-tab';
  const TABS = new Set(['overview', 'admin', 'attendance', 'import', 'system']);
  const state = {
    active: TABS.has(sessionStorage.getItem(STORAGE_KEY)) ? sessionStorage.getItem(STORAGE_KEY) : 'overview',
    scheduled: false,
    healthRequest: 0,
  };
  const projectUrl = String(window.ABSEN_SUPABASE_CONFIG?.projectUrl || '').replace(/\/$/, '');

  function user() {
    try { return JSON.parse(localStorage.getItem('auth_user') || 'null'); }
    catch { return null; }
  }

  function role() {
    return String(user()?.role || user()?.Role || '')
      .trim().toUpperCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
  }

  function isSuperAdmin() {
    return Boolean(localStorage.getItem('auth_token')) && role() === 'SUPER ADMIN';
  }

  function text(node) {
    return String(node?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function setText(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
  }

  function setMenuLabel(button, value) {
    if (!button) return;
    const spans = button.querySelectorAll(':scope > span');
    if (spans.length) {
      setText(spans[spans.length - 1], value);
      return;
    }
    const current = text(button);
    if (current === value.toLowerCase()) return;
    const textNodes = [...button.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE);
    const target = textNodes.reverse().find((node) => String(node.nodeValue || '').trim());
    if (target) target.nodeValue = ` ${value}`;
    else button.append(document.createTextNode(value));
  }

  function consolidateMenus() {
    setMenuLabel(document.querySelector('.app-nav [data-view="admin-config"]'), 'Pusat Pengaturan');
    setMenuLabel(document.querySelector('#mobile-more-menu [data-view="admin-config"]'), 'Pusat Pengaturan');
    document.querySelectorAll('[data-config-center-menu],[data-attendance-import-menu]').forEach((node) => {
      node.dataset.settingsHubManaged = 'true';
      node.setAttribute('aria-hidden', 'true');
      node.tabIndex = -1;
    });
  }

  function healthCard(key, title, description) {
    return `<article class="sa-settings-health-card">
      <div><span class="sa-settings-health-dot is-loading" data-health-dot="${key}" aria-hidden="true"></span><strong>${title}</strong></div>
      <p>${description}</p><span class="sa-settings-health-label" data-health-label="${key}">Memeriksa backend...</span>
    </article>`;
  }

  const markup = {
    overview: `<section id="sa-settings-overview" class="sa-settings-section" data-sa-settings-section="overview">
      <div class="sa-settings-hero"><div><span class="sa-settings-eyebrow">PUSAT KONTROL SUPER ADMIN</span><h2>Pengaturan terklasifikasi berdasarkan fungsi</h2><p>Gunakan tab utama untuk area yang berbeda. Tab tingkat kedua hanya dipakai untuk kategori setara, sedangkan proses upload tetap memakai alur langkah.</p></div><button class="btn btn-secondary btn-sm" type="button" data-sa-refresh-health>Muat Status Backend</button></div>
      <div class="sa-settings-module-grid">
        <button type="button" class="sa-settings-module" data-sa-open-tab="admin"><span class="sa-settings-module-icon">A</span><strong>Admin & Akses</strong><small>Role akun, cakupan SPPG, dan akses operasional.</small></button>
        <button type="button" class="sa-settings-module" data-sa-open-tab="attendance"><span class="sa-settings-module-icon">W</span><strong>Absensi</strong><small>Scan wajah, lokasi, geofence, dan kebijakan presensi.</small></button>
        <button type="button" class="sa-settings-module" data-sa-open-tab="import"><span class="sa-settings-module-icon">U</span><strong>Data Absensi</strong><small>Upload file, validasi, pemetaan akun, dan duplikat.</small></button>
        <button type="button" class="sa-settings-module" data-sa-open-tab="system"><span class="sa-settings-module-icon">S</span><strong>Sistem</strong><small>Menu, payroll, notifikasi, keamanan, dan sesi.</small></button>
      </div>
      <div class="sa-settings-health-grid" aria-label="Status backend pengaturan">${healthCard('admin','Konfigurasi Admin','Gateway getAdminConfiguration dan mapping akses SPPG.')}${healthCard('attendance','Konfigurasi Absensi','Edge Function ConfigCenter dan kebijakan scan wajah.')}${healthCard('import','Upload Data Absensi','Edge Function AttendanceImport dan izin role.')}</div>
    </section>`,
    admin: `<section id="sa-settings-admin-intro" class="sa-settings-section sa-settings-intro-card" data-sa-settings-section="admin"><div><span class="sa-settings-eyebrow">ADMIN & AKSES</span><h2>Kelola siapa dapat mengakses SPPG</h2><p>Urutan yang disarankan: tentukan role akun, berikan cakupan SPPG, lalu periksa mapping aktif. Formulir lama tetap digunakan sehingga kontrak backend tidak berubah.</p></div><div class="sa-settings-quick-actions"><button type="button" class="btn btn-secondary btn-sm" data-sa-scroll-card="berikan cakupan sppg">Cakupan SPPG</button><button type="button" class="btn btn-secondary btn-sm" data-sa-scroll-card="pengaturan role akun">Role Akun</button><button type="button" class="btn btn-secondary btn-sm" data-sa-system-tab="menu">Visibilitas Menu</button></div></section>`,
    attendance: `<section id="sa-settings-attendance" class="sa-settings-section" data-sa-settings-section="attendance"><div class="sa-settings-intro-card"><div><span class="sa-settings-eyebrow">ABSENSI & VALIDASI</span><h2>Aturan presensi dalam satu area</h2><p>Scan wajah menentukan ketersediaan fitur. Lokasi dan geofence menentukan tempat absensi yang valid. Masing-masing tetap memakai backendnya sendiri.</p></div></div><div class="sa-settings-operation-grid">
      <article class="sa-settings-operation-card"><span class="sa-settings-operation-number">01</span><h3>Scan Wajah</h3><p>Aktifkan atau nonaktifkan berdasarkan SPPG dan pengecualian karyawan.</p><button type="button" class="btn btn-primary" data-sa-open-face>Buka Scan Wajah</button></article>
      <article class="sa-settings-operation-card"><span class="sa-settings-operation-number">02</span><h3>Lokasi & Geofence</h3><p>Atur koordinat, radius, status lokasi, dan titik cadangan SPPG.</p><button type="button" class="btn btn-secondary" data-sa-open-geofence>Buka Geofence</button></article>
      <article class="sa-settings-operation-card"><span class="sa-settings-operation-number">03</span><h3>Kebijakan Absensi</h3><p>Buka aturan operasional absensi yang sudah tersedia pada konfigurasi sistem.</p><button type="button" class="btn btn-secondary" data-sa-system-tab="attendance">Buka Kebijakan</button></article>
      <article class="sa-settings-operation-card"><span class="sa-settings-operation-number">04</span><h3>Keamanan Perangkat</h3><p>Kelola sesi dan perangkat tepercaya secara terpisah dari scan wajah.</p><button type="button" class="btn btn-secondary" data-sa-system-tab="security">Buka Keamanan</button></article>
    </div></section>`,
    import: `<section id="sa-settings-import" class="sa-settings-section" data-sa-settings-section="import"><div class="sa-settings-intro-card"><div><span class="sa-settings-eyebrow">DATA ABSENSI</span><h2>Upload menggunakan alur langkah, bukan tab</h2><p>Upload file, pemetaan nama, dan penyimpanan adalah proses berurutan agar validasi tidak terlewat.</p></div><button type="button" class="btn btn-primary" data-sa-open-import>Mulai Upload Data</button></div><ol class="sa-settings-flow"><li><span>1</span><div><strong>Pilih sumber</strong><small>Pilih SPPG, file Excel, dan kebijakan duplikat.</small></div></li><li><span>2</span><div><strong>Validasi & pemetaan</strong><small>Cocokkan nama mesin dengan satu atau beberapa akun.</small></div></li><li><span>3</span><div><strong>Simpan ke Absensi</strong><small>Backend memvalidasi cakupan dan mencegah duplikasi.</small></div></li></ol><div class="sa-settings-note"><strong>Pemisahan tanggung jawab</strong><p>Izin upload tetap dikendalikan oleh <code>Attendance_Import_Role_Config</code>. Pusat Pengaturan tidak melewati validasi backend.</p></div></section>`,
    system: `<section id="sa-settings-system-intro" class="sa-settings-section sa-settings-intro-card" data-sa-settings-section="system"><div><span class="sa-settings-eyebrow">SISTEM & KEBIJAKAN</span><h2>Tab tingkat kedua untuk kategori yang setara</h2><p>Visibilitas menu, payroll, notifikasi, dan keamanan tetap memakai tab sistem yang sudah ada dan tidak dicampur dengan upload atau scan wajah.</p></div></section>`,
  };

  function ensureStructure(view) {
    const toolbar = view.querySelector(':scope > .feature-toolbar');
    if (!toolbar) return false;
    view.classList.add('super-admin-settings-hub');
    setText(toolbar.querySelector('.page-title'), 'Pusat Pengaturan');
    setText(toolbar.querySelector('.page-subtitle'), 'Konfigurasi SUPER ADMIN yang dikelompokkan berdasarkan fungsi dan alur kerja');

    let tabs = view.querySelector(':scope > #sa-settings-tabs');
    if (!tabs) {
      tabs = document.createElement('div');
      tabs.id = 'sa-settings-tabs';
      tabs.className = 'sa-settings-tabs';
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', 'Kategori Pusat Pengaturan');
      tabs.innerHTML = '<button type="button" role="tab" data-sa-settings-tab="overview">Ringkasan</button><button type="button" role="tab" data-sa-settings-tab="admin">Admin & Akses</button><button type="button" role="tab" data-sa-settings-tab="attendance">Absensi</button><button type="button" role="tab" data-sa-settings-tab="import">Data Absensi</button><button type="button" role="tab" data-sa-settings-tab="system">Sistem</button>';
      toolbar.insertAdjacentElement('afterend', tabs);
      tabs.addEventListener('click', (event) => {
        const button = event.target.closest('[data-sa-settings-tab]');
        if (button) openTab(button.dataset.saSettingsTab);
      });
    }

    let anchor = tabs;
    for (const [key, html] of Object.entries(markup)) {
      const id = key === 'overview' ? 'sa-settings-overview' : key === 'admin' ? 'sa-settings-admin-intro' : key === 'attendance' ? 'sa-settings-attendance' : key === 'import' ? 'sa-settings-import' : 'sa-settings-system-intro';
      let node = view.querySelector(`:scope > #${id}`);
      if (!node) {
        anchor.insertAdjacentHTML('afterend', html);
        node = anchor.nextElementSibling;
      }
      anchor = node;
    }
    bindActions(view);
    return true;
  }

  function category(node) {
    if (!(node instanceof HTMLElement) || node.matches('.feature-toolbar,#sa-settings-tabs')) return '';
    if (node.dataset.saSettingsSection) return node.dataset.saSettingsSection;
    if (node.classList.contains('config-overview')) return 'overview';
    if (node.id === 'sppg-location-config-root') return 'attendance';
    const value = text(node);
    if (!value) return '';
    if (/berikan cakupan sppg|cakupan akses saat ini|pengaturan role akun/.test(value)) return 'admin';
    if (/kebijakan & konfigurasi aktif/.test(value)) return 'system';
    if (/kualitas data|anomali|kelengkapan profil|indikator kualitas/.test(value)) return 'overview';
    if (/lokasi & geofence sppg/.test(value)) return 'attendance';
    return 'admin';
  }

  function classify(view) {
    [...view.children].forEach((node) => {
      const value = category(node);
      if (value) node.dataset.saSettingsSection = value;
    });
  }

  function apply(view) {
    view.querySelectorAll('[data-sa-settings-tab]').forEach((button) => {
      const active = button.dataset.saSettingsTab === state.active;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    [...view.children].forEach((node) => {
      if (node.dataset?.saSettingsSection) node.hidden = node.dataset.saSettingsSection !== state.active;
    });
  }

  function openTab(tab, scroll = true) {
    if (!TABS.has(tab)) return;
    state.active = tab;
    sessionStorage.setItem(STORAGE_KEY, tab);
    const view = document.getElementById('view-admin-config');
    if (!view) return;
    classify(view);
    apply(view);
    if (tab === 'overview') refreshHealth();
    if (tab === 'attendance') window.setTimeout(() => window.SppgLocationConfig?.load?.(), 60);
    if (scroll) view.querySelector('#sa-settings-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function findCard(needle) {
    return [...document.querySelectorAll('#view-admin-config .feature-card,#view-admin-config .admin-card')]
      .find((node) => text(node).includes(String(needle || '').toLowerCase()));
  }

  function openSystemTab(name) {
    openTab('system');
    window.setTimeout(() => {
      const button = document.querySelector(`[data-setting-tab="${CSS.escape(name)}"]`);
      button?.click();
      button?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }, 80);
  }

  function openFace() {
    const trigger = document.querySelector('[data-config-center-menu]');
    if (trigger) trigger.click();
    else window.showAlert?.('Modul scan wajah belum selesai dimuat.', 'warning');
  }

  function openImport() {
    if (typeof window.openAttendanceImport === 'function') window.openAttendanceImport();
    else document.querySelector('[data-attendance-import-menu]')?.click();
  }

  function openGeofence() {
    openTab('attendance', false);
    window.SppgLocationConfig?.load?.();
    window.setTimeout(() => document.getElementById('sppg-location-config-root')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 180);
  }

  function bindActions(view) {
    if (view.dataset.saSettingsBound === 'true') return;
    view.dataset.saSettingsBound = 'true';
    view.addEventListener('click', (event) => {
      const open = event.target.closest('[data-sa-open-tab]');
      if (open) return openTab(open.dataset.saOpenTab);
      if (event.target.closest('[data-sa-refresh-health]')) return refreshHealth();
      if (event.target.closest('[data-sa-open-face]')) return openFace();
      if (event.target.closest('[data-sa-open-import]')) return openImport();
      if (event.target.closest('[data-sa-open-geofence]')) return openGeofence();
      const system = event.target.closest('[data-sa-system-tab]');
      if (system) return openSystemTab(system.dataset.saSystemTab);
      const scroll = event.target.closest('[data-sa-scroll-card]');
      if (scroll) {
        openTab('admin', false);
        window.setTimeout(() => findCard(scroll.dataset.saScrollCard)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
      }
    });
  }

  async function post(functionName, body) {
    if (!projectUrl) throw new Error('URL Supabase belum tersedia.');
    const response = await fetch(`${projectUrl}/functions/v1/${functionName}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.success === false) throw new Error(payload?.message || payload?.error || 'Backend tidak tersedia.');
    return payload?.result;
  }

  function setHealth(key, status, label) {
    document.querySelectorAll(`[data-health-dot="${key}"]`).forEach((node) => { node.className = `sa-settings-health-dot is-${status}`; });
    document.querySelectorAll(`[data-health-label="${key}"]`).forEach((node) => setText(node, label));
  }

  async function refreshHealth() {
    if (!isSuperAdmin()) return;
    const request = ++state.healthRequest;
    ['admin', 'attendance', 'import'].forEach((key) => setHealth(key, 'loading', 'Memeriksa backend...'));
    const token = localStorage.getItem('auth_token');
    const results = await Promise.allSettled([
      typeof window.apiCall === 'function' ? window.apiCall('getAdminConfiguration', { token }) : Promise.reject(new Error('Gateway aplikasi belum siap.')),
      post('ConfigCenter', { action: 'adminConfig', token }),
      post('AttendanceImport', { action: 'config', token }),
    ]);
    if (request !== state.healthRequest) return;

    const [admin, attendance, imported] = results;
    if (admin.status === 'fulfilled') {
      const admins = admin.value?.adminAccounts?.length || 0;
      const access = (admin.value?.access || []).filter((row) => row.Aktif === true || String(row.Aktif).toLowerCase() === 'true').length;
      setHealth('admin', 'success', `Terhubung · ${admins} akun admin · ${access} akses aktif`);
    } else setHealth('admin', 'error', admin.reason?.message || 'Gagal terhubung');

    if (attendance.status === 'fulfilled') setHealth('attendance', 'success', `Terhubung · ${attendance.value?.policies?.length || 0} kebijakan · ${attendance.value?.sppg?.length || 0} SPPG`);
    else setHealth('attendance', 'error', attendance.reason?.message || 'Gagal terhubung');

    if (imported.status === 'fulfilled') {
      const allowed = Boolean(imported.value?.roleConfig?.Menu_Enabled && imported.value?.roleConfig?.Can_Upload);
      setHealth('import', allowed ? 'success' : 'warning', `${allowed ? 'Diizinkan' : 'Izin upload nonaktif'} · ${imported.value?.scopes?.length || 0} cakupan SPPG`);
    } else setHealth('import', 'error', imported.reason?.message || 'Gagal terhubung');
  }

  function enhance() {
    const enabled = isSuperAdmin();
    document.documentElement.classList.toggle('sa-settings-hub-active', enabled);
    if (!enabled) return;
    consolidateMenus();
    const view = document.getElementById('view-admin-config');
    if (!view || !ensureStructure(view)) return;
    classify(view);
    apply(view);
  }

  function schedule() {
    if (state.scheduled) return;
    state.scheduled = true;
    requestAnimationFrame(() => { state.scheduled = false; enhance(); });
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('absen:app-ready', schedule);
  window.addEventListener('absen:session-changed', schedule);
  window.addEventListener('storage', (event) => { if (event.key === 'auth_token' || event.key === 'auth_user') schedule(); });
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-view="admin-config"]')) window.setTimeout(() => { enhance(); if (state.active === 'overview') refreshHealth(); }, 100);
  }, true);

  window.SuperAdminSettingsHub = Object.freeze({ openTab, refresh: () => { enhance(); refreshHealth(); } });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
  else schedule();
})();
