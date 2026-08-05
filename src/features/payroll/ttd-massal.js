(() => {
  const ENDPOINT = 'https://szwwpnbbsmjsbzzcecyj.supabase.co/functions/v1/PayrollTTDMassal';
  const state = { rows: [], selected: new Set(), page: 1, pageSize: 50, search: '', drawings: { accountant: false, head: false }, initialized: false, processing: false };
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const money = (value) => `Rp ${Math.round(Number(value) || 0).toLocaleString('id-ID')}`;
  const date = (value) => value ? new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)) : '-';
  const token = () => (typeof AppState !== 'undefined' ? AppState.token : '') || '';
  const notify = (message, type = 'success') => typeof showAlert === 'function' ? showAlert(message, type) : window.alert(message);

  async function call(action, payload = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (typeof SUPABASE_KEY !== 'undefined' && SUPABASE_KEY) headers.apikey = SUPABASE_KEY;
    const response = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify({ action, token: token(), ...payload }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  function injectStyle() {
    if ($('#ttd-massal-style')) return;
    const style = document.createElement('style');
    style.id = 'ttd-massal-style';
    style.textContent = `
      #payroll-panel-ttd-massal .ttd-toolbar{display:grid;grid-template-columns:minmax(220px,1fr) auto auto;gap:.65rem;align-items:center;padding:1rem}
      #payroll-panel-ttd-massal .ttd-summary{display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap;padding:0 1rem 1rem}
      #payroll-panel-ttd-massal .ttd-selection{font-size:.875rem;color:var(--text-secondary)}
      #payroll-panel-ttd-massal .ttd-selection strong{color:var(--primary)}
      .ttd-progress-card{padding:1rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--primary-light);margin:0 1rem 1rem;display:none}
      .ttd-progress-card.active{display:block}.ttd-progress-track{height:10px;background:#e2e8f0;border-radius:999px;overflow:hidden;margin:.65rem 0}.ttd-progress-bar{height:100%;width:0;background:var(--primary);transition:width .25s ease}.ttd-progress-meta{display:flex;justify-content:space-between;gap:.75rem;font-size:.8125rem;color:var(--text-secondary)}
      .ttd-modal-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.ttd-signature-card{border:1px solid var(--border);border-radius:var(--radius);padding:1rem;background:#fff}.ttd-signature-card canvas{width:100%;height:150px;border:1px dashed #94a3b8;border-radius:.65rem;touch-action:none;background:#fff}.ttd-modal-note{padding:.85rem 1rem;border-radius:.65rem;background:#fff7ed;color:#9a3412;font-size:.8125rem;line-height:1.55;margin-top:1rem}
      @media(max-width:760px){#payroll-panel-ttd-massal .ttd-toolbar{grid-template-columns:1fr 1fr}#payroll-panel-ttd-massal .ttd-toolbar .admin-search{grid-column:1/-1}.ttd-modal-grid{grid-template-columns:1fr}.ttd-signature-card canvas{height:130px}}
    `;
    document.head.appendChild(style);
  }

  function injectUi() {
    const view = $('#view-admin-payroll');
    const tabs = view?.querySelector('.payroll-tabs');
    const history = $('#payroll-panel-history');
    if (!view || !tabs || !history || $('#payroll-tab-ttd-massal')) return false;

    const tab = document.createElement('button');
    tab.className = 'payroll-tab';
    tab.id = 'payroll-tab-ttd-massal';
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('aria-controls', 'payroll-panel-ttd-massal');
    tab.tabIndex = -1;
    tab.textContent = 'TTD Masal';
    tabs.appendChild(tab);

    const panel = document.createElement('section');
    panel.id = 'payroll-panel-ttd-massal';
    panel.className = 'payroll-tab-panel hidden';
    panel.hidden = true;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    panel.innerHTML = `
      <div class="admin-card">
        <div class="admin-card-header"><div><div class="admin-card-title">TTD Masal Slip Diterbitkan</div><div class="helper-text">Pilih slip, bubuhkan satu TTD Akuntan dan satu TTD Kepala SPPG, lalu PDF lama dibuat ulang dengan tanda tangan tercetak.</div></div><button class="btn btn-secondary btn-sm" id="btn-refresh-ttd-massal" type="button">Muat Ulang</button></div>
        <div class="ttd-toolbar">
          <div class="admin-search"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input id="ttd-massal-search" type="search" placeholder="Cari nama, SPPG, ID payroll atau slip..."></div>
          <button class="btn btn-secondary btn-sm" id="btn-select-all-ttd-massal" type="button">Pilih Semua Slip</button>
          <button class="btn btn-primary btn-sm" id="btn-open-ttd-massal" type="button" disabled>TTD Semua SLIP</button>
        </div>
        <div class="ttd-summary"><div class="ttd-selection"><strong id="ttd-massal-selected-count">0</strong> dari <span id="ttd-massal-total-count">0</span> slip dipilih</div><div class="helper-text">Proses berjalan bertahap dan tidak mengubah nominal, periode, atau penerima slip.</div></div>
        <div class="ttd-progress-card" id="ttd-massal-progress"><strong id="ttd-massal-progress-title">Menyiapkan proses...</strong><div class="ttd-progress-track"><div class="ttd-progress-bar" id="ttd-massal-progress-bar"></div></div><div class="ttd-progress-meta"><span id="ttd-massal-progress-count">0 / 0</span><span id="ttd-massal-progress-status">Menunggu</span></div></div>
        <div class="data-table-wrap payroll-responsive-table mobile-card-table"><table class="data-table"><thead><tr><th><input type="checkbox" id="ttd-massal-select-page" aria-label="Pilih semua slip pada halaman"></th><th>Karyawan</th><th>Periode</th><th>SPPG</th><th>Total</th><th>Terbit</th><th>PDF</th></tr></thead><tbody id="ttd-massal-body"><tr><td colspan="7"><div class="loading-state"><span class="spinner"></span>Memuat slip diterbitkan...</div></td></tr></tbody></table></div>
        <div class="pagination" id="ttd-massal-pagination" style="display:none"><span class="pagination-info" id="ttd-massal-pagination-info"></span><div class="pagination-btns"><button class="pagination-btn" id="ttd-massal-prev" type="button">← Prev</button><button class="pagination-btn" id="ttd-massal-next" type="button">Next →</button></div></div>
      </div>`;
    history.after(panel);

    const modal = document.createElement('div');
    modal.className = 'modal-overlay modal-overlay-top';
    modal.id = 'modal-ttd-massal';
    modal.innerHTML = `<div class="modal-card" style="max-width:920px"><div class="modal-header"><div><h3>TTD Semua Slip Terpilih</h3><div class="helper-text" id="ttd-massal-modal-count">0 slip akan dibuat ulang</div></div><button class="modal-close" id="btn-close-ttd-massal" type="button">✕</button></div><div class="modal-body"><div id="ttd-massal-alert" class="inline-alert"></div><div class="ttd-modal-grid"><div class="ttd-signature-card"><div class="form-group"><label class="form-label">Nama Akuntan</label><input class="form-input" id="ttd-massal-accountant-name" maxlength="120" value="Resi Rosanti, S. Ak"></div><label class="form-label">Tanda tangan Akuntan</label><canvas id="ttd-massal-accountant-canvas" width="900" height="300"></canvas><button class="btn btn-secondary btn-sm" id="btn-clear-ttd-accountant" type="button" style="margin-top:.55rem">Hapus</button></div><div class="ttd-signature-card"><div class="form-group"><label class="form-label">Nama Kepala SPPG</label><input class="form-input" id="ttd-massal-head-name" maxlength="120" value="S Abdulah Nasir, S. Ap"></div><label class="form-label">Tanda tangan Kepala SPPG</label><canvas id="ttd-massal-head-canvas" width="900" height="300"></canvas><button class="btn btn-secondary btn-sm" id="btn-clear-ttd-head" type="button" style="margin-top:.55rem">Hapus</button></div></div><div class="ttd-modal-note"><strong>Perhatian:</strong> PDF pada path aktif akan diganti dengan versi baru yang memuat gambar TTD Akuntan dan Kepala SPPG. Data gaji tidak diubah. Nama penerima tetap dicetak sebagai tanda tangan teks penerima.</div></div><div class="modal-footer"><button class="btn btn-secondary" id="btn-cancel-ttd-massal" type="button">Batal</button><button class="btn btn-primary" id="btn-confirm-ttd-massal" type="button">Mulai Generate PDF</button></div></div>`;
    document.body.appendChild(modal);
    bindUi();
    return true;
  }

  function activateTab() {
    ['payroll-tab-publish', 'payroll-tab-history'].forEach((id) => { const el = $(`#${id}`); if (el) { el.classList.remove('active'); el.setAttribute('aria-selected', 'false'); el.tabIndex = -1; } });
    ['payroll-panel-publish', 'payroll-panel-history'].forEach((id) => { const el = $(`#${id}`); if (el) { el.classList.add('hidden'); el.hidden = true; } });
    const tab = $('#payroll-tab-ttd-massal'), panel = $('#payroll-panel-ttd-massal');
    tab.classList.add('active'); tab.setAttribute('aria-selected', 'true'); tab.tabIndex = 0;
    panel.classList.remove('hidden'); panel.hidden = false;
    loadRows();
  }

  function leaveTab() {
    const tab = $('#payroll-tab-ttd-massal'), panel = $('#payroll-panel-ttd-massal');
    if (tab) { tab.classList.remove('active'); tab.setAttribute('aria-selected', 'false'); tab.tabIndex = -1; }
    if (panel) { panel.classList.add('hidden'); panel.hidden = true; }
  }

  async function loadRows() {
    const body = $('#ttd-massal-body');
    if (!body || state.processing) return;
    body.innerHTML = '<tr><td colspan="7"><div class="loading-state"><span class="spinner"></span>Memuat seluruh slip diterbitkan...</div></td></tr>';
    try {
      const result = await call('list', { page: 1, pageSize: 2000, search: state.search });
      state.rows = result.rows || [];
      state.selected = new Set([...state.selected].filter((id) => state.rows.some((row) => row.idSlip === id)));
      state.page = 1;
      render();
    } catch (error) {
      body.innerHTML = `<tr><td colspan="7"><div class="empty-state"><strong>Gagal memuat slip</strong>${esc(error.message)}</div></td></tr>`;
    }
  }

  function pageRows() {
    const start = (state.page - 1) * state.pageSize;
    return state.rows.slice(start, start + state.pageSize);
  }

  function render() {
    const body = $('#ttd-massal-body'); if (!body) return;
    const rows = pageRows();
    body.innerHTML = rows.length ? rows.map((row) => `<tr><td><input class="ttd-row-check" type="checkbox" data-id="${esc(row.idSlip)}" ${state.selected.has(row.idSlip) ? 'checked' : ''}></td><td data-primary="true"><strong>${esc(row.nama)}</strong><div class="helper-text">${esc(row.idSlip)}</div></td><td data-label="Periode">${esc(date(row.periodeMulai))} - ${esc(date(row.periodeAkhir))}</td><td data-label="SPPG">${esc(row.sppg)}</td><td data-label="Total"><strong>${esc(money(row.total))}</strong></td><td data-label="Terbit">${esc(date(row.diterbitkanAt))}</td><td data-label="PDF"><span class="badge badge-success">Tersedia</span></td></tr>`).join('') : '<tr><td colspan="7"><div class="empty-state"><strong>Tidak ada slip</strong>Tidak ada slip diterbitkan pada hasil pencarian.</div></td></tr>';
    body.querySelectorAll('.ttd-row-check').forEach((input) => input.addEventListener('change', () => { input.checked ? state.selected.add(input.dataset.id) : state.selected.delete(input.dataset.id); updateSelection(); }));
    const totalPages = Math.max(1, Math.ceil(state.rows.length / state.pageSize));
    const pagination = $('#ttd-massal-pagination'); pagination.style.display = state.rows.length > state.pageSize ? 'flex' : 'none';
    $('#ttd-massal-pagination-info').textContent = `Halaman ${state.page} dari ${totalPages} · ${state.rows.length} slip`;
    $('#ttd-massal-prev').disabled = state.page <= 1; $('#ttd-massal-next').disabled = state.page >= totalPages;
    updateSelection();
  }

  function updateSelection() {
    const rows = pageRows();
    const pageCheck = $('#ttd-massal-select-page');
    if (pageCheck) { pageCheck.checked = rows.length > 0 && rows.every((row) => state.selected.has(row.idSlip)); pageCheck.indeterminate = rows.some((row) => state.selected.has(row.idSlip)) && !pageCheck.checked; }
    $('#ttd-massal-selected-count').textContent = state.selected.size;
    $('#ttd-massal-total-count').textContent = state.rows.length;
    $('#btn-open-ttd-massal').disabled = state.selected.size === 0 || state.processing;
    $('#btn-select-all-ttd-massal').textContent = state.rows.length && state.selected.size === state.rows.length ? 'Batalkan Semua' : `Pilih Semua ${state.rows.length || ''} Slip`;
  }

  function setupCanvas(id, key) {
    const canvas = $(`#${id}`), context = canvas?.getContext('2d'); if (!canvas || !context) return;
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.strokeStyle = '#0f172a'; context.lineWidth = 5; context.lineCap = 'round'; context.lineJoin = 'round';
    let drawing = false;
    const point = (event) => { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height }; };
    canvas.onpointerdown = (event) => { event.preventDefault(); drawing = true; const p = point(event); context.beginPath(); context.moveTo(p.x, p.y); };
    canvas.onpointermove = (event) => { if (!drawing) return; event.preventDefault(); const p = point(event); context.lineTo(p.x, p.y); context.stroke(); state.drawings[key] = true; };
    canvas.onpointerup = canvas.onpointercancel = canvas.onpointerleave = () => { drawing = false; context.closePath(); };
  }

  function clearCanvas(id, key) {
    const canvas = $(`#${id}`), context = canvas?.getContext('2d'); if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); state.drawings[key] = false;
  }

  function openModal() {
    if (!state.selected.size) return;
    state.drawings = { accountant: false, head: false };
    $('#ttd-massal-modal-count').textContent = `${state.selected.size} slip akan dibuat ulang`;
    $('#ttd-massal-alert').className = 'inline-alert'; $('#ttd-massal-alert').textContent = '';
    $('#modal-ttd-massal').classList.add('active');
    requestAnimationFrame(() => { setupCanvas('ttd-massal-accountant-canvas', 'accountant'); setupCanvas('ttd-massal-head-canvas', 'head'); });
  }

  function closeModal() { if (!state.processing) $('#modal-ttd-massal').classList.remove('active'); }
  function modalError(message) { const el = $('#ttd-massal-alert'); el.textContent = message; el.className = 'inline-alert show error'; }

  function updateProgress(result) {
    const total = Number(result.total) || state.selected.size, selesai = Number(result.selesai) || 0, gagal = Number(result.gagal) || 0;
    const percent = total ? Math.round(((selesai + gagal) / total) * 100) : 0;
    $('#ttd-massal-progress').classList.add('active'); $('#ttd-massal-progress-bar').style.width = `${percent}%`;
    $('#ttd-massal-progress-count').textContent = `${selesai + gagal} / ${total}`;
    $('#ttd-massal-progress-status').textContent = gagal ? `${gagal} gagal` : `${percent}%`;
    $('#ttd-massal-progress-title').textContent = result.done ? 'Proses TTD massal selesai' : 'Meregenerasi PDF dan menempatkan tanda tangan...';
  }

  async function runJob() {
    const accountantName = $('#ttd-massal-accountant-name').value.trim(), headName = $('#ttd-massal-head-name').value.trim();
    if (!accountantName || !headName) return modalError('Nama Akuntan dan Kepala SPPG wajib diisi.');
    if (!state.drawings.accountant || !state.drawings.head) return modalError('Bubuhkan kedua tanda tangan terlebih dahulu.');
    const button = $('#btn-confirm-ttd-massal'), original = button.innerHTML;
    button.disabled = true; button.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px"></span> Menyiapkan job...'; state.processing = true; updateSelection();
    try {
      const started = await call('start', { ids: [...state.selected], namaAkuntan: accountantName, namaKepalaSppg: headName, tandaTanganAkuntanBase64: $('#ttd-massal-accountant-canvas').toDataURL('image/png'), tandaTanganKepalaSppgBase64: $('#ttd-massal-head-canvas').toDataURL('image/png') });
      closeModal(); $('#modal-ttd-massal').classList.remove('active');
      let result = { total: started.total, selesai: 0, gagal: 0, done: false };
      updateProgress(result);
      while (!result.done) { result = await call('process', { jobId: started.jobId }); updateProgress(result); await new Promise((resolve) => setTimeout(resolve, 120)); }
      if (result.gagal) notify(`TTD massal selesai dengan ${result.gagal} slip gagal.`, 'warning'); else notify(`${result.selesai} slip berhasil dibuat ulang dengan TTD tercetak.`, 'success');
      state.selected.clear(); await loadRows();
    } catch (error) {
      modalError(error.message || 'Proses TTD massal gagal.'); $('#modal-ttd-massal').classList.add('active'); notify(error.message || 'Proses TTD massal gagal.', 'error');
    } finally { state.processing = false; button.disabled = false; button.innerHTML = original; updateSelection(); }
  }

  function bindUi() {
    $('#payroll-tab-ttd-massal').addEventListener('click', activateTab);
    ['#payroll-tab-publish', '#payroll-tab-history'].forEach((selector) => $(selector)?.addEventListener('click', leaveTab, true));
    $('#btn-refresh-ttd-massal').addEventListener('click', loadRows);
    let searchTimer; $('#ttd-massal-search').addEventListener('input', (event) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.search = event.target.value.trim(); state.selected.clear(); loadRows(); }, 350); });
    $('#ttd-massal-select-page').addEventListener('change', (event) => { pageRows().forEach((row) => event.target.checked ? state.selected.add(row.idSlip) : state.selected.delete(row.idSlip)); render(); });
    $('#btn-select-all-ttd-massal').addEventListener('click', () => { if (state.selected.size === state.rows.length) state.selected.clear(); else state.rows.forEach((row) => state.selected.add(row.idSlip)); render(); });
    $('#btn-open-ttd-massal').addEventListener('click', openModal);
    $('#ttd-massal-prev').addEventListener('click', () => { if (state.page > 1) { state.page--; render(); } });
    $('#ttd-massal-next').addEventListener('click', () => { if (state.page < Math.ceil(state.rows.length / state.pageSize)) { state.page++; render(); } });
    $('#btn-close-ttd-massal').addEventListener('click', closeModal); $('#btn-cancel-ttd-massal').addEventListener('click', closeModal);
    $('#btn-clear-ttd-accountant').addEventListener('click', () => clearCanvas('ttd-massal-accountant-canvas', 'accountant'));
    $('#btn-clear-ttd-head').addEventListener('click', () => clearCanvas('ttd-massal-head-canvas', 'head'));
    $('#btn-confirm-ttd-massal').addEventListener('click', runJob);
  }

  function init() {
    if (state.initialized) return;
    injectStyle();
    if (injectUi()) state.initialized = true;
  }

  window.addEventListener('absen:app-ready', init, { once: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
  const observer = new MutationObserver(() => { if (!state.initialized) init(); }); observer.observe(document.documentElement, { childList: true, subtree: true });
})();
