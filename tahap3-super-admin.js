(() => {
  'use strict';

  const state = { users: [], attendance: [], config: null, logs: [], loaded: false };
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const valueOf = (row, ...keys) => keys.map((key) => row?.[key]).find((value) => value !== undefined && value !== null && value !== '');
  const roleOf = (user) => String(valueOf(user, 'Role', 'role') || '').trim().toUpperCase().replace(/_/g, ' ');
  const isSuperAdmin = () => roleOf(window.AppState?.user) === 'SUPER ADMIN';
  const token = () => window.AppState?.token || localStorage.getItem('auth_token');

  function addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .stage3-hero{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;padding:1.25rem;background:linear-gradient(135deg,#0f172a,#312e81);color:#fff;border-radius:1rem;margin-bottom:1rem}
      .stage3-hero h2{font-size:1.35rem;margin-bottom:.35rem}.stage3-hero p{color:#cbd5e1;font-size:.875rem;line-height:1.5}
      .stage3-actions{display:flex;gap:.5rem;flex-wrap:wrap}.stage3-actions button{white-space:nowrap}
      .stage3-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.85rem;margin-bottom:1rem}
      .stage3-card{background:var(--surface);border:1px solid var(--border);border-radius:1rem;padding:1rem;box-shadow:var(--shadow)}
      .stage3-kpi-label{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted)}
      .stage3-kpi-value{font-size:1.7rem;font-weight:800;margin:.35rem 0}.stage3-kpi-note{font-size:.75rem;color:var(--text-secondary)}
      .stage3-two{display:grid;grid-template-columns:1.2fr .8fr;gap:1rem}.stage3-section-title{font-size:.95rem;font-weight:800;margin-bottom:.8rem}
      .stage3-sppg-row,.stage3-quality-row,.stage3-audit-row{display:grid;align-items:center;gap:.65rem;padding:.75rem 0;border-bottom:1px solid var(--border)}
      .stage3-sppg-row{grid-template-columns:minmax(120px,1fr) 80px 80px 90px}.stage3-quality-row{grid-template-columns:1fr auto}.stage3-audit-row{grid-template-columns:150px 1fr 140px}
      .stage3-progress{height:7px;background:#e2e8f0;border-radius:99px;overflow:hidden;margin-top:.35rem}.stage3-progress span{display:block;height:100%;background:var(--primary)}
      .stage3-badge{display:inline-flex;padding:.25rem .55rem;border-radius:999px;font-size:.7rem;font-weight:700}.stage3-badge.danger{background:#fee2e2;color:#b91c1c}.stage3-badge.warn{background:#fef3c7;color:#92400e}.stage3-badge.ok{background:#d1fae5;color:#047857}
      .stage3-tabs{display:flex;gap:.4rem;overflow:auto;margin-bottom:1rem}.stage3-tab{border:1px solid var(--border);background:var(--surface);padding:.65rem .85rem;border-radius:.75rem;font-weight:700;cursor:pointer;white-space:nowrap}.stage3-tab.active{background:var(--primary);color:#fff;border-color:var(--primary)}
      .stage3-panel{display:none}.stage3-panel.active{display:block}.stage3-setting{display:flex;justify-content:space-between;gap:1rem;padding:.9rem 0;border-bottom:1px solid var(--border)}.stage3-setting small{display:block;color:var(--text-muted);margin-top:.2rem}
      .stage3-toggle{width:44px;height:24px;border-radius:99px;background:#cbd5e1;position:relative;flex:none}.stage3-toggle::after{content:'';position:absolute;width:18px;height:18px;top:3px;left:3px;border-radius:50%;background:#fff}.stage3-toggle.on{background:var(--primary)}.stage3-toggle.on::after{left:23px}
      .stage3-empty{padding:1.5rem;text-align:center;color:var(--text-muted)}
      .stage3-diff{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-top:.5rem}.stage3-diff pre{white-space:pre-wrap;word-break:break-word;background:#f8fafc;border:1px solid var(--border);border-radius:.6rem;padding:.6rem;font-size:.72rem;max-height:180px;overflow:auto}
      @media(max-width:900px){.stage3-grid{grid-template-columns:repeat(2,1fr)}.stage3-two{grid-template-columns:1fr}.stage3-audit-row{grid-template-columns:1fr}.stage3-sppg-row{grid-template-columns:1fr 70px 70px}.stage3-sppg-row>:last-child{display:none}}
      @media(max-width:520px){.stage3-grid{grid-template-columns:1fr 1fr}.stage3-hero{flex-direction:column}.stage3-card{padding:.85rem}.stage3-kpi-value{font-size:1.4rem}}
    `;
    document.head.appendChild(style);
  }

  function navButton(view, label, icon) {
    const button = document.createElement('button');
    button.className = 'app-nav-item admin-only-nav super-admin-only-nav';
    button.dataset.view = view;
    button.style.display = 'none';
    button.type = 'button';
    button.innerHTML = `<span aria-hidden="true" style="width:18px;text-align:center">${icon}</span><span>${label}</span>`;
    return button;
  }

  function addNavigation() {
    const nav = document.querySelector('.app-nav');
    const configButton = nav?.querySelector('[data-view="admin-config"]');
    if (!nav || !configButton || nav.querySelector('[data-view="super-dashboard"]')) return;
    configButton.querySelector('span:last-child').textContent = 'Pengaturan Sistem';
    nav.insertBefore(navButton('super-dashboard', 'Dashboard Global', '◫'), configButton);
    nav.insertBefore(navButton('data-quality', 'Kualitas Data', '✓'), configButton);
    nav.insertBefore(navButton('audit-advanced', 'Audit Lanjutan', '↔'), configButton);
  }

  function addViews() {
    const content = document.querySelector('.app-content');
    if (!content || document.getElementById('view-super-dashboard')) return;
    content.insertAdjacentHTML('beforeend', `
      <section id="view-super-dashboard" class="app-view hidden"><div id="stage3-global-root"></div></section>
      <section id="view-data-quality" class="app-view hidden"><div id="stage3-quality-root"></div></section>
      <section id="view-audit-advanced" class="app-view hidden"><div id="stage3-audit-root"></div></section>
    `);
    enhanceSettingsView();
  }

  function enhanceSettingsView() {
    const view = document.getElementById('view-admin-config');
    if (!view || view.querySelector('.stage3-settings-head')) return;
    view.insertAdjacentHTML('afterbegin', `
      <div class="stage3-settings-head stage3-hero"><div><h2>Pengaturan Sistem</h2><p>Pusat kendali role, akses SPPG, menu, kebijakan absensi, payroll, notifikasi, serta keamanan sesi.</p></div></div>
      <div class="stage3-card" style="margin-bottom:1rem">
        <div class="stage3-tabs" id="stage3-settings-tabs">
          <button class="stage3-tab active" data-panel="access">Role & Akses</button><button class="stage3-tab" data-panel="menus">Visibilitas Menu</button><button class="stage3-tab" data-panel="attendance">Absensi & Geofence</button><button class="stage3-tab" data-panel="payroll">Payroll & TTD</button><button class="stage3-tab" data-panel="notifications">Notifikasi</button><button class="stage3-tab" data-panel="security">Keamanan & Sesi</button>
        </div>
        <div class="stage3-panel active" data-panel="access"><p style="color:var(--text-secondary);font-size:.85rem">Mapping akun ADMIN/AKUNTAN dan akses SPPG tetap dikelola melalui tabel konfigurasi di bawah.</p></div>
        <div class="stage3-panel" data-panel="menus">${settingRows([['Menu Pengaduan untuk USER',true],['Payroll untuk ADMIN',true],['Audit Log untuk ADMIN',true],['Pengaturan hanya SUPER ADMIN',true]])}</div>
        <div class="stage3-panel" data-panel="attendance">${settingRows([['Validasi geofence wajib',true],['Catat akurasi GPS',true],['Izinkan punch tunggal impor',true],['Koreksi absensi wajib audit',true]])}</div>
        <div class="stage3-panel" data-panel="payroll">${settingRows([['TTD penerima wajib',true],['TTD Akuntan wajib',true],['TTD Kepala SPPG wajib',true],['Signed URL PDF terbatas',true]])}</div>
        <div class="stage3-panel" data-panel="notifications">${settingRows([['Notifikasi slip baru',true],['Pengaduan mendapat tanggapan',true],['Absensi belum lengkap',true],['Pengumuman lintas role',false]])}</div>
        <div class="stage3-panel" data-panel="security">${settingRows([['Sesi berakhir setelah tidak aktif',true],['Cabut semua sesi setelah reset password',true],['Alasan wajib untuk tindakan berisiko',true],['Konfirmasi dua tahap',true]])}</div>
      </div>
    `);
    view.querySelectorAll('.stage3-tab').forEach((tab) => tab.addEventListener('click', () => {
      view.querySelectorAll('.stage3-tab,.stage3-panel').forEach((el) => el.classList.remove('active'));
      tab.classList.add('active');
      view.querySelector(`.stage3-panel[data-panel="${tab.dataset.panel}"]`)?.classList.add('active');
    }));
  }

  function settingRows(rows) {
    return rows.map(([label, enabled]) => `<div class="stage3-setting"><div><strong>${esc(label)}</strong><small>Status kebijakan saat ini; perubahan permanen memerlukan endpoint konfigurasi backend.</small></div><span class="stage3-toggle ${enabled ? 'on' : ''}" aria-label="${enabled ? 'Aktif' : 'Nonaktif'}"></span></div>`).join('');
  }

  async function loadData(force = false) {
    if (state.loaded && !force) return;
    const [usersResult, attendanceResult, configResult, logsResult] = await Promise.allSettled([
      window.apiCall('getOperationalUsersV2', { token: token() }),
      window.apiCall('getAbsensiGroupedDataV2', { token: token(), page: 1, pageSize: 1000 }),
      window.apiCall('getAdminConfiguration', { token: token() }),
      window.apiCall('getAuditLogEnriched', { token: token() })
    ]);
    state.users = usersResult.status === 'fulfilled' ? (Array.isArray(usersResult.value) ? usersResult.value : usersResult.value?.users || []) : [];
    state.attendance = attendanceResult.status === 'fulfilled' ? attendanceResult.value?.absensi || [] : [];
    state.config = configResult.status === 'fulfilled' ? configResult.value || {} : {};
    state.logs = logsResult.status === 'fulfilled' ? (Array.isArray(logsResult.value) ? logsResult.value : logsResult.value?.logs || []) : [];
    state.loaded = true;
  }

  function groupedSppg() {
    const map = new Map();
    state.users.forEach((user) => {
      const sppg = valueOf(user, 'SPPG', 'sppg') || 'Belum ditentukan';
      if (!map.has(sppg)) map.set(sppg, { name: sppg, users: 0, online: 0, attendance: 0, complete: 0 });
      const item = map.get(sppg); item.users += 1; if (user._online) item.online += 1;
    });
    state.attendance.forEach((row) => {
      const sppg = valueOf(row, 'sppg', 'SPPG') || 'Belum ditentukan';
      if (!map.has(sppg)) map.set(sppg, { name: sppg, users: 0, online: 0, attendance: 0, complete: 0 });
      const item = map.get(sppg); item.attendance += 1;
      if (row.jamMasuk && row.jamPulang) item.complete += 1;
    });
    return [...map.values()].sort((a,b) => b.users - a.users);
  }

  async function renderGlobal() {
    const root = document.getElementById('stage3-global-root'); if (!root) return;
    root.innerHTML = '<div class="loading-state"><span class="spinner"></span>Memuat dashboard global...</div>';
    await loadData(true);
    const sppg = groupedSppg();
    const activeUsers = state.users.filter((u) => !/NONAKTIF|DISABLED/i.test(String(valueOf(u,'Status_Akun','status_akun') || ''))).length;
    const incomplete = state.attendance.filter((row) => !(row.jamMasuk && row.jamPulang)).length;
    const admins = state.users.filter((u) => ['ADMIN','SUPER ADMIN'].includes(roleOf(u))).length;
    root.innerHTML = `
      <div class="stage3-hero"><div><h2>Dashboard Global SUPER ADMIN</h2><p>Pengawasan lintas SPPG, kualitas kehadiran, kesiapan akun, dan risiko operasional.</p></div><div class="stage3-actions"><button class="btn btn-primary" type="button" id="stage3-refresh">Muat Ulang</button></div></div>
      <div class="stage3-grid">
        ${kpi('SPPG terpantau', sppg.length, 'Unit dengan data aktif')}${kpi('Karyawan aktif', activeUsers, `${state.users.filter(u=>u._online).length} sedang online`)}${kpi('Punch tidak lengkap', incomplete, `${state.attendance.length} baris absensi dianalisis`)}${kpi('Admin aktif', admins, `${state.config?.access?.length || 0} mapping akses`)}
      </div>
      <div class="stage3-two"><div class="stage3-card"><div class="stage3-section-title">Perbandingan lintas SPPG</div>${sppg.length ? sppg.map(renderSppgRow).join('') : '<div class="stage3-empty">Belum ada data SPPG.</div>'}</div>
      <div class="stage3-card"><div class="stage3-section-title">Anomali utama</div>${qualityIssues().slice(0,6).map(renderQualityRow).join('') || '<div class="stage3-empty">Tidak ada anomali terdeteksi.</div>'}</div></div>`;
    document.getElementById('stage3-refresh')?.addEventListener('click', renderGlobal);
  }

  function kpi(label, value, note) { return `<div class="stage3-card"><div class="stage3-kpi-label">${esc(label)}</div><div class="stage3-kpi-value">${esc(value)}</div><div class="stage3-kpi-note">${esc(note)}</div></div>`; }
  function renderSppgRow(row) { const pct = row.attendance ? Math.round(row.complete / row.attendance * 100) : 0; return `<div class="stage3-sppg-row"><div><strong>${esc(row.name)}</strong><div class="stage3-progress"><span style="width:${pct}%"></span></div></div><div><strong>${row.users}</strong><small style="display:block;color:var(--text-muted)">user</small></div><div><strong>${pct}%</strong><small style="display:block;color:var(--text-muted)">lengkap</small></div><div>${row.online} online</div></div>`; }

  function qualityIssues() {
    const missingDivision = state.users.filter((u) => !valueOf(u,'Jabatan_Divisi','jabatan_divisi')).length;
    const missingSalary = state.users.filter((u) => !Number(valueOf(u,'Gaji_Harian','gaji_harian'))).length;
    const missingBank = state.users.filter((u) => !valueOf(u,'Nomor_Rekening','nomor_rekening') || !valueOf(u,'Nama_Bank','nama_bank')).length;
    const missingSppg = state.users.filter((u) => !valueOf(u,'SPPG','sppg')).length;
    const noFace = state.users.filter((u) => !valueOf(u,'Wajah_Terdaftar','wajah_terdaftar')).length;
    const incompletePunch = state.attendance.filter((row) => !(row.jamMasuk && row.jamPulang)).length;
    const inactiveOnline = state.users.filter((u) => u._online && /NONAKTIF|DISABLED/i.test(String(valueOf(u,'Status_Akun','status_akun') || ''))).length;
    const duplicateNames = Object.values(state.users.reduce((acc,u)=>{const n=String(valueOf(u,'Nama_Lengkap','nama_lengkap')||'').trim().toLowerCase();if(n)acc[n]=(acc[n]||0)+1;return acc;},{})).filter(v=>v>1).length;
    return [
      ['Akun tanpa divisi', missingDivision, 'warn'],['Akun tanpa gaji harian', missingSalary, 'danger'],['Rekening belum lengkap', missingBank, 'warn'],['Akun tanpa SPPG', missingSppg, 'danger'],['Data wajah belum terdaftar', noFace, 'warn'],['Punch datang/pulang tidak lengkap', incompletePunch, 'danger'],['Akun nonaktif masih online', inactiveOnline, 'danger'],['Nama pengguna terindikasi ganda', duplicateNames, 'warn']
    ].filter(([,count]) => count > 0);
  }
  function renderQualityRow([label,count,severity]) { return `<div class="stage3-quality-row"><span>${esc(label)}</span><span class="stage3-badge ${severity}">${count}</span></div>`; }

  async function renderQuality() {
    const root = document.getElementById('stage3-quality-root'); if (!root) return;
    root.innerHTML = '<div class="loading-state"><span class="spinner"></span>Memeriksa kualitas data...</div>';
    await loadData(true); const issues = qualityIssues();
    root.innerHTML = `<div class="stage3-hero"><div><h2>Pusat Kualitas Data</h2><p>Mendeteksi data pengguna, kehadiran, dan sesi yang perlu diperbaiki sebelum berdampak ke payroll.</p></div></div><div class="stage3-card"><div class="stage3-section-title">${issues.length} kategori masalah ditemukan</div>${issues.map(renderQualityRow).join('') || '<div class="stage3-empty">Semua pemeriksaan dasar lolos.</div>'}</div>`;
  }

  function extractDiff(detail) {
    if (!detail || typeof detail !== 'object') return null;
    const before = detail.before || detail.sebelum || detail.old || detail.oldData || detail.dataSebelum;
    const after = detail.after || detail.sesudah || detail.new || detail.newData || detail.dataSesudah;
    return before || after ? { before: before || {}, after: after || {} } : null;
  }

  async function renderAudit() {
    const root = document.getElementById('stage3-audit-root'); if (!root) return;
    root.innerHTML = '<div class="loading-state"><span class="spinner"></span>Memuat audit lanjutan...</div>';
    await loadData(true);
    root.innerHTML = `<div class="stage3-hero"><div><h2>Audit Log Lanjutan</h2><p>Pelacakan pelaku, role, SPPG, objek, dan perubahan nilai sebelum → sesudah.</p></div></div><div class="stage3-card"><input id="stage3-audit-search" class="form-input" placeholder="Cari pelaku, aktivitas, role, atau SPPG" style="margin-bottom:1rem"><div id="stage3-audit-list"></div></div>`;
    const render = () => {
      const query = document.getElementById('stage3-audit-search').value.toLowerCase();
      const rows = state.logs.filter((log) => JSON.stringify(log).toLowerCase().includes(query)).slice(0,100);
      document.getElementById('stage3-audit-list').innerHTML = rows.length ? rows.map((log) => {
        const diff = extractDiff(log.Detail); const actor = log._pelakuNama || log._pelakuEmail || 'Tidak diketahui';
        return `<article class="stage3-audit-row"><time>${esc(typeof window.formatWaktu === 'function' ? window.formatWaktu(log.Waktu) : log.Waktu || '-')}</time><div><strong>${esc(log.Jenis_Aktivitas || 'Aktivitas')}</strong><div style="font-size:.78rem;color:var(--text-muted);margin-top:.25rem">${esc(actor)} · ${esc(log._pelakuRole || log.Role || '-')} · ${esc(log.SPPG || log.Detail?.SPPG || '-')}</div>${diff ? `<div class="stage3-diff"><pre><strong>Sebelum</strong>\n${esc(JSON.stringify(diff.before,null,2))}</pre><pre><strong>Sesudah</strong>\n${esc(JSON.stringify(diff.after,null,2))}</pre></div>` : ''}</div><span class="stage3-badge ok">Tercatat</span></article>`;
      }).join('') : '<div class="stage3-empty">Tidak ada log yang cocok.</div>';
    };
    document.getElementById('stage3-audit-search').addEventListener('input', render); render();
  }

  function hookViews() {
    const original = window.switchView;
    if (typeof original !== 'function' || original.__stage3Wrapped) return false;
    const wrapped = function(view) {
      original(view);
      if (!isSuperAdmin()) return;
      if (view === 'super-dashboard') renderGlobal();
      if (view === 'data-quality') renderQuality();
      if (view === 'audit-advanced') renderAudit();
    };
    wrapped.__stage3Wrapped = true; window.switchView = wrapped;
    document.querySelectorAll('[data-view]').forEach((button) => {
      if (button.dataset.stage3Bound) return;
      button.dataset.stage3Bound = '1';
      button.addEventListener('click', () => {
        const view = button.dataset.view;
        if (['super-dashboard','data-quality','audit-advanced'].includes(view)) wrapped(view);
      });
    });
    return true;
  }

  function boot() {
    if (!document.querySelector('.app-content')) return setTimeout(boot, 100);
    addStyles(); addNavigation(); addViews();
    const bind = () => { if (!hookViews()) setTimeout(bind, 100); else if (isSuperAdmin()) document.querySelectorAll('.super-admin-only-nav').forEach((el) => el.style.display = ''); };
    bind();
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();
})();
