(() => {
  const normalize = (value) => String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  function visibleOptions(picker) {
    return [...picker.querySelectorAll('.attendance-account-option')]
      .filter((option) => !option.hidden && option.style.display !== 'none');
  }

  function ensureEmptyMessage(picker) {
    const options = picker.querySelector('.attendance-account-options');
    if (!options) return null;
    let empty = options.querySelector('.attendance-account-empty');
    if (!empty) {
      empty = document.createElement('div');
      empty.className = 'attendance-account-empty';
      empty.textContent = 'Nama akun tidak ditemukan.';
      empty.hidden = true;
      options.appendChild(empty);
    }
    return empty;
  }

  function filterPicker(search) {
    const picker = search.closest('.attendance-account-picker');
    if (!picker) return;
    const query = normalize(search.value);
    const options = [...picker.querySelectorAll('.attendance-account-option')];
    let matches = 0;

    options.forEach((option) => {
      const name = normalize(option.dataset.name || option.textContent || '');
      const matched = !query || name.includes(query);
      option.hidden = !matched;
      option.style.display = matched ? '' : 'none';
      option.classList.remove('attendance-account-option-active');
      if (matched) matches += 1;
    });

    const empty = ensureEmptyMessage(picker);
    if (empty) empty.hidden = matches > 0;
    const first = visibleOptions(picker)[0];
    if (first && query) first.classList.add('attendance-account-option-active');
  }

  document.addEventListener('input', (event) => {
    const search = event.target.closest?.('.attendance-account-search');
    if (search) filterPicker(search);
  }, true);

  document.addEventListener('search', (event) => {
    const search = event.target.closest?.('.attendance-account-search');
    if (search) filterPicker(search);
  }, true);

  document.addEventListener('keydown', (event) => {
    const search = event.target.closest?.('.attendance-account-search');
    if (!search) return;
    const picker = search.closest('.attendance-account-picker');
    if (!picker) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const first = visibleOptions(picker)[0];
      const checkbox = first?.querySelector('[data-user-id]');
      if (!checkbox) return;
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      if (picker.closest('tr')?.querySelector('[data-field="mappingMode"]')?.value === 'SINGLE') {
        picker.querySelector('.attendance-account-menu').hidden = true;
        picker.querySelector('.attendance-account-trigger')?.setAttribute('aria-expanded', 'false');
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      picker.querySelector('.attendance-account-menu').hidden = true;
      picker.querySelector('.attendance-account-trigger')?.setAttribute('aria-expanded', 'false');
      picker.querySelector('.attendance-account-trigger')?.focus();
    }
  }, true);
})();