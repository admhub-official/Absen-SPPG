(() => {
  if (window.__ABSEN_EMPLOYMENT_MASTER_NORMALIZATION__) return;
  window.__ABSEN_EMPLOYMENT_MASTER_NORMALIZATION__ = true;

  const codeFor = (value) => {
    const slug = String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'JABATAN';
    return `JBT-${slug}`.slice(0, 40);
  };

  const groupOf = (node) => node?.closest?.('.form-group');

  function normalizeTabLabels() {
    document.querySelectorAll('[data-master-tab="JABATAN"]').forEach((button) => {
      if (button.textContent !== 'Jabatan atau Divisi') button.textContent = 'Jabatan atau Divisi';
    });
  }

  function normalizeJabatanCards() {
    const active = document.querySelector('[data-master-tab="JABATAN"].is-active');
    if (!active) return;
    document.querySelectorAll('#employment-master-content .employment-master-item > span').forEach((summary) => {
      const text = String(summary.textContent || '');
      if (!text.includes(' · Divisi:')) return;
      summary.textContent = `${text.split(' · Divisi:')[0]} · Kode otomatis`;
    });
  }

  function normalizeJabatanForm() {
    const name = document.querySelector('#m-nama-jabatan');
    if (!name) return;
    const code = document.querySelector('#m-kode-jabatan');
    const division = document.querySelector('#m-divisi');
    const nameLabel = groupOf(name)?.querySelector('label');
    if (nameLabel) nameLabel.textContent = 'Jabatan atau Divisi *';

    if (code) {
      const group = groupOf(code);
      if (group) group.hidden = true;
      code.tabIndex = -1;
      code.setAttribute('aria-hidden', 'true');
    }
    if (division) {
      const group = groupOf(division);
      if (group) group.hidden = true;
      division.tabIndex = -1;
      division.setAttribute('aria-hidden', 'true');
    }

    const sync = () => {
      const value = String(name.value || '').trim();
      if (code) code.value = codeFor(value);
      if (division) division.value = value;
    };
    if (name.dataset.jabatanUnified !== '1') {
      name.dataset.jabatanUnified = '1';
      name.addEventListener('input', sync);
      name.addEventListener('change', sync);
    }
    sync();

    const title = document.querySelector('#employment-contract-modal-title');
    const subtitle = document.querySelector('#employment-contract-modal-subtitle');
    if (title && /Jabatan/i.test(title.textContent || '')) {
      title.textContent = String(title.textContent || '').replace(/Jabatan\s*&\s*Divisi/gi, 'Jabatan atau Divisi');
    }
    if (subtitle) subtitle.textContent = 'Isi satu nama Jabatan atau Divisi. Kode dibuat otomatis oleh sistem.';
  }

  function normalizeWorkingHoursForm() {
    const select = document.querySelector('#m-job-id');
    const division = document.querySelector('#m-divisi');
    const masuk = document.querySelector('#m-masuk');
    const pulang = document.querySelector('#m-pulang');
    if (!select || !division || (!masuk && !pulang)) return;

    const label = groupOf(select)?.querySelector('label');
    if (label) label.textContent = 'Jabatan atau Divisi *';
    const group = groupOf(division);
    if (group) group.hidden = true;
    division.tabIndex = -1;
    division.setAttribute('aria-hidden', 'true');

    const sync = () => {
      const option = select.options?.[select.selectedIndex];
      division.value = option && option.value ? String(option.textContent || '').trim() : '';
    };
    if (select.dataset.jamUnified !== '1') {
      select.dataset.jamUnified = '1';
      select.addEventListener('change', sync);
    }
    sync();
  }

  function normalize() {
    normalizeTabLabels();
    normalizeJabatanCards();
    normalizeJabatanForm();
    normalizeWorkingHoursForm();
  }

  const observer = new MutationObserver(() => queueMicrotask(normalize));
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('input', (event) => {
    if (event.target?.id === 'm-nama-jabatan') normalizeJabatanForm();
  }, true);
  window.addEventListener('absen:session-changed', normalize);
  window.addEventListener('absen:app-ready', normalize);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', normalize, { once: true });
  else normalize();
})();
