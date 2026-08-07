(() => {
  if (window.__ABSEN_PROFILE_CONTRACT_IDENTITY__) return;
  window.__ABSEN_PROFILE_CONTRACT_IDENTITY__ = true;

  const current = { profile: null, loading: false };
  const root = () => document.querySelector('#view-profil');
  const token = () => localStorage.getItem('auth_token');
  const escText = (value) => String(value ?? '').trim() || '-';

  function personalGrid() {
    return document.querySelector('#p-nama')?.closest('.info-grid') || null;
  }

  function ensureRow(id, label) {
    const grid = personalGrid();
    if (!grid) return null;
    let value = document.getElementById(id);
    if (value) return value;
    const wrapper = document.createElement('div');
    wrapper.dataset.contractIdentityField = id;
    wrapper.innerHTML = `<div class="info-item-label">${label}</div><div class="info-item-value" id="${id}">-</div>`;
    grid.appendChild(wrapper);
    return wrapper.querySelector(`#${id}`);
  }

  function render(profile = current.profile) {
    if (!root()) return;
    const nik = ensureRow('p-nik', 'NIK');
    const address = ensureRow('p-alamat', 'Alamat Lengkap');
    if (nik) nik.textContent = escText(profile?.NIK ?? profile?.nik);
    if (address) {
      address.textContent = escText(profile?.Alamat ?? profile?.alamat);
      address.style.whiteSpace = 'normal';
      address.style.lineHeight = '1.45';
    }
  }

  async function load(force = false) {
    if (current.loading || !token() || !window.ABSEN_SUPABASE_CONFIG?.projectUrl) return;
    if (!force && current.profile) return render();
    current.loading = true;
    try {
      const response = await fetch(`${window.ABSEN_SUPABASE_CONFIG.projectUrl}/functions/v1/ProfileOps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getProfileEmployment', token: token() }),
        cache: 'no-store',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.success === false) throw new Error(body?.error || 'Profil kepegawaian gagal dimuat.');
      current.profile = body?.result || null;
      render();
    } catch (error) {
      console.warn('Contract profile identity deferred', error);
      render(current.profile);
    } finally {
      current.loading = false;
    }
  }

  function init() {
    render();
    if (root() && !root().classList.contains('hidden')) load(false);
  }

  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) => {
      const target = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
      if (target?.closest?.('#view-profil')) return true;
      return [...(mutation.addedNodes || [])].some((node) =>
        node instanceof Element && (node.matches?.('#view-profil, #p-nama') || node.querySelector?.('#view-profil, #p-nama'))
      );
    });
    if (relevant) requestAnimationFrame(init);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

  window.addEventListener('absen:profile-updated', (event) => {
    current.profile = event.detail || null;
    render();
    if (!current.profile) load(true);
  });
  window.addEventListener('absen:employment-profile-loaded', (event) => {
    current.profile = event.detail || current.profile;
    render();
  });
  window.addEventListener('absen:session-changed', () => {
    current.profile = null;
    queueMicrotask(() => load(true));
  });
  window.addEventListener('absen:app-ready', init);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
