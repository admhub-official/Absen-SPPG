(() => {
  if (window.appConfirm) return;

  let active = null;
  const queue = [];

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]));
  }

  function close(result) {
    if (!active) return;
    const { root, resolve, previousFocus, previousOverflow, keydown } = active;
    active = null;
    document.removeEventListener('keydown', keydown, true);
    root.remove();
    document.body.style.overflow = previousOverflow;
    previousFocus?.focus?.();
    resolve(Boolean(result));
    const next = queue.shift();
    if (next) open(next);
  }

  function open(request) {
    const {
      title = 'Konfirmasi tindakan',
      message = 'Lanjutkan tindakan ini?',
      confirmText = 'Ya, lanjutkan',
      cancelText = 'Batal',
      tone = 'primary',
      detail = '',
      resolve,
    } = request;

    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const root = document.createElement('div');
    root.className = 'app-confirm-backdrop';
    root.innerHTML = `<section class="app-confirm-dialog tone-${escapeHtml(tone)}" role="alertdialog" aria-modal="true" aria-labelledby="app-confirm-title" aria-describedby="app-confirm-message">
      <div class="app-confirm-icon" aria-hidden="true">${tone === 'danger' ? '!' : '?'}</div>
      <div class="app-confirm-content">
        <h2 id="app-confirm-title">${escapeHtml(title)}</h2>
        <p id="app-confirm-message">${escapeHtml(message)}</p>
        ${detail ? `<div class="app-confirm-detail">${escapeHtml(detail)}</div>` : ''}
      </div>
      <div class="app-confirm-actions">
        <button type="button" class="btn btn-secondary" data-app-confirm-cancel>${escapeHtml(cancelText)}</button>
        <button type="button" class="btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}" data-app-confirm-ok>${escapeHtml(confirmText)}</button>
      </div>
    </section>`;

    const keydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const buttons = [...root.querySelectorAll('button:not(:disabled)')];
      if (!buttons.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    active = { root, resolve, previousFocus, previousOverflow, keydown };
    document.body.appendChild(root);
    document.body.style.overflow = 'hidden';
    root.querySelector('[data-app-confirm-cancel]')?.addEventListener('click', () => close(false));
    root.querySelector('[data-app-confirm-ok]')?.addEventListener('click', () => close(true));
    root.addEventListener('click', (event) => { if (event.target === root) close(false); });
    document.addEventListener('keydown', keydown, true);
    requestAnimationFrame(() => root.querySelector('[data-app-confirm-ok]')?.focus());
  }

  window.appConfirm = (options = {}) => new Promise((resolve) => {
    const request = { ...options, resolve };
    if (active) queue.push(request);
    else open(request);
  });
})();
