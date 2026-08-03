(() => {
  const state = { tab: 'dashboard', incidentPage: 1, auditPage: 1 };
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const role = () => String(window.AppState?.user?.Role || window.AppState?.user?.role || '').toUpperCase().replace(/_/g, ' ');
  const isOperator = () => ['ADMIN', 'SUPER ADMIN', 'AKUNTAN'].includes(role());
  const formatDate = (value) => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '-';
  const badge = (value) => `<span class="security-ui-badge ${esc(String(value || '').toLowerCase())}">${esc(value || '-')}</span>`;

  function injectShell() {
    if (document.getElementById('security-ui-shell')) return;
    const shell = document.createElement('div');
    shell.id = 'security-ui-shell';
    shell.className = 'security-ui-shell';
    shell.innerHTML = `<section class="security-ui-panel" role="dialog" aria-modal="true" aria-labelledby="security-ui-title">
      <header class="security-ui-header"><div><h2 id="security-ui-title" class="security-ui-title">Security Operations</h2><p class="security-ui-subtitle">Insiden, audit keamanan, kesehatan layanan, dan perangkat.</p></div><button class="security-ui-close" data-security-close>✕ Tutup</button></header>
      <nav class="security-ui-tabs" aria-label="Security Operations"><button class="security-ui-tab active" data-security-tab="dashboard">Dashboard</button><button class="security-ui-tab" data-security-tab="incidents">Incident Center</button><button class="security-ui-tab" data-security-tab="audit">Audit Explorer</button><button class="security-ui-tab" data-security-tab="devices">Perangkat</button></nav>
      <main id="security-ui-content"></main>
    </section>`;
    document.body.appendChild(shell);
    shell.addEventListener('click', (event) => { if (event.target === shell || event.target.closest('[data-security-close]')) close(); });
    shell.querySelectorAll('[data-security-tab]').forEach((button) => button.addEventListener('click', () => { state.tab = button.dataset.securityTab; shell.querySelectorAll('[data-security-tab]').forEach((item) => item.classList.toggle('active', item === button)); load(); }));
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && shell.classList.contains('active')) close(); });
  }

  function injectLaunchers() {
    if (!document.getElementById('security-ui-devices-launcher')) {
      const deviceButton = document.createElement('button');
      deviceButton.id = 'security-ui-devices-launcher';
      deviceButton.className = 'security-ui-launcher secondary';
      deviceButton.textContent = 'Perangkat Saya';
      deviceButton.hidden = !localStorage.getItem('auth_token');
      deviceButton.addEventListener('click', () => open('devices'));
      document.body.appendChild(deviceButton);
    }
    if (isOperator() && !document.getElementById('security-ui-launcher')) {
      const button = document.createElement('button');
      button.id = 'security-ui-launcher';
      button.className = 'security-ui-launcher';
      button.textContent = 'Security Ops';
      button.addEventListener('click', () => open('dashboard'));
      document.body.appendChild(button);
    }
  }

  function open(tab = 'dashboard') {
    injectShell();
    state.tab = tab;
    const shell = document.getElementById('security-ui-shell');
    shell.classList.add('active');
    shell.querySelectorAll('[data-security-tab]').forEach((button) => button.classList.toggle('active', button.dataset.securityTab === tab));
    shell.querySelector('[data-security-tab="dashboard"]').hidden = !isOperator();
    shell.querySelector('[data-security-tab="incidents"]').hidden = !isOperator();
    shell.querySelector('[data-security-tab="audit"]').hidden = !isOperator();
    load();
  }
  function close() { document.getElementById('security-ui-shell')?.classList.remove('active'); }
  function content(html) { const node = document.getElementById('security-ui-content'); if (node) node.innerHTML = html; }
  function loading() { content('<div class="security-ui-loading">Memuat data keamanan…</div>'); }
  function failure(error) { content(`<div class="security-ui-error"><strong>Data gagal dimuat.</strong><br>${esc(error?.message || error)}${error?.requestId ? `<br>Kode: ${esc(error.requestId)}` : ''}</div>`); }

  async function loadDashboard() {
    const data = await window.SecurityOpsClient.getDashboard();
    const s = data.summary || {};
    const cards = [
      ['Security event', s.securityEvents ?? s.security_events ?? 0], ['Risiko tinggi', s.highRiskEvents ?? s.high_risk_events ?? 0], ['Insiden terbuka', s.openIncidents ?? s.open_incidents ?? 0], ['Insiden kritis', s.criticalIncidents ?? s.critical_incidents ?? 0],
      ['Device pending', s.pendingDevices ?? s.pending_devices ?? 0], ['Device diblokir', s.blockedDevices ?? s.blocked_devices ?? 0], ['Challenge gagal', s.failedChallenges ?? s.failed_challenges ?? 0], ['Request ditolak', s.rejectedEvents ?? s.rejected_events ?? 0]
    ];
    content(`<div class="security-ui-grid">${cards.map(([label, value]) => `<article class="security-ui-card"><div class="security-ui-kpi-label">${esc(label)}</div><div class="security-ui-kpi-value">${esc(value)}</div></article>`).join('')}</div>
      <section class="security-ui-section"><h3 class="security-ui-section-title">Insiden terbaru</h3>${incidentTable(data.incidents || [])}</section>
      <section class="security-ui-section"><h3 class="security-ui-section-title">Event terbaru</h3>${auditTable(data.recentEvents || [])}</section>
      <section class="security-ui-section"><h3 class="security-ui-section-title">Kesehatan layanan</h3>${healthTable(data.health || [])}</section>`);
  }

  function incidentTable(rows) {
    if (!rows.length) return '<div class="security-ui-empty">Tidak ada insiden.</div>';
    return `<div class="security-ui-table-wrap"><table class="security-ui-table"><thead><tr><th>Judul</th><th>Severity</th><th>Status</th><th>User</th><th>Risk</th><th>Diperbarui</th><th>Aksi</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${esc(row.Title)}</td><td>${badge(row.Severity)}</td><td>${badge(row.Status)}</td><td>${esc(row.ID_User || '-')}</td><td>${esc(row.Risk_Score ?? 0)}</td><td>${formatDate(row.Updated_At || row.Created_At)}</td><td><button class="security-ui-button secondary" data-incident-id="${esc(row.Incident_ID)}">Tinjau</button></td></tr>`).join('')}</tbody></table></div>`;
  }
  function auditTable(rows) {
    if (!rows.length) return '<div class="security-ui-empty">Tidak ada event keamanan.</div>';
    return `<div class="security-ui-table-wrap"><table class="security-ui-table"><thead><tr><th>Waktu</th><th>Event</th><th>Hasil</th><th>Risk</th><th>User</th><th>Device</th><th>Request ID</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${formatDate(row.Created_At)}</td><td>${esc(row.Event_Type)}</td><td>${badge(row.Result)}</td><td>${badge(row.Risk_Level)} ${esc(row.Risk_Score ?? 0)}</td><td>${esc(row.ID_User || '-')}</td><td>${esc(row.Device_ID || '-')}</td><td>${esc(row.Request_ID || '-')}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function healthTable(rows) {
    if (!rows.length) return '<div class="security-ui-empty">Belum ada health metric.</div>';
    return `<div class="security-ui-table-wrap"><table class="security-ui-table"><thead><tr><th>Layanan</th><th>Metrik</th><th>Nilai</th><th>Status</th><th>Waktu</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${esc(row.Service_Name)}</td><td>${esc(row.Metric_Name)}</td><td>${esc(row.Metric_Value)} ${esc(row.Unit || '')}</td><td>${badge(row.Status)}</td><td>${formatDate(row.Recorded_At)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  async function loadIncidents() {
    const filters = { page: state.incidentPage, pageSize: 25, status: document.getElementById('security-incident-status')?.value || undefined, severity: document.getElementById('security-incident-severity')?.value || undefined, userId: document.getElementById('security-incident-user')?.value || undefined };
    const data = await window.SecurityOpsClient.listIncidents(filters);
    content(`<div class="security-ui-toolbar"><select id="security-incident-status" class="security-ui-select"><option value="">Semua status</option><option>OPEN</option><option>INVESTIGATING</option><option>CONFIRMED</option><option>RESOLVED</option><option>FALSE_POSITIVE</option></select><select id="security-incident-severity" class="security-ui-select"><option value="">Semua severity</option><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option></select><input id="security-incident-user" class="security-ui-input" placeholder="ID User"><button id="security-incident-filter" class="security-ui-button">Terapkan</button></div>${incidentTable(data.incidents || [])}`);
    document.getElementById('security-incident-filter')?.addEventListener('click', () => loadIncidents().catch(failure));
    document.querySelectorAll('[data-incident-id]').forEach((button) => button.addEventListener('click', () => reviewIncident(button.dataset.incidentId)));
  }

  async function reviewIncident(incidentId) {
    const status = prompt('Status baru: OPEN, INVESTIGATING, CONFIRMED, RESOLVED, atau FALSE_POSITIVE', 'INVESTIGATING');
    if (!status) return;
    const note = prompt('Catatan investigasi (opsional)', '') || '';
    await window.SecurityOpsClient.updateIncident(incidentId, status.toUpperCase(), { note, resolutionNotes: ['RESOLVED', 'FALSE_POSITIVE'].includes(status.toUpperCase()) ? note : undefined });
    await loadIncidents();
  }

  async function loadAudit() {
    const filters = { page: state.auditPage, pageSize: 50, userId: document.getElementById('security-audit-user')?.value || undefined, riskLevel: document.getElementById('security-audit-risk')?.value || undefined, result: document.getElementById('security-audit-result')?.value || undefined, eventType: document.getElementById('security-audit-event')?.value || undefined };
    const data = await window.SecurityOpsClient.exploreAudit(filters);
    content(`<div class="security-ui-toolbar"><input id="security-audit-user" class="security-ui-input" placeholder="ID User"><select id="security-audit-risk" class="security-ui-select"><option value="">Semua risk</option><option>LOW</option><option>MEDIUM</option><option>HIGH</option></select><select id="security-audit-result" class="security-ui-select"><option value="">Semua hasil</option><option>SUCCESS</option><option>REJECTED</option><option>FAILED</option></select><input id="security-audit-event" class="security-ui-input" placeholder="Jenis event"><button id="security-audit-filter" class="security-ui-button">Terapkan</button></div>${auditTable(data.events || [])}`);
    document.getElementById('security-audit-filter')?.addEventListener('click', () => loadAudit().catch(failure));
  }

  async function loadDevices() {
    const own = await window.getMyAttendanceDevices?.() || [];
    let queue = [];
    if (isOperator()) { try { queue = await window.getAttendanceDeviceReviewQueue?.('PENDING') || []; } catch { queue = []; } }
    const deviceRows = (rows, admin) => rows.length ? `<div class="security-ui-table-wrap"><table class="security-ui-table"><thead><tr><th>Perangkat</th><th>Platform</th><th>Status</th><th>Terakhir aktif</th><th>Risk</th><th>Aksi</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${esc(row.Device_Name || row.deviceName || row.Device_ID)}</td><td>${esc(row.Platform || '-')} · ${esc(row.Browser || '-')}</td><td>${badge(row.Status)}</td><td>${formatDate(row.Last_Seen_At || row.Updated_At)}</td><td>${esc(row.Risk_Score ?? 0)}</td><td>${admin ? `<button class="security-ui-button" data-device-approve="${esc(row.Device_ID)}">Setujui</button> <button class="security-ui-button danger" data-device-block="${esc(row.Device_ID)}">Blokir</button>` : `<button class="security-ui-button danger" data-device-revoke="${esc(row.Device_ID)}">Cabut</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<div class="security-ui-empty">Tidak ada perangkat.</div>';
    content(`<section><h3 class="security-ui-section-title">Perangkat Saya</h3>${deviceRows(own, false)}</section>${isOperator() ? `<section class="security-ui-section"><h3 class="security-ui-section-title">Menunggu Persetujuan</h3>${deviceRows(queue, true)}</section>` : ''}`);
    document.querySelectorAll('[data-device-revoke]').forEach((button) => button.addEventListener('click', async () => { if (confirm('Cabut perangkat ini?')) { await window.revokeMyAttendanceDevice(button.dataset.deviceRevoke); loadDevices().catch(failure); } }));
    document.querySelectorAll('[data-device-approve]').forEach((button) => button.addEventListener('click', async () => { const reason = prompt('Alasan persetujuan (minimal 10 karakter)', 'Perangkat telah diverifikasi oleh Admin.'); if (reason) { await window.reviewAttendanceDevice(button.dataset.deviceApprove, 'TRUSTED', reason); loadDevices().catch(failure); } }));
    document.querySelectorAll('[data-device-block]').forEach((button) => button.addEventListener('click', async () => { const reason = prompt('Alasan pemblokiran (minimal 10 karakter)', 'Perangkat terindikasi tidak sah.'); if (reason) { await window.reviewAttendanceDevice(button.dataset.deviceBlock, 'BLOCKED', reason); loadDevices().catch(failure); } }));
  }

  async function load() {
    loading();
    try {
      if (!window.SecurityOpsClient && state.tab !== 'devices') throw new Error('SecurityOps client belum tersedia.');
      if (state.tab === 'dashboard') await loadDashboard();
      else if (state.tab === 'incidents') await loadIncidents();
      else if (state.tab === 'audit') await loadAudit();
      else await loadDevices();
    } catch (error) { failure(error); }
  }

  function boot() {
    injectShell();
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      injectLaunchers();
      if ((window.SecurityOpsClient && localStorage.getItem('auth_token')) || attempts > 60) clearInterval(timer);
    }, 1000);
  }
  window.SecurityOperationsUI = Object.freeze({ open, close, refresh: load });
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();
})();