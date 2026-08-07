(() => {
  if (window.AbsenDigitalIdentity) return;

  const BGN_LOGO = 'https://szwwpnbbsmjsbzzcecyj.supabase.co/storage/v1/object/public/Logo%20BGN/LOGO_BGN.png';
  const state = {
    identity: null,
    busy: false,
    loadedForUser: null,
    profileObserver: null,
    adminOverview: null,
    adminBusy: false,
    adminBound: false,
    selected: new Set(),
    signatureDrawn: false,
    drawing: false,
    adminTimer: null,
  };

  const token = () => localStorage.getItem('auth_token');
  const currentUser = () => {
    try { return JSON.parse(localStorage.getItem('auth_user') || 'null'); }
    catch { return null; }
  };
  const userId = () => String(currentUser()?.idUser || currentUser()?.ID_User || '');
  const role = () => String(currentUser()?.role || currentUser()?.Role || '').trim().toUpperCase().replace(/_/g, ' ');
  const isIdCardAdmin = () => ['ADMIN', 'SUPER ADMIN'].includes(role());
  const page = () => document.querySelector('#view-profil');
  const section = () => document.querySelector('#digital-identity-section');
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const safeUrl = (value) => {
    try {
      const url = new URL(String(value || ''), window.location.origin);
      return ['https:', 'http:', 'blob:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  };
  const initials = (name) => String(name || 'ID').trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase()).join('') || 'ID';

  function notify(message, type = 'info') {
    if (typeof window.showAlert === 'function') window.showAlert(message, type);
    else if (type === 'error') console.error(message);
    else console.info(message);
  }

  async function api(functionName, payload = {}) {
    if (typeof window.apiCall !== 'function') throw new Error('API aplikasi belum siap.');
    if (!token()) throw new Error('Sesi login tidak tersedia.');
    return await window.apiCall(functionName, { token: token(), ...payload });
  }

  function mountProfile() {
    const profile = page();
    if (!profile || section()) return Boolean(section());
    const node = document.createElement('section');
    node.className = 'info-section digital-identity-section';
    node.id = 'digital-identity-section';
    node.setAttribute('aria-labelledby', 'digital-identity-title');
    node.innerHTML = `
      <div class="digital-identity-heading">
        <div class="info-section-title" id="digital-identity-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h4M7 12h6M7 16h4"/><path d="M16 9h2v2h-2zM16 14h2v2h-2z"/></svg>
          ID Card Karyawan
        </div>
        <span class="digital-identity-status" id="digital-identity-status">Memuat...</span>
      </div>
      <p class="digital-identity-intro">ID Card portrait resmi SPPG dengan QR verifikasi. Penerbitan baru aktif setelah mendapat persetujuan dan TTD Kepala SPPG melalui akun ADMIN.</p>
      <div id="digital-identity-message" class="digital-identity-message" role="status" aria-live="polite"></div>
      <div class="digital-identity-content" id="digital-identity-content"><div class="digital-identity-skeleton"><span></span><span></span></div></div>
      <div class="digital-identity-actions" aria-label="Aksi ID Card">
        <button type="button" class="digital-identity-action digital-identity-action-primary" data-digital-id-action="generate"><span data-generate-label>Buat ID Card</span></button>
        <button type="button" class="digital-identity-action" data-digital-id-action="download-card" disabled>Unduh ID Card</button>
        <button type="button" class="digital-identity-action" data-digital-id-action="print-card" disabled>Cetak ID Card</button>
        <button type="button" class="digital-identity-action digital-identity-action-qr" data-digital-id-action="download-qr" disabled>Unduh QR</button>
        <button type="button" class="digital-identity-action digital-identity-action-qr" data-digital-id-action="print-qr" disabled>Cetak QR</button>
      </div>`;
    const securitySection = profile.querySelector('#p-id-card-digital')?.closest('.info-section');
    if (securitySection) securitySection.before(node);
    else profile.appendChild(node);
    node.addEventListener('click', handleProfileAction);
    renderProfile();
    return true;
  }

  function setMessage(message = '', type = 'info') {
    const node = document.querySelector('#digital-identity-message');
    if (!node) return;
    node.textContent = message;
    node.className = `digital-identity-message digital-identity-message-${type}`;
    node.hidden = !message;
  }

  function setBusy(busy, message = '') {
    state.busy = busy;
    section()?.classList.toggle('is-busy', busy);
    if (message) setMessage(message, 'info');
    renderProfile();
  }

  function updateLegacyStatus(identity) {
    const idStatus = document.querySelector('#p-id-card-digital');
    const qrStatus = document.querySelector('#p-qr-code');
    const hasCard = Boolean(identity?.hasCard);
    const hasPending = Boolean(identity?.hasPending);
    if (idStatus) {
      idStatus.textContent = hasPending && !hasCard
        ? 'Menunggu Persetujuan'
        : hasPending
        ? 'Aktif · Pembaruan Menunggu Persetujuan'
        : hasCard
        ? 'Tersedia'
        : 'Belum Tersedia';
    }
    if (qrStatus) qrStatus.textContent = hasCard ? 'Aktif' : hasPending ? 'Menunggu Persetujuan' : 'Belum Tersedia';
  }

  function institutionHeader(profile, className) {
    return `
      <div class="${className}">
        <img src="${BGN_LOGO}" alt="Logo BGN">
        <div class="digital-id-back-title-copy">
          <strong>SATUAN PELAYANAN PEMENUHAN GIZI (SPPG)</strong>
          <b>${esc(profile.sppg)}</b>
          <span>${esc(profile.yayasanLabel || profile.yayasan)}</span>
        </div>
      </div>`;
  }

  function frontPreview(profile) {
    const photo = safeUrl(profile.fotoUrl);
    return `
      <div class="digital-id-portrait-card digital-id-front" aria-label="Pratinjau bagian depan ID Card">
        <div class="digital-id-bgn-header">
          <img src="${BGN_LOGO}" alt="Logo BGN">
          <strong>SATUAN PELAYANAN PEMENUHAN GIZI (SPPG)</strong>
          <b>${esc(profile.sppg)}</b>
          <small>${esc(profile.yayasanLabel || profile.yayasan)}</small>
        </div>
        <div class="digital-id-photo-circle">${photo ? `<img src="${esc(photo)}" alt="Foto ${esc(profile.namaLengkap)}">` : `<span>${esc(initials(profile.namaLengkap))}</span>`}</div>
        <div class="digital-id-person">
          <strong>${esc(profile.namaLengkap)}</strong>
          <span>${esc(profile.jabatan === '-' ? profile.role : profile.jabatan)}</span>
          <small>TANGGAL MULAI BEKERJA</small>
          <b>${esc(profile.tanggalMulaiKerjaLabel || '-')}</b>
        </div>
      </div>`;
  }

  function backPreview(profile, card, pending) {
    const qr = safeUrl(card?.qrPngUrl);
    const signature = safeUrl(card?.headSppgSignatureUrl);
    return `
      <div class="digital-id-portrait-card digital-id-back" aria-label="Pratinjau bagian belakang ID Card">
        ${institutionHeader(profile, 'digital-id-back-title')}
        <div class="digital-id-back-qr">${qr ? `<img src="${esc(qr)}" alt="QR verifikasi ID Card">` : '<span>QR</span>'}</div>
        <small class="digital-id-code-label">KODE ID CARD</small>
        <code>${esc(profile.idCardCode)}</code>
        <p class="digital-id-official-note">${esc(profile.officialNote || '')}</p>
        <div class="digital-id-head-signature">
          <small>KEPALA SPPG</small>
          ${signature ? `<img src="${esc(signature)}" alt="TTD Kepala SPPG">` : '<div class="digital-id-signature-placeholder"></div>'}
          <strong>${card?.headSppgName ? esc(card.headSppgName) : pending ? 'MENUNGGU PERSETUJUAN' : 'BELUM DITERBITKAN'}</strong>
        </div>
      </div>`;
  }

  function renderProfile() {
    const root = section();
    if (!root) return;
    const content = root.querySelector('#digital-identity-content');
    const status = root.querySelector('#digital-identity-status');
    const generate = root.querySelector('[data-digital-id-action="generate"]');
    const generateLabel = root.querySelector('[data-generate-label]');
    const identity = state.identity;

    if (!identity) {
      status.textContent = 'Belum dimuat';
      status.className = 'digital-identity-status';
      content.innerHTML = '<div class="digital-identity-empty"><strong>ID Card belum dimuat</strong><span>Buka kembali Profil untuk memuat status kartu.</span></div>';
      root.querySelectorAll('button').forEach((button) => { button.disabled = state.busy; });
      updateLegacyStatus(null);
      return;
    }

    const hasCard = Boolean(identity.hasCard && identity.card);
    const hasPending = Boolean(identity.hasPending && identity.pending);
    const profile = identity.profile;
    status.textContent = hasPending ? 'Menunggu Persetujuan Kepala SPPG' : hasCard ? 'Aktif' : 'Belum Dibuat';
    status.className = `digital-identity-status ${hasPending ? 'is-pending' : hasCard ? 'is-active' : 'is-empty'}`;
    generateLabel.textContent = hasPending ? 'Menunggu Persetujuan Kepala SPPG' : hasCard ? 'Ajukan Pembaruan ID Card' : 'Buat ID Card';
    generate.disabled = state.busy || hasPending;
    content.innerHTML = `
      <div class="digital-id-preview-pair">
        ${frontPreview(profile)}
        ${backPreview(profile, identity.card, identity.pending)}
      </div>
      <dl class="digital-identity-meta">
        <div><dt>Kode ID Card</dt><dd>${esc(profile.idCardCode)}</dd></div>
        <div><dt>Status</dt><dd>${hasPending ? 'Menunggu Persetujuan Kepala SPPG' : hasCard ? 'Aktif dan dapat diverifikasi' : 'Belum diterbitkan'}</dd></div>
        <div><dt>Versi Aktif</dt><dd>${hasCard ? Number(identity.card.version) : '-'}</dd></div>
        <div><dt>${hasPending ? 'Diajukan' : 'Disetujui'}</dt><dd>${hasPending ? esc(identity.pending.requestedAtLabel) : hasCard ? esc(identity.card.approvedAtLabel) : '-'}</dd></div>
      </dl>
      ${hasPending ? `<div class="digital-id-pending-note">Pengajuan versi ${Number(identity.pending.version)} sedang menunggu TTD Kepala SPPG. ${hasCard ? 'ID Card aktif sebelumnya tetap berlaku sampai pengajuan ini disetujui.' : 'QR baru belum aktif sampai persetujuan selesai.'}</div>` : ''}`;

    root.querySelectorAll('[data-digital-id-action="download-card"], [data-digital-id-action="print-card"], [data-digital-id-action="download-qr"], [data-digital-id-action="print-qr"]')
      .forEach((button) => { button.disabled = state.busy || !hasCard; });
    updateLegacyStatus(identity);
  }

  async function loadProfile(force = false) {
    if (!token() || !mountProfile() || state.busy) return;
    const id = userId();
    if (!force && state.identity && state.loadedForUser === id) return renderProfile();
    setBusy(true, 'Memuat ID Card...');
    try {
      state.identity = await api('getMyDigitalIdentity');
      state.loadedForUser = id;
      setMessage('');
    } catch (error) {
      setMessage(error.message || 'ID Card gagal dimuat.', 'error');
    } finally {
      state.busy = false;
      section()?.classList.remove('is-busy');
      renderProfile();
    }
  }

  async function requestCard(renew = false) {
    if (state.busy || state.identity?.hasPending) return;
    if (renew && !window.confirm('Ajukan pembaruan ID Card? Kartu aktif saat ini tetap berlaku sampai pengajuan baru disetujui.')) return;
    setBusy(true, renew ? 'Mengirim pengajuan pembaruan ID Card...' : 'Mengirim pengajuan ID Card...');
    try {
      state.identity = await api(renew ? 'regenerateMyDigitalIdentity' : 'generateMyDigitalIdentity', renew ? { confirmation: 'REGENERATE' } : {});
      state.loadedForUser = userId();
      setMessage('Pengajuan ID Card berhasil dikirim. Status: Menunggu Persetujuan Kepala SPPG.', 'success');
      notify('Pengajuan ID Card dikirim ke ADMIN untuk TTD Kepala SPPG.', 'success');
    } catch (error) {
      setMessage(error.message || 'Pengajuan ID Card gagal dikirim.', 'error');
      notify(error.message || 'Pengajuan ID Card gagal dikirim.', 'error');
    } finally {
      state.busy = false;
      section()?.classList.remove('is-busy');
      renderProfile();
    }
  }

  async function download(url, filename) {
    const resolved = safeUrl(url);
    if (!resolved) throw new Error('Tautan berkas tidak tersedia. Muat ulang ID Card.');
    try {
      const response = await fetch(resolved, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blobUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
    } catch {
      window.open(resolved, '_blank', 'noopener,noreferrer');
    }
  }

  function printPdf(url) {
    const resolved = safeUrl(url);
    if (!resolved) throw new Error('Tautan cetak tidak tersedia. Muat ulang ID Card.');
    const opened = window.open(resolved, '_blank', 'noopener,noreferrer');
    if (!opened) throw new Error('Popup diblokir browser. Izinkan popup untuk membuka PDF.');
  }

  async function handleProfileAction(event) {
    const button = event.target.closest?.('[data-digital-id-action]');
    if (!button || button.disabled || state.busy) return;
    const action = button.dataset.digitalIdAction;
    try {
      if (action === 'generate') await requestCard(Boolean(state.identity?.hasCard));
      else if (action === 'download-card') await download(state.identity?.card?.idCardPdfUrl, `ID-Card-${state.identity?.profile?.idCardCode || 'SPPG'}.pdf`);
      else if (action === 'print-card') printPdf(state.identity?.card?.idCardPdfUrl);
      else if (action === 'download-qr') await download(state.identity?.card?.qrPdfUrl, `QR-ID-${state.identity?.profile?.idCardCode || 'SPPG'}.pdf`);
      else if (action === 'print-qr') printPdf(state.identity?.card?.qrPdfUrl);
    } catch (error) {
      notify(error.message || 'Aksi ID Card gagal.', 'error');
    }
  }

  function adminViewsContainer() {
    return document.querySelector('.app-content') || document.querySelector('.app-main');
  }

  function mountAdminShell() {
    if (!isIdCardAdmin()) return false;
    const sidebar = document.querySelector('.app-nav');
    const mobile = document.querySelector('#mobile-more-menu');
    const container = adminViewsContainer();
    if (!sidebar || !container) return false;

    if (!document.querySelector('#id-card-admin-nav-group')) {
      const group = document.createElement('div');
      group.id = 'id-card-admin-nav-group';
      group.className = 'id-card-admin-nav-group admin-only-nav';
      group.innerHTML = `
        <div class="id-card-admin-nav-title"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h4M7 12h6"/></svg><span>ID Card</span></div>
        <button class="app-nav-item id-card-admin-subnav" data-id-card-view="admin-id-card-list" type="button"><span>Daftar ID Card</span></button>
        <button class="app-nav-item id-card-admin-subnav" data-id-card-view="admin-id-card-pending" type="button"><span>Pengajuan ID Card</span><span class="badge-count" id="id-card-pending-nav-count" style="display:none">0</span></button>`;
      const before = sidebar.querySelector('[data-view="admin-log"]') || sidebar.lastElementChild;
      sidebar.insertBefore(group, before);
    }

    if (mobile && !document.querySelector('#id-card-mobile-nav')) {
      const wrap = document.createElement('div');
      wrap.id = 'id-card-mobile-nav';
      wrap.innerHTML = `
        <div class="mobile-more-menu-title">ID Card</div>
        <button class="mobile-more-menu-item" data-id-card-view="admin-id-card-list" type="button">Daftar ID Card</button>
        <button class="mobile-more-menu-item" data-id-card-view="admin-id-card-pending" type="button">Pengajuan ID Card <span class="badge-count" id="id-card-pending-mobile-count" style="display:none">0</span></button>`;
      mobile.insertBefore(wrap, mobile.firstChild?.nextSibling || null);
    }

    if (!document.querySelector('#view-admin-id-card-list')) {
      const listView = document.createElement('div');
      listView.id = 'view-admin-id-card-list';
      listView.className = 'app-view hidden id-card-admin-view';
      listView.innerHTML = `
        <div class="page-header id-card-page-heading"><div><div class="page-title">ID Card</div><div class="page-subtitle">Daftar ID Card yang sudah disetujui dan ditandatangani Kepala SPPG</div></div><button class="btn btn-secondary" data-id-card-admin-action="refresh">Refresh</button></div>
        <div class="stats-grid id-card-admin-stats"><div class="stat-card"><div><div class="stat-card-value" id="id-card-approved-count">0</div><div class="stat-card-label">ID Card Aktif</div></div></div><div class="stat-card"><div><div class="stat-card-value" id="id-card-pending-count-summary">0</div><div class="stat-card-label">Menunggu Persetujuan</div></div></div></div>
        <div class="admin-card"><div class="admin-card-header"><div class="admin-card-title">Daftar ID Card</div></div><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Nama</th><th>SPPG</th><th>Kode ID Card</th><th>Kepala SPPG</th><th>Disetujui</th><th>Aksi</th></tr></thead><tbody id="id-card-approved-body"></tbody></table></div></div>`;
      container.appendChild(listView);
    }

    if (!document.querySelector('#view-admin-id-card-pending')) {
      const pendingView = document.createElement('div');
      pendingView.id = 'view-admin-id-card-pending';
      pendingView.className = 'app-view hidden id-card-admin-view';
      pendingView.innerHTML = `
        <div class="page-header id-card-page-heading"><div><div class="page-title">Pengajuan ID Card <span class="badge-count id-card-page-badge" id="id-card-pending-page-count">0</span></div><div class="page-subtitle">Pengajuan yang belum mendapat TTD Kepala SPPG</div></div><button class="btn btn-secondary" data-id-card-admin-action="refresh">Refresh</button></div>
        <div class="id-card-bulk-toolbar"><div><strong id="id-card-selected-count">0 dipilih</strong><span>Pilih pengajuan lalu TTD secara massal.</span></div><div class="id-card-bulk-actions"><button class="btn btn-secondary" id="id-card-approve-selected" data-id-card-admin-action="approve-selected" disabled>TTD Pilihan</button><button class="btn btn-primary" id="id-card-approve-all" data-id-card-admin-action="approve-all" disabled>Setujui Semua</button></div></div>
        <div class="admin-card"><div class="data-table-wrap"><table class="data-table"><thead><tr><th class="id-card-check-col"><input type="checkbox" id="id-card-select-all" aria-label="Pilih semua pengajuan"></th><th>Nama</th><th>Jabatan / Divisi</th><th>SPPG</th><th>Yayasan</th><th>Mulai Kerja</th><th>Kode</th><th>Diajukan</th></tr></thead><tbody id="id-card-pending-body"></tbody></table></div></div>`;
      container.appendChild(pendingView);
    }

    if (!document.querySelector('#id-card-approval-modal')) mountApprovalModal();
    bindAdminEvents();
    return true;
  }

  function bindAdminEvents() {
    if (state.adminBound) return;
    state.adminBound = true;
    document.querySelector('#id-card-admin-nav-group')?.addEventListener('click', (event) => {
      const button = event.target.closest?.('[data-id-card-view]');
      if (button) openAdminView(button.dataset.idCardView);
    });
    document.querySelector('#id-card-mobile-nav')?.addEventListener('click', (event) => {
      const button = event.target.closest?.('[data-id-card-view]');
      if (button) openAdminView(button.dataset.idCardView);
    });
    document.querySelectorAll('[data-id-card-admin-action="refresh"]').forEach((button) => button.addEventListener('click', () => loadAdmin(true)));
    document.querySelector('#id-card-approve-selected')?.addEventListener('click', () => openApprovalModal([...state.selected]));
    document.querySelector('#id-card-approve-all')?.addEventListener('click', () => {
      const ids = (state.adminOverview?.pending || []).map((item) => String(item.id));
      state.selected = new Set(ids);
      renderAdminPending();
      openApprovalModal(ids);
    });
    document.querySelector('#id-card-select-all')?.addEventListener('change', (event) => {
      const ids = (state.adminOverview?.pending || []).map((item) => String(item.id));
      state.selected = event.target.checked ? new Set(ids) : new Set();
      renderAdminPending();
    });
    document.querySelector('#id-card-pending-body')?.addEventListener('change', handlePendingSelection);
    document.querySelector('#id-card-approved-body')?.addEventListener('click', handleApprovedAction);
  }

  function mountApprovalModal() {
    const modal = document.createElement('div');
    modal.id = 'id-card-approval-modal';
    modal.className = 'id-card-approval-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="id-card-approval-backdrop" data-id-card-modal-action="cancel"></div>
      <div class="id-card-approval-dialog" role="dialog" aria-modal="true" aria-labelledby="id-card-approval-title">
        <div class="id-card-approval-header"><div><strong id="id-card-approval-title">TTD & Persetujuan ID Card</strong><span id="id-card-approval-subtitle">0 pengajuan dipilih</span></div><button type="button" class="id-card-modal-close" data-id-card-modal-action="cancel" aria-label="Tutup">×</button></div>
        <div class="id-card-approval-body">
          <label class="form-label" for="id-card-head-name">Nama Kepala SPPG *</label>
          <input class="form-input" id="id-card-head-name" type="text" maxlength="120" placeholder="Nama lengkap Kepala SPPG">
          <div class="id-card-signature-label"><span>TTD Kepala SPPG *</span><button type="button" data-id-card-modal-action="clear-signature">Bersihkan TTD</button></div>
          <div class="id-card-signature-wrap"><canvas id="id-card-signature-canvas" class="id-card-signature-canvas" width="900" height="300" aria-label="Kanvas TTD Kepala SPPG"></canvas></div>
          <p class="id-card-signature-help">Tanda tangan pada area putih menggunakan mouse atau sentuhan. TTD dan nama yang sama akan diterapkan ke seluruh pengajuan terpilih.</p>
          <div id="id-card-approval-error" class="digital-identity-message digital-identity-message-error" hidden></div>
        </div>
        <div class="id-card-approval-footer"><button type="button" class="btn btn-secondary" data-id-card-modal-action="cancel">Batal</button><button type="button" class="btn btn-primary" id="id-card-confirm-approval" data-id-card-modal-action="confirm">Setujui & TTD</button></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', handleModalAction);
    const canvas = modal.querySelector('#id-card-signature-canvas');
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave']
      .forEach((eventName) => canvas.addEventListener(eventName, handleSignaturePointer));
    clearSignature();
  }

  function openAdminView(view) {
    if (!isIdCardAdmin()) return;
    mountAdminShell();
    if (typeof window.switchView === 'function') window.switchView(view);
    else {
      document.querySelectorAll('.app-view').forEach((node) => node.classList.add('hidden'));
      document.querySelector(`#view-${view}`)?.classList.remove('hidden');
    }
    document.querySelector('#mobile-more-menu')?.classList.remove('active');
    loadAdmin(true);
  }

  function setBadge(count) {
    ['#id-card-pending-nav-count', '#id-card-pending-mobile-count', '#id-card-pending-page-count'].forEach((selector) => {
      const badge = document.querySelector(selector);
      if (!badge) return;
      badge.textContent = String(count || 0);
      badge.style.display = count > 0 ? 'inline-flex' : 'none';
    });
  }

  function renderAdmin() {
    if (!state.adminOverview) return;
    const pendingCount = Number(state.adminOverview.pendingCount || 0);
    const approvedCount = Number(state.adminOverview.approvedCount || 0);
    setBadge(pendingCount);
    const approvedNode = document.querySelector('#id-card-approved-count');
    const pendingSummary = document.querySelector('#id-card-pending-count-summary');
    if (approvedNode) approvedNode.textContent = String(approvedCount);
    if (pendingSummary) pendingSummary.textContent = String(pendingCount);
    renderAdminApproved();
    renderAdminPending();
  }

  function renderAdminApproved() {
    const body = document.querySelector('#id-card-approved-body');
    if (!body) return;
    const rows = state.adminOverview?.approved || [];
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="6"><div class="table-empty">Belum ada ID Card yang sudah disetujui.</div></td></tr>';
      return;
    }
    body.innerHTML = rows.map((item) => `
      <tr>
        <td><strong>${esc(item.namaLengkap)}</strong><div class="id-card-table-sub">${esc(item.jabatan)}</div></td>
        <td>${esc(item.sppg)}</td><td><code>${esc(item.idCardCode)}</code></td>
        <td>${esc(item.headSppgName || '-')}</td><td>${esc(item.approvedAtLabel || '-')}</td>
        <td><div class="id-card-row-actions"><button class="btn btn-secondary" data-id-card-file="download" data-url="${esc(item.idCardPdfUrl || '')}" data-code="${esc(item.idCardCode)}">Unduh</button><button class="btn btn-secondary" data-id-card-file="print" data-url="${esc(item.idCardPdfUrl || '')}">Cetak</button></div></td>
      </tr>`).join('');
  }

  function renderAdminPending() {
    const body = document.querySelector('#id-card-pending-body');
    if (!body) return;
    const rows = state.adminOverview?.pending || [];
    const validIds = new Set(rows.map((item) => String(item.id)));
    state.selected = new Set([...state.selected].filter((id) => validIds.has(id)));
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="8"><div class="table-empty">Tidak ada pengajuan ID Card yang menunggu persetujuan.</div></td></tr>';
    } else {
      body.innerHTML = rows.map((item) => {
        const id = String(item.id);
        return `<tr class="${state.selected.has(id) ? 'is-selected' : ''}">
          <td class="id-card-check-col"><input type="checkbox" data-id-card-select="${esc(id)}" ${state.selected.has(id) ? 'checked' : ''} aria-label="Pilih ${esc(item.namaLengkap)}"></td>
          <td><strong>${esc(item.namaLengkap)}</strong></td><td>${esc(item.jabatan)}</td><td>${esc(item.sppg)}</td><td>${esc(item.yayasan)}</td><td>${esc(item.tanggalMulaiKerjaLabel || '-')}</td><td><code>${esc(item.idCardCode)}</code></td><td>${esc(item.requestedAtLabel || '-')}</td>
        </tr>`;
      }).join('');
    }
    const count = state.selected.size;
    const countNode = document.querySelector('#id-card-selected-count');
    if (countNode) countNode.textContent = `${count} dipilih`;
    const selectedButton = document.querySelector('#id-card-approve-selected');
    const allButton = document.querySelector('#id-card-approve-all');
    if (selectedButton) selectedButton.disabled = !count || state.adminBusy;
    if (allButton) allButton.disabled = !rows.length || state.adminBusy;
    const selectAll = document.querySelector('#id-card-select-all');
    if (selectAll) {
      selectAll.checked = Boolean(rows.length && count === rows.length);
      selectAll.indeterminate = Boolean(count && count < rows.length);
    }
  }

  async function loadAdmin(force = false) {
    if (!token() || !isIdCardAdmin() || !mountAdminShell() || state.adminBusy) return;
    if (!force && state.adminOverview) return renderAdmin();
    state.adminBusy = true;
    document.querySelectorAll('.id-card-admin-view').forEach((node) => node.classList.add('is-loading'));
    try {
      state.adminOverview = await api('getIdCardAdminOverview');
      renderAdmin();
    } catch (error) {
      notify(error.message || 'Data ID Card ADMIN gagal dimuat.', 'error');
    } finally {
      state.adminBusy = false;
      document.querySelectorAll('.id-card-admin-view').forEach((node) => node.classList.remove('is-loading'));
      renderAdminPending();
    }
  }

  function handlePendingSelection(event) {
    const checkbox = event.target.closest?.('[data-id-card-select]');
    if (!checkbox) return;
    const id = String(checkbox.dataset.idCardSelect || '');
    if (checkbox.checked) state.selected.add(id);
    else state.selected.delete(id);
    renderAdminPending();
  }

  async function handleApprovedAction(event) {
    const button = event.target.closest?.('[data-id-card-file]');
    if (!button) return;
    try {
      if (button.dataset.idCardFile === 'download') {
        await download(button.dataset.url, `ID-Card-${button.dataset.code || 'SPPG'}.pdf`);
      } else {
        printPdf(button.dataset.url);
      }
    } catch (error) {
      notify(error.message || 'File ID Card tidak dapat dibuka.', 'error');
    }
  }

  function clearSignature() {
    const canvas = document.querySelector('#id-card-signature-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    state.signatureDrawn = false;
    state.drawing = false;
  }

  function pointerPosition(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function handleSignaturePointer(event) {
    const canvas = event.currentTarget;
    const ctx = canvas.getContext('2d');
    if (event.type === 'pointerdown') {
      event.preventDefault();
      state.drawing = true;
      state.signatureDrawn = true;
      canvas.setPointerCapture?.(event.pointerId);
      const point = pointerPosition(canvas, event);
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      return;
    }
    if (event.type === 'pointermove' && state.drawing) {
      event.preventDefault();
      const point = pointerPosition(canvas, event);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      return;
    }
    if (['pointerup', 'pointercancel', 'pointerleave'].includes(event.type)) state.drawing = false;
  }

  function openApprovalModal(ids) {
    if (!ids?.length) return notify('Pilih minimal satu pengajuan ID Card.', 'warning');
    const modal = document.querySelector('#id-card-approval-modal');
    if (!modal) return;
    modal.dataset.cardIds = JSON.stringify(ids);
    modal.querySelector('#id-card-approval-subtitle').textContent = `${ids.length} pengajuan dipilih`;
    modal.querySelector('#id-card-approval-error').hidden = true;
    modal.querySelector('#id-card-head-name').value = '';
    clearSignature();
    modal.hidden = false;
    document.body.classList.add('id-card-modal-open');
    setTimeout(() => modal.querySelector('#id-card-head-name')?.focus(), 40);
  }

  function closeApprovalModal() {
    const modal = document.querySelector('#id-card-approval-modal');
    if (!modal) return;
    modal.hidden = true;
    delete modal.dataset.cardIds;
    document.body.classList.remove('id-card-modal-open');
  }

  function setModalError(message = '') {
    const node = document.querySelector('#id-card-approval-error');
    if (!node) return;
    node.textContent = message;
    node.hidden = !message;
  }

  async function handleModalAction(event) {
    const actionNode = event.target.closest?.('[data-id-card-modal-action]');
    if (!actionNode) return;
    const action = actionNode.dataset.idCardModalAction;
    if (action === 'cancel') return closeApprovalModal();
    if (action === 'clear-signature') return clearSignature();
    if (action !== 'confirm' || state.adminBusy) return;

    const modal = document.querySelector('#id-card-approval-modal');
    let ids = [];
    try { ids = JSON.parse(modal.dataset.cardIds || '[]'); } catch {}
    const headName = String(modal.querySelector('#id-card-head-name').value || '').trim();
    if (headName.length < 3) return setModalError('Masukkan nama Kepala SPPG.');
    if (!state.signatureDrawn) return setModalError('TTD Kepala SPPG wajib diisi.');
    if (!ids.length) return setModalError('Tidak ada pengajuan yang dipilih.');

    const canvas = modal.querySelector('#id-card-signature-canvas');
    const confirmButton = modal.querySelector('#id-card-confirm-approval');
    state.adminBusy = true;
    confirmButton.disabled = true;
    confirmButton.textContent = 'Memproses...';
    setModalError('');
    try {
      const result = await api('approveIdCardRequests', {
        cardIds: ids,
        headName,
        signatureDataUrl: canvas.toDataURL('image/png'),
      });
      closeApprovalModal();
      state.selected.clear();
      state.adminOverview = null;
      await loadAdmin(true);
      await loadProfile(true).catch(() => {});
      const failed = Number(result?.failedCount || 0);
      notify(`${Number(result?.approvedCount || 0)} ID Card berhasil disetujui dan ditandatangani${failed ? `, ${failed} gagal` : ''}.`, failed ? 'warning' : 'success');
    } catch (error) {
      setModalError(error.message || 'Persetujuan ID Card gagal.');
    } finally {
      state.adminBusy = false;
      confirmButton.disabled = false;
      confirmButton.textContent = 'Setujui & TTD';
      renderAdminPending();
    }
  }

  function watchProfile() {
    const profile = page();
    if (!profile || state.profileObserver) return;
    state.profileObserver = new MutationObserver(() => {
      if (!profile.classList.contains('hidden')) loadProfile(false);
    });
    state.profileObserver.observe(profile, { attributes: true, attributeFilter: ['class'] });
    if (!profile.classList.contains('hidden')) loadProfile(false);
  }

  function startAdminBadgePolling() {
    if (!isIdCardAdmin()) return;
    mountAdminShell();
    loadAdmin(true);
    if (state.adminTimer) clearInterval(state.adminTimer);
    state.adminTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && token() && isIdCardAdmin()) loadAdmin(true);
    }, 60000);
  }

  function retryMount() {
    mountProfile();
    watchProfile();
    if (isIdCardAdmin()) mountAdminShell();
  }

  function init() {
    retryMount();
    if (isIdCardAdmin()) startAdminBadgePolling();
    [500, 1400].forEach((delay) => setTimeout(retryMount, delay));
  }

  window.AbsenDigitalIdentity = Object.freeze({
    refresh: () => loadProfile(true),
    request: () => requestCard(false),
    refreshAdmin: () => loadAdmin(true),
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
  window.addEventListener('absen:app-ready', init);
  window.addEventListener('absen:session-changed', () => {
    state.identity = null;
    state.loadedForUser = null;
    state.adminOverview = null;
    state.selected.clear();
    if (state.adminTimer) clearInterval(state.adminTimer);
    state.adminTimer = null;
    init();
  });
})();
