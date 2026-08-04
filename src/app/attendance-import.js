(() => {
  const endpoint = `${window.ABSEN_SUPABASE_CONFIG.projectUrl}/functions/v1/AttendanceImport`;
  const state = { config: null, preview: null, file: null };
  const token = () => localStorage.getItem('auth_token');
  const currentUser = () => { try { return JSON.parse(localStorage.getItem('auth_user') || 'null'); } catch { return null; } };
  const role = () => String(currentUser()?.role || currentUser()?.Role || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const allowedLocalRole = () => ['SUPER ADMIN', 'ADMIN', 'AKUNTAN'].includes(role());
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalize = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

  async function call(action, payload = {}) {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, token: token(), ...payload }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) throw new Error(body.message || 'Proses upload absensi gagal.');
    return body.result;
  }

  const readBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  function ensureMenus() {
    document.querySelectorAll('[data-attendance-import-menu]').forEach((node) => node.remove());
    if (!token() || !allowedLocalRole()) return;
    const desktop = document.querySelector('.app-nav');
    if (desktop) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'app-nav-item attendance-import-nav-item';
      button.dataset.attendanceImportMenu = 'desktop'; button.style.display = '';
      button.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14a2 2 0 0 0 2-2v-4"/><path d="M3 15v4a2 2 0 0 0 2 2"/></svg><span>Upload Data Absensi</span>';
      button.onclick = open;
      desktop.insertBefore(button, desktop.querySelector('[data-view="admin-config"]') || null);
    }
    const mobile = document.querySelector('#mobile-more-menu');
    if (mobile) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'mobile-more-menu-item';
      button.dataset.attendanceImportMenu = 'mobile'; button.style.display = '';
      button.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14a2 2 0 0 0 2-2v-4"/><path d="M3 15v4a2 2 0 0 0 2 2"/></svg>Upload Data Absensi';
      button.onclick = () => { mobile.classList.remove('active'); open(); };
      mobile.insertBefore(button, mobile.querySelector('[data-view="admin-config"]') || null);
    }
  }

  function accountList(employee) {
    const byId = new Map();
    (state.preview?.accounts || []).forEach((user) => byId.set(user.ID_User, { ...user, confidence: 0 }));
    (employee.suggestions || []).forEach((user) => byId.set(user.ID_User, { ...byId.get(user.ID_User), ...user }));
    return [...byId.values()].sort((a, b) => (b.confidence || 0) - (a.confidence || 0) || String(a.Nama_Lengkap).localeCompare(String(b.Nama_Lengkap), 'id'));
  }

  function selectedLabel(employee) {
    const selected = new Set(employee.targetUserIds || []);
    const names = accountList(employee).filter((user) => selected.has(user.ID_User)).map((user) => user.Nama_Lengkap);
    if (!names.length) return 'Pilih akun tujuan';
    if (names.length === 1) return names[0];
    return `${names.length} akun dipilih`;
  }

  function accountDropdown(employee, index) {
    const selected = new Set(employee.targetUserIds || []);
    const accounts = accountList(employee);
    if (!accounts.length) return '<em>Tidak ada akun aktif pada SPPG ini.</em>';
    return `<div class="attendance-account-picker" data-account-picker="${index}">
      <button type="button" class="attendance-account-trigger" aria-expanded="false">
        <span data-selected-label>${esc(selectedLabel(employee))}</span><span aria-hidden="true">▾</span>
      </button>
      <div class="attendance-account-menu" hidden>
        <div class="attendance-account-search-wrap"><input type="search" class="attendance-account-search" placeholder="Cari nama akun..." autocomplete="off"></div>
        <div class="attendance-account-options">
          ${accounts.map((user) => `<label class="attendance-account-option" data-name="${esc(normalize(user.Nama_Lengkap))}">
            <input type="checkbox" data-user-id="${esc(user.ID_User)}" ${selected.has(user.ID_User) ? 'checked' : ''}>
            <span><strong>${esc(user.Nama_Lengkap)}</strong>${user.Jabatan_Divisi ? `<small>${esc(user.Jabatan_Divisi)}</small>` : ''}</span>
            ${(user.confidence || 0) > 0 ? `<b>${Math.round(user.confidence * 100)}%</b>` : ''}
          </label>`).join('')}
        </div>
        <div class="attendance-account-picker-foot"><button type="button" data-clear-account>Pilih ulang</button><button type="button" data-close-account>Selesai</button></div>
      </div>
    </div>`;
  }

  function updateRowStatus(row, employee) {
    const status = row.querySelector('[data-row-status]');
    const mode = employee.mappingMode;
    const count = (employee.targetUserIds || []).length;
    employee.needsReview = mode !== 'IGNORE' && (count === 0 || (mode === 'COPY_TO_MULTIPLE' && count < 2));
    status.textContent = employee.needsReview ? (mode === 'COPY_TO_MULTIPLE' && count === 1 ? 'Pilih minimal 2 akun' : 'Perlu ditinjau') : 'Siap';
    status.className = employee.needsReview ? 'attendance-status-review' : 'attendance-status-ready';
  }

  function bindAccountPicker(row, employee) {
    const picker = row.querySelector('.attendance-account-picker');
    if (!picker) return;
    const trigger = picker.querySelector('.attendance-account-trigger');
    const menu = picker.querySelector('.attendance-account-menu');
    const search = picker.querySelector('.attendance-account-search');
    const label = picker.querySelector('[data-selected-label]');
    const boxes = [...picker.querySelectorAll('[data-user-id]')];
    const syncSelection = (changedBox = null) => {
      if (employee.mappingMode === 'SINGLE' && changedBox?.checked) boxes.forEach((box) => { if (box !== changedBox) box.checked = false; });
      employee.targetUserIds = boxes.filter((box) => box.checked).map((box) => box.dataset.userId);
      if (employee.targetUserIds.length > 1 && employee.mappingMode !== 'COPY_TO_MULTIPLE') {
        employee.mappingMode = 'COPY_TO_MULTIPLE';
        row.querySelector('[data-field="mappingMode"]').value = 'COPY_TO_MULTIPLE';
      }
      label.textContent = selectedLabel(employee);
      updateRowStatus(row, employee);
    };
    trigger.onclick = (event) => {
      event.stopPropagation();
      document.querySelectorAll('.attendance-account-menu:not([hidden])').forEach((other) => { if (other !== menu) other.hidden = true; });
      menu.hidden = !menu.hidden; trigger.setAttribute('aria-expanded', String(!menu.hidden));
      if (!menu.hidden) setTimeout(() => search.focus(), 0);
    };
    menu.onclick = (event) => event.stopPropagation();
    boxes.forEach((box) => box.onchange = () => syncSelection(box));
    search.oninput = () => {
      const query = normalize(search.value);
      picker.querySelectorAll('.attendance-account-option').forEach((option) => { option.hidden = Boolean(query) && !option.dataset.name.includes(query); });
    };
    picker.querySelector('[data-clear-account]').onclick = () => { boxes.forEach((box) => { box.checked = false; }); syncSelection(); };
    picker.querySelector('[data-close-account]').onclick = () => { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
  }

  function renderRows() {
    const tbody = document.querySelector('#attendance-import-rows');
    if (!tbody || !state.preview) return;
    tbody.innerHTML = state.preview.employees.map((employee, index) => `<tr data-index="${index}">
      <td><strong>${esc(employee.sourceName)}</strong><br><small>ID ${esc(employee.machineId)} · ${esc(employee.department)}</small></td>
      <td>${employee.attendance.length} hari<br>${employee.attendance.reduce((n,d)=>n+d.scans.length,0)} scan</td>
      <td><select data-field="mappingMode"><option value="SINGLE" ${employee.mappingMode==='SINGLE'?'selected':''}>Satu akun</option><option value="COPY_TO_MULTIPLE" ${employee.mappingMode==='COPY_TO_MULTIPLE'?'selected':''}>Salin ke beberapa akun</option><option value="SPLIT_BY_DATE" ${employee.mappingMode==='SPLIT_BY_DATE'?'selected':''}>Bagi per tanggal</option><option value="IGNORE" ${employee.mappingMode==='IGNORE'?'selected':''}>Abaikan</option></select></td>
      <td class="attendance-import-targets">${accountDropdown(employee, index)}</td>
      <td data-row-status></td>
    </tr>`).join('');
    tbody.querySelectorAll('tr').forEach((row) => {
      const employee = state.preview.employees[Number(row.dataset.index)];
      const modeSelect = row.querySelector('[data-field="mappingMode"]');
      bindAccountPicker(row, employee);
      modeSelect.onchange = (event) => {
        employee.mappingMode = event.target.value;
        const picker = row.querySelector('.attendance-account-picker');
        if (employee.mappingMode === 'IGNORE') picker.style.display = 'none';
        else {
          picker.style.display = '';
          if (employee.mappingMode === 'SINGLE' && employee.targetUserIds.length > 1) {
            employee.targetUserIds = employee.targetUserIds.slice(0, 1);
            renderRows(); return;
          }
        }
        updateRowStatus(row, employee);
      };
      if (employee.mappingMode === 'IGNORE') row.querySelector('.attendance-account-picker').style.display = 'none';
      updateRowStatus(row, employee);
    });
  }

  function message(text, type = 'error') {
    const node = document.querySelector('#attendance-import-message');
    if (node) { node.className = `attendance-import-${type}`; node.textContent = text; }
  }

  async function open() {
    if (!token() || !allowedLocalRole()) return;
    try { state.config = await call('config'); }
    catch (error) { window.showAlert?.(`Upload Data Absensi: ${error.message}`, 'error'); return; }
    if (!state.config?.roleConfig?.Menu_Enabled || !state.config?.roleConfig?.Can_Upload) { window.showAlert?.('Role ini belum diizinkan mengunggah data absensi.', 'warning'); return; }
    if (document.querySelector('.attendance-import-modal')) return;
    const scopes = state.config.scopes || [];
    document.body.insertAdjacentHTML('beforeend', `<div class="attendance-import-modal"><section class="attendance-import-panel"><div class="attendance-import-head"><div><h2>Upload Data Absensi</h2><p>Unggah file mesin absensi, cocokkan nama, lalu masukkan ke akun terkait.</p></div><button type="button" data-close>✕</button></div><div id="attendance-import-message"></div><div class="attendance-import-grid"><label>SPPG<select id="attendance-import-sppg">${scopes.map((s)=>`<option value="${esc(s.SPPG)}">${esc(s.SPPG)}</option>`).join('')}</select></label><label>File Excel<input id="attendance-import-file" type="file" accept=".xlsx,.xls"></label><label>Kebijakan data sama<select id="attendance-import-duplicate"><option value="SKIP">Lewati data yang sama</option><option value="REPLACE">Perbarui data impor lama</option>${state.config.roleConfig.Can_Force_Duplicate?'<option value="FORCE">Tetap masukkan</option>':''}</select></label></div><div class="attendance-import-actions"><label><input id="attendance-import-save-mapping" type="checkbox" ${state.config.roleConfig.Can_Save_Mapping?'':'disabled'}> Simpan pemetaan sebagai aturan tetap</label><button id="attendance-import-preview" type="button">Baca dan Validasi</button></div><div class="attendance-import-summary" id="attendance-import-summary"></div><div class="attendance-import-table-wrap"><table class="attendance-import-table"><thead><tr><th>Nama file</th><th>Absensi</th><th>Mode</th><th>Akun tujuan</th><th>Status</th></tr></thead><tbody id="attendance-import-rows"></tbody></table></div><div class="attendance-import-actions"><span></span><button id="attendance-import-commit" type="button" disabled>Masukkan ke Absensi</button></div></section></div>`);
    document.querySelector('.attendance-import-modal [data-close]').onclick = () => document.querySelector('.attendance-import-modal')?.remove();
    document.querySelector('#attendance-import-preview').onclick = preview;
    document.querySelector('#attendance-import-commit').onclick = commit;
  }

  async function preview() {
    try {
      const file = document.querySelector('#attendance-import-file').files[0];
      if (!file) throw new Error('Pilih file Excel terlebih dahulu.');
      state.file = file; message('Membaca file dan mencocokkan akun…', 'success');
      state.preview = await call('preview', { sppg: document.querySelector('#attendance-import-sppg').value, fileBase64: await readBase64(file), fileName: file.name });
      const s = state.preview.summary;
      document.querySelector('#attendance-import-summary').innerHTML = `<span>${s.employees} nama</span><span>${s.scans} scan</span><span>${s.needsReview} perlu ditinjau</span>`;
      renderRows(); document.querySelector('#attendance-import-commit').disabled = false;
      message('Pratinjau selesai. Pilih mode dan akun tujuan melalui dropdown.', 'success');
    } catch (error) { message(error.message); }
  }

  async function commit() {
    try {
      const unresolved = state.preview.employees.filter((e) => e.mappingMode !== 'IGNORE' && (!(e.targetUserIds || []).length || (e.mappingMode === 'COPY_TO_MULTIPLE' && e.targetUserIds.length < 2)));
      if (unresolved.length) throw new Error(`${unresolved.length} nama belum memiliki pemetaan akun yang lengkap.`);
      document.querySelector('#attendance-import-commit').disabled = true;
      const result = await call('commit', { sppg: document.querySelector('#attendance-import-sppg').value, fileName: state.file.name, period: state.preview.period, employees: state.preview.employees, duplicatePolicy: document.querySelector('#attendance-import-duplicate').value, saveMappings: document.querySelector('#attendance-import-save-mapping').checked });
      message(`Selesai: ${result.inserted} scan masuk, ${result.skipped} dilewati, ${result.errors} gagal.`, result.errors ? 'error' : 'success');
    } catch (error) { message(error.message); document.querySelector('#attendance-import-commit').disabled = false; }
  }

  document.addEventListener('click', () => document.querySelectorAll('.attendance-account-menu:not([hidden])').forEach((menu) => { menu.hidden = true; menu.parentElement.querySelector('.attendance-account-trigger')?.setAttribute('aria-expanded', 'false'); }));
  window.openAttendanceImport = open;
  const sync = () => { window.setTimeout(ensureMenus, 0); window.setTimeout(ensureMenus, 500); window.setTimeout(ensureMenus, 1500); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync, { once: true }); else sync();
  window.addEventListener('absen:app-ready', sync); window.addEventListener('absen:session-changed', sync);
  window.addEventListener('storage', (event) => { if (event.key === 'auth_token' || event.key === 'auth_user') sync(); });
  const observer = new MutationObserver(() => { if (token() && allowedLocalRole() && !document.querySelector('[data-attendance-import-menu]')) ensureMenus(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();