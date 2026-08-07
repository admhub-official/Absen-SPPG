(() => {
  if (window.__ABSEN_ID_CARD_PRINT_SYNC__) return;
  window.__ABSEN_ID_CARD_PRINT_SYNC__ = true;
  const BGN_LOGO = 'https://szwwpnbbsmjsbzzcecyj.supabase.co/storage/v1/object/public/Logo%20BGN/LOGO_BGN.png';
  const PRINT_FUNCTION = 'DigitalIdentityPrint';
  let syncing = false;
  const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function profileFromState() {
    const root = document.querySelector('#digital-identity-section');
    const front = root?.querySelector('.digital-id-front');
    if (!front) return null;
    const title = front.querySelector('.digital-id-bgn-header b')?.textContent?.trim() || '-';
    const foundation = front.querySelector('.digital-id-bgn-header small')?.textContent?.trim() || 'Yayasan -';
    return { sppg: title, foundation };
  }

  function syncPreview() {
    const root = document.querySelector('#digital-identity-section');
    const back = root?.querySelector('.digital-id-back');
    if (!back) return;
    const meta = profileFromState();
    const header = back.querySelector('.digital-id-back-title');
    if (header && !header.querySelector('.digital-id-back-title-copy')) {
      header.innerHTML = `<img src="${BGN_LOGO}" alt="Logo BGN"><div class="digital-id-back-title-copy"><strong>SATUAN PELAYANAN PEMENUHAN GIZI (SPPG)</strong><b>${safe(meta?.sppg || '-')}</b><span>${safe(meta?.foundation || 'Yayasan -')}</span></div>`;
    }
  }

  async function callPrint(action, payload = {}) {
    const token = localStorage.getItem('auth_token');
    if (!token) throw new Error('Sesi login tidak tersedia.');
    const base = window.ABSEN_SUPABASE_CONFIG?.projectUrl || 'https://szwwpnbbsmjsbzzcecyj.supabase.co';
    const response = await fetch(`${base}/functions/v1/${PRINT_FUNCTION}`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ action, token, ...payload }),
      cache: 'no-store'
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.success === false) throw new Error(body?.message || 'Gagal menyegarkan PDF ID Card.');
    return body?.result;
  }

  const originalApiCall = window.apiCall;
  if (typeof originalApiCall === 'function') {
    window.apiCall = async function idCardPrintSyncApi(functionName, payload = {}) {
      const result = await originalApiCall(functionName, payload);
      if (syncing) return result;
      try {
        if (functionName === 'getMyDigitalIdentity' && result?.card?.id) {
          const stamp = `absen:idcard-pdf-sync:${result.card.id}:${result.card.pdfSha256 || ''}`;
          if (!sessionStorage.getItem(stamp)) {
            syncing = true;
            await callPrint('refreshMyActiveIdCardPdf');
            sessionStorage.setItem(stamp, '1');
            return await originalApiCall(functionName, payload);
          }
        }
        if (functionName === 'approveIdCardRequests' && Array.isArray(result?.approvedIds) && result.approvedIds.length) {
          syncing = true;
          await callPrint('refreshApprovedIdCardPdfs', { cardIds: result.approvedIds });
        }
      } catch (error) {
        console.warn('ID Card PDF sync deferred', error);
      } finally {
        syncing = false;
      }
      return result;
    };
  }

  const observer = new MutationObserver(syncPreview);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  syncPreview();
  window.addEventListener('absen:app-ready', syncPreview);
})();
