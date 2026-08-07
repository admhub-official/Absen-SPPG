(() => {
  if (window.__ABSEN_ID_CARD_MASTER_RENDERER__) return;
  window.__ABSEN_ID_CARD_MASTER_RENDERER__ = true;

  const CARD_WIDTH = 638;
  const CARD_HEIGHT = 1011;
  const PDF_WIDTH = 53.98 * 72 / 25.4;
  const PDF_HEIGHT = 85.6 * 72 / 25.4;
  const imageCache = new Map();
  let renderQueued = false;

  const COLORS = Object.freeze({
    navy: '#0f172a',
    blue: '#1e40af',
    sky: '#eff6ff',
    pale: '#f8fafc',
    border: '#cbd5e1',
    muted: '#64748b',
    white: '#ffffff',
    amber: '#b45309'
  });

  const text = (root, selector, fallback = '-') => root?.querySelector(selector)?.textContent?.trim() || fallback;
  const src = (root, selector) => root?.querySelector(selector)?.getAttribute('src') || '';

  function initials(name) {
    return String(name || 'ID').trim().split(/\s+/).filter(Boolean).slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase()).join('') || 'ID';
  }

  async function imageFromUrl(url) {
    if (!url) return null;
    if (imageCache.has(url)) return imageCache.get(url);
    const promise = (async () => {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Gambar ID Card gagal dimuat (${response.status}).`);
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
      console.warn('ID Card image deferred', error);
      return null;
    });
    imageCache.set(url, promise);
    return promise;
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawCentered(ctx, value, y, font, color = COLORS.navy) {
    ctx.save();
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value || '-'), CARD_WIDTH / 2, y);
    ctx.restore();
  }

  function fitFont(ctx, value, maxWidth, weight, startSize, minSize = 14) {
    let size = startSize;
    const source = String(value || '-');
    while (size > minSize) {
      ctx.font = `${weight} ${size}px Arial, sans-serif`;
      if (ctx.measureText(source).width <= maxWidth) break;
      size -= 1;
    }
    return `${weight} ${size}px Arial, sans-serif`;
  }

  function wrapLines(ctx, value, maxWidth, maxLines = 5) {
    const words = String(value || '').trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (!line || ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
        if (lines.length >= maxLines - 1) break;
      }
    }
    if (line && lines.length < maxLines) lines.push(line);
    return lines;
  }

  function drawWrappedCentered(ctx, value, centerY, maxWidth, font, color = COLORS.muted, lineHeight = 25, maxLines = 5) {
    ctx.save();
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = wrapLines(ctx, value, maxWidth, maxLines);
    const total = Math.max(0, lines.length - 1) * lineHeight;
    lines.forEach((line, index) => ctx.fillText(line, CARD_WIDTH / 2, centerY - total / 2 + index * lineHeight));
    ctx.restore();
  }

  function drawCoverCircle(ctx, image, cx, cy, diameter) {
    const radius = diameter / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    const iw = image.width || image.naturalWidth;
    const ih = image.height || image.naturalHeight;
    const scale = Math.max(diameter / iw, diameter / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(image, cx - dw / 2, cy - dh / 2, dw, dh);
    ctx.restore();
  }

  function readData(pair) {
    const front = pair.querySelector('.digital-id-front');
    const back = pair.querySelector('.digital-id-back');
    if (!front || !back) return null;
    return {
      logoUrl: src(front, '.digital-id-bgn-header img') || src(back, '.digital-id-back-title img'),
      sppg: text(front, '.digital-id-bgn-header b'),
      foundation: text(front, '.digital-id-bgn-header small', 'Yayasan -'),
      photoUrl: src(front, '.digital-id-photo-circle img'),
      name: text(front, '.digital-id-person > strong'),
      position: text(front, '.digital-id-person > span'),
      startDate: text(front, '.digital-id-person > b'),
      qrUrl: src(back, '.digital-id-back-qr img'),
      code: text(back, 'code'),
      officialNote: text(back, '.digital-id-official-note', ''),
      signatureUrl: src(back, '.digital-id-head-signature img'),
      headName: text(back, '.digital-id-head-signature > strong', ''),
      pending: /MENUNGGU PERSETUJUAN/i.test(text(back, '.digital-id-head-signature > strong', ''))
    };
  }

  async function drawFront(canvas, data) {
    canvas.width = CARD_WIDTH;
    canvas.height = CARD_HEIGHT;
    const ctx = canvas.getContext('2d', { alpha: false });
    const [logo, photo] = await Promise.all([imageFromUrl(data.logoUrl), imageFromUrl(data.photoUrl)]);

    ctx.fillStyle = COLORS.white;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
    ctx.fillStyle = COLORS.sky;
    ctx.fillRect(0, 0, CARD_WIDTH, 226);
    ctx.fillStyle = COLORS.blue;
    ctx.fillRect(0, 0, CARD_WIDTH, 12);

    if (logo) ctx.drawImage(logo, CARD_WIDTH / 2 - 40, 32, 80, 80);
    drawCentered(ctx, 'SATUAN PELAYANAN PEMENUHAN GIZI (SPPG)', 133, '700 20px Arial, sans-serif');
    drawCentered(ctx, data.sppg, 169, fitFont(ctx, data.sppg, 530, '700', 31, 22), COLORS.blue);
    drawCentered(ctx, data.foundation, 201, fitFont(ctx, data.foundation, 530, '400', 19, 15), COLORS.muted);

    const photoCx = CARD_WIDTH / 2;
    const photoCy = 358;
    ctx.fillStyle = '#dbeafe';
    ctx.beginPath();
    ctx.arc(photoCx, photoCy, 108, 0, Math.PI * 2);
    ctx.fill();
    if (photo) {
      drawCoverCircle(ctx, photo, photoCx, photoCy, 198);
    } else {
      ctx.fillStyle = '#dbeafe';
      ctx.beginPath();
      ctx.arc(photoCx, photoCy, 98, 0, Math.PI * 2);
      ctx.fill();
      drawCentered(ctx, initials(data.name), photoCy, '700 54px Arial, sans-serif', COLORS.blue);
    }

    drawCentered(ctx, data.name, 586, fitFont(ctx, data.name, 540, '700', 35, 25));
    drawCentered(ctx, data.position, 628, fitFont(ctx, data.position, 520, '400', 23, 17), COLORS.muted);

    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(58, 692, CARD_WIDTH - 116, 2);
    drawCentered(ctx, 'TANGGAL MULAI BEKERJA', 735, '700 19px Arial, sans-serif', COLORS.blue);
    drawCentered(ctx, data.startDate, 776, fitFont(ctx, data.startDate, 500, '700', 25, 19));
  }

  async function drawBack(canvas, data) {
    canvas.width = CARD_WIDTH;
    canvas.height = CARD_HEIGHT;
    const ctx = canvas.getContext('2d', { alpha: false });
    const [logo, qr, signature] = await Promise.all([
      imageFromUrl(data.logoUrl),
      imageFromUrl(data.qrUrl),
      imageFromUrl(data.signatureUrl)
    ]);

    ctx.fillStyle = COLORS.white;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
    ctx.fillStyle = COLORS.sky;
    ctx.fillRect(0, 0, CARD_WIDTH, 196);
    ctx.fillStyle = COLORS.blue;
    ctx.fillRect(0, 0, CARD_WIDTH, 12);
    ctx.fillRect(0, 190, CARD_WIDTH, 6);

    if (logo) ctx.drawImage(logo, 38, 47, 94, 94);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.navy;
    ctx.font = '700 17px Arial, sans-serif';
    ctx.fillText('SATUAN PELAYANAN PEMENUHAN GIZI (SPPG)', 154, 69);
    ctx.fillStyle = COLORS.blue;
    ctx.font = fitFont(ctx, data.sppg, 425, '700', 29, 21);
    ctx.fillText(data.sppg, 154, 108);
    ctx.fillStyle = COLORS.muted;
    ctx.font = fitFont(ctx, data.foundation, 425, '400', 18, 14);
    ctx.fillText(data.foundation, 154, 142);

    const qrSize = 286;
    const qrX = (CARD_WIDTH - qrSize) / 2;
    const qrY = 232;
    ctx.fillStyle = COLORS.pale;
    roundedRect(ctx, qrX - 12, qrY - 12, qrSize + 24, qrSize + 24, 22);
    ctx.fill();
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 2;
    ctx.stroke();
    if (qr) ctx.drawImage(qr, qrX, qrY, qrSize, qrSize);
    else drawCentered(ctx, 'QR', qrY + qrSize / 2, '700 36px Arial, sans-serif', COLORS.blue);

    drawCentered(ctx, 'KODE ID CARD', 558, '700 19px Arial, sans-serif', COLORS.blue);
    drawCentered(ctx, data.code, 594, fitFont(ctx, data.code, 500, '700', 27, 20));

    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(42, 628, CARD_WIDTH - 84, 2);
    drawWrappedCentered(ctx, data.officialNote, 696, 540, '400 17px Arial, sans-serif', COLORS.muted, 23, 5);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(42, 766, CARD_WIDTH - 84, 2);

    drawCentered(ctx, 'KEPALA SPPG', 806, '700 19px Arial, sans-serif', COLORS.blue);
    if (signature) {
      const iw = signature.width || signature.naturalWidth;
      const ih = signature.height || signature.naturalHeight;
      const scale = Math.min(190 / iw, 82 / ih);
      const width = iw * scale;
      const height = ih * scale;
      ctx.drawImage(signature, CARD_WIDTH / 2 - width / 2, 830 + (82 - height) / 2, width, height);
    } else if (data.pending) {
      drawCentered(ctx, 'MENUNGGU PERSETUJUAN', 872, '700 19px Arial, sans-serif', COLORS.amber);
    }
    if (!data.pending || signature) {
      drawCentered(ctx, data.headName || '-', 937, fitFont(ctx, data.headName || '-', 500, '700', 22, 17));
    }
  }

  async function renderPair(pair) {
    if (pair.dataset.masterRendering === '1') return;
    const data = readData(pair);
    if (!data) return;
    pair.dataset.masterRendering = '1';
    try {
      let host = pair.querySelector(':scope > .digital-id-master-preview');
      if (!host) {
        host = document.createElement('div');
        host.className = 'digital-id-master-preview';
        host.innerHTML = '<canvas class="digital-id-master-canvas" data-side="front" aria-label="Pratinjau ID Card bagian depan"></canvas><canvas class="digital-id-master-canvas" data-side="back" aria-label="Pratinjau ID Card bagian belakang"></canvas>';
        pair.appendChild(host);
      }
      const frontCanvas = host.querySelector('[data-side="front"]');
      const backCanvas = host.querySelector('[data-side="back"]');
      await Promise.all([drawFront(frontCanvas, data), drawBack(backCanvas, data)]);
      pair.classList.add('has-master-preview');
      pair.dataset.masterReady = '1';
    } catch (error) {
      pair.classList.remove('has-master-preview');
      pair.dataset.masterReady = '0';
      console.warn('Master ID Card renderer deferred', error);
    } finally {
      pair.dataset.masterRendering = '0';
    }
  }

  function renderAll() {
    document.querySelectorAll('.digital-id-preview-pair').forEach((pair) => renderPair(pair));
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderAll();
    });
  }

  function canvasJpeg(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(async (blob) => {
        if (!blob) return reject(new Error('Gagal membuat gambar ID Card.'));
        resolve(new Uint8Array(await blob.arrayBuffer()));
      }, 'image/jpeg', 0.97);
    });
  }

  const ascii = (value) => new TextEncoder().encode(value);

  function buildTwoPagePdf(frontJpeg, backJpeg) {
    const parts = [];
    const offsets = new Array(9).fill(0);
    let length = 0;
    const push = (bytes) => { parts.push(bytes); length += bytes.length; };
    const pushText = (value) => push(ascii(value));
    const object = (id, bodyParts) => {
      offsets[id] = length;
      pushText(`${id} 0 obj\n`);
      bodyParts.forEach(push);
      pushText('\nendobj\n');
    };
    const streamObject = (id, dict, bytes) => {
      offsets[id] = length;
      pushText(`${id} 0 obj\n<< ${dict} /Length ${bytes.length} >>\nstream\n`);
      push(bytes);
      pushText('\nendstream\nendobj\n');
    };

    pushText('%PDF-1.4\n');
    object(1, [ascii('<< /Type /Catalog /Pages 2 0 R >>')]);
    object(2, [ascii('<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>')]);
    object(3, [ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_WIDTH.toFixed(3)} ${PDF_HEIGHT.toFixed(3)}] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>`)]);
    streamObject(4, `/Type /XObject /Subtype /Image /Width ${CARD_WIDTH} /Height ${CARD_HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, frontJpeg);
    const frontContent = ascii(`q\n${PDF_WIDTH.toFixed(3)} 0 0 ${PDF_HEIGHT.toFixed(3)} 0 0 cm\n/Im1 Do\nQ`);
    streamObject(5, '', frontContent);
    object(6, [ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_WIDTH.toFixed(3)} ${PDF_HEIGHT.toFixed(3)}] /Resources << /XObject << /Im2 7 0 R >> >> /Contents 8 0 R >>`)]);
    streamObject(7, `/Type /XObject /Subtype /Image /Width ${CARD_WIDTH} /Height ${CARD_HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, backJpeg);
    const backContent = ascii(`q\n${PDF_WIDTH.toFixed(3)} 0 0 ${PDF_HEIGHT.toFixed(3)} 0 0 cm\n/Im2 Do\nQ`);
    streamObject(8, '', backContent);

    const xrefOffset = length;
    pushText('xref\n0 9\n0000000000 65535 f \n');
    for (let id = 1; id <= 8; id += 1) pushText(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
    pushText(`trailer\n<< /Size 9 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

    const output = new Uint8Array(length);
    let cursor = 0;
    parts.forEach((part) => { output.set(part, cursor); cursor += part.length; });
    return output;
  }

  async function currentPdfBlob(pair) {
    if (pair.dataset.masterReady !== '1') await renderPair(pair);
    const front = pair.querySelector('.digital-id-master-canvas[data-side="front"]');
    const back = pair.querySelector('.digital-id-master-canvas[data-side="back"]');
    if (!front || !back) throw new Error('Pratinjau ID Card belum siap.');
    const [frontJpeg, backJpeg] = await Promise.all([canvasJpeg(front), canvasJpeg(back)]);
    return new Blob([buildTwoPagePdf(frontJpeg, backJpeg)], { type: 'application/pdf' });
  }

  async function handleCardAction(event) {
    const button = event.target.closest?.('[data-digital-id-action="download-card"], [data-digital-id-action="print-card"]');
    if (!button || button.disabled) return;
    const root = button.closest('#digital-identity-section');
    const pair = root?.querySelector('.digital-id-preview-pair');
    if (!pair) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    button.disabled = true;
    try {
      const blob = await currentPdfBlob(pair);
      const url = URL.createObjectURL(blob);
      const code = text(pair, '.digital-id-back code', 'SPPG').replace(/[^A-Za-z0-9_-]+/g, '-');
      if (button.dataset.digitalIdAction === 'download-card') {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `ID-Card-${code}.pdf`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } else {
        const opened = window.open(url, '_blank', 'noopener,noreferrer');
        if (!opened) {
          URL.revokeObjectURL(url);
          throw new Error('Popup diblokir browser. Izinkan popup untuk membuka PDF.');
        }
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    } catch (error) {
      if (typeof window.showAlert === 'function') window.showAlert(error.message || 'Gagal membuat PDF ID Card.', 'error');
      else console.error(error);
    } finally {
      button.disabled = false;
    }
  }

  const observer = new MutationObserver(queueRender);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('click', handleCardAction, true);
  document.addEventListener('DOMContentLoaded', queueRender, { once: true });
  window.addEventListener('absen:app-ready', queueRender);
  window.addEventListener('absen:session-changed', () => { imageCache.clear(); queueRender(); });
  queueRender();

  window.AbsenIdCardMasterRenderer = Object.freeze({
    render: renderAll,
    pageSizeMm: Object.freeze({ width: 53.98, height: 85.6 }),
    rasterSize: Object.freeze({ width: CARD_WIDTH, height: CARD_HEIGHT, dpi: 300 })
  });
})();
