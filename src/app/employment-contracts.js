(() => {
  if (window.__ABSEN_EMPLOYMENT_CONTRACTS__) return;
  window.__ABSEN_EMPLOYMENT_CONTRACTS__ = true;

  const state = {
    my: null,
    admin: null,
    masters: null,
    masterTab: 'SPPG',
    activeDetail: null,
    masterEditing: null,
    busy: false,
    bound: false,
    drawing: false,
    signatureDrawn: false,
  };

  const token = () => localStorage.getItem('auth_token') || '';
  const currentUser = () => {
    try { return JSON.parse(localStorage.getItem('auth_user') || 'null') || {}; }
    catch { return {}; }
  };
  const role = () => String(currentUser()?.role || currentUser()?.Role || '')
    .trim().toUpperCase().replace(/_/g, ' ');
  const isAdmin = () => ['ADMIN', 'SUPER ADMIN'].includes(role());
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const fmtDate = (value) => {
    if (!value) return '-';
    const raw = String(value);
    const date = new Date(raw.length === 10 ? `${raw}T00:00:00+07:00` : raw);
    return Number.isNaN(date.getTime())
      ? raw
      : new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }).format(date);
  };
  const money = (value) => new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0
  }).format(Number(value) || 0);
  const notify = (message, type = 'info') => {
    if (typeof window.showAlert === 'function') window.showAlert(message, type);
    else console[type === 'error' ? 'error' : 'log'](message);
  };
  const host = () => document.querySelector('.app-content') || document.querySelector('.app-main');
  const statusLabel = (status) => ({
    DRAFT: 'Draft', WAITING_MITRA: 'Menunggu TTD Mitra', WAITING_HEAD: 'Menunggu TTD Kepala SPPG',
    WAITING_EMPLOYEE: 'Menunggu TTD Karyawan', SIGNED: 'Ditandatangani', ACTIVE: 'Aktif',
    ENDED: 'Berakhir', CANCELLED: 'Dibatalkan', SUPERSEDED: 'Digantikan'
  }[status] || status || '-');
  const statusClass = (status) => status === 'ACTIVE'
    ? 'is-active'
    : String(status || '').startsWith('WAITING')
    ? 'is-pending'
    : ['ENDED', 'CANCELLED', 'SUPERSEDED'].includes(status)
    ? 'is-ended'
    : '';

  async function api(functionName, payload = {}) {
    if (!token()) throw new Error('Sesi login tidak tersedia.');
    if (typeof window.apiCall !== 'function') throw new Error('API aplikasi belum siap.');
    return await window.apiCall(functionName, { token: token(), ...payload });
  }

  function setBusy(value) {
    state.busy = Boolean(value);
    document.querySelectorAll('.employment-contract-view').forEach((node) => {
      node.classList.toggle('is-loading', state.busy);
    });
  }

  function ensureModal() {
    let modal = document.querySelector('#employment-contract-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'employment-contract-modal';
    modal.className = 'employment-contract-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="employment-contract-modal-backdrop" data-contract-modal="close"></div>
      <div class="employment-contract-dialog" id="employment-contract-dialog">
        <div class="employment-contract-modal-head">
          <div><h3 id="employment-contract-modal-title">Perjanjian Kerja</h3><p id="employment-contract-modal-subtitle"></p></div>
          <button class="employment-contract-close" data-contract-modal="close" type="button">×</button>
        </div>
        <div class="employment-contract-modal-body" id="employment-contract-modal-body"></div>
        <div class="employment-contract-modal-foot" id="employment-contract-modal-foot"></div>
      </div>`;
    document.body.appendChild(modal);
    return modal;
  }

  function openModal(title, subtitle, body, foot = '', wide = false) {
    const modal = ensureModal();
    modal.hidden = false;
    document.body.classList.add('id-card-modal-open');
    document.querySelector('#employment-contract-modal-title').textContent = title;
    document.querySelector('#employment-contract-modal-subtitle').textContent = subtitle || '';
    document.querySelector('#employment-contract-modal-body').innerHTML = body;
    document.querySelector('#employment-contract-modal-foot').innerHTML = foot;
    document.querySelector('#employment-contract-dialog')?.classList.toggle('wide', wide);
  }

  function closeModal() {
    const modal = document.querySelector('#employment-contract-modal');
    if (modal) modal.hidden = true;
    document.body.classList.remove('id-card-modal-open');
    state.activeDetail = null;
    state.masterEditing = null;
    state.signatureDrawn = false;
    state.drawing = false;
  }

  function makeView(id, html) {
    const container = host();
    if (!container) return null;
    let view = document.querySelector(`#${id}`);
    if (!view) {
      view = document.createElement('div');
      view.id = id;
      view.className = 'app-view hidden employment-contract-view';
      view.innerHTML = html;
      container.appendChild(view);
    }
    return view;
  }

  function mountViews() {
    if (!host()) return false;
    makeView('view-employment-my', `
      <div class="employment-contract-toolbar">
        <div><h2>Perjanjian Kerja Saya</h2><p>Kontrak aktif, proses tanda tangan, dan riwayat perjanjian Anda.</p></div>
        <button class="btn btn-secondary" data-contract-action="refresh-my" type="button">Refresh</button>
      </div>
      <div id="employment-my-content" class="employment-contract-empty">Memuat perjanjian...</div>`);

    if (isAdmin()) {
      makeView('view-employment-admin', `
        <div class="employment-contract-toolbar">
          <div><h2>Perjanjian Kerja</h2><p>Buat kontrak, pantau lifecycle dan urutan tanda tangan.</p></div>
          <button class="btn btn-primary" data-contract-action="create" type="button">+ Buat Perjanjian</button>
        </div>
        <div class="employment-kpis" id="employment-admin-kpis"></div>
        <div class="employment-contract-table-wrap">
          <table class="employment-contract-table">
            <thead><tr><th>Karyawan</th><th>Nomor</th><th>SPPG</th><th>Periode</th><th>Status</th><th>TTD</th><th>Aksi</th></tr></thead>
            <tbody id="employment-admin-body"></tbody>
          </table>
        </div>`);
      makeView('view-employment-master', `
        <div class="employment-contract-toolbar">
          <div><h2>Master Perjanjian Kerja</h2><p>Konfigurasi data kontrak tanpa mengedit database.</p></div>
          <button class="btn btn-secondary" data-contract-action="refresh-master" type="button">Refresh</button>
        </div>
        <div class="employment-contract-tabs" id="employment-master-tabs"></div>
        <div id="employment-master-content" class="employment-master-panel">Memuat master...</div>`);
    } else {
      document.querySelector('#view-employment-admin')?.remove();
      document.querySelector('#view-employment-master')?.remove();
    }
    ensureModal();
    return true;
  }

  function showView(viewName) {
    mountViews();
    const target = document.querySelector(`#view-${viewName}`);
    if (!target) return false;
    document.querySelectorAll('.app-view').forEach((node) => {
      node.classList.toggle('hidden', node !== target);
    });
    document.querySelector('#mobile-more-menu')?.classList.remove('active');
    document.querySelector('#topbar-dropdown')?.classList.remove('active');
    return true;
  }

  function progressHtml(value) {
    const progress = Number(value || 0);
    return `<div class="employment-contract-progress">
      <span class="${progress >= 1 ? 'is-done' : ''}">1. Mitra ${progress >= 1 ? '✓' : ''}</span>
      <span class="${progress >= 2 ? 'is-done' : ''}">2. Kepala SPPG ${progress >= 2 ? '✓' : ''}</span>
      <span class="${progress >= 3 ? 'is-done' : ''}">3. Karyawan ${progress >= 3 ? '✓' : ''}</span>
    </div>`;
  }

  function renderMy() {
    const container = document.querySelector('#employment-my-content');
    if (!container) return;
    const rows = Array.isArray(state.my) ? state.my : [];
    if (!rows.length) {
      container.className = 'employment-contract-empty';
      container.innerHTML = '<strong>Belum ada Perjanjian Kerja</strong><div>Perjanjian yang dibuat ADMIN akan muncul di sini.</div>';
      return;
    }
    container.className = '';
    container.innerHTML = rows.map((contract) => `
      <article class="employment-contract-card">
        <div class="employment-contract-card-head">
          <div><h3>${esc(contract.contractNumber)}</h3><small>${esc(contract.snapshot?.nama_sppg || contract.sppg)} · ${esc(contract.snapshot?.jabatan || '-')}</small></div>
          <span class="employment-contract-badge ${statusClass(contract.status)}">${esc(statusLabel(contract.status))}</span>
        </div>
        ${progressHtml(contract.signatureProgress)}
        <div class="employment-contract-actions">
          <button class="btn btn-secondary" data-contract-action="detail" data-id="${esc(contract.id)}" type="button">Baca Perjanjian</button>
          ${contract.status === 'WAITING_EMPLOYEE' ? `<button class="btn btn-primary" data-contract-action="employee-sign" data-id="${esc(contract.id)}" type="button">Baca & Tanda Tangan</button>` : ''}
          ${contract.finalPdfUrl ? `<button class="btn btn-secondary" data-contract-action="download" data-url="${esc(contract.finalPdfUrl)}" data-number="${esc(contract.contractNumber)}" type="button">Unduh PDF Final</button>` : ''}
        </div>
      </article>`).join('');
  }

  async function loadMy(force = false) {
    if (state.my && !force) return renderMy();
    try {
      state.my = await api('getMyEmploymentContracts');
      renderMy();
    } catch (error) {
      notify(error?.message || 'Perjanjian gagal dimuat.', 'error');
    }
  }

  function renderAdmin() {
    const body = document.querySelector('#employment-admin-body');
    const kpis = document.querySelector('#employment-admin-kpis');
    if (!body || !kpis) return;
    const rows = Array.isArray(state.admin?.contracts) ? state.admin.contracts : [];
    const counts = {
      all: rows.length,
      pending: rows.filter((row) => String(row.status || '').startsWith('WAITING')).length,
      active: rows.filter((row) => row.status === 'ACTIVE').length,
      ended: rows.filter((row) => ['ENDED', 'CANCELLED', 'SUPERSEDED'].includes(row.status)).length,
    };
    kpis.innerHTML = `
      <div class="employment-kpi"><strong>${counts.all}</strong><span>Total Dokumen</span></div>
      <div class="employment-kpi"><strong>${counts.pending}</strong><span>Proses TTD</span></div>
      <div class="employment-kpi"><strong>${counts.active}</strong><span>Aktif</span></div>
      <div class="employment-kpi"><strong>${counts.ended}</strong><span>Riwayat</span></div>`;
    window.__ABSEN_EMPLOYMENT_CONTRACTS_ADMIN_ROWS__ = rows;
    const badge = document.querySelector('#employment-pending-badge');
    if (badge) {
      badge.textContent = String(counts.pending);
      badge.style.display = counts.pending ? 'inline-flex' : 'none';
    }
    body.innerHTML = rows.length ? rows.map((contract) => {
      const signerAction = contract.status === 'WAITING_MITRA'
        ? 'TTD Mitra'
        : contract.status === 'WAITING_HEAD'
        ? 'TTD Kepala SPPG'
        : '';
      return `<tr>
        <td><strong>${esc(contract.snapshot?.nama_relawan || '-')}</strong><small>${esc(contract.snapshot?.jabatan || '-')}</small></td>
        <td><code>${esc(contract.contractNumber)}</code></td>
        <td>${esc(contract.sppg)}</td>
        <td>${fmtDate(contract.startDate)}<br><small>${contract.endDate ? `s.d. ${fmtDate(contract.endDate)}` : 'Tanpa batas akhir'}</small></td>
        <td><span class="employment-contract-badge ${statusClass(contract.status)}">${esc(statusLabel(contract.status))}</span></td>
        <td>${Number(contract.signatureProgress || 0)}/3</td>
        <td><div class="employment-contract-actions">
          <button class="btn btn-secondary" data-contract-action="detail" data-id="${esc(contract.id)}" type="button">Detail</button>
          ${signerAction ? `<button class="btn btn-primary" data-contract-action="admin-sign" data-id="${esc(contract.id)}" type="button">${signerAction}</button>` : ''}
          ${contract.status === 'ACTIVE' ? `<button class="btn btn-secondary" data-contract-action="end" data-id="${esc(contract.id)}" type="button">Akhiri</button>` : ''}
          ${!['ENDED', 'CANCELLED', 'SUPERSEDED'].includes(contract.status) ? `<button class="btn btn-secondary" data-contract-action="cancel" data-id="${esc(contract.id)}" type="button">Batalkan</button>` : ''}
        </div></td>
      </tr>`;
    }).join('') : '<tr><td colspan="7"><div class="employment-contract-empty">Belum ada perjanjian kerja.</div></td></tr>';
  }

  async function loadAdmin(force = false) {
    if (!isAdmin()) return;
    if (state.admin && !force) return renderAdmin();
    try {
      state.admin = await api('getAdminEmploymentContracts');
      renderAdmin();
    } catch (error) {
      notify(error?.message || 'Daftar perjanjian gagal dimuat.', 'error');
    }
  }

  const MASTER_TABS = [
    ['SPPG', 'SPPG & Yayasan'],
    ['JABATAN', 'Jabatan & Divisi'],
    ['JOB_DESCRIPTION', 'Job Description'],
    ['JAM_KERJA', 'Jam Kerja'],
    ['EMPLOYMENT_TERM', 'Status Kerja & Kontrak'],
    ['COMPENSATION', 'Kompensasi'],
    ['TEMPLATE', 'Template Perjanjian'],
    ['SOP', 'SOP / Referensi'],
    ['NUMBER', 'Nomor Kontrak'],
  ];
  const masterTable = (type) => ({
    SPPG: 'Master_SPPG', JABATAN: 'Master_Jabatan', JOB_DESCRIPTION: 'Master_Job_Description',
    JAM_KERJA: 'Master_Jam_Kerja', EMPLOYMENT_TERM: 'Master_Employment_Terms',
    COMPENSATION: 'Master_Contract_Compensation', TEMPLATE: 'Master_Contract_Templates',
    SOP: 'Master_SOP_References'
  }[type]);

  function masterName(type, record, index) {
    if (type === 'SPPG') return record.Nama_SPPG || `SPPG ${index + 1}`;
    if (type === 'JABATAN' || type === 'JOB_DESCRIPTION' || type === 'JAM_KERJA' || type === 'COMPENSATION') return record.Nama_Jabatan || `Jabatan ${index + 1}`;
    if (type === 'EMPLOYMENT_TERM') return record.Nama_Status_Kerja || `Status ${index + 1}`;
    if (type === 'TEMPLATE') return record.Nama_Template || `Template ${index + 1}`;
    if (type === 'SOP') return record.Nama_SOP || `SOP ${index + 1}`;
    return `Data ${index + 1}`;
  }

  function masterSummary(type, record) {
    if (type === 'SPPG') return `${record.Kode_SPPG || 'KODE ?'} · ${record.Yayasan || 'Yayasan belum diisi'} · Mitra: ${record.Nama_Mitra || '-'} · Kepala: ${record.Nama_Kepala_SPPG || '-'}`;
    if (type === 'JABATAN') return `${record.Kode_Jabatan || '-'} · Divisi: ${record.Divisi || '-'}`;
    if (type === 'JOB_DESCRIPTION') return `Versi ${record.Version || 1} · ${String(record.Job_Description || '').slice(0, 160)}`;
    if (type === 'JAM_KERJA') return `${record.Hari_Kerja || '-'} · ${String(record.Jam_Masuk || '--:--').slice(0, 5)} - ${String(record.Jam_Pulang || '--:--').slice(0, 5)}`;
    if (type === 'EMPLOYMENT_TERM') return `${record.Jenis_Kontrak || '-'} · ${record.Durasi_Default_Bulan ? `${record.Durasi_Default_Bulan} bulan` : 'tanpa durasi default'}`;
    if (type === 'COMPENSATION') return `Gaji Pokok ${money(record.Gaji_Pokok)} · Gaji Bulanan ${money(record.Gaji_Bulanan)} · Insentif ${money(record.Insentif_Default)}`;
    if (type === 'TEMPLATE') return `Versi ${record.Version || 1} · Berlaku ${fmtDate(record.Effective_From)} · ${record.Aktif === false ? 'Nonaktif' : 'Aktif'}`;
    if (type === 'SOP') return `${record.Kode_SOP || '-'} · Urutan ${record.Urutan || 0}`;
    return '';
  }

  function renderMaster() {
    const tabs = document.querySelector('#employment-master-tabs');
    const panel = document.querySelector('#employment-master-content');
    if (!tabs || !panel) return;
    tabs.innerHTML = MASTER_TABS.map(([key, label]) => `
      <button class="employment-contract-tab ${state.masterTab === key ? 'is-active' : ''}" data-master-tab="${key}" type="button">${label}</button>`).join('');

    if (state.masterTab === 'NUMBER') {
      panel.innerHTML = `<div class="employment-contract-number-format">
        <strong>Format nomor kontrak otomatis</strong>
        <code>PK/SPPG-{KODE}/0001/VIII/2026</code>
        <p>Nomor dibuat atomik per kode SPPG dan tahun. Nomor yang sudah digunakan tidak digunakan ulang.</p>
      </div>`;
      return;
    }

    const table = masterTable(state.masterTab);
    const rows = Array.isArray(state.masters?.[table]) ? state.masters[table] : [];
    panel.innerHTML = `
      <div class="employment-contract-toolbar">
        <div><strong>${MASTER_TABS.find(([key]) => key === state.masterTab)?.[1] || state.masterTab}</strong><p>${rows.length} data tersedia.</p></div>
        <button class="btn btn-primary" data-contract-action="master-new" data-type="${state.masterTab}" type="button">+ Tambah / Konfigurasi</button>
      </div>
      <div class="employment-master-grid">
        ${rows.length ? rows.map((record, index) => `
          <div class="employment-master-item">
            <strong>${esc(masterName(state.masterTab, record, index))}</strong>
            <span>${esc(masterSummary(state.masterTab, record))}</span>
            <div class="employment-master-actions">
              <button class="btn btn-secondary" data-contract-action="master-edit" data-type="${state.masterTab}" data-index="${index}" type="button">Edit</button>
            </div>
          </div>`).join('') : '<div class="employment-contract-empty">Master ini belum memiliki data.</div>'}
      </div>`;
  }

  async function loadMaster(force = false) {
    if (!isAdmin()) return;
    if (state.masters && !force) return renderMaster();
    try {
      state.masters = await api('getContractMasterData');
      renderMaster();
    } catch (error) {
      notify(error?.message || 'Master gagal dimuat.', 'error');
    }
  }

  const replaceVars = (text, snapshot) => String(text || '').replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key) => {
    const value = snapshot?.[key];
    if (['gaji_harian', 'gaji_pokok', 'gaji_bulanan', 'insentif'].includes(key)) return money(value);
    if (['tanggal_mulai', 'akhir_kontrak', 'tanggal_kontrak'].includes(key)) return fmtDate(value);
    return String(value ?? '-');
  });

  function identityHtml(snapshot) {
    const fields = [
      ['Nama', snapshot.nama_relawan], ['NIK', snapshot.nik], ['Tempat/Tanggal Lahir', snapshot.ttl],
      ['Alamat', snapshot.alamat], ['No. HP', snapshot.no_hp], ['Email', snapshot.email],
      ['SPPG', snapshot.nama_sppg], ['Yayasan', snapshot.nama_yayasan], ['Jabatan', snapshot.jabatan],
      ['Divisi', snapshot.divisi], ['Tanggal Mulai', fmtDate(snapshot.tanggal_mulai)],
      ['Status Kontrak', snapshot.status_kontrak], ['Masa Kontrak', snapshot.masa_kontrak],
      ['Gaji Harian', money(snapshot.gaji_harian)], ['Insentif', money(snapshot.insentif)],
    ];
    return `<dl class="employment-contract-identity">${fields.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value ?? '-')}</dd>`).join('')}</dl>`;
  }

  function documentHtml(detail) {
    const snapshot = detail.snapshot || {};
    const articles = Array.isArray(detail.template?.articles) ? detail.template.articles : [];
    return `<div class="employment-contract-document">
      <h1>SURAT PERJANJIAN KERJA</h1>
      <p style="text-align:center"><strong>${esc(detail.contractNumber)}</strong></p>
      <h2>IDENTITAS PARA PIHAK</h2>
      ${identityHtml(snapshot)}
      ${articles.map((article) => {
        const body = replaceVars(article.body, snapshot)
          .split('\n')
          .filter((paragraph) => paragraph.trim())
          .map((paragraph) => `<p>${esc(paragraph)}</p>`)
          .join('');
        return `<h2>PASAL ${Number(article.number)} — ${esc(article.title)}</h2>${body}`;
      }).join('')}
    </div>`;
  }

  function setupSignatureCanvas() {
    const canvas = document.querySelector('#employment-signature-canvas');
    if (!canvas) return;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#0f172a';
    context.lineWidth = 5;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    state.signatureDrawn = false;
    const position = (event) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) * canvas.width / rect.width,
        y: (event.clientY - rect.top) * canvas.height / rect.height,
      };
    };
    canvas.onpointerdown = (event) => {
      event.preventDefault();
      state.drawing = true;
      state.signatureDrawn = true;
      canvas.setPointerCapture?.(event.pointerId);
      const point = position(event);
      context.beginPath();
      context.moveTo(point.x, point.y);
    };
    canvas.onpointermove = (event) => {
      if (!state.drawing) return;
      event.preventDefault();
      const point = position(event);
      context.lineTo(point.x, point.y);
      context.stroke();
    };
    canvas.onpointerup = () => { state.drawing = false; };
    canvas.onpointercancel = () => { state.drawing = false; };
    canvas.onpointerleave = () => { state.drawing = false; };
  }

  function clearSignature() {
    const canvas = document.querySelector('#employment-signature-canvas');
    if (!canvas) return;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    state.signatureDrawn = false;
  }

  async function openDetail(contractId, mode = 'detail') {
    setBusy(true);
    try {
      const detail = await api('getEmploymentContractDetail', { contractId });
      state.activeDetail = detail;
      let signBox = '';
      let footer = '<button class="btn btn-secondary" data-contract-modal="close" type="button">Tutup</button>';
      if (mode === 'employee-sign') {
        signBox = `<div class="employment-contract-sign-box">
          <strong>Tanda Tangan Karyawan</strong>
          <label class="employment-contract-consent"><input type="checkbox" id="contract-consent"> <span>Saya telah membaca, memahami, dan menyetujui seluruh isi Perjanjian Kerja, SOP, Peraturan Perusahaan, dan Kode Etik.</span></label>
          <canvas id="employment-signature-canvas" class="employment-contract-signature-canvas" width="900" height="280"></canvas>
          <button class="btn btn-secondary" style="margin-top:8px" data-contract-modal="clear-signature" type="button">Bersihkan TTD</button>
        </div>`;
        footer += '<button class="btn btn-primary" data-contract-modal="sign-employee" type="button">Setuju & Tanda Tangan</button>';
      } else if (mode === 'admin-sign') {
        const mitra = detail.status === 'WAITING_MITRA';
        const defaultName = mitra ? detail.snapshot?.nama_mitra : detail.snapshot?.nama_kepala_sppg;
        signBox = `<div class="employment-contract-sign-box">
          <strong>${mitra ? 'TTD MITRA' : 'TTD KEPALA SPPG'}</strong>
          <div class="form-group" style="margin-top:10px"><label class="form-label">Nama Penandatangan *</label><input id="contract-signer-name" class="form-input" value="${esc(defaultName || '')}"></div>
          <canvas id="employment-signature-canvas" class="employment-contract-signature-canvas" width="900" height="280"></canvas>
          <button class="btn btn-secondary" style="margin-top:8px" data-contract-modal="clear-signature" type="button">Bersihkan TTD</button>
        </div>`;
        footer += '<button class="btn btn-primary" data-contract-modal="sign-admin" type="button">Simpan TTD & Lanjutkan</button>';
      }
      openModal(
        mode === 'detail' ? 'Perjanjian Kerja' : mode === 'employee-sign' ? 'Baca & Tanda Tangan' : 'Persetujuan & Tanda Tangan',
        statusLabel(detail.status),
        documentHtml(detail) + signBox,
        footer,
        true,
      );
      if (mode !== 'detail') setupSignatureCanvas();
    } catch (error) {
      notify(error?.message || 'Detail perjanjian gagal dimuat.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function openCreate() {
    await loadAdmin(false);
    await loadMaster(false);
    const users = Array.isArray(state.admin?.users) ? state.admin.users : [];
    const terms = Array.isArray(state.masters?.Master_Employment_Terms) ? state.masters.Master_Employment_Terms : [];
    const today = new Date().toISOString().slice(0, 10);
    openModal('Buat Perjanjian Kerja', 'Data identitas dan master akan dikunci sebagai snapshot.', `
      <div class="employment-contract-form-grid">
        <div class="form-group span-2"><label class="form-label">Karyawan *</label><select id="contract-create-user" class="form-input"><option value="">Pilih karyawan</option>${users.map((user) => `<option value="${esc(user.ID_User)}">${esc(user.Nama_Lengkap)} · ${esc(user.Jabatan_Divisi || '-')} · ${esc(user.SPPG || '-')}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Status Kerja / Kontrak *</label><select id="contract-create-term" class="form-input"><option value="">Pilih</option>${terms.filter((term) => term.Aktif !== false).map((term) => `<option value="${esc(term.ID_Employment_Term)}">${esc(term.Nama_Status_Kerja)} · ${esc(term.Jenis_Kontrak)}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Tanggal Kontrak *</label><input id="contract-create-date" class="form-input" type="date" value="${today}"></div>
        <div class="form-group"><label class="form-label">Tanggal Mulai</label><input id="contract-create-start" class="form-input" type="date"><div class="helper-text">Kosong = mengikuti Tanggal Mulai Kerja profil.</div></div>
        <div class="form-group"><label class="form-label">Tanggal Akhir</label><input id="contract-create-end" class="form-input" type="date"><div class="helper-text">Kosong = dihitung dari master kontrak.</div></div>
        <div class="employment-master-note span-2">Sistem memvalidasi NIK, alamat, SPPG/Yayasan, Mitra, Kepala SPPG, Jabatan, Job Description, Jam Kerja, dan Gaji Harian sebelum kontrak dibuat.</div>
      </div>`,
      '<button class="btn btn-secondary" data-contract-modal="close" type="button">Batal</button><button class="btn btn-primary" data-contract-modal="create-confirm" type="button">Buat & Mulai Proses TTD</button>');
  }

  const field = (label, id, value = '', type = 'text') => `<div class="form-group"><label class="form-label" for="${id}">${label}</label><input id="${id}" class="form-input" type="${type}" value="${esc(value ?? '')}"></div>`;
  const area = (label, id, value = '', extra = '') => `<div class="form-group ${extra}"><label class="form-label" for="${id}">${label}</label><textarea id="${id}" class="form-input" rows="5">${esc(value ?? '')}</textarea></div>`;

  function jobOptions(selectedId = '') {
    const jobs = Array.isArray(state.masters?.Master_Jabatan) ? state.masters.Master_Jabatan : [];
    return `<option value="">Pilih Jabatan</option>${jobs.map((job) => `<option value="${esc(job.ID_Master_Jabatan)}" ${job.ID_Master_Jabatan === selectedId ? 'selected' : ''}>${esc(job.Nama_Jabatan)}</option>`).join('')}`;
  }

  function masterForm(type, record = {}) {
    if (type === 'SPPG') return `<div class="employment-contract-form-grid">${field('Nama SPPG *', 'm-nama-sppg', record.Nama_SPPG)}${field('Kode SPPG *', 'm-kode-sppg', record.Kode_SPPG)}${field('Yayasan *', 'm-yayasan', record.Yayasan)}${field('Lokasi', 'm-lokasi', record.Lokasi_SPPG)}${area('Alamat SPPG *', 'm-alamat', record.Alamat_SPPG, 'span-2')}${field('Nama Mitra *', 'm-mitra', record.Nama_Mitra)}${field('Nama Kepala SPPG *', 'm-kepala', record.Nama_Kepala_SPPG)}</div>`;
    if (type === 'JABATAN') return `<div class="employment-contract-form-grid">${field('Nama Jabatan *', 'm-nama-jabatan', record.Nama_Jabatan)}${field('Kode Jabatan', 'm-kode-jabatan', record.Kode_Jabatan)}${field('Divisi', 'm-divisi', record.Divisi)}</div>`;
    if (type === 'JOB_DESCRIPTION') return `<div class="employment-contract-form-grid"><div class="form-group"><label class="form-label">Jabatan *</label><select id="m-job-id" class="form-input">${jobOptions(record.ID_Master_Jabatan)}</select></div>${field('Versi', 'm-version', record.Version || 1, 'number')}${area('Job Description *', 'm-job-description', record.Job_Description, 'span-2')}</div>`;
    if (type === 'JAM_KERJA') return `<div class="employment-contract-form-grid"><div class="form-group"><label class="form-label">Jabatan *</label><select id="m-job-id" class="form-input">${jobOptions(record.ID_Master_Jabatan)}</select></div>${field('Divisi', 'm-divisi', record.Divisi)}${field('Hari Kerja', 'm-hari', record.Hari_Kerja || 'Sesuai jadwal operasional SPPG')}${field('Jam Masuk', 'm-masuk', String(record.Jam_Masuk || '').slice(0, 5), 'time')}${field('Jam Pulang', 'm-pulang', String(record.Jam_Pulang || '').slice(0, 5), 'time')}${area('Keterangan', 'm-keterangan', record.Keterangan, 'span-2')}</div>`;
    if (type === 'EMPLOYMENT_TERM') return `<div class="employment-contract-form-grid">${field('Status Kerja *', 'm-status', record.Nama_Status_Kerja)}<div class="form-group"><label class="form-label">Jenis Kontrak *</label><select id="m-contract-type" class="form-input">${['PKWT', 'PKWTT', 'RELAWAN', 'LAINNYA'].map((value) => `<option ${record.Jenis_Kontrak === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div>${field('Durasi Default Bulan', 'm-durasi', record.Durasi_Default_Bulan || '', 'number')}${area('Keterangan', 'm-keterangan', record.Keterangan, 'span-2')}</div>`;
    if (type === 'COMPENSATION') return `<div class="employment-contract-form-grid"><div class="form-group"><label class="form-label">Jabatan</label><select id="m-job-id" class="form-input">${jobOptions(record.ID_Master_Jabatan)}</select></div>${field('Jenis Kontrak', 'm-contract-type', record.Jenis_Kontrak)}${field('Gaji Pokok', 'm-gaji-pokok', record.Gaji_Pokok || 0, 'number')}${field('Gaji Bulanan', 'm-gaji-bulanan', record.Gaji_Bulanan || 0, 'number')}${field('Insentif Default', 'm-insentif', record.Insentif_Default || 0, 'number')}${area('Keterangan', 'm-keterangan', record.Keterangan, 'span-2')}</div>`;
    if (type === 'SOP') return `<div class="employment-contract-form-grid">${field('Kode SOP', 'm-kode-sop', record.Kode_SOP)}${field('Nama SOP *', 'm-nama-sop', record.Nama_SOP)}${field('Urutan', 'm-urutan', record.Urutan || 0, 'number')}${area('Deskripsi', 'm-deskripsi', record.Deskripsi, 'span-2')}</div>`;
    if (type === 'TEMPLATE') return `<div class="employment-contract-form-grid">${field('Nama Template', 'm-template-name', record.Nama_Template || 'PK SPPG MBG')}${field('Versi', 'm-version', record.Version || 1, 'number')}${field('Judul Dokumen', 'm-title', record.Title)}${field('Berlaku Mulai', 'm-effective', String(record.Effective_From || new Date().toISOString().slice(0, 10)).slice(0, 10), 'date')}<div class="form-group span-2"><label class="form-label">Isi Template (JSON)</label><textarea id="m-template-json" class="form-input employment-master-json">${esc(JSON.stringify(record.Content_JSON || { articles: [] }, null, 2))}</textarea></div></div>`;
    return '<div class="employment-contract-empty">Master ini belum memiliki editor.</div>';
  }

  function openMasterEditor(type, index = -1) {
    const table = masterTable(type);
    const record = index >= 0 ? state.masters?.[table]?.[index] || {} : {};
    state.masterEditing = { type, record };
    const label = MASTER_TABS.find(([key]) => key === type)?.[1] || type;
    openModal(`${index >= 0 ? 'Edit' : 'Tambah'} ${label}`, 'Perubahan disimpan melalui API Master.', masterForm(type, record), '<button class="btn btn-secondary" data-contract-modal="close" type="button">Batal</button><button class="btn btn-primary" data-contract-modal="master-save" type="button">Simpan</button>', true);
  }

  function value(id) { return document.querySelector(`#${id}`)?.value ?? ''; }

  function collectMaster(type, record) {
    const jobs = Array.isArray(state.masters?.Master_Jabatan) ? state.masters.Master_Jabatan : [];
    const jobId = value('m-job-id');
    const job = jobs.find((item) => item.ID_Master_Jabatan === jobId);
    if (type === 'SPPG') return { ...record, Nama_SPPG: value('m-nama-sppg'), Kode_SPPG: value('m-kode-sppg'), Yayasan: value('m-yayasan'), Alamat_SPPG: value('m-alamat'), Lokasi_SPPG: value('m-lokasi'), Nama_Mitra: value('m-mitra'), Nama_Kepala_SPPG: value('m-kepala'), Aktif: true };
    if (type === 'JABATAN') return { ...record, Nama_Jabatan: value('m-nama-jabatan'), Kode_Jabatan: value('m-kode-jabatan'), Divisi: value('m-divisi'), Aktif: true };
    if (type === 'JOB_DESCRIPTION') return { ...record, ID_Master_Jabatan: jobId, Nama_Jabatan: job?.Nama_Jabatan || '', Job_Description: value('m-job-description'), Version: Number(value('m-version')) || 1, Aktif: true };
    if (type === 'JAM_KERJA') return { ...record, ID_Master_Jabatan: jobId, Nama_Jabatan: job?.Nama_Jabatan || '', Divisi: value('m-divisi') || job?.Divisi || '', Hari_Kerja: value('m-hari'), Jam_Masuk: value('m-masuk'), Jam_Pulang: value('m-pulang'), Keterangan: value('m-keterangan'), Aktif: true };
    if (type === 'EMPLOYMENT_TERM') return { ...record, Nama_Status_Kerja: value('m-status'), Jenis_Kontrak: value('m-contract-type'), Durasi_Default_Bulan: Number(value('m-durasi')) || null, Keterangan: value('m-keterangan'), Aktif: true };
    if (type === 'COMPENSATION') return { ...record, ID_Master_Jabatan: jobId || null, Nama_Jabatan: job?.Nama_Jabatan || '', Jenis_Kontrak: value('m-contract-type'), Gaji_Pokok: Number(value('m-gaji-pokok')) || 0, Gaji_Bulanan: Number(value('m-gaji-bulanan')) || 0, Insentif_Default: Number(value('m-insentif')) || 0, Keterangan: value('m-keterangan'), Aktif: true };
    if (type === 'SOP') return { ...record, Kode_SOP: value('m-kode-sop'), Nama_SOP: value('m-nama-sop'), Urutan: Number(value('m-urutan')) || 0, Deskripsi: value('m-deskripsi'), Aktif: true };
    if (type === 'TEMPLATE') {
      let content;
      try { content = JSON.parse(value('m-template-json')); }
      catch { throw new Error('JSON template tidak valid.'); }
      return { ...record, Nama_Template: value('m-template-name'), Version: Number(value('m-version')) || 1, Title: value('m-title'), Effective_From: value('m-effective'), Content_JSON: content, Aktif: true };
    }
    return record;
  }

  function download(url, number) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `Perjanjian-${String(number || 'Kerja').replace(/[^A-Za-z0-9_-]+/g, '-')}.pdf`;
    anchor.target = '_blank';
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  async function handlePageAction(button) {
    const action = button.dataset.contractAction;
    const id = button.dataset.id;
    if (action === 'refresh-my') return loadMy(true);
    if (action === 'refresh-admin') return loadAdmin(true);
    if (action === 'refresh-master') return loadMaster(true);
    if (action === 'create') return openCreate();
    if (action === 'detail') return openDetail(id, 'detail');
    if (action === 'employee-sign') return openDetail(id, 'employee-sign');
    if (action === 'admin-sign') return openDetail(id, 'admin-sign');
    if (action === 'download') return download(button.dataset.url, button.dataset.number);
    if (action === 'master-new') return openMasterEditor(button.dataset.type);
    if (action === 'master-edit') return openMasterEditor(button.dataset.type, Number(button.dataset.index));
    if (action === 'cancel') {
      const reason = prompt('Alasan pembatalan perjanjian:');
      if (!reason) return;
      setBusy(true);
      try {
        await api('cancelEmploymentContract', { contractId: id, reason });
        state.admin = null;
        await loadAdmin(true);
        notify('Perjanjian dibatalkan.', 'success');
      } finally { setBusy(false); }
      return;
    }
    if (action === 'end') {
      if (!confirm('Akhiri perjanjian aktif ini?')) return;
      setBusy(true);
      try {
        await api('endEmploymentContract', { contractId: id });
        state.admin = null;
        await loadAdmin(true);
        notify('Perjanjian diakhiri.', 'success');
      } finally { setBusy(false); }
    }
  }

  async function handleModalAction(action) {
    if (action === 'close') return closeModal();
    if (action === 'clear-signature') return clearSignature();
    if (action === 'create-confirm') {
      const idUser = value('contract-create-user');
      const employmentTermId = value('contract-create-term');
      const contractDate = value('contract-create-date');
      const startDate = value('contract-create-start');
      const endDate = value('contract-create-end');
      if (!idUser || !employmentTermId) throw new Error('Pilih karyawan dan status kerja.');
      setBusy(true);
      try {
        await api('createEmploymentContract', { idUser, employmentTermId, contractDate, startDate: startDate || undefined, endDate: endDate || undefined });
        closeModal();
        state.admin = null;
        await loadAdmin(true);
        notify('Perjanjian dibuat. Menunggu TTD Mitra.', 'success');
      } finally { setBusy(false); }
      return;
    }
    if (action === 'sign-admin' || action === 'sign-employee') {
      if (!state.activeDetail?.id) throw new Error('Perjanjian aktif tidak ditemukan.');
      if (!state.signatureDrawn) throw new Error('Tanda tangan wajib diisi.');
      const canvas = document.querySelector('#employment-signature-canvas');
      const accepted = action === 'sign-employee' ? Boolean(document.querySelector('#contract-consent')?.checked) : false;
      if (action === 'sign-employee' && !accepted) throw new Error('Centang pernyataan telah membaca dan menyetujui perjanjian.');
      const signerName = action === 'sign-admin' ? value('contract-signer-name').trim() : undefined;
      setBusy(true);
      try {
        await api('signEmploymentContract', {
          contractId: state.activeDetail.id,
          signerName,
          signatureDataUrl: canvas.toDataURL('image/png'),
          acceptedStatement: accepted,
          userAgent: navigator.userAgent,
        });
        closeModal();
        state.my = null;
        state.admin = null;
        if (isAdmin()) await Promise.all([loadAdmin(true), loadMy(true)]);
        else await loadMy(true);
        notify(action === 'sign-employee' ? 'Perjanjian selesai ditandatangani dan PDF final dibuat.' : 'Tanda tangan berhasil disimpan.', 'success');
      } finally { setBusy(false); }
      return;
    }
    if (action === 'master-save') {
      const type = state.masterEditing?.type;
      if (!type) throw new Error('Master tidak dipilih.');
      const payload = collectMaster(type, state.masterEditing.record || {});
      setBusy(true);
      try {
        await api('saveContractMaster', { masterType: type, record: payload });
        closeModal();
        state.masters = null;
        await loadMaster(true);
        notify('Master berhasil disimpan.', 'success');
      } finally { setBusy(false); }
    }
  }

  function bindOnce() {
    if (state.bound) return;
    state.bound = true;
    document.addEventListener('click', (event) => {
      const tab = event.target.closest?.('[data-master-tab]');
      if (tab) {
        state.masterTab = tab.dataset.masterTab;
        renderMaster();
        return;
      }
      const modalButton = event.target.closest?.('[data-contract-modal]');
      if (modalButton) {
        event.preventDefault();
        void handleModalAction(modalButton.dataset.contractModal).catch((error) => notify(error?.message || 'Proses gagal.', 'error'));
        return;
      }
      const actionButton = event.target.closest?.('[data-contract-action]');
      if (!actionButton || state.busy) return;
      event.preventDefault();
      void handlePageAction(actionButton).catch((error) => notify(error?.message || 'Aksi gagal.', 'error'));
    });
  }

  async function openView(viewName) {
    if ((viewName === 'employment-admin' || viewName === 'employment-master') && !isAdmin()) {
      notify('Menu ini hanya dapat diakses oleh ADMIN/SUPER ADMIN.', 'warning');
      return false;
    }
    if (!showView(viewName)) {
      notify('Halaman Perjanjian Kerja belum siap.', 'error');
      return false;
    }
    if (viewName === 'employment-my') await loadMy(true);
    if (viewName === 'employment-admin') await loadAdmin(true);
    if (viewName === 'employment-master') await loadMaster(true);
    return true;
  }

  function resetForSession() {
    state.my = null;
    state.admin = null;
    state.masters = null;
    state.activeDetail = null;
    window.__ABSEN_EMPLOYMENT_CONTRACTS_ADMIN_ROWS__ = [];
    mountViews();
  }

  function init() {
    bindOnce();
    mountViews();
  }

  window.addEventListener('absen:session-changed', resetForSession);
  window.addEventListener('absen:app-ready', init);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  window.AbsenEmploymentContracts = Object.freeze({
    openMy: () => openView('employment-my'),
    openAdmin: () => openView('employment-admin'),
    openMaster: () => openView('employment-master'),
    refresh: () => {
      state.my = null;
      state.admin = null;
      state.masters = null;
    },
  });
})();
