(() => {
  if (window.__ABSEN_ID_CARD_FRONT_SIGNATURE_RENDERER__) return;
  window.__ABSEN_ID_CARD_FRONT_SIGNATURE_RENDERER__ = true;

  const imageCache = new Map();
  const rendered = new WeakMap();
  let scheduled = false;

  function readSignatureData(pair) {
    const block = pair?.querySelector('.digital-id-front-head-signature') || pair?.querySelector('.digital-id-head-signature');
    if (!block) return null;
    const image = block.querySelector('img');
    const name = block.querySelector('strong')?.textContent?.trim() || '';
    const pending = /MENUNGGU PERSETUJUAN/i.test(name);
    return {
      url: image?.getAttribute('src') || '',
      name,
      pending,
      signature: `${image?.getAttribute('src') || ''}|${name}|${pending ? 1 : 0}`,
    };
  }

  function ensureFallbackBlock(pair) {
    const front = pair?.querySelector('.digital-id-front');
    const backBlock = pair?.querySelector('.digital-id-head-signature');
    if (!front || !backBlock) return;
    let block = front.querySelector('.digital-id-front-head-signature');
    if (!block) {
      block = document.createElement('div');
      block.className = 'digital-id-front-head-signature';
      block.setAttribute('aria-label', 'TTD Kepala SPPG pada bagian depan');
      front.appendChild(block);
    }
    if (block.innerHTML !== backBlock.innerHTML) block.innerHTML = backBlock.innerHTML;
  }

  async function imageFromUrl(url) {
    if (!url) return null;
    if (imageCache.has(url)) return imageCache.get(url);
    const promise = (async () => {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`TTD Kepala SPPG gagal dimuat (${response.status}).`);
      const blob = await response.blob();
      if ('createImageBitmap' in window) return await createImageBitmap(blob);
      const objectUrl = URL.createObjectURL(blob);
      try {
        const image = new Image();
        image.decoding = 'async';
        image.src = objectUrl;
        await image.decode();
        return image;
      } finally {
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    })().catch((error) => {
      imageCache.delete(url);
      console.warn('Front ID Card signature deferred', error);
      return null;
    });
    imageCache.set(url, promise);
    return promise;
  }

  function fitFont(ctx, value, maxWidth, startSize = 22, minSize = 16) {
    let size = startSize;
    const source = String(value || '-');
    while (size > minSize) {
      ctx.font = `700 ${size}px Arial, sans-serif`;
      if (ctx.measureText(source).width <= maxWidth) break;
      size -= 1;
    }
    return `700 ${size}px Arial, sans-serif`;
  }

  function centered(ctx, value, y, font, color) {
    ctx.save();
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value || '-'), 319, y);
    ctx.restore();
  }

  async function paintPair(pair) {
    ensureFallbackBlock(pair);
    const canvas = pair?.querySelector('.digital-id-master-canvas[data-side="front"]');
    if (!canvas || canvas.width !== 638 || canvas.height !== 1011) return false;
    const data = readSignatureData(pair);
    if (!data) return false;
    const masterSignature = pair.dataset.masterSignature || '';
    const renderKey = `${masterSignature}|${data.signature}`;

    const signature = data.url ? await imageFromUrl(data.url) : null;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return false;

    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(42, 812, 554, 181);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(58, 816, 522, 2);
    centered(ctx, 'KEPALA SPPG', 848, '700 18px Arial, sans-serif', '#1e40af');

    if (signature) {
      const iw = signature.width || signature.naturalWidth || 1;
      const ih = signature.height || signature.naturalHeight || 1;
      const scale = Math.min(176 / iw, 66 / ih);
      const width = iw * scale;
      const height = ih * scale;
      ctx.drawImage(signature, 319 - width / 2, 864 + (66 - height) / 2, width, height);
      centered(ctx, data.name || '-', 958, fitFont(ctx, data.name || '-', 500), '#0f172a');
    } else if (data.pending) {
      centered(ctx, 'MENUNGGU PERSETUJUAN', 902, '700 18px Arial, sans-serif', '#b45309');
    } else {
      centered(ctx, data.name || 'BELUM DITERBITKAN', 916, fitFont(ctx, data.name || 'BELUM DITERBITKAN', 500, 19, 15), '#64748b');
    }
    ctx.restore();
    rendered.set(pair, renderKey);
    return true;
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => requestAnimationFrame(async () => {
      scheduled = false;
      for (const pair of document.querySelectorAll('.digital-id-preview-pair')) await paintPair(pair);
    }));
  }

  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => {
      const target = mutation.target?.nodeType === 1 ? mutation.target : mutation.target?.parentElement;
      if (target?.closest?.('#digital-identity-section')) return true;
      return [...(mutation.addedNodes || [])].some((node) => node.nodeType === 1 &&
        (node.matches?.('#digital-identity-section, .digital-id-preview-pair, .digital-id-master-preview') ||
         node.querySelector?.('#digital-identity-section, .digital-id-preview-pair, .digital-id-master-preview')));
    })) schedule();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'class', 'data-master-ready', 'data-master-signature'],
  });

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-digital-id-action="download-card"]');
    if (!button || button.disabled) return;
    if (button.dataset.frontSignatureReplay === '1') {
      delete button.dataset.frontSignatureReplay;
      return;
    }
    const pair = button.closest('#digital-identity-section')?.querySelector('.digital-id-preview-pair');
    if (!pair) return;
    const data = readSignatureData(pair);
    const expected = `${pair.dataset.masterSignature || ''}|${data?.signature || ''}`;
    if (rendered.get(pair) === expected) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    paintPair(pair).then(() => {
      button.dataset.frontSignatureReplay = '1';
      button.click();
    }).catch((error) => {
      if (typeof window.showAlert === 'function') window.showAlert(error.message || 'TTD depan ID Card gagal dirender.', 'error');
    });
  }, true);

  document.addEventListener('DOMContentLoaded', schedule, { once: true });
  window.addEventListener('absen:app-ready', schedule);
  window.addEventListener('absen:session-changed', () => {
    imageCache.clear();
    schedule();
  });
  schedule();

  window.AbsenIdCardFrontSignatureRenderer = Object.freeze({ render: schedule });
})();
