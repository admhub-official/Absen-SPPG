(() => {
  const endpoint = `${window.ABSEN_SUPABASE_CONFIG.projectUrl}/functions/v1/AttendanceImport`;
  const state = { config: null, preview: null, file: null };
  const token = () => localStorage.getItem('auth_token');
  async function call(action, payload = {}) {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, token: token(), ...payload }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) throw new Error(body.message || 'Proses upload absensi gagal.');
    return body.result;
  }
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
  const readBase64 = (file) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
  function candidates(employee) {
    const selected = new Set(employee.targetUserIds || []);
    return (employee.suggestions || []).map((u) => `<label><input type="checkbox" data-user-id="${esc(u.ID_User)}" ${selected.has(u.ID_User) ? 'checked' : ''}> ${esc(u.Nama_Lengkap)} <small>${Math.round((u.confidence || 0) * 100)}%</small></label>`).join('') || '<em>Tidak ada saran otomatis.</em>';
  }
  function renderRows() {
    const tbody = document.querySelector('#attendance-import-rows');
    if (!tbody || !state.preview) return;
    tbody.innerHTML = state.preview.employees.map((employee, index) => `<tr data-index="${index}"><td><strong>${esc(employee.sourceName)}</strong><br><small>ID ${esc(employee.machineId)} · ${esc(employee.department)}</small></td><td>${employee.attendance.length} hari<br>${employee.attendance.reduce((n,d)=>n+d.scans.length,0)} scan</td><td><select data-field="mappingMode"><option value="SINGLE" ${employee.mappingMode==='SINGLE'?'selected':''}>Satu akun</option><option value="COPY_TO_MULTIPLE" ${employee.mappingMode==='COPY_TO_MULTIPLE'?'selected':''}>Salin ke beberapa akun</option><option value="IGNORE" ${employee.mappingMode==='IGNORE'?'selected':''}>Abaikan</option></select></td><td class="attendance-import-targets">${candidates(employee)}</td><td>${employee.needsReview ? 'Perlu ditinjau' : 'Siap'}</td></tr>`).join('');
    tbody.querySelectorAll('tr').forEach((row) => {
      const employee = state.preview.employees[Number(row.dataset.index)];
      row.querySelector('[data-field="mappingMode"]').addEventListener('change', (event) => { employee.mappingMode = event.target.value; });
      row.querySelectorAll('[data-user-id]').forEach((box) => box.addEventListener('change', () => { employee.targetUserIds = [...row.querySelectorAll('[data-user-id]:checked')].map((node) => node.dataset.userId); if (employee.targetUserIds.length > 1) employee.mappingMode = 'COPY_TO_MULTIPLE'; }));
    });
  }
  function message(text, type = 'error') { const node = document.querySelector('#attendance-import-message'); if (node) { node.className = `attendance-import-${type}`; node.textContent = text; } }
  function open() {
    if (document.querySelector('.attendance-import-modal')) return;
    const scopes = state.config?.scopes || [];
    document.body.insertAdjacentHTML('beforeend', `<div class="attendance-import-modal"><section class="attendance-import-panel"><div class="attendance-import-head"><div><h2>Upload Data Absensi</h2><p>Unggah file mesin absensi, cocokkan nama, lalu masukkan ke akun terkait.</p></div><button type="button" data-close>✕</button></div><div id="attendance-import-message"></div><div class="attendance-import-grid"><label>SPPG<select id="attendance-import-sppg">${scopes.map((s)=>`<option value="${esc(s.SPPG)}">${esc(s.SPPG)}</option>`).join('')}</select></label><label>File Excel<input id="attendance-import-file" type="file" accept=".xlsx,.xls"></label><label>Kebijakan data sama<select id="attendance-import-duplicate"><option value="SKIP">Lewati data yang sama</option><option value="REPLACE">Perbarui data impor lama</option>${state.config?.roleConfig?.Can_Force_Duplicate?'<option value="FORCE">Tetap masukkan</option>':''}</select></label></div><div class="attendance-import-actions"><label><input id="attendance-import-save-mapping" type="checkbox" ${state.config?.roleConfig?.Can_Save_Mapping?'':'disabled'}> Simpan pemetaan sebagai aturan tetap</label><button id="attendance-import-preview" type="button">Baca dan Validasi</button></div><div class="attendance-import-summary" id="attendance-import-summary"></div><div class="attendance-import-table-wrap"><table class="attendance-import-table"><thead><tr><th>Nama file</th><th>Absensi</th><th>Mode</th><th>Akun tujuan</th><th>Status</th></tr></thead><tbody id="attendance-import-rows"></tbody></table></div><div class="attendance-import-actions"><span></span><button id="attendance-import-commit" type="button" disabled>Masukkan ke Absensi</button></div></section></div>`);
    document.querySelector('[data-close]').onclick = () => document.querySelector('.attendance-import-modal')?.remove();
    document.querySelector('#attendance-import-preview').onclick = preview;
    document.querySelector('#attendance-import-commit').onclick = commit;
  }
  async function preview() {
    try {
      const file = document.querySelector('#attendance-import-file').files[0];
      if (!file) throw new Error('Pilih file Excel terlebih dahulu.');
      state.file = file;
      message('Membaca file dan mencocokkan akun…', 'success');
      state.preview = await call('preview', { sppg: document.querySelector('#attendance-import-sppg').value, fileBase64: await readBase64(file), fileName: file.name });
      const s = state.preview.summary;
      document.querySelector('#attendance-import-summary').innerHTML = `<span>${s.employees} nama</span><span>${s.scans} scan</span><span>${s.needsReview} perlu ditinjau</span>`;
      renderRows();
      document.querySelector('#attendance-import-commit').disabled = false;
      message('Pratinjau selesai. Periksa pemetaan akun sebelum menyimpan.', 'success');
    } catch (error) { message(error.message); }
  }
  async function commit() {
    try {
      const unresolved = state.preview.employees.filter((e) => e.mappingMode !== 'IGNORE' && !(e.targetUserIds || []).length);
      if (unresolved.length) throw new Error(`${unresolved.length} nama belum memiliki akun tujuan.`);
      document.querySelector('#attendance-import-commit').disabled = true;
      const result = await call('commit', { sppg: document.querySelector('#attendance-import-sppg').value, fileName: state.file.name, period: state.preview.period, employees: state.preview.employees, duplicatePolicy: document.querySelector('#attendance-import-duplicate').value, saveMappings: document.querySelector('#attendance-import-save-mapping').checked });
      message(`Selesai: ${result.inserted} scan masuk, ${result.skipped} dilewati, ${result.errors} gagal.`, result.errors ? 'error' : 'success');
    } catch (error) { message(error.message); document.querySelector('#attendance-import-commit').disabled = false; }
  }
  async function initialize() {
    if (!token()) return;
    try { state.config = await call('config'); } catch { return; }
    if (!state.config?.roleConfig?.Menu_Enabled) return;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'attendance-import-launcher'; button.innerHTML = '<span aria-hidden="true">⇧</span><span>Upload Data Absensi</span>'; button.onclick = open;
    const containers = ['#sidebar-menu','.sidebar nav','.sidebar-menu','#more-menu','.mobile-more-menu'].map((s)=>document.querySelector(s)).filter(Boolean);
    if (containers[0]) containers[0].appendChild(button); else { button.style.position='fixed'; button.style.right='1rem'; button.style.bottom='5rem'; button.style.zIndex='9000'; button.style.background='var(--surface,#fff)'; button.style.boxShadow='0 8px 24px rgba(0,0,0,.2)'; document.body.appendChild(button); }
    window.openAttendanceImport = open;
  }
  window.addEventListener('absen:app-ready', initialize, { once: true });
})();
