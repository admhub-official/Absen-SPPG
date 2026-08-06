(() => {
  if (window.AbsenDigitalIdentity) return;

  const state = {
    identity: null,
    busy: false,
    mounted: false,
    loadedForUser: null,
    profileObserver: null
  };

  const token = () => localStorage.getItem('auth_token');
  const currentUser = () => {
    try { return JSON.parse(localStorage.getItem('auth_user') || 'null'); }
    catch { return null; }
  };
  const userId = () => String(currentUser()?.idUser || currentUser()?.ID_User || '');
  const page = () => document.querySelector('#view-profil');
  const section = () => document.querySelector('#digital-identity-section');
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const safeUrl = (value) => {
    try {
      const url = new URL(String(value || ''), window.location.origin);
      if (!['https:', 'http:', 'blob:'].includes(url.protocol)) return '';
      return url.href;
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

  function mount() {
    const profile = page();
    if (!profile || section()) return Boolean(section());

    const node = document.createElement('section');
    node.className = 'info-section digital-identity-section';
    node.id = 'digital-identity-section';
    node.setAttribute('aria-labelledby', 'digital-identity-title');
    node.innerHTML = `
      <div class="digital-identity-heading">
        <div class="info-section-title" id="digital-identity-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h4M7 12h6M7 16h4"/><path d="M16 9h2v2h-2zM16 14h2v2h-2z"/>
          </svg>
          QR Code &amp; ID Card Digital
        </div>
        <span class="digital-identity-status" id="digital-identity-status">Memuat...</span>
      </div>
      <p class="digital-identity-intro">
        Buat kartu identitas digital dengan QR verifikasi aman. QR tidak menyimpan password, nomor rekening, atau data biometrik.
      </p>
      <div id="digital-identity-message" class="digital-identity-message" role="status" aria-live="polite"></div>
      <div class="digital-identity-content" id="digital-identity-content">
        <div class="digital-identity-skeleton" aria-label="Memuat identitas digital">
          <span></span><span></span><span></span>
        </div>
      </div>
      <div class="digital-identity-actions" aria-label="Aksi QR Code dan ID Card">
        <button type="button" class="digital-identity-action digital-identity-action-primary" data-digital-id-action="generate">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          <span data-generate-label>Buat Identitas</span>
        </button>
        <button type="button" class="digital-identity-action" data-digital-id-action="download-card" disabled>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>
          <span>Unduh ID Card</span>
        </button>
        <button type="button" class="digital-identity-action" data-digital-id-action="print-card" disabled>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/></svg>
          <span>Cetak ID Card</span>
        </button>
        <button type="button" class="digital-identity-action digital-identity-action-qr" data-digital-id-action="download-qr" disabled>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM18 18h3v3h-3zM18 14h3"/></svg>
          <span>Unduh QR</span>
        </button>
        <button type="button" class="digital-identity-action digital-identity-action-qr" data-digital-id-action="print-qr" disabled>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/></svg>
          <span>Cetak QR</span>
        </button>
      </div>
      <div class="digital-identity-security-row" id="digital-identity-security-row" hidden>
        <div>
          <strong>QR perlu diganti?</strong>
          <span>Regenerasi akan menonaktifkan QR lama dan membuat versi baru.</span>
        </div>
        <button type="button" class="digital-identity-regenerate" data-digital-id-action="regenerate">Regenerasi QR &amp; ID Card</button>
      </div>`;

    const securitySection = profile.querySelector('#p-id-card-digital')?.closest('.info-section');
    if (securitySection) securitySection.before(node);
    else profile.appendChild(node);

    node.addEventListener('click', handleAction);
    state.mounted = true;
    render();
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
    section()?.querySelectorAll('button').forEach((button) => {
      if (busy) {
        button.dataset.wasDisabled = String(button.disabled);
        button.disabled = true;
      } else if (button.dataset.wasDisabled !== 'true') {
        button.disabled = false;
      }
      if (!busy) delete button.dataset.wasDisabled;
    });
    if (message) setMessage(message, 'info');
  }

  function updateLegacyStatus(hasCard) {
    const idStatus = document.querySelector('#p-id-card-digital');
    const qrStatus = document.querySelector('#p-qr-code');
    if (idStatus) idStatus.textContent = hasCard ? 'Tersedia' : 'Belum Tersedia';
    if (qrStatus) qrStatus.textContent = hasCard ? 'Tersedia' : 'Belum Tersedia';
  }

  function cardPreview(profile, card) {
    const photo = safeUrl(profile.fotoUrl);
    const qr = safeUrl(card?.qrPngUrl);
    return `
      <article class="digital-id-preview" aria-label="Pratinjau ID Card digital">
        <div class="digital-id-card-face digital-id-card-front">
          <div class="digital-id-card-brand">
            <span class="digital-id-card-logo"><img src="./icons/app-icon.svg" alt=""></span>
            <span><strong>Hadirly</strong><small>ABSENSI &amp; PAYROLL DIGITAL</small></span>
          </div>
          <div class="digital-id-card-body">
            <div class="digital-id-card-photo">${photo
              ? `<img src="${esc(photo)}" alt="Foto ${esc(profile.namaLengkap)}">`
              : `<span>${esc(initials(profile.namaLengkap))}</span>`}</div>
            <div class="digital-id-card-copy">
              <strong title="${esc(profile.namaLengkap)}">${esc(profile.namaLengkap)}</strong>
              <span>${esc(profile.jabatan === '-' ? profile.role : profile.jabatan)}</span>
              <small>SPPG</small>
              <b>${esc(profile.sppg)}</b>
              <small>ID CARD</small>
              <code>${esc(profile.idCardCode)}</code>
            </div>
            <div class="digital-id-card-mini-qr">${qr
              ? `<img src="${esc(qr)}" alt="QR verifikasi ID Card">`
              : '<span aria-hidden="true">QR</span>'}</div>
          </div>
        </div>
        <div class="digital-id-preview-caption">
          <span>Ukuran cetak standar CR80</span>
          <span>85,60 × 53,98 mm</span>
        </div>
      </article>`;
  }

  function qrPreview(profile, card) {
    const qr = safeUrl(card?.qrPngUrl);
    return `
      <article class="digital-qr-preview" aria-label="Pratinjau QR Code identitas">
        <div class="digital-qr-icon">${qr
          ? `<img src="${esc(qr)}" alt="QR Code ${esc(profile.namaLengkap)}">`
          : `<svg width="76" height="76" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM18 18h3v3h-3zM18 14h3"/></svg>`}</div>
        <div class="digital-qr-copy">
          <strong>${card ? 'QR Aktif' : 'QR Belum Dibuat'}</strong>
          <span>${esc(profile.idCardCode)}</span>
          <small>${card ? `Versi ${Number(card.version)} · ${esc(card.generatedAtLabel)}` : 'Buat identitas digital untuk menghasilkan QR verifikasi.'}</small>
        </div>
        ${card ? `<div class="digital-qr-verified"><span></span>${Number(card.verificationCount || 0)} kali diverifikasi</div>` : ''}
      </article>`;
  }

  function render() {
    const root = section();
    if (!root) return;
    const content = root.querySelector('#digital-identity-content');
    const status = root.querySelector('#digital-identity-status');
    const generateLabel = root.querySelector('[data-generate-label]');
    const securityRow = root.querySelector('#digital-identity-security-row');
    const identity = state.identity;

    if (!identity) {
      status.textContent = 'Belum dimuat';
      status.className = 'digital-identity-status';
      content.innerHTML = '<div class="digital-identity-empty"><strong>Identitas digital belum dimuat</strong><span>Buka kembali halaman Profil atau tekan Buat Identitas.</span></div>';
      updateLegacyStatus(false);
      return;
    }

    const hasCard = Boolean(identity.hasCard && identity.card);
    const profile = identity.profile;
    status.textContent = hasCard ? 'Aktif' : 'Belum Dibuat';
    status.className = `digital-identity-status ${hasCard ? 'is-active' : 'is-empty'}`;
    generateLabel.textContent = hasCard ? 'Muat Ulang' : 'Buat Identitas';
    content.innerHTML = `
      <div class="digital-identity-preview-grid">
        ${cardPreview(profile, identity.card)}
        ${qrPreview(profile, identity.card)}
      </div>
      <dl class="digital-identity-meta">
        <div><dt>Kode ID Card</dt><dd>${esc(profile.idCardCode)}</dd></div>
        <div><dt>Status</dt><dd>${hasCard ? 'Aktif dan dapat diverifikasi' : 'Belum diterbitkan'}</dd></div>
        <div><dt>Versi</dt><dd>${hasCard ? Number(identity.card.version) : '-'}</dd></div>
        <div><dt>Terakhir dibuat</dt><dd>${hasCard ? esc(identity.card.generatedAtLabel) : '-'}</dd></div>
      </dl>`;

    root.querySelectorAll('[data-digital-id-action="download-card"], [data-digital-id-action="print-card"], [data-digital-id-action="download-qr"], [data-digital-id-action="print-qr"]')
      .forEach((button) => { button.disabled = !hasCard || state.busy; });
    if (securityRow) securityRow.hidden = !hasCard;
    updateLegacyStatus(hasCard);
  }

  async function load(force = false) {
    if (!token() || !mount() || state.busy) return;
    const id = userId();
    if (!force && state.identity && state.loadedForUser === id) {
      render();
      return;
    }
    setBusy(true, 'Memuat QR Code dan ID Card...');
    try {
      state.identity = await api('getMyDigitalIdentity');
      state.loadedForUser = id;
      setMessage('');
      render();
    } catch (error) {
      setMessage(error.message || 'Identitas digital gagal dimuat.', 'error');
      notify(error.message || 'Identitas digital gagal dimuat.', 'error');
    } finally {
      setBusy(false);
      render();
    }
  }

  async function generate(regenerate = false) {
    if (state.busy) return;
    if (regenerate) {
      const approved = window.confirm(
        'QR lama akan langsung dinonaktifkan. Lanjutkan membuat QR dan ID Card versi baru?'
      );
      if (!approved) return;
    }
    setBusy(true, regenerate ? 'Membuat versi baru...' : 'Membuat QR dan ID Card...');
    try {
      state.identity = await api(
        regenerate ? 'regenerateMyDigitalIdentity' : 'generateMyDigitalIdentity',
        regenerate ? { confirmation: 'REGENERATE' } : {}
      );
      state.loadedForUser = userId();
      setMessage(regenerate
        ? 'QR lama telah dinonaktifkan dan versi baru berhasil dibuat.'
        : 'QR Code dan ID Card berhasil dibuat.', 'success');
      notify(regenerate ? 'Identitas digital berhasil diperbarui.' : 'QR Code dan ID Card berhasil dibuat.', 'success');
    } catch (error) {
      setMessage(error.message || 'Identitas digital gagal dibuat.', 'error');
      notify(error.message || 'Identitas digital gagal dibuat.', 'error');
    } finally {
      setBusy(false);
      render();
    }
  }

  async function download(url, filename) {
    const resolved = safeUrl(url);
    if (!resolved) throw new Error('Tautan berkas tidak tersedia. Muat ulang identitas digital.');
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
    if (!resolved) throw new Error('Tautan cetak tidak tersedia. Muat ulang identitas digital.');
    const opened = window.open(resolved, '_blank', 'noopener,noreferrer');
    if (!opened) throw new Error('Popup diblokir browser. Izinkan popup untuk membuka halaman cetak.');
  }

  async function handleAction(event) {
    const button = event.target.closest?.('[data-digital-id-action]');
    if (!button || state.busy) return;
    const action = button.dataset.digitalIdAction;
    try {
      if (action === 'generate') {
        if (state.identity?.hasCard) await load(true);
        else await generate(false);
      } else if (action === 'regenerate') {
        await generate(true);
      } else if (action === 'download-card') {
        await download(state.identity?.card?.idCardPdfUrl, `ID-Card-${state.identity?.profile?.idCardCode || 'Hadirly'}.pdf`);
      } else if (action === 'print-card') {
        printPdf(state.identity?.card?.idCardPdfUrl);
      } else if (action === 'download-qr') {
        await download(state.identity?.card?.qrPdfUrl, `QR-ID-${state.identity?.profile?.idCardCode || 'Hadirly'}.pdf`);
      } else if (action === 'print-qr') {
        printPdf(state.identity?.card?.qrPdfUrl);
      }
    } catch (error) {
      notify(error.message || 'Aksi identitas digital gagal.', 'error');
    }
  }

  function watchProfile() {
    const profile = page();
    if (!profile || state.profileObserver) return;
    state.profileObserver = new MutationObserver(() => {
      if (!profile.classList.contains('hidden')) load(false);
    });
    state.profileObserver.observe(profile, { attributes: true, attributeFilter: ['class'] });
    if (!profile.classList.contains('hidden')) load(false);
  }

  function init() {
    mount();
    watchProfile();
    setTimeout(() => { mount(); watchProfile(); }, 400);
    setTimeout(() => { mount(); watchProfile(); }, 1200);
  }

  window.AbsenDigitalIdentity = Object.freeze({
    refresh: () => load(true),
    generate: () => generate(false),
    regenerate: () => generate(true)
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
  window.addEventListener('absen:app-ready', init);
  window.addEventListener('absen:session-changed', () => {
    state.identity = null;
    state.loadedForUser = null;
    init();
  });
})();
