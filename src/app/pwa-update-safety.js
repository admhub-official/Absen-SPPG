(() => {
  if (window.HadirlyUpdateSafety) return;

  const dirtyInputs = new Map();
  const dirtyCanvases = new Set();
  let manualDirty = false;
  let lastDirty = false;

  const editableSelector = 'input:not([type="hidden"]):not([type="search"]):not([type="button"]):not([type="submit"]):not([type="reset"]),textarea,select,[contenteditable="true"]';

  function visible(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    if (element.closest('[hidden],.hidden,[aria-hidden="true"]')) return false;
    return element.getClientRects().length > 0;
  }

  function valueOf(element) {
    if (element instanceof HTMLInputElement) {
      if (['checkbox', 'radio'].includes(element.type)) return element.checked ? '1' : '0';
      if (element.type === 'file') return [...(element.files || [])].map((file) => `${file.name}:${file.size}:${file.lastModified}`).join('|');
      return element.value;
    }
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return element.value;
    return element.textContent || '';
  }

  function captureInitial(element) {
    if (!(element instanceof Element) || !element.matches(editableSelector)) return;
    if (!dirtyInputs.has(element)) dirtyInputs.set(element, { initial: valueOf(element), dirty: false });
  }

  function updateInput(element) {
    if (!(element instanceof Element) || !element.matches(editableSelector)) return;
    captureInitial(element);
    const state = dirtyInputs.get(element);
    state.dirty = valueOf(element) !== state.initial;
    notifySafePointIfNeeded();
  }

  function isDirty() {
    if (manualDirty) return true;
    for (const [element, state] of dirtyInputs) {
      if (!element.isConnected) { dirtyInputs.delete(element); continue; }
      if (state.dirty && visible(element)) return true;
    }
    for (const canvas of [...dirtyCanvases]) {
      if (!canvas.isConnected) { dirtyCanvases.delete(canvas); continue; }
      if (visible(canvas)) return true;
    }
    return false;
  }

  function notifySafePointIfNeeded() {
    const current = isDirty();
    if (lastDirty && !current) window.dispatchEvent(new CustomEvent('absen:pwa-safe-point'));
    lastDirty = current;
  }

  function markDirty() {
    manualDirty = true;
    notifySafePointIfNeeded();
  }

  function markClean() {
    manualDirty = false;
    dirtyCanvases.clear();
    for (const [element] of dirtyInputs) {
      if (!element.isConnected) dirtyInputs.delete(element);
      else dirtyInputs.set(element, { initial: valueOf(element), dirty: false });
    }
    notifySafePointIfNeeded();
  }

  document.addEventListener('focusin', (event) => captureInitial(event.target), true);
  document.addEventListener('input', (event) => updateInput(event.target), true);
  document.addEventListener('change', (event) => updateInput(event.target), true);
  document.addEventListener('pointerdown', (event) => {
    const canvas = event.target instanceof Element ? event.target.closest('canvas') : null;
    if (canvas && visible(canvas) && canvas.closest('.modal-overlay,.app-view,form')) {
      dirtyCanvases.add(canvas);
      notifySafePointIfNeeded();
    }
  }, true);
  document.addEventListener('submit', () => setTimeout(markClean, 0), true);
  document.addEventListener('reset', () => setTimeout(markClean, 0), true);
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('.modal-close,[data-close-modal],[data-dismiss="modal"],.btn-cancel') : null;
    if (target) setTimeout(markClean, 0);
  }, true);
  window.addEventListener('absen:session-changed', (event) => {
    if (event.detail?.authenticated === false) markClean();
  });

  window.HadirlyUpdateSafety = Object.freeze({ isDirty, markDirty, markClean });
})();
