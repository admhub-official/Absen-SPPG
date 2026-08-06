(() => {
  const endpoint = `${window.ABSEN_SUPABASE_CONFIG.projectUrl}/functions/v1/ConfigCenter`;
  const state = {
    admin: null,
    lastFocused: null,
    previousBodyOverflow: '',
  };

  const token = () => localStorage.getItem('auth_token');
  const user = () => {
    try { return JSON.parse(localStorage.getItem('auth_user') || 'null'); }
    catch { return null; }
  };
  const role = () => String(user()?.role || user()?.Role || '').toUpperCase().replace(/_/g, ' ').trim();
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const normalize = (value) => String(value || '').trim().toUpperCase().replace(/_/g, ' ').replace(/\s+/g, ' ');

  async function call(action, payload = {}) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token: token(), ...payload })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) throw new Error(body.message || 'Proses gagal.');
    return body.result;
  }

  function policies() {
    return Array.isArray(state.admin?.policies) ? state.admin.policies : [];
  }

  function globalEnabled() {
    const policy = policies().find((item) => normalize(item.Scope_Type) === 'GLOBAL');
    return policy ? Boolean(policy.Enabled) : true;
  }

  function sppgPolicy(name) {
    const key = normalize(name);
    return policies().find((item) => normalize(item.Scope_Type) === 'SPPG' && normalize(item.SPPG) === key) || null;
  }

  function userPolicy(id) {
    return policies().find((item) => normalize(item.Scope_Type) === 'USER' && String(item.ID_User || '') === String(id || '')) || null;
  }

  function effectiveSppgEnabled(name) {
    const policy = sppgPolicy(name);
    return policy ? Boolean(policy.Enabled) : globalEnabled();
  }

  function effectiveUserEnabled(item) {
    const policy = userPolicy(item.ID_User);
    return policy ? Boolean(policy.Enabled) : effectiveSppgEnabled(item.SPPG);
  }

  function statusBadge(enabled, source) {
    return `<span class="cc-status-badge ${enabled ? 'is-enabled' : 'is-disabled'}">${enabled ? 'Aktif' : 'Nonaktif'}</span><small>${esc(source)}</small>`;
  }

  function ensureAdminMenu() {
    document.querySelectorAll('[data-config-center-menu]').forEach((node) => node.remove());
    if (role() !== 'SUPER ADMIN' || !token()) return;

    const nav = document.querySelector('.app-nav');
    if (nav) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'app-nav-item';
      button.dataset.configCenterMenu = 'desktop';
      button.innerHTML = '<span aria-hidden="true">⚙️</span><span>Konfigurasi Absensi</span>';
      button.addEventListener('click', openAdmin);
      nav.appendChild(button);
    }

    const mobile = document.querySelector('#mobile-more-menu');
    if (mobile) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mobile-more-menu-item';
      button.dataset.configCenterMenu = 'mobile';
      button.textContent = '⚙️ Konfigurasi Absensi';
      button.addEventListener('click', () => {
        mobile.classList.remove('active');
        openAdmin();
      });
      mobile.appendChild(button);
    }
  }

  function faceTab() {
    const sppg = Array.isArray(state.admin?.sppg) ? state.admin.sppg : [];
    const activeCount = sppg.filter((item) => effectiveSppgEnabled(item.Nama_SPPG)).length;
    const inactiveCount = sppg.length - activeCount;
    const defaultEnabled = globalEnabled();

    const sppgRows = sppg.map((item) => {
      const name = String(item.Nama_SPPG || '').trim();
      const policy = sppgPolicy(name);
      const enabled = policy ? Boolean(policy.Enabled) : defaultEnabled;
      const source = policy ? 'Aturan khusus SPPG' : `Mengikuti global: ${defaultEnabled ? 'Aktif' : 'Nonaktif'}`;
      return `<label class="cc-option" data-cc-sppg-row data-search="${esc(name.toLowerCase())}">
        <input type="checkbox" data-cc-sppg value="${esc(name)}" aria-label="Pilih ${esc(name)}">
        <span class="cc-option-main"><strong>${esc(name)}</strong>${item.Yayasan ? `<small>${esc(item.Yayasan)}</small>` : ''}</span>
        <span class="cc-option-status">${statusBadge(enabled, source)}</span>
      </label>`;
    }).join('') || '<div class="cc-empty-state">Belum ada SPPG yang tersedia.</div>';

    return `<div class="cc-summary" aria-label="Ringkasan konfigurasi scan wajah">
      <div><span class="cc-summary-label">Default global</span><strong>${defaultEnabled ? 'Scan wajah aktif' : 'Scan wajah nonaktif'}</strong></div>
      <div><span class="cc-summary-label">SPPG aktif</span><strong>${activeCount}</strong></div>
      <div><span class="cc-summary-label">SPPG nonaktif</span><strong>${inactiveCount}</strong></div>
      <p>Aturan karyawan memiliki prioritas tertinggi, lalu aturan SPPG, kemudian default global.</p>
    </div>
    <div class="cc-grid">
      <section class="cc-card" aria-labelledby="cc-sppg-heading">
        <div class="cc-card-header">
          <div><h3 id="cc-sppg-heading">Aturan per SPPG</h3><p>Aktifkan atau nonaktifkan absensi dengan scan wajah untuk SPPG terpilih.</p></div>
          <span class="cc-selection-pill" id="cc-sppg-selection-count">0 dipilih</span>
        </div>
        <div class="cc-list-toolbar">
          <label class="cc-search"><span class="sr-only">Cari SPPG</span><input id="cc-sppg-search" type="search" placeholder="Cari SPPG..." autocomplete="off"></label>
          <button type="button" class="cc-button cc-button-secondary" data-cc-select-visible>Pilih yang tampil</button>
          <button type="button" class="cc-button cc-button-ghost" data-cc-clear-sppg>Hapus pilihan</button>
        </div>
        <div class="cc-list cc-sppg-list" id="cc-sppg-list">${sppgRows}</div>
        <div class="cc-action-bar">
          <div><strong>Terapkan ke SPPG terpilih</strong><small>Perubahan langsung dipakai saat pengguna membuka fitur Absen.</small></div>
          <div class="cc-actions">
            <button type="button" class="cc-button cc-button-success" data-cc-sppg-on disabled>Aktifkan scan wajah</button>
            <button type="button" class="cc-button cc-button-danger" data-cc-sppg-off disabled>Nonaktifkan scan wajah</button>
          </div>
        </div>
      </section>

      <section class="cc-card" aria-labelledby="cc-user-heading">
        <div class="cc-card-header">
          <div><h3 id="cc-user-heading">Pengecualian per Karyawan</h3><p>Gunakan hanya bila seorang karyawan perlu aturan berbeda dari SPPG-nya.</p></div>
          <span class="cc-selection-pill" id="cc-user-selection-count">0 dipilih</span>
        </div>
        <label class="cc-field"><span>Pilih SPPG</span><select id="cc-user-sppg"><option value="">Pilih SPPG untuk melihat karyawan</option>${sppg.map((item) => `<option value="${esc(item.Nama_SPPG)}">${esc(item.Nama_SPPG)}</option>`).join('')}</select></label>
        <div class="cc-list-toolbar">
          <button type="button" class="cc-button cc-button-secondary" data-cc-select-all-users disabled>Pilih semua</button>
          <button type="button" class="cc-button cc-button-ghost" data-cc-clear-users disabled>Hapus pilihan</button>
        </div>
        <div id="cc-user-list" class="cc-list cc-user-list"><div class="cc-empty-state">Pilih SPPG untuk melihat karyawan aktif.</div></div>
        <div class="cc-action-bar">
          <div><strong>Terapkan pengecualian</strong><small>Aturan ini mengalahkan aturan SPPG dan global.</small></div>
          <div class="cc-actions">
            <button type="button" class="cc-button cc-button-success" data-cc-user-on disabled>Aktifkan scan wajah</button>
            <button type="button" class="cc-button cc-button-danger" data-cc-user-off disabled>Nonaktifkan scan wajah</button>
          </div>
        </div>
      </section>
    </div>`;
  }

  function closeAdmin() {
    const modal = document.querySelector('.cc-modal');
    if (!modal) return;
    modal.remove();
    document.body.style.overflow = state.previousBodyOverflow;
    document.removeEventListener('keydown', handleAdminKeydown);
    state.lastFocused?.focus?.();
    state.lastFocused = null;
  }

  function handleAdminKeydown(event) {
    if (event.key === 'Escape') closeAdmin();
  }

  async function openAdmin() {
    if (role() !== 'SUPER ADMIN') {
      window.showAlert?.('Akses konfigurasi hanya untuk SUPER ADMIN.', 'error');
      return;
    }

    state.lastFocused = document.activeElement;
    try { state.admin = await call('adminConfig'); }
    catch (error) {
      window.showAlert?.(error.message, 'error');
      return;
    }

    document.querySelector('.cc-modal')?.remove();
    state.previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.insertAdjacentHTML('beforeend', `<div class="cc-modal" data-cc-modal>
      <div class="cc-panel" role="dialog" aria-modal="true" aria-labelledby="cc-modal-title" aria-describedby="cc-modal-description">
        <header class="cc-modal-header">
          <div><span class="cc-eyebrow">SUPER ADMIN</span><h2 id="cc-modal-title">Konfigurasi Absensi</h2><p id="cc-modal-description">Kelola ketersediaan absensi dengan scan wajah berdasarkan SPPG atau karyawan.</p></div>
          <button type="button" class="cc-close-button" data-cc-close aria-label="Tutup konfigurasi"><span aria-hidden="true">×</span></button>
        </header>
        <div id="cc-body">${faceTab()}</div>
      </div>
    </div>`);

    const modal = document.querySelector('.cc-modal');
    modal?.querySelector('[data-cc-close]')?.addEventListener('click', closeAdmin);
    modal?.addEventListener('click', (event) => {
      if (event.target === modal) closeAdmin();
    });
    document.addEventListener('keydown', handleAdminKeydown);
    bindFace();
    modal?.querySelector('[data-cc-close]')?.focus();
  }

  function selectedValues(selector) {
    const modal = document.querySelector('.cc-modal');
    if (!modal) return [];
    return [...modal.querySelectorAll(`${selector}:checked`)].map((node) => node.value || node.dataset.id).filter(Boolean);
  }

  function setModalBusy(busy, message = '') {
    const modal = document.querySelector('.cc-modal');
    if (!modal) return;
    modal.querySelector('.cc-panel')?.setAttribute('aria-busy', String(busy));
    modal.querySelectorAll('button,select,input').forEach((node) => {
      if (busy) {
        node.dataset.ccWasDisabled = String(node.disabled);
        node.disabled = true;
      } else if (node.dataset.ccWasDisabled !== undefined) {
        node.disabled = node.dataset.ccWasDisabled === 'true';
        delete node.dataset.ccWasDisabled;
      }
    });
    let status = modal.querySelector('#cc-save-status');
    if (!status) {
      status = document.createElement('div');
      status.id = 'cc-save-status';
      status.className = 'cc-save-status';
      status.setAttribute('role', 'status');
      modal.querySelector('.cc-modal-header')?.insertAdjacentElement('afterend', status);
    }
    status.textContent = message;
    status.classList.toggle('is-visible', Boolean(message));
  }

  async function saveFace(scope, enabled, extra) {
    const targets = scope === 'SPPG' ? extra.sppg : extra.userIds;
    const label = scope === 'SPPG' ? 'SPPG' : 'karyawan';
    if (!Array.isArray(targets) || targets.length === 0) {
      window.showAlert?.(`Pilih minimal satu ${label} terlebih dahulu.`, 'warning');
      return;
    }

    if (!enabled) {
      const approved = window.confirm(`Nonaktifkan absensi scan wajah untuk ${targets.length} ${label} terpilih?`);
      if (!approved) return;
    }

    setModalBusy(true, `${enabled ? 'Mengaktifkan' : 'Menonaktifkan'} scan wajah untuk ${targets.length} ${label}...`);
    try {
      await call('saveFacePolicy', { scope, enabled, ...extra });
      state.admin = await call('adminConfig');
      const body = document.querySelector('#cc-body');
      if (body) body.innerHTML = faceTab();
      bindFace();
      setModalBusy(false, 'Konfigurasi berhasil diterapkan.');
      window.showAlert?.(`Scan wajah berhasil ${enabled ? 'diaktifkan' : 'dinonaktifkan'} untuk ${targets.length} ${label}.`, 'success');
      window.setTimeout(() => document.querySelector('#cc-save-status')?.classList.remove('is-visible'), 3500);
    } catch (error) {
      setModalBusy(false, 'Perubahan gagal diterapkan.');
      window.showAlert?.(error.message, 'error');
    }
  }

  function renderUsersForSppg(sppgName) {
    const list = document.querySelector('#cc-user-list');
    if (!list) return;
    const users = (state.admin?.users || []).filter((item) => String(item.SPPG || '') === String(sppgName || ''));
    list.innerHTML = users.map((item) => {
      const policy = userPolicy(item.ID_User);
      const enabled = effectiveUserEnabled(item);
      const source = policy ? 'Aturan khusus karyawan' : `Mengikuti SPPG: ${effectiveSppgEnabled(item.SPPG) ? 'Aktif' : 'Nonaktif'}`;
      return `<label class="cc-option">
        <input type="checkbox" data-cc-user data-id="${esc(item.ID_User)}" aria-label="Pilih ${esc(item.Nama_Lengkap)}">
        <span class="cc-option-main"><strong>${esc(item.Nama_Lengkap)}</strong><small>${esc(item.Jabatan_Divisi || 'Jabatan belum diisi')}</small></span>
        <span class="cc-option-status">${statusBadge(enabled, source)}</span>
      </label>`;
    }).join('') || '<div class="cc-empty-state">Tidak ada karyawan aktif pada SPPG ini.</div>';
  }

  function bindFace() {
    const modal = document.querySelector('.cc-modal');
    if (!modal) return;

    const sppgList = modal.querySelector('#cc-sppg-list');
    const sppgCount = modal.querySelector('#cc-sppg-selection-count');
    const sppgOn = modal.querySelector('[data-cc-sppg-on]');
    const sppgOff = modal.querySelector('[data-cc-sppg-off]');
    const search = modal.querySelector('#cc-sppg-search');

    const updateSppgSelection = () => {
      const count = selectedValues('[data-cc-sppg]').length;
      if (sppgCount) sppgCount.textContent = `${count} dipilih`;
      if (sppgOn) sppgOn.disabled = count === 0;
      if (sppgOff) sppgOff.disabled = count === 0;
    };

    sppgList?.querySelectorAll('[data-cc-sppg]').forEach((node) => node.addEventListener('change', updateSppgSelection));
    search?.addEventListener('input', () => {
      const query = String(search.value || '').trim().toLowerCase();
      sppgList?.querySelectorAll('[data-cc-sppg-row]').forEach((row) => {
        row.hidden = query && !String(row.dataset.search || '').includes(query);
      });
    });
    modal.querySelector('[data-cc-select-visible]')?.addEventListener('click', () => {
      sppgList?.querySelectorAll('[data-cc-sppg-row]:not([hidden]) [data-cc-sppg]').forEach((node) => { node.checked = true; });
      updateSppgSelection();
    });
    modal.querySelector('[data-cc-clear-sppg]')?.addEventListener('click', () => {
      sppgList?.querySelectorAll('[data-cc-sppg]').forEach((node) => { node.checked = false; });
      updateSppgSelection();
    });
    sppgOn?.addEventListener('click', () => saveFace('SPPG', true, { sppg: selectedValues('[data-cc-sppg]') }));
    sppgOff?.addEventListener('click', () => saveFace('SPPG', false, { sppg: selectedValues('[data-cc-sppg]') }));

    const select = modal.querySelector('#cc-user-sppg');
    const userList = modal.querySelector('#cc-user-list');
    const userCount = modal.querySelector('#cc-user-selection-count');
    const userOn = modal.querySelector('[data-cc-user-on]');
    const userOff = modal.querySelector('[data-cc-user-off]');
    const selectAllUsers = modal.querySelector('[data-cc-select-all-users]');
    const clearUsers = modal.querySelector('[data-cc-clear-users]');

    const updateUserSelection = () => {
      const count = selectedValues('[data-cc-user]').length;
      if (userCount) userCount.textContent = `${count} dipilih`;
      if (userOn) userOn.disabled = count === 0;
      if (userOff) userOff.disabled = count === 0;
    };

    const bindUserCheckboxes = () => {
      userList?.querySelectorAll('[data-cc-user]').forEach((node) => node.addEventListener('change', updateUserSelection));
      updateUserSelection();
    };

    select?.addEventListener('change', () => {
      renderUsersForSppg(select.value);
      const hasSppg = Boolean(select.value);
      if (selectAllUsers) selectAllUsers.disabled = !hasSppg;
      if (clearUsers) clearUsers.disabled = !hasSppg;
      bindUserCheckboxes();
    });
    selectAllUsers?.addEventListener('click', () => {
      userList?.querySelectorAll('[data-cc-user]').forEach((node) => { node.checked = true; });
      updateUserSelection();
    });
    clearUsers?.addEventListener('click', () => {
      userList?.querySelectorAll('[data-cc-user]').forEach((node) => { node.checked = false; });
      updateUserSelection();
    });
    userOn?.addEventListener('click', () => saveFace('USER', true, { userIds: selectedValues('[data-cc-user]') }));
    userOff?.addEventListener('click', () => saveFace('USER', false, { userIds: selectedValues('[data-cc-user]') }));

    updateSppgSelection();
    updateUserSelection();
  }

  async function checkFaceAvailability() {
    if (!token()) return;
    try {
      const result = await call('getFaceStatus');
      const enabled = Boolean(result.enabled);
      window.FACE_ATTENDANCE_ENABLED = enabled;
      document.documentElement.dataset.faceAttendanceEnabled = String(enabled);
      document.querySelectorAll('[data-view="absen"],#btn-absen,.btn-absen').forEach((node) => {
        if (enabled) {
          if (node.dataset.facePolicyDisabled === 'true') {
            node.removeAttribute('aria-disabled');
            if (node.title === 'Scan wajah dinonaktifkan oleh SUPER ADMIN') node.removeAttribute('title');
            delete node.dataset.facePolicyDisabled;
          }
        } else {
          node.dataset.facePolicyDisabled = 'true';
          node.setAttribute('aria-disabled', 'true');
          node.title = 'Scan wajah dinonaktifkan oleh SUPER ADMIN';
        }
      });
      window.dispatchEvent(new CustomEvent('absen:face-policy-changed', { detail: { enabled } }));
    } catch (error) {
      console.warn('Status scan wajah gagal diperiksa', error);
    }
  }

  function removeNotificationUi() {
    document.querySelectorAll('[data-cc-bell],.cc-bell,.cc-notification-panel,[data-cc-banner],.cc-banner').forEach((node) => node.remove());
  }

  function sync() {
    removeNotificationUi();
    ensureAdminMenu();
    checkFaceAvailability();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync, { once: true });
  else sync();
  window.addEventListener('absen:app-ready', sync);
  window.addEventListener('absen:session-changed', sync);
  window.setInterval(checkFaceAvailability, 60000);
})();
