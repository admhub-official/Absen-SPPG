(() => {
  if (window.SettingsNotificationAdmin) return;

  const endpoint = `${String(window.ABSEN_SUPABASE_CONFIG?.projectUrl || '').replace(/\/$/, '')}/functions/v1/ConfigCenter`;
  const state = {
    settings: [],
    notifications: [],
    admin: { sppg: [], users: [] },
    section: 'policy',
    category: 'notification',
    editingId: '',
    loading: false,
    bound: false,
  };

  const token = () => localStorage.getItem('auth_token') || '';
  const currentUser = () => {
    try { return JSON.parse(localStorage.getItem('auth_user') || 'null'); }
    catch { return null; }
  };
  const role = () => String(currentUser()?.role || currentUser()?.Role || '')
    .trim().toUpperCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
  const isSuper = () => Boolean(token()) && role() === 'SUPER ADMIN';
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
  const fmt = (value) => {
    if (!value) return '-';
    try { return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
    catch { return String(value); }
  };

  async function call(action, payload = {}) {
    if (!endpoint.startsWith('https://')) throw new Error('Konfigurasi backend belum tersedia.');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token: token(), ...payload }),
      cache: 'no-store',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) throw new Error(body.message || 'Permintaan gagal diproses.');
    return body.result;
  }

  const categoryMeta = {
    menu: { label: 'Visibilitas Menu', description: 'Atur menu yang dapat digunakan oleh role terkait.' },
    attendance: { label: 'Absensi', description: 'Kebijakan validasi dan pencatatan absensi.' },
    payroll: { label: 'Payroll & TTD', description: 'Persyaratan keamanan dan tanda tangan slip.' },
    notification: { label: 'Notifikasi', description: 'Izin pengumuman dan notifikasi operasional.' },
    security: { label: 'Keamanan & Sesi', description: 'Kebijakan sesi, audit, dan tindakan berisiko.' },
  };

  function categoryOf(key) {
    const prefix = String(key || '').split('.')[0];
    return categoryMeta[prefix] ? prefix : '';
  }

  function settingLabel(key) {
    const labels = {
      'menu.admin.audit': 'Menu Audit untuk ADMIN',
      'menu.admin.payroll': 'Menu Payroll untuk ADMIN',
      'menu.user.complaints': 'Menu Pengaduan untuk USER',
      'attendance.allow_import_single_punch': 'Izinkan Punch Tunggal Hasil Impor',
      'attendance.capture_gps_accuracy': 'Rekam Akurasi GPS',
      'attendance.correction_requires_audit': 'Audit Wajib untuk Koreksi',
      'attendance.geofence_required': 'Geofence Wajib',
      'payroll.accountant_signature_required': 'TTD Akuntan Wajib',
      'payroll.head_signature_required': 'TTD Kepala SPPG Wajib',
      'payroll.private_pdf': 'PDF Slip Bersifat Privat',
      'payroll.recipient_signature_required': 'TTD Penerima Wajib',
      'notification.complaint_reply': 'Notifikasi Tanggapan Pengaduan',
      'notification.global_announcement': 'Pengumuman Global',
      'notification.incomplete_attendance': 'Peringatan Absensi Belum Lengkap',
      'notification.new_slip': 'Notifikasi Slip Baru',
      'security.idle_session_expiry': 'Akhiri Sesi Tidak Aktif',
      'security.revoke_on_password_reset': 'Cabut Sesi Saat Password Diubah',
      'security.risky_action_reason': 'Alasan Wajib untuk Tindakan Berisiko',
      'security.two_step_confirmation': 'Konfirmasi Dua Tahap',
    };
    return labels[key] || key;
  }

  function globalAnnouncementEnabled() {
    return Boolean(state.settings.find((row) => row.Setting_Key === 'notification.global_announcement')?.Enabled);
  }

  function hideLegacySettingsCard() {
    const legacyBody = document.getElementById('system-settings-body');
    const card = legacyBody?.closest('.feature-card');
    if (card) {
      card.dataset.replacedBySettingsAdmin = 'true';
      card.hidden = true;
    }
  }

  function ensureRoot() {
    const view = document.getElementById('view-admin-config');
    if (!view || !isSuper()) return null;
    hideLegacySettingsCard();
    let root = document.getElementById('settings-notification-admin-root');
    if (!root) {
      root = document.createElement('section');
      root.id = 'settings-notification-admin-root';
      root.className = 'settings-notification-admin feature-card';
      root.dataset.saSettingsSection = 'system';
      const anchor = document.getElementById('sa-settings-system-intro');
      if (anchor?.parentElement === view) anchor.insertAdjacentElement('afterend', root);
      else view.appendChild(root);
    }
    return root;
  }

  function policyMarkup() {
    const rows = state.settings.filter((item) => item.Enabled !== null && categoryOf(item.Setting_Key) === state.category);
    return `<div class="sna-policy-layout">
      <nav class="sna-category-nav" aria-label="Kategori kebijakan">
        ${Object.entries(categoryMeta).map(([key, meta]) => `<button type="button" class="${key === state.category ? 'active' : ''}" data-sna-category="${key}"><strong>${esc(meta.label)}</strong><small>${esc(meta.description)}</small></button>`).join('')}
      </nav>
      <div class="sna-setting-list">
        ${rows.length ? rows.map((item) => `<article class="sna-setting-row ${item.Setting_Key === 'notification.global_announcement' ? 'is-featured' : ''}">
          <div><strong>${esc(settingLabel(item.Setting_Key))}</strong><p>${esc(item.Description || item.Setting_Key)}</p><small>Terakhir diperbarui ${esc(fmt(item.Updated_At))}</small></div>
          <label class="sna-switch"><input type="checkbox" data-sna-setting="${esc(item.Setting_Key)}" ${item.Enabled ? 'checked' : ''}><span aria-hidden="true"></span><b>${item.Enabled ? 'Aktif' : 'Nonaktif'}</b></label>
        </article>`).join('') : '<div class="sna-empty">Tidak ada sakelar aktif/nonaktif pada kategori ini.</div>'}
      </div>
    </div>`;
  }

  function targetMarkup(mode, selected = {}) {
    const checkedRoles = new Set(selected.roles || []);
    const checkedSppg = new Set(selected.sppg || []);
    const checkedUsers = new Set(selected.users || []);
    if (mode === 'ROLES') {
      return `<div class="sna-check-grid">${['USER', 'ADMIN', 'AKUNTAN', 'SUPER ADMIN'].map((item) => `<label><input type="checkbox" data-sna-target-role value="${item}" ${checkedRoles.has(item) ? 'checked' : ''}>${item}</label>`).join('')}</div>`;
    }
    if (mode === 'SPPG') {
      return `<div class="sna-target-toolbar"><input type="search" class="form-input" data-sna-target-search placeholder="Cari SPPG..."><button type="button" class="btn btn-secondary btn-sm" data-sna-target-all>Pilih semua</button></div><div class="sna-check-grid sna-target-list">${(state.admin.sppg || []).map((item) => `<label data-sna-target-item="${esc(String(item.Nama_SPPG || '').toLowerCase())}"><input type="checkbox" data-sna-target-sppg value="${esc(item.Nama_SPPG)}" ${checkedSppg.has(item.Nama_SPPG) ? 'checked' : ''}><span>${esc(item.Nama_SPPG)}${item.Yayasan ? `<small>${esc(item.Yayasan)}</small>` : ''}</span></label>`).join('')}</div>`;
    }
    if (mode === 'USERS') {
      return `<div class="sna-target-toolbar"><select class="form-input" data-sna-user-sppg><option value="">Semua SPPG</option>${(state.admin.sppg || []).map((item) => `<option value="${esc(item.Nama_SPPG)}">${esc(item.Nama_SPPG)}</option>`).join('')}</select><input type="search" class="form-input" data-sna-target-search placeholder="Cari pengguna..."></div><div class="sna-check-grid sna-target-list">${(state.admin.users || []).map((item) => `<label data-sna-target-item="${esc(`${item.Nama_Lengkap || ''} ${item.SPPG || ''} ${item.Role || ''}`.toLowerCase())}" data-user-sppg="${esc(item.SPPG || '')}"><input type="checkbox" data-sna-target-user value="${esc(item.ID_User)}" ${checkedUsers.has(String(item.ID_User)) ? 'checked' : ''}><span>${esc(item.Nama_Lengkap)}<small>${esc(item.Role || 'USER')} · ${esc(item.SPPG || '-')}</small></span></label>`).join('')}</div>`;
    }
    return `<div class="sna-target-all-note"><strong>Semua pengguna aktif</strong><span>Notifikasi dikirim lintas role dan seluruh SPPG.</span></div>`;
  }

  function localDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
  }

  function publisherMarkup() {
    const item = state.notifications.find((row) => String(row.ID_Notification) === state.editingId) || null;
    const mode = item?.Target_Mode || 'ALL';
    const globalEnabled = globalAnnouncementEnabled();
    return `<form class="sna-publisher" id="sna-notification-form">
      <div class="sna-form-head"><div><h3>${item ? 'Edit Notifikasi' : 'Terbitkan Notifikasi'}</h3><p>Menu ini ditempatkan di Pusat Pengaturan → Sistem → Penerbitan Notifikasi.</p></div>${item ? '<span class="badge badge-info">Mode edit</span>' : ''}</div>
      ${!globalEnabled ? '<div class="sna-warning"><strong>Pengumuman Global nonaktif.</strong><span>Target Semua Pengguna tidak dapat diterbitkan sampai sakelar di Kebijakan Notifikasi diaktifkan.</span><button type="button" class="btn btn-secondary btn-sm" data-sna-go-global>Atur sekarang</button></div>' : ''}
      <div class="sna-form-grid">
        <label class="sna-field sna-span-2"><span>Judul *</span><input class="form-input" name="title" maxlength="120" required value="${esc(item?.Title || '')}" placeholder="Contoh: Pemeliharaan aplikasi malam ini"></label>
        <label class="sna-field sna-span-2"><span>Isi Pengumuman *</span><textarea class="form-input" name="message" maxlength="1000" rows="5" required placeholder="Tulis informasi yang perlu diketahui pengguna.">${esc(item?.Message || '')}</textarea><small><b data-sna-message-count>${String(item?.Message || '').length}</b>/1000 karakter</small></label>
        <label class="sna-field"><span>Prioritas</span><select class="form-input" name="priority">${['RENDAH','NORMAL','TINGGI','MENDESAK'].map((value) => `<option ${value === (item?.Priority || 'NORMAL') ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
        <label class="sna-field"><span>Target</span><select class="form-input" name="targetMode" data-sna-target-mode><option value="ALL" ${mode === 'ALL' ? 'selected' : ''} ${!globalEnabled ? 'disabled' : ''}>Semua Pengguna</option><option value="ROLES" ${mode === 'ROLES' ? 'selected' : ''}>Role Tertentu</option><option value="SPPG" ${mode === 'SPPG' ? 'selected' : ''}>SPPG Tertentu</option><option value="USERS" ${mode === 'USERS' ? 'selected' : ''}>Pengguna Tertentu</option></select></label>
        <div class="sna-field sna-span-2"><span>Rincian Target</span><div class="sna-target-box" data-sna-target-box>${targetMarkup(mode, { roles: item?.Target_Roles, sppg: item?.Target_SPPG, users: (item?.Target_User_IDs || []).map(String) })}</div></div>
        <label class="sna-field"><span>Mulai Tampil</span><input class="form-input" type="datetime-local" name="startsAt" value="${esc(localDateTime(item?.Starts_At))}"></label>
        <label class="sna-field"><span>Berakhir</span><input class="form-input" type="datetime-local" name="expiresAt" value="${esc(localDateTime(item?.Expires_At))}"></label>
        <label class="sna-field sna-span-2"><span>Arahkan ke Menu</span><select class="form-input" name="actionView"><option value="dashboard">Dashboard</option><option value="pengaduan" ${item?.Action_View === 'pengaduan' ? 'selected' : ''}>Pengaduan</option><option value="payroll-saya" ${item?.Action_View === 'payroll-saya' ? 'selected' : ''}>Payroll Saya</option><option value="my-absensi" ${item?.Action_View === 'my-absensi' ? 'selected' : ''}>Absensi Saya</option></select></label>
      </div>
      <div class="sna-delivery-options"><label><input type="checkbox" name="showBanner" ${item?.Show_Banner !== false ? 'checked' : ''}><span><strong>Banner in-app</strong><small>Tampil pada dashboard pengguna.</small></span></label><label><input type="checkbox" name="pushEnabled" ${item?.Push_Enabled !== false ? 'checked' : ''}><span><strong>Push notification</strong><small>Dikirim ke perangkat yang terdaftar.</small></span></label><label><input type="checkbox" name="playSound" ${item?.Play_Sound === true ? 'checked' : ''}><span><strong>Suara</strong><small>Bunyikan pemberitahuan saat banner muncul.</small></span></label></div>
      <div class="sna-form-actions"><button type="button" class="btn btn-secondary" data-sna-save-draft>Simpan Draft</button>${item ? '<button type="button" class="btn btn-secondary" data-sna-cancel-edit>Batal Edit</button>' : ''}<button type="submit" class="btn btn-primary">${item ? 'Simpan & Terbitkan' : 'Terbitkan Notifikasi'}</button></div>
    </form>`;
  }

  function statusBadge(status) {
    const value = String(status || 'DRAFT').toUpperCase();
    const cls = value === 'PUBLISHED' ? 'badge-success' : value === 'CANCELLED' ? 'badge-gray' : 'badge-warning';
    return `<span class="badge ${cls}">${esc(value === 'CANCELLED' ? 'DIBATALKAN' : value)}</span>`;
  }

  function historyMarkup() {
    return `<div class="sna-history"><div class="sna-history-head"><div><h3>Riwayat Penerbitan</h3><p>Tambah, edit, batalkan, dan hapus notifikasi tersinkron langsung dengan backend.</p></div><button type="button" class="btn btn-primary btn-sm" data-sna-new-notification>+ Notifikasi Baru</button></div><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Judul</th><th>Target</th><th>Jadwal</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${state.notifications.length ? state.notifications.map((item) => `<tr><td data-primary="true"><strong>${esc(item.Title)}</strong><small class="sna-cell-sub">${esc(String(item.Message || '').slice(0, 90))}</small></td><td>${esc(item.Target_Mode)}${item.Target_Mode === 'SPPG' ? `<small class="sna-cell-sub">${esc((item.Target_SPPG || []).join(', '))}</small>` : ''}</td><td>${esc(fmt(item.Starts_At))}${item.Expires_At ? `<small class="sna-cell-sub">s.d. ${esc(fmt(item.Expires_At))}</small>` : ''}</td><td>${statusBadge(item.Status)}</td><td><div class="sna-row-actions"><button type="button" class="btn btn-secondary btn-sm" data-sna-edit="${esc(item.ID_Notification)}">Edit</button>${item.Status === 'PUBLISHED' ? `<button type="button" class="btn btn-secondary btn-sm" data-sna-cancel="${esc(item.ID_Notification)}">Batalkan</button>` : ''}<button type="button" class="btn btn-danger btn-sm" data-sna-delete="${esc(item.ID_Notification)}">Hapus</button></div></td></tr>`).join('') : '<tr><td colspan="5"><div class="sna-empty">Belum ada notifikasi yang diterbitkan.</div></td></tr>'}</tbody></table></div></div>`;
  }

  function render() {
    const root = ensureRoot();
    if (!root) return;
    root.innerHTML = `<div class="sna-head"><div><span class="sa-settings-eyebrow">SISTEM & KOMUNIKASI</span><h2>Kebijakan dan Penerbitan Notifikasi</h2><p>Pengaturan tersimpan pada System_Settings. Penerbitan tersimpan pada App_Notifications.</p></div><button type="button" class="btn btn-secondary btn-sm" data-sna-refresh>Muat Ulang</button></div>
      <div class="sna-tabs" role="tablist" aria-label="Pengaturan sistem dan notifikasi"><button type="button" role="tab" data-sna-section="policy" class="${state.section === 'policy' ? 'active' : ''}" aria-selected="${state.section === 'policy'}">Kebijakan Sistem</button><button type="button" role="tab" data-sna-section="publisher" class="${state.section === 'publisher' ? 'active' : ''}" aria-selected="${state.section === 'publisher'}">Penerbitan Notifikasi</button><button type="button" role="tab" data-sna-section="history" class="${state.section === 'history' ? 'active' : ''}" aria-selected="${state.section === 'history'}">Riwayat & Kelola <span>${state.notifications.length}</span></button></div>
      <div class="sna-body" aria-busy="${state.loading}">${state.loading ? '<div class="loading-state"><span class="spinner"></span>Memuat data backend...</div>' : state.section === 'policy' ? policyMarkup() : state.section === 'publisher' ? publisherMarkup() : historyMarkup()}</div>`;
    bindDynamic(root);
  }

  function renderTargetBox(form) {
    const mode = form.elements.targetMode.value;
    const box = form.querySelector('[data-sna-target-box]');
    if (box) box.innerHTML = targetMarkup(mode);
    bindTargetTools(form);
  }

  function bindTargetTools(scope) {
    const search = scope.querySelector('[data-sna-target-search]');
    const sppgFilter = scope.querySelector('[data-sna-user-sppg]');
    const applyFilter = () => {
      const query = String(search?.value || '').trim().toLowerCase();
      const selectedSppg = String(sppgFilter?.value || '');
      scope.querySelectorAll('[data-sna-target-item]').forEach((item) => {
        const matchesQuery = !query || String(item.dataset.snaTargetItem || '').includes(query);
        const matchesSppg = !selectedSppg || item.dataset.userSppg === selectedSppg;
        item.hidden = !(matchesQuery && matchesSppg);
      });
    };
    search?.addEventListener('input', applyFilter);
    sppgFilter?.addEventListener('change', applyFilter);
    scope.querySelector('[data-sna-target-all]')?.addEventListener('click', () => {
      scope.querySelectorAll('[data-sna-target-item]:not([hidden]) input[type="checkbox"]').forEach((input) => { input.checked = true; });
    });
  }

  function bindDynamic(root) {
    const form = root.querySelector('#sna-notification-form');
    if (form) {
      form.elements.targetMode?.addEventListener('change', () => renderTargetBox(form));
      form.elements.message?.addEventListener('input', () => {
        const count = form.querySelector('[data-sna-message-count]');
        if (count) count.textContent = String(form.elements.message.value.length);
      });
      bindTargetTools(form);
      form.addEventListener('submit', (event) => { event.preventDefault(); saveNotification('PUBLISHED'); });
    }
  }

  function selectedValues(selector) {
    return [...document.querySelectorAll(`#settings-notification-admin-root ${selector}:checked`)].map((node) => node.value);
  }

  function formPayload(status) {
    const form = document.getElementById('sna-notification-form');
    if (!form) throw new Error('Form notifikasi tidak tersedia.');
    const targetMode = form.elements.targetMode.value;
    return {
      id: state.editingId || undefined,
      title: form.elements.title.value.trim(),
      message: form.elements.message.value.trim(),
      priority: form.elements.priority.value,
      targetMode,
      targetRoles: selectedValues('[data-sna-target-role]'),
      targetSppg: selectedValues('[data-sna-target-sppg]'),
      targetUserIds: selectedValues('[data-sna-target-user]'),
      showBanner: form.elements.showBanner.checked,
      pushEnabled: form.elements.pushEnabled.checked,
      playSound: form.elements.playSound.checked,
      actionView: form.elements.actionView.value,
      startsAt: form.elements.startsAt.value ? new Date(form.elements.startsAt.value).toISOString() : undefined,
      expiresAt: form.elements.expiresAt.value ? new Date(form.elements.expiresAt.value).toISOString() : null,
      status,
    };
  }

  async function toggleSetting(input) {
    const key = input.dataset.snaSetting;
    const previous = !input.checked;
    const enabled = input.checked;
    input.checked = previous;
    const approved = await window.appConfirm?.({
      title: `${enabled ? 'Aktifkan' : 'Nonaktifkan'} ${settingLabel(key)}?`,
      message: enabled ? 'Fitur akan tersedia sesuai cakupan pengaturan ini.' : 'Fitur akan dinonaktifkan setelah perubahan tersimpan.',
      confirmText: enabled ? 'Ya, aktifkan' : 'Ya, nonaktifkan',
      tone: enabled ? 'primary' : 'danger',
      detail: 'Perubahan dicatat di backend dan diverifikasi ulang sebelum tampilan diperbarui.',
    });
    if (!approved) return;
    try {
      input.disabled = true;
      await call('updateSystemSetting', { settingKey: key, enabled });
      const refreshed = await call('getSystemSettings');
      state.settings = refreshed?.items || [];
      const actual = state.settings.find((item) => item.Setting_Key === key)?.Enabled;
      if (Boolean(actual) !== enabled) throw new Error('Backend belum mengembalikan nilai terbaru. Muat ulang dan coba kembali.');
      window.showAlert?.(`${settingLabel(key)} berhasil ${enabled ? 'diaktifkan' : 'dinonaktifkan'}.`, 'success');
      render();
    } catch (error) {
      input.disabled = false;
      window.showAlert?.(error.message, 'error');
      render();
    }
  }

  async function saveNotification(status) {
    try {
      const payload = formPayload(status);
      if (!payload.title || !payload.message) throw new Error('Judul dan isi notifikasi wajib diisi.');
      const isPublish = status === 'PUBLISHED';
      if (isPublish) {
        const approved = await window.appConfirm?.({
          title: state.editingId ? 'Simpan perubahan dan terbitkan?' : 'Terbitkan notifikasi?',
          message: `Notifikasi akan dikirim ke target ${payload.targetMode}.`,
          confirmText: state.editingId ? 'Simpan & terbitkan' : 'Ya, terbitkan',
          detail: 'Periksa kembali judul, target, jadwal, banner, dan push notification.',
        });
        if (!approved) return;
      }
      const saved = await call('saveNotification', payload);
      const list = await call('listAdminNotifications');
      state.notifications = list?.items || [];
      const verified = state.notifications.find((item) => item.ID_Notification === saved.ID_Notification);
      if (!verified || verified.Status !== status) throw new Error('Notifikasi tersimpan tetapi verifikasi backend belum sesuai.');
      state.editingId = '';
      state.section = status === 'DRAFT' ? 'history' : 'history';
      window.showAlert?.(status === 'DRAFT' ? 'Draft notifikasi berhasil disimpan.' : 'Notifikasi berhasil diterbitkan.', 'success');
      window.dispatchEvent(new CustomEvent('absen:notifications-changed'));
      render();
    } catch (error) {
      window.showAlert?.(error.message, 'error');
    }
  }

  async function cancelNotification(id) {
    const item = state.notifications.find((row) => String(row.ID_Notification) === String(id));
    if (!item) return;
    const approved = await window.appConfirm?.({ title: 'Batalkan notifikasi?', message: item.Title, confirmText: 'Ya, batalkan', tone: 'danger', detail: 'Notifikasi tidak lagi muncul untuk pengguna, tetapi tetap tercatat di riwayat.' });
    if (!approved) return;
    try {
      await call('cancelNotification', { id });
      const list = await call('listAdminNotifications');
      state.notifications = list?.items || [];
      if (state.notifications.find((row) => row.ID_Notification === id)?.Status !== 'CANCELLED') throw new Error('Status pembatalan belum tersinkron.');
      window.showAlert?.('Notifikasi berhasil dibatalkan.', 'success');
      window.dispatchEvent(new CustomEvent('absen:notifications-changed'));
      render();
    } catch (error) { window.showAlert?.(error.message, 'error'); }
  }

  async function deleteNotification(id) {
    const item = state.notifications.find((row) => String(row.ID_Notification) === String(id));
    if (!item) return;
    const approved = await window.appConfirm?.({ title: 'Hapus notifikasi secara permanen?', message: item.Title, confirmText: 'Hapus permanen', tone: 'danger', detail: 'Riwayat baca pengguna untuk notifikasi ini juga akan dihapus. Tindakan tidak dapat dibatalkan.' });
    if (!approved) return;
    try {
      await call('deleteNotification', { id });
      const list = await call('listAdminNotifications');
      state.notifications = list?.items || [];
      if (state.notifications.some((row) => row.ID_Notification === id)) throw new Error('Notifikasi masih ditemukan setelah penghapusan.');
      if (state.editingId === id) state.editingId = '';
      window.showAlert?.('Notifikasi berhasil dihapus.', 'success');
      window.dispatchEvent(new CustomEvent('absen:notifications-changed'));
      render();
    } catch (error) { window.showAlert?.(error.message, 'error'); }
  }

  async function load(showLoader = true) {
    if (!isSuper() || state.loading) return;
    state.loading = true;
    if (showLoader) render();
    try {
      const [settings, notifications, admin] = await Promise.all([
        call('getSystemSettings'),
        call('listAdminNotifications'),
        call('adminConfig'),
      ]);
      state.settings = settings?.items || [];
      state.notifications = notifications?.items || [];
      state.admin = admin || { sppg: [], users: [] };
    } catch (error) {
      window.showAlert?.(`Pusat Pengaturan: ${error.message}`, 'error');
    } finally {
      state.loading = false;
      render();
    }
  }

  function openSection(section, category = '') {
    if (['menu','attendance','payroll','notification','security'].includes(section)) {
      state.section = 'policy';
      state.category = section;
    } else if (['policy','publisher','history'].includes(section)) {
      state.section = section;
      if (categoryMeta[category]) state.category = category;
    }
    window.SuperAdminSettingsHub?.openTab?.('system');
    render();
    document.getElementById('settings-notification-admin-root')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleClick(event) {
    const root = event.target.closest?.('#settings-notification-admin-root');
    if (!root) return;
    const section = event.target.closest('[data-sna-section]');
    if (section) { state.section = section.dataset.snaSection; state.editingId = state.section === 'publisher' ? state.editingId : ''; return render(); }
    const category = event.target.closest('[data-sna-category]');
    if (category) { state.category = category.dataset.snaCategory; return render(); }
    if (event.target.closest('[data-sna-refresh]')) return load();
    if (event.target.closest('[data-sna-go-global]')) { state.section = 'policy'; state.category = 'notification'; return render(); }
    if (event.target.closest('[data-sna-save-draft]')) return saveNotification('DRAFT');
    if (event.target.closest('[data-sna-cancel-edit]')) { state.editingId = ''; return render(); }
    if (event.target.closest('[data-sna-new-notification]')) { state.editingId = ''; state.section = 'publisher'; return render(); }
    const edit = event.target.closest('[data-sna-edit]');
    if (edit) { state.editingId = edit.dataset.snaEdit; state.section = 'publisher'; return render(); }
    const cancel = event.target.closest('[data-sna-cancel]');
    if (cancel) return cancelNotification(cancel.dataset.snaCancel);
    const remove = event.target.closest('[data-sna-delete]');
    if (remove) return deleteNotification(remove.dataset.snaDelete);
  }

  function handleChange(event) {
    const input = event.target.closest?.('[data-sna-setting]');
    if (input) toggleSetting(input);
  }

  function schedule() {
    if (!isSuper()) return;
    const root = ensureRoot();
    if (!root) return;
    if (!state.bound) {
      state.bound = true;
      document.addEventListener('click', handleClick);
      document.addEventListener('change', handleChange);
    }
    if (!state.settings.length && !state.loading) load();
    else render();
  }

  window.SettingsNotificationAdmin = Object.freeze({ openSection, refresh: () => load(false) });
  new MutationObserver(() => requestAnimationFrame(schedule)).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('absen:app-ready', schedule);
  window.addEventListener('absen:session-changed', schedule);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
  else schedule();
})();
