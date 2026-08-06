(() => {
  if (window.SuperAdminDashboard) return;

  const state = { loading: false, loadedAt: 0, data: null };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const role = () => String(window.AppState?.user?.Role || window.AppState?.user?.role || '').trim().toUpperCase().replace(/_/g, ' ');
  const isSuperAdmin = () => role() === 'SUPER ADMIN';
  const rupiah = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
  const number = (value) => new Intl.NumberFormat('id-ID').format(Number(value) || 0);

  function icon(name) {
    const icons = {
      sppg: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 10h2m2 0h2M9 14h2m2 0h2M9 18h6"/>',
      attendance: '<path d="M9 11l3 3L22 4"/><path d="M21 12a9 9 0 1 1-5.3-8.2"/>',
      payroll: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/>',
      admins: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6m3-3h-6"/>',
      warning: '<path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/>',
      refresh: '<path d="M20 6v6h-6M4 18v-6h6"/><path d="M18.5 9A7 7 0 0 0 6 6.5L4 9m2 6a7 7 0 0 0 12 2.5L20 15"/>'
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.warning}</svg>`;
  }

  function qualityCount(quality, key) {
    return Array.isArray(quality?.[key]) ? quality[key].length : Number(quality?.[key] || 0);
  }

  function render(data) {
    const dashboard = document.getElementById('view-dashboard');
    if (!dashboard || !isSuperAdmin()) return;
    dashboard.classList.add('super-admin-dashboard-active');

    let root = document.getElementById('super-admin-overview');
    if (!root) {
      root = document.createElement('section');
      root.id = 'super-admin-overview';
      root.className = 'sa-overview';
      dashboard.prepend(root);
    }

    const totals = data?.totals || {};
    const quality = data?.quality || {};
    const rows = Array.isArray(data?.bySppg) ? data.bySppg : [];
    const issues = [
      ['Nama duplikat', qualityCount(quality, 'duplicateNames'), 'Perlu verifikasi identitas'],
      ['Divisi kosong', qualityCount(quality, 'withoutDivision'), 'Lengkapi jabatan/divisi'],
      ['Gaji belum diatur', qualityCount(quality, 'withoutSalary'), 'Lengkapi gaji harian'],
      ['Rekening belum lengkap', qualityCount(quality, 'withoutBank'), 'Lengkapi data pembayaran'],
      ['Slip tanpa PDF', qualityCount(quality, 'slipsWithoutPdf'), 'Periksa penerbitan slip'],
      ['Sesi akun nonaktif', qualityCount(quality, 'inactiveWithSession'), 'Cabut sesi yang tersisa']
    ];
    const totalIssues = issues.reduce((sum, [, count]) => sum + Number(count || 0), 0);
    const sortedRows = [...rows].sort((a, b) => Number(a.attendanceRate || 0) - Number(b.attendanceRate || 0));

    root.innerHTML = `
      <header class="sa-hero">
        <div class="sa-hero__content">
          <span class="sa-eyebrow">PUSAT KENDALI SUPER ADMIN</span>
          <h1>Ringkasan Operasional SPPG</h1>
          <p>Pantau kehadiran, payroll, kualitas data, dan kebutuhan tindak lanjut seluruh unit dalam satu tampilan.</p>
        </div>
        <div class="sa-hero__meta">
          <span class="sa-health ${totalIssues ? 'has-issues' : 'is-healthy'}"><i></i>${totalIssues ? `${number(totalIssues)} perhatian` : 'Semua indikator baik'}</span>
          <button type="button" class="sa-refresh" data-sa-refresh>${icon('refresh')}<span>Perbarui</span></button>
        </div>
      </header>

      <div class="sa-kpis">
        ${[
          ['sppg', 'SPPG aktif', number(totals.sppg), 'Unit dalam pengawasan'],
          ['attendance', 'Kehadiran hari ini', `${number(totals.attendanceRate)}%`, 'Rata-rata seluruh SPPG'],
          ['payroll', 'Total payroll', rupiah(totals.payrollTotal), 'Akumulasi slip diterbitkan'],
          ['admins', 'Admin aktif', number(totals.admins), 'Admin dan akuntan operasional']
        ].map(([type, label, value, note]) => `<article class="sa-kpi sa-kpi--${type}"><div class="sa-kpi__icon">${icon(type)}</div><div class="sa-kpi__body"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div></article>`).join('')}
      </div>

      <div class="sa-layout">
        <section class="sa-panel sa-panel--wide">
          <div class="sa-panel__head"><div><span class="sa-panel__eyebrow">PERFORMA UNIT</span><h2>Ringkasan per SPPG</h2></div><span class="sa-panel__count">${number(rows.length)} unit</span></div>
          ${rows.length ? `<div class="sa-table-wrap"><table class="sa-table"><thead><tr><th>SPPG</th><th>Karyawan</th><th>Kehadiran</th><th>Punch lengkap</th><th>Payroll</th><th>TTD tertunda</th><th>Pengaduan</th></tr></thead><tbody>${sortedRows.map((row) => {
            const attendance = Number(row.attendanceRate || 0);
            const level = attendance >= 90 ? 'good' : attendance >= 70 ? 'warning' : 'danger';
            return `<tr><td><strong>${esc(row.sppg || '-')}</strong></td><td>${number(row.employees)}</td><td><div class="sa-progress"><span><i style="width:${Math.max(0, Math.min(100, attendance))}%"></i></span><b class="${level}">${number(attendance)}%</b></div></td><td>${number(row.completePunchRate)}%</td><td>${rupiah(row.payrollTotal)}</td><td><span class="sa-status ${Number(row.pendingSlips) ? 'warning' : 'neutral'}">${number(row.pendingSlips)}</span></td><td><span class="sa-status ${Number(row.openComplaints) ? 'danger' : 'neutral'}">${number(row.openComplaints)}</span></td></tr>`;
          }).join('')}</tbody></table></div>` : '<div class="sa-empty">Belum ada data SPPG untuk ditampilkan.</div>'}
        </section>

        <aside class="sa-panel sa-panel--attention">
          <div class="sa-panel__head"><div><span class="sa-panel__eyebrow">KUALITAS DATA</span><h2>Perlu perhatian</h2></div><span class="sa-panel__count ${totalIssues ? 'danger' : ''}">${number(totalIssues)}</span></div>
          <div class="sa-issue-list">${issues.map(([label, count, note]) => `<article class="sa-issue ${Number(count) ? 'has-issue' : ''}"><div class="sa-issue__icon">${icon('warning')}</div><div><strong>${esc(label)}</strong><small>${esc(note)}</small></div><b>${number(count)}</b></article>`).join('')}</div>
        </aside>
      </div>
      <footer class="sa-updated">Data diperbarui ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}</footer>`;

    root.querySelector('[data-sa-refresh]')?.addEventListener('click', () => load(true));
  }

  function renderLoading() {
    const dashboard = document.getElementById('view-dashboard');
    if (!dashboard || !isSuperAdmin()) return;
    let root = document.getElementById('super-admin-overview');
    if (!root) {
      root = document.createElement('section');
      root.id = 'super-admin-overview';
      root.className = 'sa-overview';
      dashboard.prepend(root);
    }
    root.innerHTML = '<div class="sa-loading"><span></span><div><strong>Menyiapkan dashboard global</strong><small>Mengambil ringkasan seluruh SPPG…</small></div></div>';
  }

  function renderError(error) {
    const root = document.getElementById('super-admin-overview');
    if (!root) return;
    root.innerHTML = `<div class="sa-error"><div>${icon('warning')}</div><strong>Dashboard global belum dapat dimuat</strong><p>${esc(error?.message || 'Terjadi kesalahan saat mengambil data.')}</p><button type="button" data-sa-retry>Coba lagi</button></div>`;
    root.querySelector('[data-sa-retry]')?.addEventListener('click', () => load(true));
  }

  async function load(force = false) {
    if (!isSuperAdmin() || state.loading || typeof window.apiCall !== 'function') return;
    const dashboard = document.getElementById('view-dashboard');
    if (!dashboard || dashboard.classList.contains('hidden')) return;
    if (!force && state.data && Date.now() - state.loadedAt < 120000) {
      render(state.data);
      return;
    }
    state.loading = true;
    renderLoading();
    try {
      const data = await window.apiCall('getSuperAdminOverviewV3', { token: window.AppState?.token || localStorage.getItem('auth_token') });
      state.data = data || {};
      state.loadedAt = Date.now();
      render(state.data);
    } catch (error) {
      renderError(error);
    } finally {
      state.loading = false;
    }
  }

  function cleanup() {
    if (isSuperAdmin()) return;
    document.getElementById('super-admin-overview')?.remove();
    document.getElementById('view-dashboard')?.classList.remove('super-admin-dashboard-active');
  }

  function schedule() {
    [0, 150, 500, 1200].forEach((delay) => setTimeout(() => isSuperAdmin() ? load() : cleanup(), delay));
  }

  function init() {
    schedule();
    window.addEventListener('hashchange', schedule);
    window.addEventListener('absen:app-ready', schedule);
    window.addEventListener('absen:session-changed', schedule);
    const observer = new MutationObserver(() => {
      const dashboard = document.getElementById('view-dashboard');
      if (dashboard && !dashboard.classList.contains('hidden')) load();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  window.SuperAdminDashboard = Object.freeze({ load, refresh: () => load(true) });
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init, { once: true }) : init();
})();
