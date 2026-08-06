(() => {
  if (window.SystemSettings) return;

  const endpoint = `${String(window.ABSEN_SUPABASE_CONFIG?.projectUrl || '').replace(/\/$/, '')}/functions/v1/SystemSettings`;
  const categories = Object.freeze({
    menu:['Menu & Akses','Visibilitas menu berdasarkan role.'],
    attendance:['Absensi','Validasi lokasi, impor, dan koreksi.'],
    payroll:['Payroll & TTD','Persyaratan penerbitan slip gaji.'],
    notification:['Notifikasi','Notifikasi operasional dan pengumuman.'],
    security:['Keamanan & Sesi','Sesi dan tindakan berisiko.'],
  });
  const definitions = Object.freeze([
    ['menu','menu.user.complaints','Menu Pengaduan USER','Tampilkan pusat pengaduan untuk pengguna.'],
    ['menu','menu.admin.payroll','Menu Payroll ADMIN','Izinkan ADMIN mengakses penerbitan payroll.'],
    ['menu','menu.admin.audit','Menu Audit Log','Tampilkan audit operasional bagi ADMIN.'],
    ['attendance','attendance.geofence_required','Geofence wajib','Tolak absensi di luar radius SPPG.'],
    ['attendance','attendance.capture_gps_accuracy','Simpan akurasi GPS','Rekam metadata akurasi lokasi setiap punch.'],
    ['attendance','attendance.allow_import_single_punch','Punch tunggal impor','Izinkan punch tunggal hasil impor dihitung valid.'],
    ['attendance','attendance.correction_requires_audit','Audit koreksi absensi','Setiap koreksi wajib disertai audit.'],
    ['payroll','payroll.recipient_signature_required','TTD penerima wajib','Slip final memerlukan tanda tangan penerima.'],
    ['payroll','payroll.accountant_signature_required','TTD akuntan wajib','Penerbitan slip memerlukan tanda tangan akuntan.'],
    ['payroll','payroll.head_signature_required','TTD Kepala SPPG wajib','Penerbitan slip memerlukan tanda tangan Kepala SPPG.'],
    ['payroll','payroll.private_pdf','PDF slip privat','Batasi akses PDF slip kepada pihak berwenang.'],
    ['notification','notification.new_slip','Notifikasi slip baru','Beri tahu pengguna saat slip diterbitkan.'],
    ['notification','notification.complaint_reply','Notifikasi balasan pengaduan','Beri tahu pengguna saat pengaduan ditanggapi.'],
    ['notification','notification.incomplete_attendance','Pengingat absensi tidak lengkap','Beri peringatan punch belum lengkap.'],
    ['notification','notification.global_announcement','Pengumuman global','Izinkan SUPER ADMIN menerbitkan pengumuman lintas SPPG.'],
    ['security','security.idle_session_expiry','Kedaluwarsa sesi idle','Akhiri sesi yang tidak aktif sesuai kebijakan.'],
    ['security','security.revoke_on_password_reset','Cabut sesi saat reset password','Keluar dari seluruh perangkat setelah perubahan sandi.'],
    ['security','security.risky_action_reason','Alasan tindakan wajib','Wajibkan alasan pada perubahan berisiko.'],
    ['security','security.two_step_confirmation','Konfirmasi dua tahap','Tampilkan dampak sebelum tindakan berisiko.'],
  ].map(([category,key,label,description]) => ({ category,key,label,description,featured:key==='notification.global_announcement' })));

  const state = { rows:new Map(), category:'attendance', loading:false, loaded:false, saving:new Set(), timer:null };
  const token = () => localStorage.getItem('auth_token') || '';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const enabled = (row) => Boolean(row?.Enabled ?? row?.Setting_Value?.enabled);

  function isSuper() {
    try {
      const user = JSON.parse(localStorage.getItem('auth_user') || 'null');
      return Boolean(token()) && String(user?.role || user?.Role || '').trim().toUpperCase().replace(/_/g,' ').replace(/\s+/g,' ') === 'SUPER ADMIN';
    } catch { return false; }
  }

  async function call(action,payload={}) {
    const response = await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,token:token(),...payload}),cache:'no-store'});
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) throw new Error(body.message || 'Pengaturan gagal diproses.');
    return body.result;
  }

  function legacyCard() {
    return document.getElementById('system-settings-body')?.closest('.feature-card,.admin-card') || null;
  }

  function disableLegacyRenderer() {
    const card = legacyCard();
    if (!card) return;
    card.classList.add('system-settings-legacy-disabled');
    card.dataset.legacySystemSettings = 'disabled';
    card.removeAttribute('aria-hidden');
  }

  function syncLegacyCategory(category=state.category) {
    const button = document.querySelector(`[data-setting-tab="${CSS.escape(category)}"]`);
    if (button && !button.classList.contains('active')) button.click();
    disableLegacyRenderer();
  }

  function root() {
    if (!isSuper()) return null;
    const view = document.getElementById('view-admin-config');
    if (!view) return null;
    disableLegacyRenderer();
    let node = document.getElementById('system-settings-root');
    if (!node) {
      node = document.createElement('section');
      node.id = 'system-settings-root';
      node.className = 'system-settings-controller feature-card';
      node.dataset.saSettingsSection = 'system';
      const anchor = document.getElementById('sa-settings-system-intro');
      if (anchor?.parentElement === view) anchor.insertAdjacentElement('afterend',node); else view.appendChild(node);
    }
    return node;
  }

  function formatDate(value) {
    if (!value) return 'Belum pernah diperbarui';
    try { return new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)); }
    catch { return String(value); }
  }

  function render() {
    const node = root(); if (!node) return;
    const rows = definitions.filter((item) => item.category === state.category);
    node.innerHTML = `<header class="ssc-header"><div><span class="sa-settings-eyebrow">SUMBER TUNGGAL BACKEND</span><h2>Konfigurasi Sistem</h2><p>Nilai tombol selalu berasal dari database. Pesan sukses hanya muncul setelah pembacaan ulang sesuai.</p></div><button type="button" class="btn btn-secondary btn-sm" data-ssc-refresh ${state.loading?'disabled':''}>Muat Ulang</button></header>
      <div class="ssc-health ${state.loaded?'is-ready':''}" role="status"><strong>${state.loading?'Membaca backend…':state.loaded?'Backend tersinkron':'Backend belum dimuat'}</strong><span>${state.loaded?`${state.rows.size} pengaturan tersedia.`:'Tidak ada nilai default sebelum backend siap.'}</span></div>
      <nav class="ssc-tabs" role="tablist" aria-label="Kategori konfigurasi sistem">${Object.entries(categories).map(([key,[label,description]])=>`<button type="button" role="tab" data-ssc-category="${key}" class="${key===state.category?'active':''}" aria-selected="${key===state.category}"><strong>${esc(label)}</strong><small>${esc(description)}</small></button>`).join('')}</nav>
      <div class="ssc-list" aria-busy="${state.loading}">${state.loading&&!state.loaded?'<div class="ssc-empty">Memuat nilai aktual dari database…</div>':rows.map((item)=>{
        const row=state.rows.get(item.key),ready=Boolean(row),on=ready&&enabled(row),saving=state.saving.has(item.key);
        return `<article class="ssc-row ${item.featured?'is-featured':''}"><div class="ssc-row-copy"><strong>${esc(item.label)}</strong><p>${esc(row?.Description||item.description)}</p><small>${ready?`Diperbarui ${esc(formatDate(row.Updated_At))}`:'Nilai backend belum tersedia'}</small></div><div class="ssc-row-control"><span class="ssc-state ${on?'is-on':'is-off'}">${on?'Aktif':'Nonaktif'}</span><button type="button" class="ssc-switch ${on?'active':''}" role="switch" aria-checked="${on}" aria-label="${esc(item.label)}" data-ssc-key="${esc(item.key)}" ${!ready||saving?'disabled':''}><span aria-hidden="true"></span></button></div></article>`;
      }).join('')}</div>`;
    syncLegacyCategory();
  }

  async function refresh(silent=false) {
    if (!isSuper() || state.loading) return;
    state.loading=true; if(!silent)render();
    try {
      const result=await call('getSettings');
      const items=Array.isArray(result?.items)?result.items:[];
      if(items.length!==definitions.length)throw new Error(`Backend mengembalikan ${items.length} dari ${definitions.length} pengaturan.`);
      state.rows=new Map(items.map((item)=>[String(item.Setting_Key),item])); state.loaded=true;
    } catch(error) { state.loaded=false; window.showAlert?.(error.message,'error'); }
    finally { state.loading=false; render(); }
  }

  async function update(key) {
    if(state.saving.has(key))return;
    const item=definitions.find((entry)=>entry.key===key),current=state.rows.get(key);
    if(!item||!current)return window.showAlert?.('Nilai backend belum tersedia. Muat ulang halaman.','error');
    const next=!enabled(current);
    if(typeof window.appConfirm!=='function')return window.showAlert?.('Dialog konfirmasi belum siap.','error');
    const approved=await window.appConfirm({title:`${next?'Aktifkan':'Nonaktifkan'} ${item.label}?`,message:`Fitur akan ${next?'diaktifkan':'dinonaktifkan'} setelah database berhasil diverifikasi.`,confirmText:next?'Ya, aktifkan':'Ya, nonaktifkan',cancelText:'Tidak',tone:next?'primary':'danger',detail:'Tampilan tidak memakai status lokal atau nilai default.'});
    if(!approved)return;
    state.saving.add(key);render();
    try {
      const result=await call('updateSetting',{key,enabled:next,description:current.Description||item.description,reason:`SUPER ADMIN ${next?'mengaktifkan':'menonaktifkan'} ${item.label} melalui Konfigurasi Sistem.`});
      if(!result?.item||enabled(result.item)!==next)throw new Error('Respons simpan tidak sesuai.');
      const verified=await call('getSettings'),items=Array.isArray(verified?.items)?verified.items:[];
      state.rows=new Map(items.map((entry)=>[String(entry.Setting_Key),entry]));
      if(!state.rows.get(key)||enabled(state.rows.get(key))!==next)throw new Error('Nilai database tidak sesuai saat diverifikasi ulang.');
      state.loaded=true;
      window.showAlert?.(`${item.label} berhasil ${next?'diaktifkan':'dinonaktifkan'}.`,'success');
      window.dispatchEvent(new CustomEvent('absen:system-settings-changed',{detail:{key,enabled:next,setting:state.rows.get(key)}}));
      if(key==='notification.global_announcement')window.NotificationPublisher?.load?.();
    } catch(error) { window.showAlert?.(error.message||'Pengaturan gagal disimpan.','error'); await refresh(true); }
    finally { state.saving.delete(key); render(); }
  }

  function schedule(delay=80) {
    clearTimeout(state.timer); state.timer=setTimeout(()=>{if(!root())return;render();if(!state.loaded&&!state.loading)refresh();},delay);
  }

  document.addEventListener('click',(event)=>{
    const category=event.target.closest?.('[data-ssc-category]');
    if(category){state.category=category.dataset.sscCategory;render();return;}
    if(event.target.closest?.('[data-ssc-refresh]')){refresh();return;}
    const toggle=event.target.closest?.('[data-ssc-key]');if(toggle){update(toggle.dataset.sscKey);return;}
    const shortcut=event.target.closest?.('[data-sa-system-tab],[data-setting-tab]');
    const requested=shortcut?.dataset.saSystemTab||shortcut?.dataset.settingTab;
    if(categories[requested]){state.category=requested;schedule(40);return;}
    if(event.target.closest?.('[data-sa-settings-tab="system"],[data-view="admin-config"]'))schedule(120);
  });
  window.addEventListener('absen:app-ready',()=>schedule(180));
  window.addEventListener('absen:session-changed',()=>{state.loaded=false;schedule(180);});
  window.addEventListener('focus',()=>{if(state.loaded)refresh(true);});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.loaded)refresh(true);});
  new MutationObserver(()=>{disableLegacyRenderer();if(isSuper()&&!document.getElementById('system-settings-root'))schedule(50);}).observe(document.documentElement,{childList:true,subtree:true});

  window.SystemSettings=Object.freeze({refresh:()=>refresh(),get:(key)=>state.rows.get(key)||null,openCategory:(category)=>{if(categories[category])state.category=category;window.SuperAdminSettingsHub?.openTab?.('system');schedule(40);}});
  window.SystemSettingsController=window.SystemSettings;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>schedule(180),{once:true});else schedule(180);
})();
