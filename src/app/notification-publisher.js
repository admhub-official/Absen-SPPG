(() => {
  if (window.NotificationPublisher) return;

  const endpoint = `${window.ABSEN_SUPABASE_CONFIG.projectUrl}/functions/v1/ConfigCenter`;
  const state = { config: null, items: [], loading: false, editing: null, scheduled: false };
  const token = () => localStorage.getItem('auth_token');
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const role = () => { try { const u = JSON.parse(localStorage.getItem('auth_user') || 'null'); return String(u?.role || u?.Role || '').toUpperCase().replace(/_/g, ' ').trim(); } catch { return ''; } };

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

  function activeContext() {
    const view = document.getElementById('view-admin-config');
    const notificationTab = document.querySelector('[data-setting-tab="notification"]');
    return role() === 'SUPER ADMIN'
      && view && !view.classList.contains('hidden') && !view.hidden
      && notificationTab?.classList.contains('active');
  }

  function effectiveStatus(item) {
    if (item.Status !== 'PUBLISHED') return item.Status || 'DRAFT';
    const now = Date.now();
    if (item.Expires_At && new Date(item.Expires_At).getTime() <= now) return 'KEDALUWARSA';
    if (item.Starts_At && new Date(item.Starts_At).getTime() > now) return 'TERJADWAL';
    return 'AKTIF';
  }

  function formatDate(value) {
    if (!value) return 'Tanpa batas';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function targetLabel(item) {
    const mode = String(item.Target_Mode || 'ALL');
    if (mode === 'ALL') return 'Semua pengguna';
    if (mode === 'ROLES') return `Role: ${(item.Target_Roles || []).join(', ') || '-'}`;
    if (mode === 'SPPG') return `SPPG: ${(item.Target_SPPG || []).join(', ') || '-'}`;
    if (mode === 'USERS') return `${(item.Target_User_IDs || []).length} pengguna terpilih`;
    return mode;
  }

  function rootMarkup() {
    return `<section id="notification-publisher-root" class="notification-publisher-root" aria-label="Penerbitan notifikasi">
      <div class="notification-publisher-header">
        <div><span class="notification-publisher-eyebrow">PUSAT PENGATURAN · SISTEM · NOTIFIKASI</span><h3>Penerbitan Notifikasi & Pengumuman</h3><p>Buat, edit, jadwalkan, hentikan, dan hapus pengumuman dari satu tempat.</p></div>
        <div class="notification-publisher-header-actions"><span class="notification-publisher-setting" data-announcement-setting>Memeriksa pengaturan…</span><button type="button" class="btn btn-primary" data-announcement-add>Tambah Pengumuman</button></div>
      </div>
      <div class="notification-publisher-message" data-announcement-message></div>
      <div class="notification-publisher-list" data-announcement-list><div class="notification-publisher-empty">Memuat pengumuman…</div></div>
    </section>`;
  }

  function ensureRoot() {
    if (!activeContext()) {
      document.getElementById('notification-publisher-root')?.remove();
      return null;
    }
    const body = document.getElementById('system-settings-body');
    if (!body) return null;
    let root = document.getElementById('notification-publisher-root');
    if (!root) {
      body.insertAdjacentHTML('afterend', rootMarkup());
      root = document.getElementById('notification-publisher-root');
      root.querySelector('[data-announcement-add]').addEventListener('click', () => openEditor());
      root.addEventListener('click', handleListAction);
    } else if (root.previousElementSibling !== body) {
      body.insertAdjacentElement('afterend', root);
    }
    return root;
  }

  function render() {
    const root = ensureRoot();
    if (!root) return;
    const enabled = Boolean(state.config?.enabled);
    const setting = root.querySelector('[data-announcement-setting]');
    setting.textContent = enabled ? 'Pengumuman global aktif' : 'Pengumuman global nonaktif';
    setting.className = `notification-publisher-setting ${enabled ? 'is-enabled' : 'is-disabled'}`;
    root.querySelector('[data-announcement-add]').title = enabled ? 'Buat pengumuman baru' : 'Pengumuman dapat disimpan sebagai draft; aktifkan Pengumuman Global untuk menerbitkan.';

    const list = root.querySelector('[data-announcement-list]');
    if (state.loading) {
      list.innerHTML = '<div class="notification-publisher-empty">Memuat pengumuman…</div>';
      return;
    }
    if (!state.items.length) {
      list.innerHTML = '<div class="notification-publisher-empty"><strong>Belum ada pengumuman</strong><span>Gunakan tombol Tambah Pengumuman untuk membuat draft atau menerbitkan notifikasi.</span></div>';
      return;
    }
    list.innerHTML = state.items.map((item) => {
      const status = effectiveStatus(item);
      const published = item.Status === 'PUBLISHED';
      return `<article class="notification-publisher-item" data-notification-id="${esc(item.ID_Notification)}">
        <div class="notification-publisher-item-main">
          <div class="notification-publisher-item-title"><strong>${esc(item.Title)}</strong><span class="notification-publisher-status status-${esc(status.toLowerCase())}">${esc(status)}</span></div>
          <p>${esc(item.Message)}</p>
          <div class="notification-publisher-meta"><span>${esc(targetLabel(item))}</span><span>Mulai: ${esc(formatDate(item.Starts_At))}</span><span>Berakhir: ${esc(formatDate(item.Expires_At))}</span></div>
        </div>
        <div class="notification-publisher-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-announcement-edit>Edit</button>
          <button type="button" class="btn btn-secondary btn-sm" data-announcement-status="${published ? 'DRAFT' : 'PUBLISHED'}" ${!enabled && !published ? 'disabled title="Aktifkan Pengumuman Global terlebih dahulu"' : ''}>${published ? 'Jeda' : 'Terbitkan'}</button>
          <button type="button" class="btn btn-secondary btn-sm notification-delete" data-announcement-delete>Hapus</button>
        </div>
      </article>`;
    }).join('');
  }

  async function load() {
    if (!activeContext() || state.loading) return;
    state.loading = true;
    render();
    try {
      const [config, result] = await Promise.all([
        call('adminNotificationConfig'),
        call('listAdminNotifications'),
      ]);
      state.config = config || { enabled: false, sppg: [], users: [] };
      state.items = result?.items || [];
    } catch (error) {
      const root = ensureRoot();
      const message = root?.querySelector('[data-announcement-message]');
      if (message) { message.textContent = error.message; message.className = 'notification-publisher-message is-error'; }
      state.items = [];
    } finally {
      state.loading = false;
      render();
    }
  }

  function toLocalInput(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  function optionList(values, selected = []) {
    const set = new Set((selected || []).map(String));
    return values.map((value) => `<option value="${esc(value.value)}" ${set.has(String(value.value)) ? 'selected' : ''}>${esc(value.label)}</option>`).join('');
  }

  function openEditor(item = null) {
    state.editing = item;
    document.querySelector('.notification-editor-overlay')?.remove();
    const users = (state.config?.users || []).map((user) => ({ value: user.ID_User, label: `${user.Nama_Lengkap} — ${user.SPPG || 'Tanpa SPPG'}` }));
    const sppg = (state.config?.sppg || []).map((row) => ({ value: row.Nama_SPPG, label: row.Yayasan ? `${row.Nama_SPPG} — ${row.Yayasan}` : row.Nama_SPPG }));
    const targetMode = item?.Target_Mode || 'ALL';
    const overlay = document.createElement('div');
    overlay.className = 'notification-editor-overlay';
    overlay.innerHTML = `<section class="notification-editor" role="dialog" aria-modal="true" aria-labelledby="notification-editor-title">
      <header><div><span class="notification-publisher-eyebrow">PENERBITAN NOTIFIKASI</span><h3 id="notification-editor-title">${item ? 'Edit Pengumuman' : 'Tambah Pengumuman'}</h3></div><button type="button" class="notification-editor-close" aria-label="Tutup">×</button></header>
      <div class="notification-editor-body">
        <div class="notification-editor-alert" data-editor-alert></div>
        <div class="notification-editor-grid">
          <label class="wide"><span>Judul *</span><input name="title" maxlength="120" value="${esc(item?.Title || '')}" required></label>
          <label class="wide"><span>Isi pengumuman *</span><textarea name="message" maxlength="1000" rows="5" required>${esc(item?.Message || '')}</textarea></label>
          <label><span>Prioritas</span><select name="priority"><option value="RENDAH">Rendah</option><option value="NORMAL">Normal</option><option value="TINGGI">Tinggi</option><option value="MENDESAK">Mendesak</option></select></label>
          <label><span>Target</span><select name="targetMode"><option value="ALL">Semua pengguna</option><option value="ROLES">Role tertentu</option><option value="SPPG">SPPG tertentu</option><option value="USERS">Pengguna tertentu</option></select></label>
          <label class="wide target-field" data-target-field="ROLES"><span>Pilih role</span><select name="targetRoles" multiple size="4">${optionList([{value:'USER',label:'USER'},{value:'ADMIN',label:'ADMIN'},{value:'AKUNTAN',label:'AKUNTAN'},{value:'SUPER ADMIN',label:'SUPER ADMIN'}], item?.Target_Roles)}</select></label>
          <label class="wide target-field" data-target-field="SPPG"><span>Pilih SPPG</span><select name="targetSppg" multiple size="6">${optionList(sppg, item?.Target_SPPG)}</select></label>
          <label class="wide target-field" data-target-field="USERS"><span>Cari pengguna</span><input type="search" name="userSearch" placeholder="Cari nama atau SPPG…"><select name="targetUserIds" multiple size="7">${optionList(users, item?.Target_User_IDs)}</select></label>
          <label><span>Mulai tayang</span><input type="datetime-local" name="startsAt" value="${esc(toLocalInput(item?.Starts_At || new Date().toISOString()))}"></label>
          <label><span>Berakhir</span><input type="datetime-local" name="expiresAt" value="${esc(toLocalInput(item?.Expires_At))}"></label>
          <label><span>Arahkan ke menu</span><select name="actionView"><option value="dashboard">Dashboard</option><option value="pengaduan">Pengaduan</option><option value="my-payroll">Payroll Saya</option><option value="admin-absen">Data Absensi</option></select></label>
          <fieldset class="wide"><legend>Tampilan dan pengiriman</legend><label><input type="checkbox" name="showBanner" ${item?.Show_Banner !== false ? 'checked' : ''}> Tampilkan banner</label><label><input type="checkbox" name="playSound" ${item?.Play_Sound !== false ? 'checked' : ''}> Putar suara</label><label><input type="checkbox" name="pushEnabled" ${item?.Push_Enabled !== false ? 'checked' : ''}> Aktifkan push</label></fieldset>
        </div>
      </div>
      <footer><button type="button" class="btn btn-secondary" data-editor-cancel>Batal</button><button type="button" class="btn btn-secondary" data-editor-save="DRAFT">Simpan Draft</button><button type="button" class="btn btn-primary" data-editor-save="PUBLISHED" ${state.config?.enabled ? '' : 'disabled title="Aktifkan Pengumuman Global terlebih dahulu"'}>Terbitkan</button></footer>
    </section>`;
    document.body.appendChild(overlay);
    document.body.classList.add('notification-editor-open');
    const priority = overlay.querySelector('[name="priority"]'); priority.value = item?.Priority || 'NORMAL';
    const mode = overlay.querySelector('[name="targetMode"]'); mode.value = targetMode;
    const action = overlay.querySelector('[name="actionView"]'); action.value = item?.Action_View || 'dashboard';

    const updateTarget = () => overlay.querySelectorAll('[data-target-field]').forEach((field) => { field.hidden = field.dataset.targetField !== mode.value; });
    mode.addEventListener('change', updateTarget); updateTarget();
    const userSearch = overlay.querySelector('[name="userSearch"]');
    userSearch?.addEventListener('input', () => {
      const query = userSearch.value.trim().toLowerCase();
      overlay.querySelectorAll('[name="targetUserIds"] option').forEach((option) => { option.hidden = Boolean(query) && !option.textContent.toLowerCase().includes(query); });
    });
    const close = () => { overlay.remove(); document.body.classList.remove('notification-editor-open'); state.editing = null; };
    overlay.querySelector('.notification-editor-close').addEventListener('click', close);
    overlay.querySelector('[data-editor-cancel]').addEventListener('click', close);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    overlay.querySelectorAll('[data-editor-save]').forEach((button) => button.addEventListener('click', () => saveEditor(overlay, button.dataset.editorSave, close, button)));
    window.requestAnimationFrame(() => overlay.querySelector('[name="title"]')?.focus());
  }

  function selected(select) { return [...select.selectedOptions].map((option) => option.value); }

  async function saveEditor(overlay, status, close, button) {
    const value = (name) => overlay.querySelector(`[name="${name}"]`);
    const title = value('title').value.trim();
    const message = value('message').value.trim();
    const targetMode = value('targetMode').value;
    const alert = overlay.querySelector('[data-editor-alert]');
    if (!title || !message) { alert.textContent = 'Judul dan isi pengumuman wajib diisi.'; alert.className = 'notification-editor-alert is-error'; return; }
    const payload = {
      id: state.editing?.ID_Notification || null,
      title, message,
      priority: value('priority').value,
      targetMode,
      targetRoles: selected(value('targetRoles')),
      targetSppg: selected(value('targetSppg')),
      targetUserIds: selected(value('targetUserIds')),
      startsAt: value('startsAt').value ? new Date(value('startsAt').value).toISOString() : new Date().toISOString(),
      expiresAt: value('expiresAt').value ? new Date(value('expiresAt').value).toISOString() : null,
      actionView: value('actionView').value,
      showBanner: value('showBanner').checked,
      playSound: value('playSound').checked,
      pushEnabled: value('pushEnabled').checked,
      status,
    };
    if (targetMode === 'ROLES' && !payload.targetRoles.length) { alert.textContent = 'Pilih minimal satu role.'; alert.className = 'notification-editor-alert is-error'; return; }
    if (targetMode === 'SPPG' && !payload.targetSppg.length) { alert.textContent = 'Pilih minimal satu SPPG.'; alert.className = 'notification-editor-alert is-error'; return; }
    if (targetMode === 'USERS' && !payload.targetUserIds.length) { alert.textContent = 'Pilih minimal satu pengguna.'; alert.className = 'notification-editor-alert is-error'; return; }
    if (payload.expiresAt && new Date(payload.expiresAt) <= new Date(payload.startsAt)) { alert.textContent = 'Waktu berakhir harus setelah waktu mulai.'; alert.className = 'notification-editor-alert is-error'; return; }
    button.disabled = true;
    try {
      await call('saveNotification', payload);
      close();
      window.showAlert?.(status === 'PUBLISHED' ? 'Pengumuman berhasil diterbitkan.' : 'Draft pengumuman berhasil disimpan.', 'success');
      await load();
      window.AbsenOperationalNotifications?.load?.();
    } catch (error) {
      button.disabled = false;
      alert.textContent = error.message;
      alert.className = 'notification-editor-alert is-error';
    }
  }

  async function handleListAction(event) {
    const itemNode = event.target.closest('[data-notification-id]');
    if (!itemNode) return;
    const item = state.items.find((row) => String(row.ID_Notification) === itemNode.dataset.notificationId);
    if (!item) return;
    if (event.target.closest('[data-announcement-edit]')) { openEditor(item); return; }
    const statusButton = event.target.closest('[data-announcement-status]');
    if (statusButton) {
      const status = statusButton.dataset.announcementStatus;
      const approved = await window.appConfirm?.({
        title: status === 'PUBLISHED' ? 'Terbitkan pengumuman?' : 'Jeda pengumuman?',
        message: status === 'PUBLISHED' ? 'Pengumuman akan mulai tampil sesuai jadwal dan target.' : 'Pengumuman tidak lagi tampil sampai diterbitkan kembali.',
        confirmText: status === 'PUBLISHED' ? 'Ya, terbitkan' : 'Ya, jeda',
        cancelText: 'Tidak',
        tone: status === 'PUBLISHED' ? 'primary' : 'danger',
      });
      if (!approved) return;
      statusButton.disabled = true;
      try { await call('setNotificationStatus', { id: item.ID_Notification, status }); window.showAlert?.('Status pengumuman diperbarui.', 'success'); await load(); }
      catch (error) { statusButton.disabled = false; window.showAlert?.(error.message, 'error'); }
      return;
    }
    if (event.target.closest('[data-announcement-delete]')) {
      const approved = await window.appConfirm?.({ title: 'Hapus pengumuman?', message: `Pengumuman “${item.Title}” akan dihapus dari daftar dan tidak lagi ditampilkan.`, confirmText: 'Ya, hapus', cancelText: 'Tidak', tone: 'danger' });
      if (!approved) return;
      try { await call('deleteNotification', { id: item.ID_Notification }); window.showAlert?.('Pengumuman berhasil dihapus.', 'success'); await load(); }
      catch (error) { window.showAlert?.(error.message, 'error'); }
    }
  }

  function schedule() {
    if (state.scheduled) return;
    state.scheduled = true;
    window.requestAnimationFrame(() => {
      state.scheduled = false;
      if (activeContext()) { ensureRoot(); load(); }
      else document.getElementById('notification-publisher-root')?.remove();
    });
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-setting-tab="notification"],[data-sa-system-tab="notification"]')) window.setTimeout(schedule, 40);
    if (event.target.closest('[data-setting-key="notification.global_announcement"]')) window.setTimeout(() => { state.config = null; schedule(); }, 500);
  });
  window.addEventListener('absen:app-ready', schedule);
  window.addEventListener('absen:session-changed', schedule);
  window.addEventListener('hashchange', schedule);
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true }); else schedule();
  window.NotificationPublisher = Object.freeze({ load, open: () => openEditor(), sync: schedule });
})();
