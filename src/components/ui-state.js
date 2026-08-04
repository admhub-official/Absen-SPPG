const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

export function renderLoading(container, message = 'Memuat data…') {
  if (!container) return;
  container.innerHTML = `<div class="app-state app-state-loading" role="status" aria-live="polite"><div class="app-state-skeleton"></div><div>${escapeHtml(message)}</div></div>`;
}

export function renderEmpty(container, { title = 'Belum ada data', message = 'Data akan tampil di sini ketika tersedia.', actionLabel = '', onAction } = {}) {
  if (!container) return;
  container.innerHTML = `<div class="app-state app-state-empty"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p>${actionLabel ? `<button type="button" class="app-state-action">${escapeHtml(actionLabel)}</button>` : ''}</div>`;
  container.querySelector('.app-state-action')?.addEventListener('click', () => onAction?.());
}

export function renderError(container, error, { onRetry } = {}) {
  if (!container) return;
  const message = error?.message || 'Terjadi kesalahan saat memuat data.';
  const requestId = error?.requestId ? `<small>Kode bantuan: ${escapeHtml(error.requestId)}</small>` : '';
  container.innerHTML = `<div class="app-state app-state-error" role="alert"><strong>Data tidak dapat dimuat</strong><p>${escapeHtml(message)}</p>${requestId}${onRetry ? '<button type="button" class="app-state-action">Coba lagi</button>' : ''}</div>`;
  container.querySelector('.app-state-action')?.addEventListener('click', () => onRetry?.());
}
