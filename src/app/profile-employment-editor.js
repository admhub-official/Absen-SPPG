(() => {
  if (window.__ABSEN_PROFILE_EMPLOYMENT_EDITOR__) return;
  window.__ABSEN_PROFILE_EMPLOYMENT_EDITOR__ = true;

  const modal = () => document.querySelector('#modal-edit-profil');
  const byId = (id) => document.getElementById(id);
  const currentUser = () => {
    try { return JSON.parse(localStorage.getItem('auth_user') || 'null') || {}; }
    catch { return {}; }
  };
  const valueOf = (user, camel, raw) => user?.[camel] ?? user?.[raw] ?? '';
  const dateOnly = (value) => value ? String(value).slice(0, 10) : '';

  function appendField(grid, label, id, type, hint = '') {
    const group = document.createElement('div');
    group.className = 'form-group';
    group.dataset.profileEmploymentField = id;
    group.innerHTML = `
      <label class="form-label" for="${id}">${label}</label>
      <input type="${type}" id="${id}" class="form-input">
      ${hint ? `<div class="helper-text" style="margin-top:.35rem">${hint}</div>` : ''}`;
    grid.appendChild(group);
  }

  function appendSalaryField(grid) {
    const group = document.createElement('div');
    group.className = 'form-group';
    group.dataset.profileEmploymentField = 'edit-gaji-harian';
    group.innerHTML = `
      <label class="form-label" for="edit-gaji-harian">Gaji Harian</label>
      <input type="number" id="edit-gaji-harian" class="form-input" disabled aria-readonly="true">
      <div class="helper-text" style="margin-top:.35rem">Dikelola ADMIN/SUPER ADMIN dan tidak dapat diubah dari Profil.</div>`;
    grid.appendChild(group);
  }

  function ensureFields() {
    const root = modal();
    const grid = root?.querySelector('.modal-grid');
    if (!grid || grid.dataset.employmentFieldsReady === '1') return Boolean(grid);
    grid.dataset.employmentFieldsReady = '1';

    appendField(grid, 'SPPG', 'edit-sppg', 'text', 'Nama SPPG tempat bekerja');
    appendField(grid, 'Yayasan', 'edit-yayasan', 'text', 'Nama yayasan');
    appendField(grid, 'Jabatan / Divisi', 'edit-jabatan-divisi', 'text', 'Jabatan atau divisi');
    appendField(grid, 'Tanggal Mulai Kerja', 'edit-tanggal-mulai-kerja', 'date');
    appendSalaryField(grid);
    return true;
  }

  function populate() {
    if (!ensureFields()) return;
    const user = currentUser();
    byId('edit-sppg').value = valueOf(user, 'sppg', 'SPPG');
    byId('edit-yayasan').value = valueOf(user, 'yayasan', 'Yayasan');
    byId('edit-jabatan-divisi').value = valueOf(user, 'jabatanDivisi', 'Jabatan_Divisi');
    byId('edit-tanggal-mulai-kerja').value = dateOnly(valueOf(user, 'tanggalMulaiKerja', 'Tanggal_Mulai_Kerja'));
    byId('edit-gaji-harian').value = valueOf(user, 'gajiHarian', 'Gaji_Harian');
  }

  function showInline(message = '', type = 'error') {
    if (typeof window.showInlineAlert === 'function') {
      if (message) window.showInlineAlert('edit-profil-alert', message, type);
      else if (typeof window.hideInlineAlert === 'function') window.hideInlineAlert('edit-profil-alert');
      return;
    }
    const node = byId('edit-profil-alert');
    if (!node) return;
    node.textContent = message;
    node.style.display = message ? 'block' : 'none';
  }

  async function callProfileOps(updates) {
    const projectUrl = window.ABSEN_SUPABASE_CONFIG?.projectUrl;
    const token = localStorage.getItem('auth_token');
    if (!projectUrl || !token) throw new Error('Sesi atau konfigurasi aplikasi tidak tersedia.');
    const response = await fetch(`${projectUrl}/functions/v1/ProfileOps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'updateProfil', token, updates }),
      cache: 'no-store',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.success === false) throw new Error(body?.error || 'Gagal memperbarui profil.');
    return body?.result;
  }

  async function saveProfile(button) {
    showInline('');
    const updates = {
      Nama_Lengkap: byId('edit-nama')?.value.trim() || '',
      Tempat_Lahir: byId('edit-tempat-lahir')?.value.trim() || '',
      Tanggal_Lahir: byId('edit-tanggal-lahir')?.value || null,
      Jenis_Kelamin: byId('edit-jk')?.value || '',
      Email: byId('edit-email')?.value.trim() || '',
      No_Whatsapp: byId('edit-wa')?.value.trim() || '',
      Nama_Bank: byId('edit-bank')?.value.trim() || '',
      Nomor_Rekening: byId('edit-nomor-rekening')?.value.trim() || '',
      Atas_Nama_Rekening: byId('edit-rekening')?.value.trim() || '',
      SPPG: byId('edit-sppg')?.value.trim() || '',
      Yayasan: byId('edit-yayasan')?.value.trim() || '',
      Jabatan_Divisi: byId('edit-jabatan-divisi')?.value.trim() || '',
      Tanggal_Mulai_Kerja: byId('edit-tanggal-mulai-kerja')?.value || null,
    };
    if (!updates.Nama_Lengkap) return showInline('Nama lengkap tidak boleh kosong.', 'warning');

    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<div class="spinner" style="width:18px;height:18px;border-width:2px"></div> Menyimpan...';
    try {
      const result = await callProfileOps(updates);
      if (!result?.success) throw new Error(result?.message || 'Gagal memperbarui profil.');
      if (typeof window.showAlert === 'function') window.showAlert(result.message || 'Profil berhasil diperbarui.', 'success');
      if (typeof window.loadProfilLengkap === 'function') await window.loadProfilLengkap();
      else window.dispatchEvent(new CustomEvent('absen:profile-updated'));
      if (typeof window.closeEditProfil === 'function') window.closeEditProfil();
      else modal()?.classList.remove('active');
    } catch (error) {
      showInline(error?.message || 'Terjadi kesalahan saat menyimpan profil.');
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  }

  function handleClick(event) {
    const openButton = event.target.closest?.('#btn-open-edit-profil');
    if (openButton) {
      ensureFields();
      queueMicrotask(populate);
      return;
    }

    const saveButton = event.target.closest?.('#btn-save-edit-profil');
    if (!saveButton || saveButton.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    ensureFields();
    saveProfile(saveButton);
  }

  function init() {
    ensureFields();
    document.addEventListener('click', handleClick, true);
    window.addEventListener('absen:profile-updated', populate);
    window.addEventListener('absen:session-changed', () => queueMicrotask(populate));
  }

  window.AbsenProfileEmploymentEditor = Object.freeze({ refresh: populate });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
