(() => {
  const endpoint = `${window.ABSEN_SUPABASE_CONFIG.projectUrl}/functions/v1/ConfigCenter`;
  const state = { admin: null };
  const token = () => localStorage.getItem('auth_token');
  const user = () => {
    try { return JSON.parse(localStorage.getItem('auth_user') || 'null'); }
    catch { return null; }
  };
  const role = () => String(user()?.role || user()?.Role || '').toUpperCase().replace(/_/g, ' ').trim();
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

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

  function ensureAdminMenu() {
    document.querySelectorAll('[data-config-center-menu]').forEach((node) => node.remove());
    if (role() !== 'SUPER ADMIN' || !token()) return;
    const nav = document.querySelector('.app-nav');
    if (nav) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'app-nav-item';
      button.dataset.configCenterMenu = 'desktop';
      button.innerHTML = '<span>⚙️</span><span>Konfigurasi Absensi</span>';
      button.onclick = openAdmin;
      nav.appendChild(button);
    }
    const mobile = document.querySelector('#mobile-more-menu');
    if (mobile) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mobile-more-menu-item';
      button.dataset.configCenterMenu = 'mobile';
      button.textContent = '⚙️ Konfigurasi Absensi';
      button.onclick = () => {
        mobile.classList.remove('active');
        openAdmin();
      };
      mobile.appendChild(button);
    }
  }

  function faceTab() {
    const sppg = state.admin?.sppg || [];
    return `<div class="cc-grid"><section class="cc-card"><h3>Aturan per SPPG</h3><p>Pilih satu atau beberapa SPPG lalu aktifkan/nonaktifkan scan wajah.</p><div class="cc-list">${sppg.map((item) => `<label><input type="checkbox" data-cc-sppg value="${esc(item.Nama_SPPG)}"> ${esc(item.Nama_SPPG)}</label>`).join('')}</div><div class="cc-actions"><button data-cc-sppg-on>Aktifkan</button><button data-cc-sppg-off>Nonaktifkan</button></div></section><section class="cc-card"><h3>Aturan per Karyawan</h3><select id="cc-user-sppg"><option value="">Pilih SPPG</option>${sppg.map((item) => `<option>${esc(item.Nama_SPPG)}</option>`).join('')}</select><div class="cc-actions"><button data-cc-select-all>Pilih semua</button><button data-cc-clear-all>Hapus pilihan</button></div><div id="cc-user-list" class="cc-list"><em>Pilih SPPG untuk melihat karyawan.</em></div><div class="cc-actions"><button data-cc-user-on>Aktifkan</button><button data-cc-user-off>Nonaktifkan</button></div></section></div>`;
  }

  async function openAdmin() {
    try { state.admin = await call('adminConfig'); }
    catch (error) {
      window.showAlert?.(error.message, 'error');
      return;
    }
    document.querySelector('.cc-modal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="cc-modal"><div class="cc-panel"><header><div><h2>Konfigurasi Absensi</h2><p>Khusus SUPER ADMIN</p></div><button data-cc-close>✕</button></header><div id="cc-body">${faceTab()}</div></div></div>`);
    bindAdmin();
  }

  function selectedValues(selector) {
    return [...document.querySelectorAll(`${selector}:checked`)].map((node) => node.value || node.dataset.id);
  }

  async function saveFace(scope, enabled, extra) {
    try {
      await call('saveFacePolicy', { scope, enabled, ...extra });
      window.showAlert?.('Konfigurasi scan wajah tersimpan.', 'success');
      state.admin = await call('adminConfig');
    } catch (error) {
      window.showAlert?.(error.message, 'error');
    }
  }

  function bindAdmin() {
    const modal = document.querySelector('.cc-modal');
    if (!modal) return;
    modal.querySelector('[data-cc-close]')?.addEventListener('click', () => modal.remove());
    bindFace();
  }

  function bindFace() {
    const sppgOn = document.querySelector('[data-cc-sppg-on]');
    const sppgOff = document.querySelector('[data-cc-sppg-off]');
    const userOn = document.querySelector('[data-cc-user-on]');
    const userOff = document.querySelector('[data-cc-user-off]');
    const select = document.querySelector('#cc-user-sppg');
    const list = document.querySelector('#cc-user-list');
    sppgOn?.addEventListener('click', () => saveFace('SPPG', true, { sppg: selectedValues('[data-cc-sppg]') }));
    sppgOff?.addEventListener('click', () => saveFace('SPPG', false, { sppg: selectedValues('[data-cc-sppg]') }));
    select?.addEventListener('change', () => {
      const users = (state.admin?.users || []).filter((item) => item.SPPG === select.value);
      list.innerHTML = users.map((item) => `<label><input type="checkbox" data-cc-user data-id="${esc(item.ID_User)}"> <span>${esc(item.Nama_Lengkap)}<small>${esc(item.Jabatan_Divisi || '')}</small></span></label>`).join('') || '<em>Tidak ada karyawan aktif.</em>';
    });
    document.querySelector('[data-cc-select-all]')?.addEventListener('click', () => list?.querySelectorAll('[data-cc-user]').forEach((node) => { node.checked = true; }));
    document.querySelector('[data-cc-clear-all]')?.addEventListener('click', () => list?.querySelectorAll('[data-cc-user]').forEach((node) => { node.checked = false; }));
    userOn?.addEventListener('click', () => saveFace('USER', true, { userIds: selectedValues('[data-cc-user]') }));
    userOff?.addEventListener('click', () => saveFace('USER', false, { userIds: selectedValues('[data-cc-user]') }));
  }

  async function checkFaceAvailability() {
    if (!token()) return;
    try {
      const result = await call('getFaceStatus');
      window.FACE_ATTENDANCE_ENABLED = result.enabled;
      document.documentElement.dataset.faceAttendanceEnabled = String(result.enabled);
      if (!result.enabled) {
        document.querySelectorAll('[data-view="absen"],#btn-absen,.btn-absen').forEach((node) => {
          node.setAttribute('aria-disabled', 'true');
          node.title = 'Scan wajah dinonaktifkan oleh SUPER ADMIN';
        });
      }
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