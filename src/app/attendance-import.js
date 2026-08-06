(() => {
  const endpoint = `${window.ABSEN_SUPABASE_CONFIG.projectUrl}/functions/v1/AttendanceImport`;
  const state = { config: null, preview: null, file: null, returnFocus: null, busy: false };
  const token = () => localStorage.getItem('auth_token');
  const currentUser = () => { try { return JSON.parse(localStorage.getItem('auth_user') || 'null'); } catch { return null; } };
  const role = () => String(currentUser()?.role || currentUser()?.Role || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const allowedLocalRole = () => ['SUPER ADMIN', 'ADMIN', 'AKUNTAN'].includes(role());
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
  const normalize = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const modal = () => document.querySelector('.attendance-import-modal');

  async function call(action, payload = {}) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token: token(), ...payload }),
      cache: 'no-store'
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) throw new Error(body.message || 'Proses upload absensi gagal.');
    return body.result;
  }

  const readBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('File tidak dapat dibaca.'));
    reader.readAsDataURL(file);
  });

  function ensureMenus() {
    document.querySelectorAll('[data-attendance-import-menu]').forEach((node) => node.remove());
    if (!token() || !allowedLocalRole()) return;
    const desktop = document.querySelector('.app-nav');
    if (desktop) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'app-nav-item attendance-import-nav-item';
      button.dataset.attendanceImportMenu = 'desktop';
      button.style.display = '';
      button.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14a2 2 0 0 0 2-2v-4"/><path d="M3 15v4a2 2 0 0 0 2 2"/></svg><span>Upload Data Absensi</span>';
      button.onclick = open;
      desktop.insertBefore(button, desktop.querySelector('[data-view="admin-config"]') || null);
    }
    const mobile = document.querySelector('#mobile-more-menu');
    if (mobile) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mobile-more-menu-item';
      button.dataset.attendanceImportMenu = 'mobile';
      button.style.display = '';
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
    if (!accounts.length) return '<em class="attendance-import-muted">Tidak ada akun aktif pada SPPG ini.</em>';
    return `<div class="attendance-account-picker" data-account-picker="${index}">
      <button type="button" class="attendance-account-trigger" aria-expanded="false" aria-haspopup="listbox">
        <span data-selected-label>${esc(selectedLabel(employee))}</span><span aria-hidden="true">▾</span>
      </button>
      <div class="attendance-account-menu" role="listbox" aria-multiselectable="true" hidden>
        <div class="attendance-account-search-wrap"><input type="search" class="attendance-account-search" placeholder="Cari nama akun..." autocomplete="off" aria-label="Cari akun tujuan"></div>
        <div class="attendance-account-options">
          ${accounts.map((user) => `<label class="attendance-account-option" data-name="${esc(normalize(user.Nama_Lengkap))}">
            <input type="checkbox" data-user-id="${esc(user.ID_User)}" ${selected.has(user.ID_User) ? 'checked' : ''}>
            <span><strong>${esc(user.Nama_Lengkap)}</strong>${user.Jabatan_Divisi ? `<small>${esc(user.Jabatan_Divisi)}</small>` : ''}</span>
            ${(user.confidence || 0) > 0 ? `<b title="Tingkat kecocokan nama">${Math.round(user.confidence * 100)}%</b>` : ''}
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
    row.dataset.review = String(employee.needsReview);
    refreshCommitState();
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
      menu.hidden = !menu.hidden;
      trigger.setAttribute('aria-expanded', String(!menu.hidden));
      if (!menu.hidden) {
        picker.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        setTimeout(() => search.focus(), 80);
      }
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
      <td data-label="Nama mesin"><strong>${esc(employee.sourceName)}</strong><small>ID ${esc(employee.machineId)} · ${esc(employee.department)}</small></td>
      <td data-label="Data">${employee.attendance.length} hari<small>${employee.attendance.reduce((n,d)=>n+d.scans.length,0)} scan</small></td>
      <td data-label="Mode"><select data-field="mappingMode" aria-label="Mode pemetaan ${esc(employee.sourceName)}"><option value="SINGLE" ${employee.mappingMode==='SINGLE'?'selected':''}>Satu akun</option><option value="COPY_TO_MULTIPLE" ${employee.mappingMode==='COPY_TO_MULTIPLE'?'selected':''}>Salin ke beberapa akun</option><option value="SPLIT_BY_DATE" ${employee.mappingMode==='SPLIT_BY_DATE'?'selected':''}>Bagi per tanggal</option><option value="IGNORE" ${employee.mappingMode==='IGNORE'?'selected':''}>Abaikan</option></select></td>
      <td data-label="Akun tujuan" class="attendance-import-targets">${accountDropdown(employee, index)}</td>
      <td data-label="Status" data-row-status></td>
    </tr>`).join('');
    tbody.querySelectorAll('tr').forEach((row) => {
      const employee = state.preview.employees[Number(row.dataset.index)];
      const modeSelect = row.querySelector('[data-field="mappingMode"]');
      bindAccountPicker(row, employee);
      modeSelect.onchange = (event) => {
        employee.mappingMode = event.target.value;
        const picker = row.querySelector('.attendance-account-picker');
        if (employee.mappingMode === 'IGNORE') {
          if (picker) picker.style.display = 'none';
        } else if (picker) {
          picker.style.display = '';
          if (employee.mappingMode === 'SINGLE' && employee.targetUserIds.length > 1) {
            employee.targetUserIds = employee.targetUserIds.slice(0, 1);
            renderRows();
            return;
          }
        }
        updateRowStatus(row, employee);
      };
      const picker = row.querySelector('.attendance-account-picker');
      if (employee.mappingMode === 'IGNORE' && picker) picker.style.display = 'none';
      updateRowStatus(row, employee);
    });
  }

  function message(text = '', type = 'info') {
    const node = document.querySelector('#attendance-import-message');
    if (!node) return;
    node.className = text ? `attendance-import-message attendance-import-${type}` : 'attendance-import-message';
    node.textContent = text;
    node.hidden = !text;
  }

  function setStage(stage) {
    modal()?.querySelectorAll('[data-stage]').forEach((node) => {
      const order = { source: 1, review: 2, done: 3 };
      const current = order[stage] || 1;
      const item = order[node.dataset.stage] || 1;
      node.dataset.state = item < current ? 'complete' : item === current ? 'active' : 'upcoming';
    });
  }

  function setBusy(isBusy, label = '') {
    state.busy = isBusy;
    const panel = modal()?.querySelector('.attendance-import-panel');
    if (panel) panel.setAttribute('aria-busy', String(isBusy));
    modal()?.querySelectorAll('button,input,select').forEach((control) => {
      if (control.matches('[data-close]')) return;
      if (isBusy) {
        control.dataset.wasDisabled = String(control.disabled);
        control.disabled = true;
      } else if (control.dataset.wasDisabled !== undefined) {
        control.disabled = control.dataset.wasDisabled === 'true';
        delete control.dataset.wasDisabled;
      }
    });
    const busyLabel = document.querySelector('#attendance-import-busy-label');
    if (busyLabel) { busyLabel.textContent = label; busyLabel.hidden = !isBusy; }
  }

  function refreshCommitState() {
    const button = document.querySelector('#attendance-import-commit');
    if (!button) return;
    const unresolved = state.preview?.employees?.filter((e) => e.mappingMode !== 'IGNORE' && (!(e.targetUserIds || []).length || (e.mappingMode === 'COPY_TO_MULTIPLE' && e.targetUserIds.length < 2))) || [];
    button.disabled = !state.preview || unresolved.length > 0 || state.busy;
    const hint = document.querySelector('#attendance-import-commit-hint');
    if (hint) hint.textContent = !state.preview ? 'Validasi file terlebih dahulu.' : unresolved.length ? `${unresolved.length} nama masih perlu ditinjau.` : 'Semua pemetaan siap disimpan.';
  }

  function updateFilePresentation(file) {
    state.file = file || null;
    const name = document.querySelector('#attendance-import-file-name');
    const meta = document.querySelector('#attendance-import-file-meta');
    const dropzone = document.querySelector('.attendance-import-dropzone');
    if (!name || !meta || !dropzone) return;
    if (!file) {
      name.textContent = 'Pilih atau jatuhkan file Excel';
      meta.textContent = 'Format .xlsx atau .xls';
      dropzone.dataset.hasFile = 'false';
      return;
    }
    name.textContent = file.name;
    meta.textContent = `${Math.max(1, Math.round(file.size / 1024))} KB · siap dibaca`;
    dropzone.dataset.hasFile = 'true';
  }

  function close() {
    if (state.busy) return;
    modal()?.remove();
    document.body.classList.remove('attendance-import-open');
    const returnFocus = state.returnFocus;
    state.returnFocus = null;
    if (returnFocus?.isConnected) setTimeout(() => returnFocus.focus(), 0);
  }

  function bindDialog() {
    const root = modal();
    if (!root) return;
    const panel = root.querySelector('.attendance-import-panel');
    const closeButton = root.querySelector('[data-close]');
    closeButton.onclick = close;
    root.addEventListener('click', (event) => { if (event.target === root) close(); });
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...panel.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });

    const input = root.querySelector('#attendance-import-file');
    const dropzone = root.querySelector('.attendance-import-dropzone');
    input.onchange = () => updateFilePresentation(input.files?.[0]);
    ['dragenter','dragover'].forEach((name) => dropzone.addEventListener(name, (event) => { event.preventDefault(); dropzone.dataset.dragover = 'true'; }));
    ['dragleave','drop'].forEach((name) => dropzone.addEventListener(name, (event) => { event.preventDefault(); dropzone.dataset.dragover = 'false'; }));
    dropzone.addEventListener('drop', (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      if (!/\.(xlsx|xls)$/i.test(file.name)) { message('Gunakan file Excel dengan format .xlsx atau .xls.', 'error'); return; }
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      updateFilePresentation(file);
      message('', 'info');
    });

    root.querySelector('#attendance-import-preview').onclick = preview;
    root.querySelector('#attendance-import-commit').onclick = commit;
    setTimeout(() => panel.focus(), 0);
  }

  async function open(event) {
    if (!token() || !allowedLocalRole()) return;
    if (modal()) return;
    state.returnFocus = event?.currentTarget instanceof HTMLElement ? event.currentTarget : document.activeElement;
    try { state.config = await call('config'); }
    catch (error) { window.showAlert?.(`Upload Data Absensi: ${error.message}`, 'error'); return; }
    if (!state.config?.roleConfig?.Menu_Enabled || !state.config?.roleConfig?.Can_Upload) {
      window.showAlert?.('Role ini belum diizinkan mengunggah data absensi.', 'warning');
      return;
    }
    state.preview = null;
    state.file = null;
    const scopes = state.config.scopes || [];
    document.body.insertAdjacentHTML('beforeend', `<div class="attendance-import-modal" role="presentation">
      <section class="attendance-import-panel" role="dialog" aria-modal="true" aria-labelledby="attendance-import-title" tabindex="-1">
        <header class="attendance-import-head">
          <div class="attendance-import-title-wrap"><span class="attendance-import-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14a2 2 0 0 0 2-2v-4"/><path d="M3 15v4a2 2 0 0 0 2 2"/></svg></span><div><h2 id="attendance-import-title">Upload Data Absensi</h2><p>Validasi file mesin, cocokkan akun, lalu simpan dengan aman.</p></div></div>
          <button type="button" class="attendance-import-close" data-close aria-label="Tutup upload data absensi">✕</button>
        </header>
        <nav class="attendance-import-steps" aria-label="Tahapan upload"><span data-stage="source" data-state="active"><b>1</b>Sumber data</span><span data-stage="review" data-state="upcoming"><b>2</b>Validasi & pemetaan</span><span data-stage="done" data-state="upcoming"><b>3</b>Selesai</span></nav>
        <div class="attendance-import-body">
          <div id="attendance-import-message" class="attendance-import-message" role="status" aria-live="polite" hidden></div>
          <section class="attendance-import-source-card" aria-labelledby="attendance-source-title">
            <div class="attendance-import-section-heading"><div><h3 id="attendance-source-title">Sumber data</h3><p>Pilih unit kerja, file mesin, dan cara menangani data yang sama.</p></div></div>
            <div class="attendance-import-grid">
              <label class="attendance-import-field"><span>SPPG tujuan</span><select id="attendance-import-sppg">${scopes.map((s)=>`<option value="${esc(s.SPPG)}">${esc(s.SPPG)}</option>`).join('')}</select><small>Hanya unit sesuai hak akses Anda.</small></label>
              <label class="attendance-import-field"><span>Kebijakan duplikat</span><select id="attendance-import-duplicate"><option value="SKIP">Lewati data yang sama</option><option value="REPLACE">Perbarui data impor lama</option>${state.config.roleConfig.Can_Force_Duplicate?'<option value="FORCE">Tetap masukkan</option>':''}</select><small>Pilih “Lewati” untuk opsi paling aman.</small></label>
              <label class="attendance-import-dropzone" data-has-file="false" data-dragover="false"><input id="attendance-import-file" type="file" accept=".xlsx,.xls"><span class="attendance-import-drop-icon" aria-hidden="true">↑</span><span id="attendance-import-file-name">Pilih atau jatuhkan file Excel</span><small id="attendance-import-file-meta">Format .xlsx atau .xls</small></label>
            </div>
            <div class="attendance-import-source-actions"><span id="attendance-import-busy-label" class="attendance-import-busy-label" hidden></span><button id="attendance-import-preview" class="attendance-import-primary" type="button">Baca dan Validasi</button></div>
          </section>

          <section class="attendance-import-review-card" aria-labelledby="attendance-review-title">
            <div class="attendance-import-section-heading"><div><h3 id="attendance-review-title">Validasi & pemetaan akun</h3><p>Periksa setiap nama sebelum data dimasukkan ke absensi.</p></div><div class="attendance-import-summary" id="attendance-import-summary"><span class="attendance-summary-placeholder">Belum ada pratinjau</span></div></div>
            <div class="attendance-import-table-wrap"><table class="attendance-import-table"><thead><tr><th>Nama mesin</th><th>Data</th><th>Mode</th><th>Akun tujuan</th><th>Status</th></tr></thead><tbody id="attendance-import-rows"><tr><td colspan="5"><div class="attendance-import-empty"><strong>File belum divalidasi</strong><span>Pilih file Excel lalu tekan “Baca dan Validasi”.</span></div></td></tr></tbody></table></div>
          </section>
        </div>
        <footer class="attendance-import-footer"><label class="attendance-import-save-rule"><input id="attendance-import-save-mapping" type="checkbox" ${state.config.roleConfig.Can_Save_Mapping?'':'disabled'}><span><strong>Simpan aturan pemetaan</strong><small>Gunakan pilihan akun yang sama untuk impor berikutnya.</small></span></label><div class="attendance-import-footer-actions"><span id="attendance-import-commit-hint">Validasi file terlebih dahulu.</span><button type="button" class="attendance-import-secondary" data-close>Tutup</button><button id="attendance-import-commit" class="attendance-import-primary" type="button" disabled>Masukkan ke Absensi</button></div></footer>
      </section>
    </div>`);
    document.body.classList.add('attendance-import-open');
    modal().querySelectorAll('[data-close]').forEach((button) => button.onclick = close);
    bindDialog();
    refreshCommitState();
  }

  async function preview() {
    try {
      const input = document.querySelector('#attendance-import-file');
      const file = input?.files?.[0] || state.file;
      if (!file) throw new Error('Pilih file Excel terlebih dahulu.');
      if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error('Gunakan file Excel dengan format .xlsx atau .xls.');
      state.file = file;
      setBusy(true, 'Membaca file dan mencocokkan akun…');
      message('Membaca file dan mencocokkan akun…', 'info');
      state.preview = await call('preview', {
        sppg: document.querySelector('#attendance-import-sppg').value,
        fileBase64: await readBase64(file),
        fileName: file.name
      });
      const s = state.preview.summary;
      document.querySelector('#attendance-import-summary').innerHTML = `<span><b>${s.employees}</b>nama</span><span><b>${s.scans}</b>scan</span><span data-warning="${s.needsReview > 0}"><b>${s.needsReview}</b>perlu ditinjau</span>`;
      renderRows();
      setStage('review');
      message(s.needsReview ? 'Pratinjau selesai. Lengkapi pemetaan yang masih perlu ditinjau.' : 'Pratinjau selesai. Semua nama siap disimpan.', s.needsReview ? 'warning' : 'success');
      document.querySelector('.attendance-import-review-card')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } catch (error) {
      message(error.message, 'error');
    } finally {
      setBusy(false);
      refreshCommitState();
    }
  }

  async function commit() {
    try {
      if (!state.preview || !state.file) throw new Error('Validasi file terlebih dahulu.');
      const unresolved = state.preview.employees.filter((e) => e.mappingMode !== 'IGNORE' && (!(e.targetUserIds || []).length || (e.mappingMode === 'COPY_TO_MULTIPLE' && e.targetUserIds.length < 2)));
      if (unresolved.length) throw new Error(`${unresolved.length} nama belum memiliki pemetaan akun yang lengkap.`);
      setBusy(true, 'Menyimpan data absensi…');
      message('Menyimpan data absensi. Jangan tutup halaman ini…', 'info');
      const result = await call('commit', {
        sppg: document.querySelector('#attendance-import-sppg').value,
        fileName: state.file.name,
        period: state.preview.period,
        employees: state.preview.employees,
        duplicatePolicy: document.querySelector('#attendance-import-duplicate').value,
        saveMappings: document.querySelector('#attendance-import-save-mapping').checked
      });
      setStage('done');
      message(`Selesai: ${result.inserted} scan masuk, ${result.skipped} dilewati, ${result.errors} gagal.`, result.errors ? 'warning' : 'success');
      const button = document.querySelector('#attendance-import-commit');
      if (button) { button.textContent = 'Data Berhasil Diproses'; button.disabled = true; }
      const hint = document.querySelector('#attendance-import-commit-hint');
      if (hint) hint.textContent = result.errors ? 'Periksa ringkasan hasil sebelum menutup.' : 'Impor selesai dan tersimpan.';
    } catch (error) {
      message(error.message, 'error');
    } finally {
      setBusy(false);
      if (modal()?.querySelector('[data-stage="done"]')?.dataset.state !== 'active') refreshCommitState();
    }
  }

  document.addEventListener('click', () => document.querySelectorAll('.attendance-account-menu:not([hidden])').forEach((menu) => { menu.hidden = true; menu.parentElement.querySelector('.attendance-account-trigger')?.setAttribute('aria-expanded', 'false'); }));
  window.openAttendanceImport = open;
  const sync = () => { window.setTimeout(ensureMenus, 0); window.setTimeout(ensureMenus, 500); window.setTimeout(ensureMenus, 1500); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync, { once: true }); else sync();
  window.addEventListener('absen:app-ready', sync);
  window.addEventListener('absen:session-changed', sync);
  window.addEventListener('storage', (event) => { if (event.key === 'auth_token' || event.key === 'auth_user') sync(); });
  const observer = new MutationObserver(() => { if (token() && allowedLocalRole() && !document.querySelector('[data-attendance-import-menu]')) ensureMenus(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
