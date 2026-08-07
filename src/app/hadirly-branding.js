(() => {
  if (window.__HADIRLY_BRANDING__) return;
  window.__HADIRLY_BRANDING__ = true;

  const APP_NAME = 'Hadirly';
  const TAGLINE = 'Absensi & Payroll Digital';
  const FULL_NAME = `${APP_NAME} : ${TAGLINE}`;
  const ICON = './icons/app-icon.svg';
  const LOGO = './icons/hadirly-logo-horizontal.svg';

  function updateHead() {
    document.title = FULL_NAME;
    const values = {
      'application-name': APP_NAME,
      'apple-mobile-web-app-title': APP_NAME,
      description: `${APP_NAME} — ${TAGLINE}`
    };
    Object.entries(values).forEach(([name, content]) => {
      let meta = document.querySelector(`meta[name="${name}"]`);
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = name;
        document.head.appendChild(meta);
      }
      meta.content = content;
    });
    document.querySelectorAll('link[rel~="icon"],link[rel="apple-touch-icon"]').forEach((link) => {
      link.href = ICON;
      link.type = 'image/svg+xml';
    });
    if (!document.querySelector('link[rel~="icon"]')) {
      const link = document.createElement('link');
      link.rel = 'icon';
      link.type = 'image/svg+xml';
      link.href = ICON;
      document.head.appendChild(link);
    }
  }

  function replaceImages(root = document) {
    root.querySelectorAll?.('img').forEach((img) => {
      const src = String(img.getAttribute('src') || '');
      const alt = String(img.getAttribute('alt') || '');
      const isBrand = /icon%20aplikasi|icon aplikasi|app-icon|presence\s*sppg/i.test(`${src} ${alt}`) ||
        img.closest('.auth-brand-mark,.auth-logo-mobile,.app-sidebar-brand,.app-topbar-brand');
      if (isBrand) {
        img.src = ICON;
        img.alt = APP_NAME;
        img.removeAttribute('srcset');
      }
    });
  }

  function replaceText(root = document) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const parent = node.parentElement;
      if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) return;
      if (/Presence SPPG/i.test(node.nodeValue || '')) {
        node.nodeValue = node.nodeValue.replace(/Presence SPPG/gi, APP_NAME);
      }
    });
  }

  function decorateBrandBlocks() {
    document.querySelectorAll(
      '.auth-brand-mark,.auth-logo-mobile,.app-sidebar-brand,.app-topbar-brand'
    ).forEach((block) => {
      block.classList.add('hadirly-brand');

      let text = block.querySelector(':scope > .hadirly-brand__text');

      [...block.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .forEach((node) => node.remove());

      [...block.children].forEach((child) => {
        if (child === text) return;
        const isIconElement = child.matches('img') || Boolean(child.querySelector('img'));
        if (!isIconElement) child.remove();
      });

      if (!text || !block.contains(text)) {
        text = document.createElement('span');
        text.className = 'hadirly-brand__text';
        block.appendChild(text);
      }

      const displayName = block.classList.contains('app-sidebar-brand') ? `${APP_NAME} :` : APP_NAME;
      text.innerHTML = `<strong>${displayName}</strong><small>${TAGLINE}</small>`;
    });
  }

  function apply(root = document) {
    updateHead();
    replaceImages(root);
    replaceText(root);
    decorateBrandBlocks();
    document.documentElement.dataset.brand = 'hadirly';
  }

  const refresh = () => apply(document);
  refresh();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh, { once: true });
  window.addEventListener('absen:app-ready', refresh);
  window.addEventListener('absen:session-changed', refresh);
  window.HadirlyBranding = Object.freeze({ apply, refresh, APP_NAME, TAGLINE, FULL_NAME, ICON, LOGO });
})();
