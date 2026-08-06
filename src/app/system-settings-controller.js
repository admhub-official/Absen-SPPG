(() => {
  if (window.SystemSettingsController) return;

  const endpoint = `${String(window.ABSEN_SUPABASE_CONFIG?.projectUrl || '').replace(/\/$/, '')}/functions/v1/SystemSettings`;
  const state = {
    rows: new Map(),
    category: 'attendance',
    loading: false,
    saving: new Set(),
    loaded: false,
    mountTimer: null,
  };

  const categories = Object.freeze({
    menu: { label: 'Menu & Akses', description: 'Visibilitas menu berdasarkan role.' },
    attendance: { label: 'Absensi', description: 'Validasi lokasi, impor, dan koreksi.' },
    payroll: { label: 'Payroll & TTD', description: 'Persyaratan penerbitan slip gaji.' },
    notification: { label: 'Notifikasi', description: 'Notifikasi operasional dan pengumuman.' },
    security: { label: 'Keamanan & Sesi', description: 'Sesi dan tindakan berisiko.' },
  });

  const definitions = Object.freeze([
    { category:'menu', key:'menu.user.complaints', label:'Menu Pengaduan USER', description:'Tampilkan pusat pengaduan untuk pengguna.' },
    { category:'menu', key:'menu.admin.payroll', label:'Menu Payroll ADMIN', description:'Izinkan ADMIN mengakses penerbitan payroll.' },
    { category:'menu', key:'menu.admin.audit', label:'Menu Audit Log', description:'Tampilkan audit operasional bagi ADMIN.' },
    { category:'attendance', key:'attendance.geofence_required', label:'Geofence wajib', description:'Tolak absensi di luar radius SPPG.' },
    { category:'attendance', key:'attendance.capture_gps_accuracy', label:'Simpan akurasi GPS', description:'Rekam metadata akurasi lokasi setiap punch.' },
    { category:'attendance', key:'attendance.allow_import_single_punch', label:'Punch tunggal impor', description:'Izinkan punch tunggal hasil impor dihitung valid.' },
    { category:'attendance', key:'attendance.correction_requires_audit', label:'Audit koreksi absensi', description:'Setiap koreksi wajib disertai audit.' },
    { category:'payroll', key:'payroll.recipient_signature_required', label:'TTD penerima wajib', description:'Slip final memerlukan tanda tangan penerima.' },
    { category:'payroll', key:'payroll.accountant_signature_required', label:'TTD akuntan wajib', description:'Penerbitan slip memerlukan tanda tangan akuntan.' },
    { category:'payroll', key:'payroll.head_signature_required', label:'TTD Kepala SPPG wajib', description:'Penerbitan slip memerlukan tanda tangan Kepala SPPG.' },
    { category:'payroll', key:'payroll.private_pdf', label:'PDF slip privat', description:'Batasi akses PDF slip kepada pihak berwenang.' },
    { category:'notification', key:'notification.new_slip', label:'Notifikasi slip baru', description:'Beri tahu pengguna saat slip diterbitkan.' },
    { category:'notification', key:'notification.complaint_reply', label:'Notifikasi balasan pengaduan', description:'Beri tahu pengguna saat pengaduan ditanggapi.' },
    { category:'notification', key:'notification.incomplete_attendance', label:'Pengingat absensi tidak lengkap', description:'Beri peringatan punch belum lengkap.' },
    { category:'notification', key:'notification.global_announcement', label:'Pengumuman global', description:'Izinkan SUPER ADMIN menerbitkan pengumuman lintas SPPG.', featured:true },
    { category:'security', key:'security.idle_session_expiry', label:'Kedaluwarsa sesi idle', description:'Akhiri sesi yang tidak aktif sesuai kebijakan.' },
    { category:'security', key:'security.revoke_on_password_reset', label:'Cabut sesi saat reset password', description:'Keluar dari seluruh perangkat setelah perubahan sandi.' },
    { category:'security', key:'security.risky_action_reason', label:'Alasan tindakan wajib', description:'Wajibkan alasan pada perubahan berisiko.' },
    { category:'security', key:'security.two_step_confirmation', label:'Konfirmasi dua tahap', description:'Tampilkan dampak sebelum tindakan berisiko.' },
  ]);

  const token = () => localStorage.getItem('auth_token') || '';
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));

  function isSuperAdmin() {
    try {
      const user = JSON.parse(localStorage.getItem('auth_user') || 'null');
      return Boolean(token()) && String(user?.role || user?.Role || '')
        .trim().toUpperCase().replace(/_/g, ' ').replace(/\s+/g, ' ') === 'SUPER ADMIN';
    } catch { return false; }
  }

  async function call(action, payload = {}) {
    if (!endpoint.startsWith('https://')) throw new Error('Endpoint pengaturan belum tersedia.');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token: token(), ...payload }),
      cache: 'no-store',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) throw new Error(body.message || 'Pengaturan gagal diproses.');
    return body.result;
  }

  function disableLegacyCard() {
    const legacyBody = document.getElementById('system-settings-body');
    const legacyCard = legacyBody?.closest('.feature-card,.admin-card');
    if (legacyCard) {
      legacyCard.classList.add('system-settings-legacy-disabled');
      legacyCard.dataset.legacySystemSettings = 'disabled';
      legacyCard.setAttribute('aria-hidden', 'true');
    }
  }

  function ensureRoot() {
    if (!isSuperAdmin()) return null;
    const view = document.getElementById('view-admin-config');
    if (!view) return null;
    disableLegacyCard();

    let root = document.getElementById('system-settings-controller-root');
    if (!root) {
      root = document.createElement('section');
      root.id = 'system-settings-controller-root';
      root.className = 'system-settings-controller feature-card';
      root.dataset.saSettingsSection = 'system';
      const anchor = document.getElementById('sa-settings-system-intro');
      if (anchor?.parentElement === view) anchor.insertAdjacentElement('afterend', root);
      else view.appendChild(root);
    }
    return root;
  }

  function formatDate(value) {
    if (!value) return 'Belum pernah diperbarui';
    try {
      return new Intl.DateTimeFormat('id-ID', { dateStyle:'medium', timeStyle:'short' }).format(new Date(value));
    } catch { return String(value); }
  }

  function enabledOf(row) {
    return Boolean(row?.Enabled ?? row?.Setting_Value?.enabled);
  }

  function render() {
    const root = ensureRoot();
    if (!root) return;
    const rows = definitions.filter((item) => item.category === state.category);
    root.innerHTML = `
      <header class="ssc-header">
        <div><span class="sa-settings-eyebrow">SUMBER TUNGGAL BACKEND</span><h2>Konfigurasi Sistem</h2><p>Setiap tombol membaca nilai aktual database. Status sukses hanya muncul setelah hasil simpan dibaca ulang dan cocok.</p></div>
        <button type="button" class="btn btn-secondary btn-sm" data-ssc-refresh ${state.loading ? 'disabled' : ''}>Muat Ulang</button>
      </header>
      <div class="ssc-health ${state.loaded ? 'is-ready' : ''}" role="status">
        <strong>${state.loading ? 'Membaca backend…' : state.loaded ? 'Backend tersinkron' : 'Backend belum dimuat'}</strong>
        <span>${state.loaded ? `${state.rows.size} pengaturan aktif/nonaktif tersedia.` : 'Tidak ada nilai default yang digunakan sebelum backend siap.'}</span>
      </div>
      <nav class="ssc-tabs" role="tablist" aria-label="Kategori konfigurasi sistem">
        ${Object.entries(categories).map(([key, meta]) => `<button type="button" role="tab" data-ssc-category="${key}" class="${key === state.category ? 'active' : ''}" aria-selected="${key === state.category}"><strong>${esc(meta.label)}</strong><small>${esc(meta.description)}</small></button>`).join('')}
      </nav>
      <div class="ssc-list" aria-busy="${state.loading}">
        ${state.loading && !state.loaded ? '<div class="ssc-empty">Memuat nilai aktual dari database…</div>' : rows.map((item) => {
          const row = state.rows.get(item.key);
          const ready = Boolean(row);
          const enabled = ready && enabledOf(row);
          const saving = state.saving.has(item.key);
          return `<article class="ssc-row ${item.featured ? 'is-featured' : ''}" data-ssc-row="${esc(item.key)}">
            <div class="ssc-row-copy"><strong>${esc(item.label)}</strong><p>${esc(row?.Description || item.description)}</p><small>${ready ? `Diperbarui ${esc(formatDate(row.Updated_At))}` : 'Nilai backend belum tersedia'}</small></div>
            <div class="ssc-row-control"><span class="ssc-state ${enabled ? 'is-on' : 'is-off'}">${enabled ? 'Aktif' : 'Nonaktif'}</span><button type="button" class="ssc-switch ${enabled ? 'active' : ''}" role="switch" aria-checked="${enabled}" aria-label="${esc(item.label)}" data-ssc-key="${esc(item.key)}" ${!ready || saving ? 'disabled' : ''}><span aria-hidden="true"></span></button></div>
          </article>`;
        }).join('')}
      </div>`;
  }

  async function refresh({ silent = false } = {}) {
    if (!isSuperAdmin() || state.loading) return;
    state.loading = true;
    if (!silent) render();
    try {
      const result = await call('getSettings');
      const items = Array.isArray(result?.items) ? result.items : [];
      state.rows = new Map(items.map((item) => [String(item.Setting_Key), item]));
      state.loaded = true;
      if (state.rows.size !== definitions.length) throw new Error(`Backend mengembalikan ${state.rows.size} dari ${definitions.length} pengaturan.`);
    } catch (error) {
      state.loaded = false;
      window.showAlert?.(error.message, 'error');
    } finally {
      state.loading = false;
      render();
    }
  }

  async function confirmChange(definition, enabled) {
    if (typeof window.appConfirm !== 'function') throw new Error('Dialog konfirmasi belum siap.');
    return window.appConfirm({
      title: `${enabled ? 'Aktifkan' : 'Nonaktifkan'} ${definition.label}?`,
      message: enabled ? 'Fitur akan diaktifkan setelah nilai database berhasil diverifikasi.' : 'Fitur akan dinonaktifkan setelah nilai database berhasil diverifikasi.',
      confirmText: enabled ? 'Ya, aktifkan' : 'Ya, nonaktifkan',
      cancelText: 'Tidak',
      tone: enabled ? 'primary' : 'danger',
      detail: 'Tampilan tidak menggunakan nilai default atau status lokal.',
    });
  }

  async function update(key) {
    if (state.saving.has(key)) return;
    const definition = definitions.find((item) => item.key === key);
    const current = state.rows.get(key);
    if (!definition || !current) {
      window.showAlert?.('Nilai backend belum tersedia. Muat ulang halaman.', 'error');
      return;
    }

    const enabled = !enabledOf(current);
    let approved = false;
    try { approved = await confirmChange(definition, enabled); }
    catch (error) { window.showAlert?.(error.message, 'error'); return; }
    if (!approved) return;

    state.saving.add(key);
    render();
    try {
      const result = await call('updateSetting', {
        key,
        enabled,
        description: current.Description || definition.description,
        reason: `SUPER ADMIN ${enabled ? 'mengaktifkan' : 'menonaktifkan'} ${definition.label} melalui Konfigurasi Sistem.`,
      });
      if (!result?.item || enabledOf(result.item) !== enabled) throw new Error('Respons simpan tidak sesuai dengan pilihan.');

      const verified = await call('getSettings');
      const items = Array.isArray(verified?.items) ? verified.items : [];
      state.rows = new Map(items.map((item) => [String(item.Setting_Key), item]));
      const actual = state.rows.get(key);
      if (!actual || enabledOf(actual) !== enabled) throw new Error('Nilai database berubah saat diverifikasi ulang.');

      state.loaded = true;
      window.showAlert?.(`${definition.label} berhasil ${enabled ? 'diaktifkan' : 'dinonaktifkan'}.`, 'success');
      window.dispatchEvent(new CustomEvent('absen:system-settings-changed', { detail:{ key, enabled, setting:actual } }));
      if (key === 'notification.global_announcement') window.NotificationPublisher?.load?.();
    } catch (error) {
      window.showAlert?.(error.message || 'Pengaturan gagal disimpan.', 'error');
      await refresh({ silent:true });
    } finally {
      state.saving.delete(key);
      render();
    }
  }

  function handleClick(event) {
    const root = event.target.closest?.('#system-settings-controller-root');
    if (!root) return;
    const category = event.target.closest('[data-ssc-category]');
    if (category) {
      state.category = category.dataset.sscCategory;
      render();
      return;
    }
    if (event.target.closest('[data-ssc-refresh]')) { refresh(); return; }
    const toggle = event.target.closest('[data-ssc-key]');
    if (toggle) update(toggle.dataset.sscKey);
  }

  function schedule(delay = 80) {
    clearTimeout(state.mountTimer);
    state.mountTimer = setTimeout(() => {
      const root = ensureRoot();
      if (!root) return;
      render();
      if (!state.loaded && !state.loading) refresh();
    }, delay);
  }

  document.addEventListener('click', handleClick);
  document.addEventListener('click', (event) => {
    if (event.target.closest?.('[data-sa-settings-tab="system"],[data-sa-system-tab],[data-view="admin-config"]')) schedule(120);
  });
  window.addEventListener('absen:app-ready', () => schedule(180));
  window.addEventListener('absen:session-changed', () => { state.loaded = false; schedule(180); });
  window.addEventListener('focus', () => { if (state.loaded) refresh({ silent:true }); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.loaded) refresh({ silent:true }); });

  const observer = new MutationObserver(() => {
    if (isSuperAdmin() && !document.getElementById('system-settings-controller-root')) schedule(50);
    else disableLegacyCard();
  });
  observer.observe(document.documentElement, { childList:true, subtree:true });

  window.SystemSettingsController = Object.freeze({
    refresh: () => refresh(),
    get: (key) => state.rows.get(key) || null,
    openCategory: (category) => {
      if (categories[category]) state.category = category;
      window.SuperAdminSettingsHub?.openTab?.('system');
      schedule(40);
    },
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => schedule(180), { once:true });
  else schedule(180);
})();
