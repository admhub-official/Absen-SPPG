(() => {
  const projectUrl = window.APP_CONFIG?.projectUrl || 'https://szwwpnbbsmjsbzzcecyj.supabase.co';
  const endpoint = `${String(projectUrl).replace(/\/$/, '')}/functions/v1/PayrollListPage`;
  const pageSize = 30;
  const state = { page: 1, installed: false, loading: false };

  const $ = (selector, root = document) => root.querySelector(selector);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>\'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[char]));
  const rupiah = (value) => `Rp ${Math.round(Number(value) || 0).toLocaleString('id-ID')}`;
  const tanggal = (value) => {
    if (!value) return '-';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? String(value)
      : new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed);
  };
  const messageOf = (error) => {
    if (typeof error === 'string') return error;
    if (error?.message) return String(error.message);
    try { return JSON.stringify(error); } catch { return 'Gagal memuat riwayat slip.'; }
  };
  const authToken = () => {
    try {
      if (window.AppState?.token) return window.AppState.token;
    } catch {}
    return localStorage.getItem('auth_token') || '';
  };

  function ensureMarkup() {
    const view = $('#view-admin-payroll');
    const tabs = view?.querySelector('.payroll-tabs');
    const panel = $('#payroll-panel-history');
    if (!view || !tabs || !panel) return false;

    const publishTab = $('#payroll-tab-publish');
    const historyTab = $('#payroll-tab-history');
    if (publishTab) publishTab.dataset.payrollTab = 'publish';
    if (historyTab) historyTab.dataset.payrollTab = 'history';

    const table = panel.querySelector('table');
    if (table && !table.dataset.historyUpdated) {
      table.dataset.historyUpdated = 'true';
      const head = table.querySelector('thead');
      if (head) head.innerHTML = '<tr><th>No.</th><th>Karyawan</th><th>Periode</th><th>SPPG</th><th>Total</th><th>Status</th><th>PDF</th></tr>';
    }

    if (!$('#admin-payroll-history-pagination')) {
      const pagination = document.createElement('div');
      pagination.className = 'pagination';
      pagination.id = 'admin-payroll-history-pagination';
      panel.querySelector('.admin-card')?.appendChild(pagination);
    }
    return true;
  }

  function switchPanel(tab) {
    document.querySelectorAll('#view-admin-payroll [data-payroll-tab]').forEach((button) => {
      const active = button.dataset.payrollTab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    for (const name of ['publish', 'history']) {
      const panel = $(`#payroll-panel-${name}`);
      if (!panel) continue;
      const hidden = name !== tab;
      panel.hidden = hidden;
      panel.classList.toggle('hidden', hidden);
      panel.setAttribute('aria-hidden', String(hidden));
    }
  }

  async function fetchPage(page) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: authToken(), status: 'HISTORY', page, pageSize }),
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({ success: false, error: 'Respons daftar slip tidak valid.' }));
    if (!response.ok || payload?.success === false) throw new Error(messageOf(payload?.error || `HTTP ${response.status}`));
    return payload?.result || {};
  }

  function pageNumbers(current, total) {
    if (total <= 1) return [1];
    let start = Math.max(1, current - 2);
    const end = Math.min(total, start + 4);
    start = Math.max(1, end - 4);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }

  function renderPagination(data) {
    const current = Number(data.page || 1);
    const totalPages = Math.max(1, Number(data.totalPages || 0));
    const total = Number(data.total || 0);
    const first = total ? ((current - 1) * pageSize) + 1 : 0;
    const last = Math.min(current * pageSize, total);
    const host = $('#admin-payroll-history-pagination');
    if (!host) return;
    host.innerHTML = `<span class="pagination-info">Menampilkan ${first}–${last} dari ${total} slip · Halaman ${current} dari ${totalPages}</span><div class="pagination-btns">
      <button class="pagination-btn" data-history-page="${current - 1}" ${current <= 1 ? 'disabled' : ''}>Sebelumnya</button>
      ${pageNumbers(current, totalPages).map((page) => `<button class="pagination-btn ${page === current ? 'active' : ''}" data-history-page="${page}" ${page === current ? 'aria-current="page"' : ''}>${page}</button>`).join('')}
      <button class="pagination-btn" data-history-page="${current + 1}" ${current >= totalPages ? 'disabled' : ''}>Berikutnya</button>
    </div>`;
    host.querySelectorAll('[data-history-page]').forEach((button) => button.addEventListener('click', () => {
      const page = Number(button.dataset.historyPage);
      if (page < 1 || page > totalPages || page === current) return;
      state.page = page;
      loadHistory(page);
    }));
  }

  async function downloadSlip(idSlip, button) {
    const original = button.innerHTML;
    button.disabled = true;
    button.textContent = 'Memuat…';
    try {
      if (typeof window.apiCall !== 'function') throw new Error('Layanan unduh belum siap. Muat ulang aplikasi.');
      const result = await window.apiCall('getSlipDownloadUrl', { token: authToken(), idSlip });
      if (!result?.url) throw new Error('Tautan PDF tidak tersedia.');
      const anchor = document.createElement('a');
      anchor.href = result.url;
      anchor.download = result.filename || `slip-${idSlip}.pdf`;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      const message = messageOf(error);
      if (typeof window.showAlert === 'function') window.showAlert(message, 'error');
      else alert(message);
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  }

  async function loadHistory(page = 1) {
    if (state.loading || !ensureMarkup()) return;
    const body = $('#admin-payroll-history-body');
    if (!body) return;
    state.loading = true;
    body.innerHTML = '<tr><td colspan="7"><div class="loading-state"><span class="spinner"></span>Memuat riwayat slip...</div></td></tr>';
    try {
      const data = await fetchPage(page);
      const rows = Array.isArray(data.items) ? data.items : [];
      const first = rows.length ? ((Number(data.page || 1) - 1) * pageSize) + 1 : 0;
      body.innerHTML = rows.length ? rows.map((row, index) => {
        const waiting = row.Status_Penerbitan === 'MENUNGGU_TTD_PENERIMA';
        const statusText = waiting ? 'Menunggu TTD Penerima' : 'Diterbitkan';
        const pdf = waiting
          ? '<button class="btn btn-secondary btn-sm" type="button" disabled>Menunggu TTD</button>'
          : row.PDF_Storage_Path
            ? `<button class="btn btn-secondary btn-sm" type="button" data-download-slip="${escapeHtml(row.ID_Slip)}">Unduh</button>`
            : 'Belum tersedia';
        return `<tr>
          <td data-label="No.">${first + index}</td>
          <td data-label="Karyawan"><strong>${escapeHtml(row.Nama_Lengkap || '-')}</strong><small>${escapeHtml(row.Jabatan_Divisi || '-')}</small></td>
          <td data-label="Periode">${tanggal(row.Periode_Mulai)} – ${tanggal(row.Periode_Akhir)}</td>
          <td data-label="SPPG">${escapeHtml(row.SPPG || '-')}</td>
          <td data-label="Total">${rupiah(row.Total_Gaji_Diterima)}</td>
          <td data-label="Status"><span class="status-badge ${waiting ? 'status-waiting-recipient' : ''}">${statusText}</span></td>
          <td data-label="PDF">${pdf}</td>
        </tr>`;
      }).join('') : '<tr><td colspan="7"><div class="belum-absen-empty">Belum ada riwayat slip.</div></td></tr>';
      body.querySelectorAll('[data-download-slip]').forEach((button) => button.addEventListener('click', () => downloadSlip(button.dataset.downloadSlip, button)));
      renderPagination(data);
    } catch (error) {
      body.innerHTML = `<tr><td colspan="7"><div class="belum-absen-empty">${escapeHtml(messageOf(error))}</div></td></tr>`;
      const pagination = $('#admin-payroll-history-pagination');
      if (pagination) pagination.innerHTML = '';
    } finally {
      state.loading = false;
    }
  }

  function install() {
    if (state.installed || !ensureMarkup()) return false;
    state.installed = true;
    $('#view-admin-payroll .payroll-tabs')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-payroll-tab]');
      if (!button || !['publish', 'history'].includes(button.dataset.payrollTab)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      switchPanel(button.dataset.payrollTab);
      if (button.dataset.payrollTab === 'history') loadHistory(state.page);
    }, true);
    $('#btn-refresh-payroll-history')?.addEventListener('click', (event) => {
      event.stopImmediatePropagation();
      loadHistory(state.page);
    }, true);
    window.loadAdminPayrollHistory = () => loadHistory(state.page);
    return true;
  }

  if (!install()) {
    const observer = new MutationObserver(() => {
      if (install()) observer.disconnect();
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 15000);
  }
  window.addEventListener('absen:app-ready', install, { once: true });
})();
