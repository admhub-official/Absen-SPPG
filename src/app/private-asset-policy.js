(() => {
  if (window.HadirlyPrivateAssets) return;

  const projectOrigin = (() => {
    try { return new URL(window.ABSEN_SUPABASE_CONFIG?.projectUrl || '').origin; }
    catch { return ''; }
  })();
  const originalOpen = window.open.bind(window);

  function isSensitiveStorageUrl(value) {
    try {
      const url = new URL(String(value || ''), location.href);
      if (!projectOrigin || url.origin !== projectOrigin) return false;
      return url.pathname.includes('/storage/v1/object/sign/') ||
        url.pathname.includes('/storage/v1/object/authenticated/');
    } catch { return false; }
  }

  function filenameFrom(urlValue, fallback = 'dokumen') {
    try {
      const url = new URL(urlValue, location.href);
      const explicit = url.searchParams.get('download');
      if (explicit && explicit !== 'true') return explicit.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 160);
      const last = decodeURIComponent(url.pathname.split('/').pop() || '').replace(/[\\/:*?"<>|]+/g, '-');
      return last || fallback;
    } catch { return fallback; }
  }

  async function fetchPrivateAsset(url) {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    });
    if (!response.ok) throw new Error(`Dokumen tidak dapat dibuka (${response.status}).`);
    return response.blob();
  }

  async function openPrivate(url, options = {}) {
    const blob = await fetchPrivateAsset(url);
    const objectUrl = URL.createObjectURL(blob);
    const target = options.target || '_blank';
    const placeholder = options.placeholder || null;
    if (placeholder && !placeholder.closed) {
      placeholder.location.replace(objectUrl);
    } else if (options.download) {
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = options.filename || filenameFrom(url);
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } else {
      originalOpen(objectUrl, target, 'noopener,noreferrer');
    }
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }

  window.open = function guardedWindowOpen(url, target, features) {
    if (!isSensitiveStorageUrl(url)) return originalOpen(url, target, features);
    const placeholder = originalOpen('about:blank', target || '_blank', features || 'noopener,noreferrer');
    openPrivate(String(url), { target: target || '_blank', placeholder }).catch((error) => {
      try { placeholder?.close(); } catch {}
      console.warn('Private asset open failed', error);
      window.showAlert?.(error.message || 'Dokumen tidak dapat dibuka.', 'error');
    });
    return placeholder;
  };

  document.addEventListener('click', (event) => {
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!anchor || !isSensitiveStorageUrl(anchor.href)) return;
    event.preventDefault();
    event.stopPropagation();
    openPrivate(anchor.href, {
      target: anchor.target || '_blank',
      download: anchor.hasAttribute('download'),
      filename: anchor.getAttribute('download') || filenameFrom(anchor.href)
    }).catch((error) => {
      console.warn('Private asset download failed', error);
      window.showAlert?.(error.message || 'Dokumen tidak dapat diunduh.', 'error');
    });
  }, true);

  window.HadirlyPrivateAssets = Object.freeze({ isSensitiveStorageUrl, fetchPrivateAsset, openPrivate });
})();
