(() => {
  if (window.appConfirm) return;

  let active = null;

  function close(result) {
    if (!active) return;
    const { root, resolve, previousFocus } = active;
    active = null;
    root.remove();
    document.body.classList.remove('in-app-confirm-open');
    previousFocus?.focus?.();
    resolve(Boolean(result));
  }

  function keydown(event) {
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...active.root.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  window.appConfirm = function appConfirm({
    title = 'Konfirmasi tindakan',
    message = 'Apakah Anda yakin ingin melanjutkan?',
    confirmText = 'Ya, lanjutkan',
    cancelText = 'Tidak',
    tone = 'primary',
  } = {}) {
    if (active) close(false);
    return new Promise((resolve) => {
      const root = document.createElement('div');
      root.className = 'in-app-confirm-overlay';
      root.innerHTML = `
        <section class="in-app-confirm-card" role="dialog" aria-modal="true" aria-labelledby="in-app-confirm-title" aria-describedby="in-app-confirm-message">
          <div class="in-app-confirm-icon ${tone === 'danger' ? 'is-danger' : ''}" aria-hidden="true">${tone === 'danger' ? '!' : '?'}</div>
          <div class="in-app-confirm-copy">
            <h3 id="in-app-confirm-title"></h3>
            <p id="in-app-confirm-message"></p>
          </div>
          <div class="in-app-confirm-actions">
            <button type="button" class="in-app-confirm-cancel"></button>
            <button type="button" class="in-app-confirm-accept ${tone === 'danger' ? 'is-danger' : ''}"></button>
          </div>
        </section>`;
      root.querySelector('#in-app-confirm-title').textContent = String(title);
      root.querySelector('#in-app-confirm-message').textContent = String(message);
      root.querySelector('.in-app-confirm-cancel').textContent = String(cancelText);
      root.querySelector('.in-app-confirm-accept').textContent = String(confirmText);
      active = { root, resolve, previousFocus: document.activeElement };
      document.body.appendChild(root);
      document.body.classList.add('in-app-confirm-open');
      root.querySelector('.in-app-confirm-cancel').addEventListener('click', () => close(false));
      root.querySelector('.in-app-confirm-accept').addEventListener('click', () => close(true));
      root.addEventListener('click', (event) => { if (event.target === root) close(false); });
      root.addEventListener('keydown', keydown);
      window.requestAnimationFrame(() => root.querySelector('.in-app-confirm-cancel')?.focus());
    });
  };

  // Konfirmasi nonaktif scan wajah sebelumnya memakai dialog browser. Tangani di dalam aplikasi.
  document.addEventListener('click', async (event) => {
    const button = event.target.closest?.('[data-cc-sppg-off],[data-cc-user-off]');
    if (!button || button.dataset.inAppConfirmBypass === 'true') return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const modal = button.closest('.cc-modal');
    if (!modal || button.disabled) return;
    const isSppg = button.hasAttribute('data-cc-sppg-off');
    const selector = isSppg ? '[data-cc-sppg]:checked' : '[data-cc-user]:checked';
    const selected = [...modal.querySelectorAll(selector)]
      .map((node) => isSppg ? node.value : node.dataset.id)
      .filter(Boolean);
    if (!selected.length) {
      window.showAlert?.(`Pilih minimal satu ${isSppg ? 'SPPG' : 'karyawan'} terlebih dahulu.`, 'warning');
      return;
    }

    const approved = await window.appConfirm({
      title: 'Nonaktifkan scan wajah?',
      message: `Fitur scan wajah akan dinonaktifkan untuk ${selected.length} ${isSppg ? 'SPPG' : 'karyawan'} terpilih.`,
      confirmText: 'Ya, nonaktifkan',
      cancelText: 'Tidak',
      tone: 'danger',
    });
    if (!approved) return;

    const endpoint = `${window.ABSEN_SUPABASE_CONFIG.projectUrl}/functions/v1/ConfigCenter`;
    button.disabled = true;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveFacePolicy',
          token: localStorage.getItem('auth_token'),
          scope: isSppg ? 'SPPG' : 'USER',
          enabled: false,
          ...(isSppg ? { sppg: selected } : { userIds: selected }),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.success === false) throw new Error(body.message || 'Konfigurasi gagal disimpan.');
      window.showAlert?.('Scan wajah berhasil dinonaktifkan.', 'success');
      modal.remove();
      document.body.style.overflow = '';
      window.setTimeout(() => document.querySelector('[data-config-center-menu]')?.click(), 80);
    } catch (error) {
      button.disabled = false;
      window.showAlert?.(error.message || 'Konfigurasi gagal disimpan.', 'error');
    }
  }, true);
})();
