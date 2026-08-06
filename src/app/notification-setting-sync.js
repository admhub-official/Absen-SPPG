(() => {
  if (window.SystemSettingSync) return;

  const state = {
    rows: new Map(),
    loading: false,
    saving: new Set(),
    timer: null,
  };

  const labels = Object.freeze({
    'menu.user.complaints': 'Menu Pengaduan USER',
    'menu.admin.payroll': 'Menu Payroll ADMIN',
    'menu.admin.audit': 'Menu Audit Log',
    'attendance.geofence_required': 'Geofence wajib',
    'attendance.capture_gps_accuracy': 'Simpan akurasi GPS',
    'attendance.allow_import_single_punch': 'Punch tunggal impor',
    'attendance.correction_requires_audit': 'Audit koreksi absensi',
    'payroll.recipient_signature_required': 'TTD penerima wajib',
    'payroll.accountant_signature_required': 'TTD akuntan wajib',
    'payroll.head_signature_required': 'TTD Kepala SPPG wajib',
    'payroll.private_pdf': 'PDF slip privat',
    'notification.new_slip': 'Notifikasi slip baru',
    'notification.complaint_reply': 'Notifikasi balasan pengaduan',
    'notification.incomplete_attendance': 'Pengingat absensi tidak lengkap',
    'notification.global_announcement': 'Pengumuman global',
    'security.idle_session_expiry': 'Kedaluwarsa sesi idle',
    'security.revoke_on_password_reset': 'Cabut sesi saat reset password',
    'security.risky_action_reason': 'Alasan tindakan wajib',
    'security.two_step_confirmation': 'Konfirmasi dua tahap',
  });

  const token = () => localStorage.getItem('auth_token') || '';

  function isSuperAdmin() {
    try {
      const user = JSON.parse(localStorage.getItem('auth_user') || 'null');
      return Boolean(token())
        && String(user?.role || user?.Role || '')
          .trim()
          .toUpperCase()
          .replace(/_/g, ' ')
          .replace(/\s+/g, ' ') === 'SUPER ADMIN';
    } catch {
      return false;
    }
  }

  function enabledOf(row) {
    return Boolean(row?.Setting_Value?.enabled);
  }

  function applyButton(button, row) {
    const enabled = enabledOf(row);
    button.classList.toggle('active', enabled);
    button.setAttribute('aria-checked', String(enabled));
    button.dataset.backendSynced = 'true';
    if (row?.Updated_At) button.dataset.backendUpdatedAt = String(row.Updated_At);
    button.disabled = state.saving.has(button.dataset.settingKey);
  }

  function applyAll() {
    document.querySelectorAll('[data-setting-key]').forEach((button) => {
      const row = state.rows.get(String(button.dataset.settingKey || ''));
      if (row) applyButton(button, row);
    });
  }

  async function api(functionName, payload) {
    if (typeof window.apiCall !== 'function') throw new Error('API pengaturan belum siap.');
    return window.apiCall(functionName, payload);
  }

  async function readBackend() {
    const result = await api('manageSystemSettingsV3', {
      token: token(),
      mode: 'GET',
    });
    const rows = Array.isArray(result?.settings) ? result.settings : [];
    state.rows = new Map(rows.map((row) => [String(row.Setting_Key || ''), row]));
    return rows;
  }

  async function sync({ force = false } = {}) {
    if (!isSuperAdmin() || state.loading) return;
    if (!force && !document.querySelector('[data-setting-key]')) return;
    state.loading = true;
    try {
      await readBackend();
      applyAll();
    } catch (error) {
      console.warn('Pengaturan sistem gagal disinkronkan dari backend', error);
    } finally {
      state.loading = false;
    }
  }

  function schedule(delay = 80) {
    clearTimeout(state.timer);
    state.timer = window.setTimeout(() => sync(), delay);
  }

  async function confirmChange(label, enabled) {
    if (typeof window.appConfirm === 'function') {
      return window.appConfirm({
        title: `${enabled ? 'Aktifkan' : 'Nonaktifkan'} ${label}?`,
        message: enabled
          ? 'Fitur akan diaktifkan dan berlaku setelah nilai backend berhasil diverifikasi.'
          : 'Fitur akan dinonaktifkan dan berlaku setelah nilai backend berhasil diverifikasi.',
        confirmText: enabled ? 'Ya, aktifkan' : 'Ya, nonaktifkan',
        cancelText: 'Tidak',
        tone: enabled ? 'primary' : 'danger',
      });
    }
    if (typeof window.confirmRiskAction === 'function') {
      const answer = await window.confirmRiskAction({
        title: 'Ubah pengaturan sistem',
        impact: `${label} akan ${enabled ? 'diaktifkan' : 'dinonaktifkan'} untuk aplikasi.`,
      });
      return Boolean(answer);
    }
    return false;
  }

  async function save(button) {
    const key = String(button.dataset.settingKey || '');
    if (!key || state.saving.has(key)) return;

    if (!state.rows.has(key)) await sync({ force: true });
    const current = state.rows.get(key);
    if (!current) {
      window.showAlert?.('Nilai pengaturan belum tersedia dari backend. Muat ulang lalu coba kembali.', 'error');
      return;
    }

    const enabled = !enabledOf(current);
    const label = button.getAttribute('aria-label') || labels[key] || key;
    const approved = await confirmChange(label, enabled);
    if (!approved) {
      applyButton(button, current);
      return;
    }

    state.saving.add(key);
    button.disabled = true;
    try {
      await api('manageSystemSettingsV3', {
        token: token(),
        mode: 'UPDATE',
        key,
        enabled,
        description: current.Description || labels[key] || key,
        reason: `SUPER ADMIN ${enabled ? 'mengaktifkan' : 'menonaktifkan'} ${label} melalui Pusat Pengaturan.`,
      });

      await readBackend();
      const verified = state.rows.get(key);
      if (!verified || enabledOf(verified) !== enabled) {
        throw new Error('Backend belum mengembalikan nilai yang baru disimpan.');
      }

      applyAll();
      window.showAlert?.(`${label} berhasil ${enabled ? 'diaktifkan' : 'dinonaktifkan'} dan telah diverifikasi.`, 'success');
      window.dispatchEvent(new CustomEvent('absen:system-settings-changed', {
        detail: { key, enabled, setting: verified },
      }));
      if (key === 'notification.global_announcement') {
        window.NotificationPublisher?.refresh?.();
      }
    } catch (error) {
      await sync({ force: true });
      window.showAlert?.(error?.message || 'Pengaturan gagal disimpan.', 'error');
    } finally {
      state.saving.delete(key);
      const latestButton = document.querySelector(`[data-setting-key="${CSS.escape(key)}"]`);
      if (latestButton) {
        latestButton.disabled = false;
        const latest = state.rows.get(key);
        if (latest) applyButton(latestButton, latest);
      }
    }
  }

  // Tangani lebih dulu daripada listener lama agar pesan sukses hanya muncul
  // setelah nilai dibaca ulang dan cocok dengan database.
  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-setting-key]');
    if (!button || !isSuperAdmin()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    save(button);
  }, true);

  document.addEventListener('click', (event) => {
    if (event.target.closest?.('[data-setting-tab]')) schedule(60);
  });
  window.addEventListener('absen:app-ready', () => schedule(180));
  window.addEventListener('absen:session-changed', () => schedule(180));
  window.addEventListener('focus', () => schedule(40));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule(40);
  });
  new MutationObserver(() => {
    applyAll();
    schedule(100);
  }).observe(document.body, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => schedule(180), { once: true });
  } else {
    schedule(180);
  }

  window.SystemSettingSync = Object.freeze({
    sync: () => sync({ force: true }),
    get: (key) => state.rows.get(key) || null,
  });
  window.NotificationSettingSync = window.SystemSettingSync;
})();
