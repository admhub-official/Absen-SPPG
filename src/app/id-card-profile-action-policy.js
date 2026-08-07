(() => {
  if (window.__ABSEN_ID_CARD_PROFILE_ACTION_POLICY__) return;
  window.__ABSEN_ID_CARD_PROFILE_ACTION_POLICY__ = true;

  const REMOVED_ACTIONS = new Set(['print-card', 'download-qr', 'print-qr']);
  const selector = [...REMOVED_ACTIONS]
    .map((action) => `[data-digital-id-action="${action}"]`)
    .join(',');

  const style = document.createElement('style');
  style.id = 'id-card-profile-action-policy-style';
  style.textContent = `
    #digital-identity-section ${selector}{display:none!important}
    #digital-identity-section .digital-identity-actions.id-card-profile-actions-compact{
      grid-template-columns:repeat(2,minmax(0,1fr))!important;
    }
    @media (max-width:640px){
      #digital-identity-section .digital-identity-actions.id-card-profile-actions-compact{
        grid-template-columns:1fr 1fr!important;
      }
    }
  `;
  document.head.appendChild(style);

  function applyPolicy(root = document) {
    const scope = root.nodeType === 1 || root.nodeType === 9 ? root : document;
    scope.querySelectorAll?.(selector).forEach((button) => button.remove());
    document.querySelector('#digital-identity-section .digital-identity-actions')
      ?.classList.add('id-card-profile-actions-compact');
  }

  const observer = new MutationObserver((mutations) => {
    let relevant = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes || []) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.('#digital-identity-section, .digital-identity-actions, [data-digital-id-action]') ||
            node.querySelector?.('#digital-identity-section, .digital-identity-actions, [data-digital-id-action]')) {
          relevant = true;
          break;
        }
      }
      if (relevant) break;
    }
    if (relevant) applyPolicy();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => applyPolicy(), { once: true });
  window.addEventListener('absen:app-ready', () => applyPolicy());
  window.addEventListener('absen:session-changed', () => queueMicrotask(() => applyPolicy()));
  applyPolicy();

  window.AbsenIdCardProfileActionPolicy = Object.freeze({ apply: applyPolicy });
})();
