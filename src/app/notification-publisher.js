(() => {
  if (window.NotificationPublisher) return;

  const endpoint = `${window.ABSEN_SUPABASE_CONFIG.projectUrl}/functions/v1/ConfigCenter`;
  const state = { config: null, items: [], loading: false, loaded: false, editing: null, timer: null };
  const token = () => localStorage.getItem('auth_token');
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));

  function isSuperAdmin() {
    try {
      const user = JSON.parse(localStorage.getItem('auth_user') || 'null');
      return Boolean(token()) && String(user?.role || user?.Role || '').toUpperCase().replace(/_/g, ' ').trim() === 'SUPER ADMIN';
    } catch { return false; }
  }

  function isActive() {
    const view = document.getElementById('view-admin-config');
    const tab = document.querySelector('[data-setting-tab="notification"]');
    return isSuperAdmin() && view && !view.classList.contains('hidden') && !view.hidden && tab?.classList.contains('active');
  }

  async function call(action, payload = {}) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token: token(), ...payload }),
      cache: 'no-store',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) throw new Error(body.message || 'Proses notifikasi gagal.');
    return body.result;
  }

  function ensureRoot() {
    if (!isActive()) {
      document.getElementById('notification-publisher-root')?.remove();
      return null;
    }
    const settingsBody = document.getElementById('system-settings-body');
    if (!settingsBody) return null;
    let root = document.getElementById('notification-publisher-root');
    if (!root) {
      settingsBody.insertAdjacentHTML('afterend', `
        <section id="notification-publisher-root" class="notification-publisher-root">
          <div class="notification-publisher-header">
            <div><span class="notification-publisher-eyebrow">PUSAT PENGATURAN · SISTEM · NOTIFIKASI</span><h3>Penerbitan Notifikasi & Pengumuman</h3><p>Buat, edit, jadwalkan, hentikan, dan hapus pengumuman dari satu tempat.</p></div>
            <div class="notification-publisher-header-actions"><span class="notification-publisher-setting" data-publisher-setting>Memeriksa…</span><button type="button" class="btn btn-secondary btn-sm" data-publisher-refresh>Muat Ulang</button><button type="button" class="btn btn-primary" data-publisher-add>Tambah Pengumuman</button></div>
          </div>
          <div class="notification-publisher-message" data-publisher-message></div>
          <div class="notification-publisher-list" data-publisher-list></div>
        </section>`);
      root = document.getElementById('notification-publisher-root');
      root.querySelector('[data-publisher-add]').addEventListener('click', () => openEditor());
      root.querySelector('[data-publisher-refresh]').addEventListener('click', () => load(true));
      root.addEventListener('click', handleAction);
    } else if (root.previousElementSibling !== settingsBody) {
      settingsBody.insertAdjacentElement('afterend', root);
    }
    return root;
  }

  function formatDate(value) {
    if (!value) return 'Tanpa batas';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function statusOf(item) {
    if (item.Status !== 'PUBLISHED') return item.Status || 'DRAFT';
    const now = Date.now();
    if (item.Expires_At && new Date(item.Expires_At).getTime() <= now) return 'KEDALUWARSA';
    if (item.Starts_At && new Date(item.Starts_At).getTime() > now) return 'TERJADWAL';
    return 'AKTIF';
  }

  function targetOf(item) {
    if (item.Target_Mode === 'ALL') return 'Semua pengguna';
    if (item.Target_Mode === 'ROLES') return `Role: ${(item.Target_Roles || []).join(', ') || '-'}`;
    if (item.Target_Mode === 'SPPG') return `SPPG: ${(item.Target_SPPG || []).join(', ') || '-'}`;
    if (item.Target_Mode === 'USERS') return `${(item.Target_User_IDs || []).length} pengguna`;
    return item.Target_Mode || '-';
  }

  function render() {
    const root = ensureRoot();
    if (!root) return;
    const enabled = Boolean(state.config?.enabled);
    const setting = root.querySelector('[data-publisher-setting]');
    setting.textContent = enabled ? 'Pengumuman global aktif' : 'Pengumuman global nonaktif';
    setting.className = `notification-publisher-setting ${enabled ? 'is-enabled' : 'is-disabled'}`;
    const list = root.querySelector('[data-publisher-list]');
    if (state.loading) {
      list.innerHTML = '<div class="notification-publisher-empty">Memuat pengumuman…</div>';
      return;
    }
    if (!state.items.length) {
      list.innerHTML = '<div class="notification-publisher-empty"><strong>Belum ada pengumuman</strong><span>Buat draft atau terbitkan pengumuman baru.</span></div>';
      return;
    }
    list.innerHTML = state.items.map((item) => {
      const status = statusOf(item);
      const published = item.Status === 'PUBLISHED';
      return `<article class="notification-publisher-item" data-notification-id="${escapeHtml(item.ID_Notification)}">
        <div class="notification-publisher-item-main"><div class="notification-publisher-item-title"><strong>${escapeHtml(item.Title)}</strong><span class="notification-publisher-status status-${escapeHtml(status.toLowerCase())}">${escapeHtml(status)}</span></div><p>${escapeHtml(item.Message)}</p><div class="notification-publisher-meta"><span>${escapeHtml(targetOf(item))}</span><span>Mulai: ${escapeHtml(formatDate(item.Starts_At))}</span><span>Berakhir: ${escapeHtml(formatDate(item.Expires_At))}</span></div></div>
        <div class="notification-publisher-actions"><button type="button" class="btn btn-secondary btn-sm" data-publisher-edit>Edit</button><button type="button" class="btn btn-secondary btn-sm" data-publisher-status="${published ? 'DRAFT' : 'PUBLISHED'}" ${!enabled && !published ? 'disabled title="Aktifkan Pengumuman Global terlebih dahulu"' : ''}>${published ? 'Jeda' : 'Terbitkan'}</button><button type="button" class="btn btn-secondary btn-sm notification-delete" data-publisher-delete>Hapus</button></div>
      </article>`;
    }).join('');
  }

  async function load(force = false) {
    if (!isActive() || state.loading || (!force && state.loaded)) return;
    state.loading = true;
    render();
    try {
      const [config, notifications] = await Promise.all([call('adminNotificationConfig'), call('listAdminNotifications')]);
      state.config = config || { enabled: false, sppg: [], users: [] };
      state.items = notifications?.items || [];
      state.loaded = true;
    } catch (error) {
      state.loaded = false;
      const root = ensureRoot();
      const message = root?.querySelector('[data-publisher-message]');
      if (message) { message.textContent = error.message; message.className = 'notification-publisher-message is-error'; }
    } finally {
      state.loading = false;
      render();
    }
  }

  function localDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  function options(rows, selected = []) {
    const selectedSet = new Set((selected || []).map(String));
    return rows.map((row) => `<option value="${escapeHtml(row.value)}" ${selectedSet.has(String(row.value)) ? 'selected' : ''}>${escapeHtml(row.label)}</option>`).join('');
  }

  function openEditor(item = null) {
    state.editing = item;
    document.querySelector('.notification-editor-overlay')?.remove();
    const sppgRows = (state.config?.sppg || []).map((row) => ({ value: row.Nama_SPPG, label: row.Yayasan ? `${row.Nama_SPPG} — ${row.Yayasan}` : row.Nama_SPPG }));
    const userRows = (state.config?.users || []).map((row) => ({ value: row.ID_User, label: `${row.Nama_Lengkap} — ${row.SPPG || 'Tanpa SPPG'}` }));
    const overlay = document.createElement('div');
    overlay.className = 'notification-editor-overlay';
    overlay.innerHTML = `<section class="notification-editor" role="dialog" aria-modal="true" aria-labelledby="notification-editor-title">
      <header><div><span class="notification-publisher-eyebrow">PENERBITAN NOTIFIKASI</span><h3 id="notification-editor-title">${item ? 'Edit Pengumuman' : 'Tambah Pengumuman'}</h3></div><button type="button" class="notification-editor-close" aria-label="Tutup">×</button></header>
      <div class="notification-editor-body"><div class="notification-editor-alert" data-editor-alert></div><div class="notification-editor-grid">
        <label class="wide"><span>Judul *</span><input name="title" maxlength="120" value="${escapeHtml(item?.Title || '')}"></label>
        <label class="wide"><span>Isi pengumuman *</span><textarea name="message" maxlength="1000" rows="5">${escapeHtml(item?.Message || '')}</textarea></label>
        <label><span>Prioritas</span><select name="priority"><option>RENDAH</option><option>NORMAL</option><option>TINGGI</option><option>MENDESAK</option></select></label>
        <label><span>Target</span><select name="targetMode"><option value="ALL">Semua pengguna</option><option value="ROLES">Role tertentu</option><option value="SPPG">SPPG tertentu</option><option value="USERS">Pengguna tertentu</option></select></label>
        <label class="wide" data-target="ROLES"><span>Pilih role</span><select name="targetRoles" multiple size="4">${options([{value:'USER',label:'USER'},{value:'ADMIN',label:'ADMIN'},{value:'AKUNTAN',label:'AKUNTAN'},{value:'SUPER ADMIN',label:'SUPER ADMIN'}], item?.Target_Roles)}</select></label>
        <label class="wide" data-target="SPPG"><span>Pilih SPPG</span><select name="targetSppg" multiple size="6">${options(sppgRows, item?.Target_SPPG)}</select></label>
        <label class="wide" data-target="USERS"><span>Cari pengguna</span><input type="search" name="userSearch" placeholder="Cari nama atau SPPG…"><select name="targetUserIds" multiple size="7">${options(userRows, item?.Target_User_IDs)}</select></label>
        <label><span>Mulai tayang</span><input type="datetime-local" name="startsAt" value="${escapeHtml(localDateTime(item?.Starts_At || new Date().toISOString()))}"></label>
        <label><span>Berakhir</span><input type="datetime-local" name="expiresAt" value="${escapeHtml(localDateTime(item?.Expires_At))}"></label>
        <label><span>Arahkan ke menu</span><select name="actionView"><option value="dashboard">Dashboard</option><option value="pengaduan">Pengaduan</option><option value="my-payroll">Payroll Saya</option><option value="admin-absen">Data Absensi</option></select></label>
        <fieldset class="wide"><legend>Tampilan dan pengiriman</legend><label><input type="checkbox" name="showBanner" ${item?.Show_Banner !== false ? 'checked' : ''}> Banner</label><label><input type="checkbox" name="playSound" ${item?.Play_Sound !== false ? 'checked' : ''}> Suara</label><label><input type="checkbox" name="pushEnabled" ${item?.Push_Enabled !== false ? 'checked' : ''}> Push</label></fieldset>
      </div></div>
      <footer><button type="button" class="btn btn-secondary" data-editor-cancel>Batal</button><button type="button" class="btn btn-secondary" data-editor-save="DRAFT">Simpan Draft</button><button type="button" class="btn btn-primary" data-editor-save="PUBLISHED" ${state.config?.enabled ? '' : 'disabled title="Aktifkan Pengumuman Global terlebih dahulu"'}>Terbitkan</button></footer>
    </section>`;
    document.body.appendChild(overlay);
    document.body.classList.add('notification-editor-open');
    overlay.querySelector('[name="priority"]').value = item?.Priority || 'NORMAL';
    overlay.querySelector('[name="targetMode"]').value = item?.Target_Mode || 'ALL';
    overlay.querySelector('[name="actionView"]').value = item?.Action_View || 'dashboard';

    const targetMode = overlay.querySelector('[name="targetMode"]');
    const updateTarget = () => overlay.querySelectorAll('[data-target]').forEach((node) => { node.hidden = node.dataset.target !== targetMode.value; });
    targetMode.addEventListener('change', updateTarget);
    updateTarget();
    overlay.querySelector('[name="userSearch"]').addEventListener('input', (event) => {
      const query = event.target.value.trim().toLowerCase();
      overlay.querySelectorAll('[name="targetUserIds"] option').forEach((option) => { option.hidden = Boolean(query) && !option.textContent.toLowerCase().includes(query); });
    });
    const close = () => { overlay.remove(); document.body.classList.remove('notification-editor-open'); state.editing = null; };
    overlay.querySelector('.notification-editor-close').addEventListener('click', close);
    overlay.querySelector('[data-editor-cancel]').addEventListener('click', close);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    overlay.querySelectorAll('[data-editor-save]').forEach((button) => button.addEventListener('click', () => save(overlay, button.dataset.editorSave, button, close)));
    requestAnimationFrame(() => overlay.querySelector('[name="title"]')?.focus());
  }

  const selected = (select) => [...select.selectedOptions].map((option) => option.value);

  async function save(overlay, status, button, close) {
    const field = (name) => overlay.querySelector(`[name="${name}"]`);
    const alert = overlay.querySelector('[data-editor-alert]');
    const targetMode = field('targetMode').value;
    const payload = {
      id: state.editing?.ID_Notification || null,
      title: field('title').value.trim(),
      message: field('message').value.trim(),
      priority: field('priority').value,
      targetMode,
      targetRoles: selected(field('targetRoles')),
      targetSppg: selected(field('targetSppg')),
      targetUserIds: selected(field('targetUserIds')),
      startsAt: field('startsAt').value ? new Date(field('startsAt').value).toISOString() : new Date().toISOString(),
      expiresAt: field('expiresAt').value ? new Date(field('expiresAt').value).toISOString() : null,
      actionView: field('actionView').value,
      showBanner: field('showBanner').checked,
      playSound: field('playSound').checked,
      pushEnabled: field('pushEnabled').checked,
      status,
    };
    const errorMessage = !payload.title || !payload.message ? 'Judul dan isi pengumuman wajib diisi.'
      : targetMode === 'ROLES' && !payload.targetRoles.length ? 'Pilih minimal satu role.'
      : targetMode === 'SPPG' && !payload.targetSppg.length ? 'Pilih minimal satu SPPG.'
      : targetMode === 'USERS' && !payload.targetUserIds.length ? 'Pilih minimal satu pengguna.'
      : payload.expiresAt && new Date(payload.expiresAt) <= new Date(payload.startsAt) ? 'Waktu berakhir harus setelah waktu mulai.' : '';
    if (errorMessage) { alert.textContent = errorMessage; alert.className = 'notification-editor-alert is-error'; return; }
    button.disabled = true;
    try {
      await call('saveNotification', payload);
      close();
      window.showAlert?.(status === 'PUBLISHED' ? 'Pengumuman berhasil diterbitkan.' : 'Draft berhasil disimpan.', 'success');
      state.loaded = false;
      await load(true);
      window.AbsenOperationalNotifications?.load?.();
    } catch (error) {
      button.disabled = false;
      alert.textContent = error.message;
      alert.className = 'notification-editor-alert is-error';
    }
  }

  async function handleAction(event) {
    const row = event.target.closest('[data-notification-id]');
    if (!row) return;
    const item = state.items.find((entry) => String(entry.ID_Notification) === row.dataset.notificationId);
    if (!item) return;
    if (event.target.closest('[data-publisher-edit]')) { openEditor(item); return; }
    const statusButton = event.target.closest('[data-publisher-status]');
    if (statusButton) {
      const status = statusButton.dataset.publisherStatus;
      const approved = await window.appConfirm({ title: status === 'PUBLISHED' ? 'Terbitkan pengumuman?' : 'Jeda pengumuman?', message: status === 'PUBLISHED' ? 'Pengumuman akan tampil sesuai jadwal dan target.' : 'Pengumuman tidak lagi tampil sampai diterbitkan kembali.', confirmText: status === 'PUBLISHED' ? 'Ya, terbitkan' : 'Ya, jeda', cancelText: 'Tidak', tone: status === 'PUBLISHED' ? 'primary' : 'danger' });
      if (!approved) return;
      statusButton.disabled = true;
      try { await call('setNotificationStatus', { id: item.ID_Notification, status }); window.showAlert?.('Status pengumuman diperbarui.', 'success'); state.loaded = false; await load(true); }
      catch (error) { statusButton.disabled = false; window.showAlert?.(error.message, 'error'); }
      return;
    }
    if (event.target.closest('[data-publisher-delete]')) {
      const approved = await window.appConfirm({ title: 'Hapus pengumuman?', message: `Pengumuman “${item.Title}” akan dihapus dan tidak lagi tampil.`, confirmText: 'Ya, hapus', cancelText: 'Tidak', tone: 'danger' });
      if (!approved) return;
      try { await call('deleteNotification', { id: item.ID_Notification }); window.showAlert?.('Pengumuman berhasil dihapus.', 'success'); state.loaded = false; await load(true); }
      catch (error) { window.showAlert?.(error.message, 'error'); }
    }
  }

  function schedule(force = false, delay = 80) {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      if (!isActive()) { document.getElementById('notification-publisher-root')?.remove(); return; }
      ensureRoot();
      load(force);
    }, delay);
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-setting-tab="notification"],[data-sa-system-tab="notification"]')) { state.loaded = false; schedule(true); }
    if (event.target.closest('[data-setting-key="notification.global_announcement"]')) { state.loaded = false; schedule(true, 750); }
  });
  window.addEventListener('absen:app-ready', () => schedule(true, 250));
  window.addEventListener('absen:session-changed', () => { state.loaded = false; schedule(true, 250); });
  window.addEventListener('hashchange', () => schedule(false));
  new MutationObserver(() => schedule(false, 120)).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => schedule(true, 250), { once: true });
  else schedule(true, 250);
  window.NotificationPublisher = Object.freeze({ load: () => load(true), open: () => openEditor(), sync: () => schedule(true) });
})();
