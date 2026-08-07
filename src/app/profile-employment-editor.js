(() => {
  if (window.__ABSEN_PROFILE_EMPLOYMENT_EDITOR__) return;
  window.__ABSEN_PROFILE_EMPLOYMENT_EDITOR__ = true;

  const modal = () => document.querySelector('#modal-edit-profil');
  const byId = (id) => document.getElementById(id);
  const currentUser = () => { try { return JSON.parse(localStorage.getItem('auth_user') || 'null') || {}; } catch { return {}; } };
  const valueOf = (user, camel, raw) => user?.[camel] ?? user?.[raw] ?? '';
  const dateOnly = (value) => value ? String(value).slice(0, 10) : '';
  let profileSnapshot = null;
  let idCardSyncQueued = false;

  const normalizedJobTitle = (user = profileSnapshot || currentUser()) => {
    const value = String(valueOf(user, 'jabatanDivisi', 'Jabatan_Divisi') || '').trim();
    return value && value !== '-' ? value : '';
  };

  function appendField(grid, label, id, type, hint = '') {
    const group = document.createElement('div'); group.className = 'form-group'; group.dataset.profileEmploymentField = id;
    group.innerHTML = `<label class="form-label" for="${id}">${label}</label><input type="${type}" id="${id}" class="form-input">${hint ? `<div class="helper-text" style="margin-top:.35rem">${hint}</div>` : ''}`;
    grid.appendChild(group);
  }
  function appendTextarea(grid, label, id, hint = '') {
    const group = document.createElement('div'); group.className = 'form-group'; group.dataset.profileEmploymentField = id;
    group.innerHTML = `<label class="form-label" for="${id}">${label}</label><textarea id="${id}" class="form-input" rows="3"></textarea>${hint ? `<div class="helper-text" style="margin-top:.35rem">${hint}</div>` : ''}`;
    grid.appendChild(group);
  }
  function appendSalaryField(grid) {
    const group=document.createElement('div'); group.className='form-group'; group.dataset.profileEmploymentField='edit-gaji-harian';
    group.innerHTML='<label class="form-label" for="edit-gaji-harian">Gaji Harian</label><input type="number" id="edit-gaji-harian" class="form-input" disabled aria-readonly="true"><div class="helper-text" style="margin-top:.35rem">Dikelola ADMIN/SUPER ADMIN dan tidak dapat diubah dari Profil.</div>'; grid.appendChild(group);
  }
  function ensureFields() {
    const grid=modal()?.querySelector('.modal-grid'); if(!grid||grid.dataset.employmentFieldsReady==='1') return Boolean(grid); grid.dataset.employmentFieldsReady='1';
    appendField(grid,'NIK','edit-nik','text','16 digit. Digunakan sebagai identitas pada Perjanjian Kerja.');
    appendTextarea(grid,'Alamat Lengkap','edit-alamat','Alamat domisili/identitas yang akan dicantumkan pada Perjanjian Kerja.');
    appendField(grid,'SPPG','edit-sppg','text','Nama SPPG tempat bekerja');
    appendField(grid,'Yayasan','edit-yayasan','text','Nama yayasan');
    appendField(grid,'Jabatan / Divisi','edit-jabatan-divisi','text','Data ini dipakai pada ID Card dan Perjanjian Kerja.');
    appendField(grid,'Tanggal Mulai Kerja','edit-tanggal-mulai-kerja','date'); appendSalaryField(grid); return true;
  }

  async function profileOps(action, updates) {
    const projectUrl=window.ABSEN_SUPABASE_CONFIG?.projectUrl, token=localStorage.getItem('auth_token'); if(!projectUrl||!token) throw new Error('Sesi atau konfigurasi aplikasi tidak tersedia.');
    const response=await fetch(`${projectUrl}/functions/v1/ProfileOps`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,token,updates}),cache:'no-store'});
    const body=await response.json().catch(()=>({})); if(!response.ok||body?.success===false) throw new Error(body?.error||'Profil gagal diproses.'); return body?.result;
  }

  async function loadSnapshot() {
    try { profileSnapshot=await profileOps('getProfileEmployment'); return profileSnapshot; } catch { profileSnapshot=currentUser(); return profileSnapshot; }
  }
  async function populate() {
    if(!ensureFields()) return; const user=await loadSnapshot();
    byId('edit-nik').value=valueOf(user,'nik','NIK'); byId('edit-alamat').value=valueOf(user,'alamat','Alamat');
    byId('edit-sppg').value=valueOf(user,'sppg','SPPG'); byId('edit-yayasan').value=valueOf(user,'yayasan','Yayasan');
    byId('edit-jabatan-divisi').value=valueOf(user,'jabatanDivisi','Jabatan_Divisi'); byId('edit-tanggal-mulai-kerja').value=dateOnly(valueOf(user,'tanggalMulaiKerja','Tanggal_Mulai_Kerja'));
    byId('edit-gaji-harian').value=valueOf(user,'gajiHarian','Gaji_Harian'); queueIdCardEmploymentSync(); window.dispatchEvent(new CustomEvent('absen:employment-profile-loaded',{detail:user}));
  }
  function showInline(message='',type='error') { if(typeof window.showInlineAlert==='function'){ if(message) window.showInlineAlert('edit-profil-alert',message,type); else window.hideInlineAlert?.('edit-profil-alert'); return; } const n=byId('edit-profil-alert'); if(n){n.textContent=message;n.style.display=message?'block':'none';} }

  function syncIdCardEmploymentTitle() {
    const root=document.querySelector('#digital-identity-section'); if(!root) return; const jobTitle=normalizedJobTitle(); const display=jobTitle||'Jabatan / Divisi belum diatur';
    root.querySelectorAll('.digital-id-person > span').forEach((node)=>{ if(node.textContent?.trim()!==display) node.textContent=display; node.dataset.idCardSource='Jabatan_Divisi'; });
    const button=root.querySelector('[data-digital-id-action="generate"]'); if(button){ if(!jobTitle){button.dataset.employmentBlocked='1';button.disabled=true;button.title='Lengkapi Jabatan / Divisi di Update Profil sebelum membuat ID Card.';} else if(button.dataset.employmentBlocked==='1'){delete button.dataset.employmentBlocked;button.removeAttribute('title');if(!/menunggu persetujuan/i.test(button.textContent||'')&&!root.classList.contains('is-busy')) button.disabled=false;} }
    let warning=root.querySelector('[data-id-card-employment-warning]'); if(!jobTitle){ if(!warning){warning=document.createElement('div');warning.dataset.idCardEmploymentWarning='1';warning.className='digital-id-pending-note';root.querySelector('.digital-identity-actions')?.before(warning);} warning.textContent='Lengkapi Jabatan / Divisi pada Update Profil. ID Card tidak akan menggunakan Role akun sebagai pengganti jabatan.';} else warning?.remove();
  }
  function queueIdCardEmploymentSync(){if(idCardSyncQueued)return;idCardSyncQueued=true;requestAnimationFrame(()=>{idCardSyncQueued=false;syncIdCardEmploymentTitle();});}

  async function saveProfile(button) {
    showInline(''); const nik=byId('edit-nik')?.value.trim()||''; if(nik&&!/^\d{16}$/.test(nik)) return showInline('NIK harus terdiri dari 16 digit angka.','warning');
    const updates={Nama_Lengkap:byId('edit-nama')?.value.trim()||'',NIK:nik,Tempat_Lahir:byId('edit-tempat-lahir')?.value.trim()||'',Tanggal_Lahir:byId('edit-tanggal-lahir')?.value||null,Jenis_Kelamin:byId('edit-jk')?.value||'',Alamat:byId('edit-alamat')?.value.trim()||'',Email:byId('edit-email')?.value.trim()||'',No_Whatsapp:byId('edit-wa')?.value.trim()||'',Nama_Bank:byId('edit-bank')?.value.trim()||'',Nomor_Rekening:byId('edit-nomor-rekening')?.value.trim()||'',Atas_Nama_Rekening:byId('edit-rekening')?.value.trim()||'',SPPG:byId('edit-sppg')?.value.trim()||'',Yayasan:byId('edit-yayasan')?.value.trim()||'',Jabatan_Divisi:byId('edit-jabatan-divisi')?.value.trim()||'',Tanggal_Mulai_Kerja:byId('edit-tanggal-mulai-kerja')?.value||null};
    if(!updates.Nama_Lengkap) return showInline('Nama lengkap tidak boleh kosong.','warning'); const original=button.innerHTML;button.disabled=true;button.innerHTML='<div class="spinner" style="width:18px;height:18px;border-width:2px"></div> Menyimpan...';
    try { const result=await profileOps('updateProfil',updates); profileSnapshot=result?.profile||await loadSnapshot(); window.showAlert?.(result?.message||'Profil berhasil diperbarui.','success'); if(typeof window.loadProfilLengkap==='function') await window.loadProfilLengkap(); window.dispatchEvent(new CustomEvent('absen:profile-updated',{detail:profileSnapshot})); queueIdCardEmploymentSync(); window.closeEditProfil?.()||modal()?.classList.remove('active'); }
    catch(error){showInline(error?.message||'Terjadi kesalahan saat menyimpan profil.');} finally{button.disabled=false;button.innerHTML=original;}
  }
  function handleClick(event){const open=event.target.closest?.('#btn-open-edit-profil');if(open){ensureFields();queueMicrotask(populate);return;}const save=event.target.closest?.('#btn-save-edit-profil');if(!save||save.disabled)return;event.preventDefault();event.stopImmediatePropagation();ensureFields();saveProfile(save);}
  function init(){ensureFields();document.addEventListener('click',handleClick,true);window.addEventListener('absen:profile-updated',populate);window.addEventListener('absen:session-changed',()=>queueMicrotask(populate));window.addEventListener('absen:app-ready',queueIdCardEmploymentSync);const observer=new MutationObserver((mutations)=>{if(mutations.some((m)=>{const t=m.target instanceof Element?m.target:m.target.parentElement;if(t?.closest?.('#digital-identity-section'))return true;return[...m.addedNodes].some((n)=>n instanceof Element&&(n.matches?.('#digital-identity-section')||n.querySelector?.('#digital-identity-section')));} ))queueIdCardEmploymentSync();});observer.observe(document.documentElement,{childList:true,subtree:true});queueIdCardEmploymentSync();}
  window.AbsenProfileEmploymentEditor=Object.freeze({refresh:populate,syncIdCardJobTitle:syncIdCardEmploymentTitle,jobTitleSource:'Jabatan_Divisi'});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
