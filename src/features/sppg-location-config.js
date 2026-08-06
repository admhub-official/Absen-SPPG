(() => {
  if (window.__SPPG_LOCATION_CONFIG__) return;
  window.__SPPG_LOCATION_CONFIG__ = true;

  const state = {
    masterSppg: [],
    locations: [],
    maxRadiusMeter: 100,
    selectedKey: '',
  };

  function escape(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function normalizeKey(value) {
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/^SPPG[\s_-]*/, '')
      .replace(/[^A-Z0-9]+/g, '');
  }

  function isSuperAdmin() {
    return typeof isSuperAdminUser === 'function' && isSuperAdminUser();
  }

  function notify(message, type = 'success') {
    if (typeof showAlert === 'function') showAlert(message, type);
  }

  function ensureStyles() {
    if (document.getElementById('sppg-location-config-style')) return;
    const style = document.createElement('style');
    style.id = 'sppg-location-config-style';
    style.textContent = `
      .sppg-location-card{margin-top:1rem}
      .sppg-location-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.85rem;padding:1rem}
      .sppg-location-grid .form-group{margin:0}
      .sppg-location-span-2{grid-column:1/-1}
      .sppg-location-actions{display:flex;gap:.55rem;flex-wrap:wrap;align-items:center}
      .sppg-location-switch{display:flex;align-items:center;gap:.6rem;min-height:44px;padding:.65rem .8rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg)}
      .sppg-location-switch input{width:18px;height:18px;accent-color:var(--primary)}
      .sppg-location-status{font-size:.78rem;color:var(--text-secondary);min-height:1.1rem}
      .sppg-location-table td{vertical-align:middle}
      .sppg-location-coord{font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.76rem}
      .sppg-location-note{max-width:280px;white-space:normal;line-height:1.45;color:var(--text-secondary)}
      .sppg-location-map-link{display:inline-flex;align-items:center;gap:.3rem;color:var(--primary);font-weight:700;text-decoration:none}
      .sppg-location-empty{padding:1.25rem;text-align:center;color:var(--text-secondary)}
      @media(max-width:760px){
        .sppg-location-grid{grid-template-columns:1fr;padding:.8rem}
        .sppg-location-span-2{grid-column:auto}
        .sppg-location-actions .btn{flex:1 1 140px}
      }
    `;
    document.head.appendChild(style);
  }

  function ensureRoot() {
    let root = document.getElementById('sppg-location-config-root');
    if (root) return root;
    const accessBody = document.getElementById('config-access-body');
    const anchor = accessBody?.closest('.admin-card');
    if (!anchor?.parentElement) return null;
    root = document.createElement('div');
    root.id = 'sppg-location-config-root';
    anchor.parentElement.insertBefore(root, anchor);
    return root;
  }

  function locationByKey(key) {
    return state.locations.find((row) => String(row.Kunci_SPPG || '') === key) || null;
  }

  function buildOptions() {
    const options = new Map();
    options.set('DEFAULT', {
      key: 'DEFAULT',
      name: 'Titik cadangan SPPG lainnya',
      yayasan: '',
    });

    state.masterSppg.forEach((row) => {
      const key = normalizeKey(row.Nama_SPPG);
      if (!key) return;
      options.set(key, {
        key,
        name: String(row.Nama_SPPG || key),
        yayasan: String(row.Yayasan || ''),
      });
    });

    state.locations.forEach((row) => {
      const key = String(row.Kunci_SPPG || '');
      if (!key || options.has(key)) return;
      options.set(key, {
        key,
        name: String(row.Nama_SPPG || key),
        yayasan: '',
      });
    });

    return [...options.values()].sort((a, b) => {
      if (a.key === 'DEFAULT') return -1;
      if (b.key === 'DEFAULT') return 1;
      return a.name.localeCompare(b.name, 'id');
    });
  }

  function render() {
    const root = ensureRoot();
    if (!root) return;
    ensureStyles();

    if (!isSuperAdmin()) {
      root.innerHTML = '';
      return;
    }

    const options = buildOptions();
    const selectedKey = state.selectedKey || options[0]?.key || '';
    state.selectedKey = selectedKey;
    const selected = locationByKey(selectedKey);
    const selectedOption = options.find((item) => item.key === selectedKey);

    const tableRows = state.locations.length
      ? state.locations.map((row) => {
        const lat = Number(row.Latitude);
        const lng = Number(row.Longitude);
        const mapUrl = Number.isFinite(lat) && Number.isFinite(lng)
          ? `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`
          : '';
        return `<tr>
          <td><strong>${escape(row.Nama_SPPG || row.Kunci_SPPG)}</strong><div class="helper-text">${escape(row.Kunci_SPPG)}</div></td>
          <td class="sppg-location-coord">${escape(Number.isFinite(lat) ? lat.toFixed(8) : '-')}</td>
          <td class="sppg-location-coord">${escape(Number.isFinite(lng) ? lng.toFixed(8) : '-')}</td>
          <td>${escape(row.Radius_Meter || '-')} m</td>
          <td><span class="badge ${row.Aktif ? 'badge-success' : 'badge-gray'}">${row.Aktif ? 'Aktif' : 'Nonaktif'}</span></td>
          <td class="sppg-location-note">${escape(row.Catatan || '-')}</td>
          <td>
            <div class="sppg-location-actions">
              <button class="btn btn-sm btn-secondary" type="button" data-location-edit="${escape(row.Kunci_SPPG)}">Edit</button>
              ${mapUrl ? `<a class="sppg-location-map-link" href="${mapUrl}" target="_blank" rel="noopener noreferrer">Peta</a>` : ''}
            </div>
          </td>
        </tr>`;
      }).join('')
      : '<tr><td colspan="7"><div class="sppg-location-empty">Belum ada konfigurasi lokasi SPPG.</div></td></tr>';

    root.innerHTML = `
      <div class="feature-card sppg-location-card">
        <div class="feature-toolbar">
          <div>
            <strong>Lokasi & Geofence SPPG</strong>
            <div class="helper-text">Atur titik latitude, longitude, dan radius maksimal untuk validasi absensi wajah.</div>
          </div>
          <button class="btn btn-secondary btn-sm" id="btn-refresh-sppg-location" type="button">Muat Ulang</button>
        </div>
        <div class="config-section-note">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 12-9 12S3 17 3 10a9 9 0 1 1 18 0Z"/><circle cx="12" cy="10" r="3"/></svg>
          <div>Koordinat ini dipakai langsung oleh gateway absensi. Radius maksimum sistem adalah ${escape(state.maxRadiusMeter)} meter. Pilihan DEFAULT menjadi titik cadangan bila SPPG belum memiliki titik khusus.</div>
        </div>
        <div class="sppg-location-grid">
          <div class="form-group sppg-location-span-2">
            <label class="form-label" for="sppg-location-select">SPPG / Titik Cadangan</label>
            <select class="form-input" id="sppg-location-select">
              ${options.map((option) => `<option value="${escape(option.key)}" ${option.key === selectedKey ? 'selected' : ''}>${escape(option.key === 'DEFAULT' ? 'DEFAULT — Titik cadangan semua SPPG' : `${option.name}${option.yayasan ? ` — ${option.yayasan}` : ''}`)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="sppg-location-latitude">Latitude</label>
            <input class="form-input" id="sppg-location-latitude" type="number" inputmode="decimal" step="0.00000001" min="-90" max="90" placeholder="Contoh: -6.91883033" value="${escape(selected?.Latitude ?? '')}">
          </div>
          <div class="form-group">
            <label class="form-label" for="sppg-location-longitude">Longitude</label>
            <input class="form-input" id="sppg-location-longitude" type="number" inputmode="decimal" step="0.00000001" min="-180" max="180" placeholder="Contoh: 108.07180419" value="${escape(selected?.Longitude ?? '')}">
          </div>
          <div class="form-group">
            <label class="form-label" for="sppg-location-radius">Radius Maksimum (meter)</label>
            <input class="form-input" id="sppg-location-radius" type="number" inputmode="numeric" min="1" max="${escape(state.maxRadiusMeter)}" value="${escape(selected?.Radius_Meter ?? 50)}">
          </div>
          <label class="sppg-location-switch" for="sppg-location-active">
            <input id="sppg-location-active" type="checkbox" ${selected?.Aktif !== false ? 'checked' : ''}>
            <span><strong>Lokasi aktif</strong><span class="helper-text">Dipakai untuk validasi absensi</span></span>
          </label>
          <div class="form-group sppg-location-span-2">
            <label class="form-label" for="sppg-location-note">Catatan</label>
            <textarea class="form-input" id="sppg-location-note" rows="3" maxlength="500" placeholder="Contoh: Titik resmi pintu utama SPPG">${escape(selected?.Catatan || '')}</textarea>
          </div>
          <div class="sppg-location-actions sppg-location-span-2">
            <button class="btn btn-secondary" id="btn-use-current-sppg-location" type="button">Gunakan Lokasi Perangkat</button>
            <button class="btn btn-secondary" id="btn-open-sppg-location-map" type="button">Buka di Peta</button>
            <button class="btn btn-primary" id="btn-save-sppg-location" type="button">Simpan Lokasi</button>
          </div>
          <div class="sppg-location-status sppg-location-span-2" id="sppg-location-status">${selected ? `Mengedit ${escape(selected.Nama_SPPG || selectedOption?.name || selectedKey)}.` : `Belum ada titik untuk ${escape(selectedOption?.name || selectedKey)}.`}</div>
        </div>
        <div class="data-table-wrap">
          <table class="data-table sppg-location-table">
            <thead><tr><th>SPPG</th><th>Latitude</th><th>Longitude</th><th>Radius</th><th>Status</th><th>Catatan</th><th>Aksi</th></tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      </div>
    `;

    bindEvents();
  }

  function setStatus(message) {
    const status = document.getElementById('sppg-location-status');
    if (status) status.textContent = message;
  }

  function selectLocation(key) {
    state.selectedKey = key;
    render();
    document.getElementById('sppg-location-select')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function openMap() {
    const lat = Number(document.getElementById('sppg-location-latitude')?.value);
    const lng = Number(document.getElementById('sppg-location-longitude')?.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      notify('Isi latitude dan longitude terlebih dahulu.', 'warning');
      return;
    }
    window.open(`https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`, '_blank', 'noopener,noreferrer');
  }

  function useCurrentLocation() {
    const button = document.getElementById('btn-use-current-sppg-location');
    if (!navigator.geolocation) {
      notify('Perangkat atau browser tidak mendukung geolokasi.', 'error');
      return;
    }
    const original = button?.textContent || '';
    if (button) {
      button.disabled = true;
      button.textContent = 'Membaca GPS...';
    }
    setStatus('Meminta koordinat GPS perangkat...');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latInput = document.getElementById('sppg-location-latitude');
        const lngInput = document.getElementById('sppg-location-longitude');
        if (latInput) latInput.value = Number(position.coords.latitude).toFixed(8);
        if (lngInput) lngInput.value = Number(position.coords.longitude).toFixed(8);
        setStatus(`Lokasi perangkat terbaca dengan akurasi sekitar ±${Math.round(position.coords.accuracy || 0)} meter.`);
        if (button) {
          button.disabled = false;
          button.textContent = original;
        }
      },
      (error) => {
        const message = error.code === error.PERMISSION_DENIED
          ? 'Izin lokasi ditolak. Aktifkan izin lokasi lalu coba kembali.'
          : 'Koordinat GPS tidak dapat dibaca. Coba di area dengan sinyal lebih baik.';
        notify(message, 'error');
        setStatus(message);
        if (button) {
          button.disabled = false;
          button.textContent = original;
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  async function save() {
    const selected = buildOptions().find((item) => item.key === state.selectedKey);
    const latitude = Number(document.getElementById('sppg-location-latitude')?.value);
    const longitude = Number(document.getElementById('sppg-location-longitude')?.value);
    const radiusMeter = Number(document.getElementById('sppg-location-radius')?.value);
    const aktif = Boolean(document.getElementById('sppg-location-active')?.checked);
    const catatan = String(document.getElementById('sppg-location-note')?.value || '').trim();

    if (!selected) {
      notify('Pilih SPPG terlebih dahulu.', 'warning');
      return;
    }
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      notify('Latitude harus berada antara -90 dan 90.', 'warning');
      return;
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      notify('Longitude harus berada antara -180 dan 180.', 'warning');
      return;
    }
    if (!Number.isFinite(radiusMeter) || radiusMeter < 1 || radiusMeter > state.maxRadiusMeter) {
      notify(`Radius harus antara 1 sampai ${state.maxRadiusMeter} meter.`, 'warning');
      return;
    }

    const button = document.getElementById('btn-save-sppg-location');
    const original = button?.innerHTML || '';
    if (button) {
      button.disabled = true;
      button.innerHTML = '<span class="spinner" style="width:18px;height:18px;border-width:2px"></span>Menyimpan...';
    }

    try {
      const result = await apiCall('saveSppgLocationConfiguration', {
        token: AppState.token,
        kunciSppg: selected.key,
        namaSppg: selected.name,
        latitude,
        longitude,
        radiusMeter: Math.round(radiusMeter),
        aktif,
        catatan,
      });
      notify(result?.message || 'Konfigurasi lokasi berhasil disimpan.', 'success');
      await load();
      selectLocation(selected.key);
    } catch (error) {
      notify(error?.message || 'Gagal menyimpan konfigurasi lokasi.', 'error');
    } finally {
      if (button && document.body.contains(button)) {
        button.disabled = false;
        button.innerHTML = original;
      }
    }
  }

  function bindEvents() {
    document.getElementById('sppg-location-select')?.addEventListener('change', (event) => {
      state.selectedKey = event.target.value;
      render();
    });
    document.getElementById('btn-refresh-sppg-location')?.addEventListener('click', () => load());
    document.getElementById('btn-use-current-sppg-location')?.addEventListener('click', useCurrentLocation);
    document.getElementById('btn-open-sppg-location-map')?.addEventListener('click', openMap);
    document.getElementById('btn-save-sppg-location')?.addEventListener('click', save);
    document.querySelectorAll('[data-location-edit]').forEach((button) => {
      button.addEventListener('click', () => selectLocation(button.dataset.locationEdit));
    });
  }

  async function load() {
    if (!isSuperAdmin()) return;
    const root = ensureRoot();
    if (!root) return;
    ensureStyles();
    root.innerHTML = '<div class="feature-card sppg-location-card"><div class="loading-state"><span class="spinner"></span>Memuat lokasi SPPG...</div></div>';
    try {
      const result = await apiCall('getSppgLocationConfiguration', { token: AppState.token });
      state.masterSppg = result?.masterSppg || [];
      state.locations = result?.locations || [];
      state.maxRadiusMeter = Number(result?.maxRadiusMeter) || 100;
      if (!state.selectedKey) state.selectedKey = 'DEFAULT';
      render();
    } catch (error) {
      root.innerHTML = `<div class="feature-card sppg-location-card"><div class="table-empty">Gagal memuat lokasi SPPG: ${escape(error?.message || 'Terjadi kesalahan.')}</div></div>`;
    }
  }

  window.SppgLocationConfig = Object.freeze({ load });
})();
