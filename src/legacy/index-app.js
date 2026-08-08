const APP_CONFIG=window.ABSEN_SUPABASE_CONFIG;
if(!APP_CONFIG?.projectUrl||!APP_CONFIG?.functionName)throw new Error('Konfigurasi Supabase tidak lengkap.');
let SUPABASE_URL='',SUPABASE_KEY='';
const CONFIG_ENDPOINT=`${APP_CONFIG.projectUrl.replace(/\/$/,'')}/functions/v1/${encodeURIComponent(APP_CONFIG.functionName)}`;
const LOGO_BGN_STORAGE_URL=`${APP_CONFIG.projectUrl.replace(/\/$/,'')}/storage/v1/object/public/Logo%20BGN/LOGO_BGN.webp`;
let BgnLogoPngPromise=null;
const $=(s)=>document.querySelector(s),$$=(s)=>document.querySelectorAll(s),AppState={token:null,user:null,currentView:'dashboard',pendingRegisterEmail:'',pendingResetEmail:'',pendingResetToken:'',profilePasswordEmail:'',profilePasswordResetToken:'',resendTimerRegister:null,resendTimerReset:null,resendTimerProfilePassword:null,presenceTimer:null,notifications:[]};
const escapeHtml=(value)=>String(value??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalizeRole=(value)=>String(value||'').trim().toUpperCase().replace(/_/g,' ');
const FACEAPI_CDN_URL='https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.js';
const FACEAPI_MODEL_URL='https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
const FaceApiState={scriptLoaded:false,modelsLoaded:false,loadingPromise:null};
function loadFaceApiLibrary(){
  if(FaceApiState.scriptLoaded && window.faceapi) return Promise.resolve();
  if(window.faceapi){FaceApiState.scriptLoaded=true;return Promise.resolve();}
  return new Promise((resolve,reject)=>{
    const existing=document.querySelector(`script[src="${FACEAPI_CDN_URL}"]`);
    if(existing){
      existing.addEventListener('load',()=>{FaceApiState.scriptLoaded=true;resolve();});
      existing.addEventListener('error',()=>reject(new Error('Gagal memuat pustaka face-api.')));
      return;
    }
    const s=document.createElement('script');
    s.src=FACEAPI_CDN_URL;
    s.async=true;
    s.onload=()=>{FaceApiState.scriptLoaded=true;resolve();};
    s.onerror=()=>reject(new Error('Gagal memuat pustaka face-api.'));
    document.head.appendChild(s);
  });
}
async function loadFaceApiModels(){
  if(FaceApiState.modelsLoaded) return;
  if(FaceApiState.loadingPromise) return FaceApiState.loadingPromise;
  FaceApiState.loadingPromise=(async()=>{
    await loadFaceApiLibrary();
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(FACEAPI_MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(FACEAPI_MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(FACEAPI_MODEL_URL),
      faceapi.nets.faceExpressionNet.loadFromUri(FACEAPI_MODEL_URL)
    ]);
    FaceApiState.modelsLoaded=true;
  })();
  try{
    await FaceApiState.loadingPromise;
  }catch(err){
    FaceApiState.loadingPromise=null;
    throw err;
  }
}

function formatTanggal(v){const d=parseDateValue(v);if(!d)return'-';return d.toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'});}
function formatRupiah(v){if(v===undefined||v===null||v==='')return'-';const n=Number(v);if(isNaN(n))return'-';return'Rp '+n.toLocaleString('id-ID');}
function setInfo(id,val,formatter){const el=document.getElementById(id);if(!el)return;const v=formatter?formatter(val):val;el.textContent=(v===undefined||v===null||v==='')?'-':v;el.classList.toggle('empty',!v||v==='-');}
function showApp(){
  $('#auth-layout').classList.add('hidden');
  $('#auth-layout').classList.remove('active');
  $('#app-layout').classList.add('active');
  renderProfilFromUser();
  if(isAdmin()){
    showAdminNav();
    switchView(isSuperAdminUser()?'super-dashboard':'admin-dashboard');
    loadComplaintNotification();
  } else {
    showUserNav();
    switchView('dashboard');
  }
  startPresenceHeartbeat();
}
function showAuth(){stopPresenceHeartbeat();$('#app-layout').classList.remove('active'),$('#auth-layout').classList.remove('hidden');}
function closeNavigationMenus(){
  $('#topbar-dropdown')?.classList.remove('active');
  $('#mobile-more-menu')?.classList.remove('active');
  $('#btn-topbar-profile')?.setAttribute('aria-expanded','false');
  $('#btn-mobile-more')?.setAttribute('aria-expanded','false');
}
function switchView(v){
  AppState.currentView=v;
  $$('.app-view').forEach(e=>e.classList.add('hidden'));
  const target=document.getElementById(`view-${v}`);
  if(!target){console.error('View tidak ditemukan:',v);return;}
  target.classList.remove('hidden');
  $$('.app-nav-item[data-view],.app-bottomnav-item[data-view],.sidebar-absen-btn[data-view],.app-topbar-dropdown-item[data-view],.mobile-more-menu-item[data-view]').forEach(e=>e.classList.toggle('active',e.dataset.view===v));
  const moreViews=['admin-absen','admin-pengaduan','admin-log','admin-config'];
  $('#btn-mobile-more')?.classList.toggle('active',moreViews.includes(v));
  closeNavigationMenus();
  if(!AppState.token)return;
  if(v==='admin-absen'){loadAdminAbsen();startAbsenRealtime();}else{stopAbsenRealtime();}
  if(v==='admin-users')loadAdminUsers();
  if(v==='admin-log')loadAdminLog();
  if(v==='admin-payroll')loadAdminPayroll();
  if(v==='admin-pengaduan')loadAdminComplaints();
  if(v==='admin-config')loadAdminConfiguration();
  if(v==='super-dashboard')loadSuperAdminOverview();
  if(v==='my-absensi')loadMyAbsensi();
  if(v==='my-payroll')loadMyPayroll();
  if(v==='my-activity')loadMyActivity();
  if(v==='pengaduan')loadMyComplaints();
  if(v==='dashboard'||v==='admin-dashboard')loadDashboardData();
  if(v==='absen-scan')openAbsenScan();
}
function renderProfilFromUser(){
  const u=AppState.user;if(!u)return;
  const nama=u.namaLengkap||u.Nama_Lengkap||u.nama||'';
  const role=u.role||u.Role||'USER';
  const idCard=u.idCardUnik||u.ID_Card_Unik||'';
  const fotoUrl=u.urlFotoProfil||u.URL_Foto_Profil||'';
  const hasFace=Boolean(u.Wajah_Terdaftar||u.wajahTerdaftar||u.faceDescriptor||u.Face_Descriptor_JSON);
  const statusAktif=u.statusAktif??u.Status_Aktif;
  const akunDibekukan=u.akunDibekukan??u.Akun_Dibekukan;
  const dashboardGreeting=$('#dashboard-greeting');if(dashboardGreeting)dashboardGreeting.textContent=`Selamat datang, ${nama.split(' ')[0]||'Pengguna'}!`;
  const avatarEl=$('#profil-avatar');
  if(avatarEl){if(fotoUrl){avatarEl.innerHTML=`<img src="${fotoUrl}" alt="Foto profil">`;}else{avatarEl.textContent=nama?nama.trim().charAt(0).toUpperCase():'?';}}
  $('#profil-nama').textContent=nama||'-';
  $('#profil-role').textContent=role;
  $('#profil-idcard').textContent=idCard?`ID Card: ${idCard}`:'-';
  setInfo('p-id-user',u.idUser||u.ID_User);
  setInfo('p-id-card',idCard);
  setInfo('p-nama',nama);
  setInfo('p-username',u.username||u.Username);
  setInfo('p-tempat-lahir',u.tempatLahir||u.Tempat_Lahir);
  setInfo('p-tanggal-lahir',u.tanggalLahir||u.Tanggal_Lahir,formatTanggal);
  setInfo('p-jk',u.jenisKelamin||u.Jenis_Kelamin);
  setInfo('p-email',u.email||u.Email);
  setInfo('p-wa',u.noWhatsapp||u.No_Whatsapp);
  setInfo('p-sppg',u.sppg||u.SPPG);
  setInfo('p-yayasan',u.yayasan||u.Yayasan);
  setInfo('p-jabatan',u.jabatanDivisi||u.Jabatan_Divisi);
  setInfo('p-mulai-kerja',u.tanggalMulaiKerja||u.Tanggal_Mulai_Kerja,formatTanggal);
  setInfo('p-gaji',u.gajiHarian||u.Gaji_Harian,formatRupiah);
  setInfo('p-bank',u.namaBank||u.Nama_Bank);
  setInfo('p-nomor-rekening',u.nomorRekening||u.Nomor_Rekening);
  setInfo('p-rekening',u.atasNamaRekening||u.Atas_Nama_Rekening);
  setInfo('p-role',role);
  setInfo('p-status-akun',akunDibekukan?'Dibekukan':statusAktif===false?'Tidak Aktif':'Aktif');
  setInfo('p-status-wajah',hasFace?'Sudah Terdaftar':'Belum Terdaftar');
  setInfo('p-id-card-digital',(u.ID_Card_Digital_Tersedia??u.idCardDigitalTersedia)?'Tersedia':'Belum Tersedia');
  setInfo('p-qr-code',(u.QR_Code_Tersedia??u.qrCodeTersedia)?'Tersedia':'Belum Tersedia');
  setInfo('p-persetujuan-data',(u.Setuju_Kebijakan_Data??u.setujuKebijakanData)?'Disetujui':'Belum Disetujui');
  setInfo('p-created-at',u.Created_At||u.createdAt,formatDateTime);
  setInfo('p-updated-at',u.Updated_At||u.updatedAt,formatDateTime);
  const tbAvatar=$('#topbar-avatar');
  if(tbAvatar){if(fotoUrl){tbAvatar.innerHTML=`<img src="${fotoUrl}" alt="Foto profil">`;}else{tbAvatar.textContent=nama?nama.trim().charAt(0).toUpperCase():'?';}}
  const tbName=$('#topbar-profile-name');if(tbName)tbName.textContent=nama||'-';
  const adminGreet=$('#admin-dashboard-greeting');if(adminGreet)adminGreet.textContent=`Selamat datang, ${String(role).toUpperCase()||'Admin'}!`;
  const tbRole=$('#topbar-profile-role');if(tbRole)tbRole.textContent=role;
  updateFaceStatusBadge();
}
async function loadProfilLengkap(){try{const r=await apiCall('getProfilLengkap',{token:AppState.token});if(r&&r.user){AppState.user=r.user;localStorage.setItem('auth_user',JSON.stringify(r.user));renderProfilFromUser();}}catch(e){console.error(e);}}

function renderBelumAbsenList(belumAbsen){
  const container=$('#dash-belum-absen-list');
  if(!container)return;
  if(!belumAbsen||belumAbsen.length===0){
    container.innerHTML='<div class="belum-absen-empty">Semua karyawan sudah absen 🎉</div>';
    return;
  }
  const shown=belumAbsen.slice(0,5);
  const sisa=belumAbsen.length-shown.length;
  container.innerHTML=shown.map(u=>{
    const inisial=(u.nama||'?').trim().charAt(0).toUpperCase();
    return `<div class="belum-absen-item">
      <div class="belum-absen-avatar">${inisial}</div>
      <div class="belum-absen-info">
        <div class="belum-absen-name">${u.nama||'-'}</div>
        <div class="belum-absen-detail">${u.jabatan||'-'} • ${u.sppg||'-'}</div>
      </div>
    </div>`;
  }).join('') + (sisa>0?`<div class="belum-absen-more">+${sisa} lainnya belum absen</div>`:'');
}

function renderRiwayatMini(riwayat){
  const container=$('#dash-riwayat-list');
  if(!container)return;
  if(!riwayat||riwayat.length===0){
    container.innerHTML='<div class="belum-absen-empty">Belum ada riwayat absensi</div>';
    return;
  }
  container.innerHTML=riwayat.map(r=>{
    const isDatang=r.jenis==='DATANG';
    const isPulang=r.jenis==='PULANG';
    const icon=isDatang
      ?'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>'
      :'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
    return `<div class="riwayat-mini-item">
      <div class="riwayat-mini-icon ${isDatang?'datang':isPulang?'pulang':'datang'}">${icon}</div>
      <div>
        <div class="riwayat-mini-jenis">${isDatang?'Datang':isPulang?'Pulang':r.jenis==='PUNCH_TUNGGAL'?'Punch tunggal valid':'Punch tambahan'}</div>
        <div class="riwayat-mini-tanggal">${formatTanggal(r.tanggal)}</div>
      </div>
      <div class="riwayat-mini-waktu">${(r.waktu||'-').substring(0,5)}</div>
    </div>`;
  }).join('');
}

function startPresenceHeartbeat(){
  stopPresenceHeartbeat();
  const send=()=>{if(!AppState.token)return;apiCall('presenceHeartbeat',{token:AppState.token,clientState:document.hidden?'HIDDEN':'ACTIVE'}).catch(error=>console.error('Heartbeat gagal',error));};
  send();
  // Tetap di bawah ambang online dua menit sambil mengurangi trafik heartbeat 50%.
  AppState.presenceTimer=setInterval(send,90000);
}
function stopPresenceHeartbeat(){if(AppState.presenceTimer){clearInterval(AppState.presenceTimer);AppState.presenceTimer=null;}}

function notificationMarkup(items,compact=false){
  if(!items.length)return `<div class="belum-absen-empty">${compact?'Tidak ada tindakan mendesak.':'Belum ada notifikasi.'}</div>`;
  return items.slice(0,compact?4:20).map(item=>`<button class="notification-item" type="button" data-notification-view="${escapeHtml(item.actionView||'dashboard')}"><strong>${escapeHtml(item.title||'Notifikasi')}</strong><span>${escapeHtml(item.message||'')}</span></button>`).join('');
}
async function loadUserNotifications(){
  if(!AppState.token)return;
  try{
    const result=await apiCall('getUserNotificationsV2',{token:AppState.token});
    AppState.notifications=result?.items||[];
  }catch(error){
    console.error('Notifikasi pengguna gagal dimuat',error);
    AppState.notifications=[];
  }
  const count=AppState.notifications.length,badge=$('#notification-count');
  if(badge){badge.textContent=count>99?'99+':String(count);badge.style.display=count?'inline-flex':'none';}
  const panelList=$('#notification-list');if(panelList)panelList.innerHTML=notificationMarkup(AppState.notifications);
  const dashboardList=$('#dashboard-notification-list');if(dashboardList)dashboardList.innerHTML=notificationMarkup(AppState.notifications,true);
  $('#dashboard-notification-card')?.classList.toggle('hidden',isAdmin());
}

function renderOperationalDashboard(result){
  const totals=result?.totals||{},exceptions=result?.exceptions||{};
  $('#ops-online-count').textContent=totals.online??0;
  $('#ops-not-arrived-count').textContent=totals.notArrived??0;
  $('#ops-not-departed-count').textContent=totals.notDeparted??0;
  $('#ops-profile-count').textContent=totals.incompleteProfiles??0;
  $('#ops-ticket-count').textContent=totals.openTickets??0;
  $('#ops-slip-count').textContent=totals.pendingRecipientSignatures??0;
  $('#dash-admin-total-karyawan').textContent=totals.employees??0;
  const attendance=[...(exceptions.belumDatang||[]).map(row=>({...row,_status:'Belum datang'})),...(exceptions.belumPulang||[]).map(row=>({...row,_status:'Belum pulang'}))].slice(0,8);
  const attendanceList=$('#ops-attendance-list');
  if(attendanceList)attendanceList.innerHTML=attendance.length?attendance.map(row=>`<div class="exception-item"><div><strong>${escapeHtml(row.nama||'-')}</strong><span>${escapeHtml(row.jabatan||'-')} · ${escapeHtml(row.sppg||'-')}</span></div><span class="badge badge-warning">${escapeHtml(row._status)}</span></div>`).join(''):'<div class="belum-absen-empty">Tidak ada pengecualian kehadiran.</div>';
  const profiles=exceptions.profilBelumLengkap||[],profileList=$('#ops-profile-list');
  if(profileList)profileList.innerHTML=profiles.length?profiles.map(row=>`<div class="exception-item"><div><strong>${escapeHtml(row.nama||'-')}</strong><span>${escapeHtml((row.missing||[]).slice(0,2).join(', '))}</span></div><span class="badge badge-warning">${Number(row.score)||0}%</span></div>`).join(''):'<div class="belum-absen-empty">Semua profil operasional sudah lengkap.</div>';
  renderBelumAbsenList(exceptions.belumDatang||[]);
}

async function loadDashboardData(){
  try{
    const r=await apiCall(isAdmin()?'getOperationalDashboardV2':'getDashboardData',{token:AppState.token});
    if(!r)return;
    if(isAdmin()){
      renderOperationalDashboard(r);
      $('#dash-admin-datang-hari-ini').textContent=Math.max(0,(r.totals?.employees||0)-(r.totals?.notArrived||0));
      $('#dash-admin-pulang-hari-ini').textContent=Math.max(0,(r.totals?.employees||0)-(r.totals?.notArrived||0)-(r.totals?.notDeparted||0));
      $('#dash-admin-payroll-bulan-ini').textContent=r.totals?.pendingRecipientSignatures??0;
      $('#dash-trend-chart').innerHTML='<div class="belum-absen-empty" style="width:100%">Dashboard kini memprioritaskan pengecualian operasional hari ini.</div>';
    }else{
      $('#dash-total-hari-kerja').textContent=r.totalHariKerja??0;
      $('#dash-total-gaji').textContent=formatRupiah(r.totalGajiDiterima??0);
      $('#dash-total-slip').textContent=r.totalSlip??0;
      const pillDatang=$('#dash-pill-datang'),pillPulang=$('#dash-pill-pulang');
      const statusDatang=$('#dash-status-datang'),statusPulang=$('#dash-status-pulang');
      if(r.sudahDatang){pillDatang.classList.add('done');statusDatang.textContent='Sudah Absen';}else{pillDatang.classList.remove('done');statusDatang.textContent='Belum Absen';}
      if(r.sudahPulang){pillPulang.classList.add('done');statusPulang.textContent='Sudah Absen';}else{pillPulang.classList.remove('done');statusPulang.textContent='Belum Absen';}
      renderRiwayatMini(r.riwayat||[]);
    }
    loadUserNotifications();
  }catch(e){
    console.error(e);
  }
}
async function handleLogout(){
  try{if(AppState.token)await apiCall('logout',{token:AppState.token});}
  catch(error){console.warn('Server session revoke failed during logout.',error);}
  finally{localStorage.removeItem('auth_token');localStorage.removeItem('auth_user');sessionStorage.clear();AppState.token=null;AppState.user=null;clearApiResponseCache();showAuth();navigateTo('login');}
}
function navigateTo(p){$$('.auth-page').forEach(e=>e.classList.add('hidden'));const t=$(`#page-${p}`);if(t)t.classList.remove('hidden');history.pushState({p},'',`#${p}`);}
function showAlert(m,t='info'){const i={success:'✓',error:'✕',warning:'⚠',info:'ℹ'},a=document.createElement('div');a.className=`alert ${t}`,a.innerHTML=`<span>${i[t]||i.info}</span><div style="flex:1">${m}</div><button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer">✕</button>`,$('#alert-box').appendChild(a),setTimeout(()=>{a.style.opacity='0';setTimeout(()=>a.remove(),300)},5000);}

let RiskConfirmation=null;
function closeRiskConfirmation(value=null){
  const modal=$('#modal-risk-confirm');
  modal?.classList.remove('active');
  if(RiskConfirmation?.resolve)RiskConfirmation.resolve(value);
  RiskConfirmation=null;
}
function confirmRiskAction({title='Konfirmasi tindakan',impact='Tindakan ini akan mengubah data sistem.'}={}){
  if(RiskConfirmation)closeRiskConfirmation(null);
  $('#risk-title').textContent=title;
  $('#risk-impact').textContent=impact;
  $('#risk-reason').value='';
  $('#risk-confirm-text').value='';
  $('#risk-alert').className='inline-alert';
  $('#risk-alert').textContent='';
  $('#risk-stage-impact').classList.add('active');
  $('#risk-stage-reason').classList.remove('active');
  $('#btn-risk-next').hidden=false;
  $('#btn-risk-confirm').hidden=true;
  $('#modal-risk-confirm').classList.add('active');
  return new Promise(resolve=>{RiskConfirmation={resolve};});
}
function advanceRiskConfirmation(){
  $('#risk-stage-impact').classList.remove('active');
  $('#risk-stage-reason').classList.add('active');
  $('#btn-risk-next').hidden=true;
  $('#btn-risk-confirm').hidden=false;
  $('#risk-reason').focus();
}
function finishRiskConfirmation(){
  const reason=$('#risk-reason').value.trim(),confirmation=$('#risk-confirm-text').value.trim().toUpperCase();
  const alert=$('#risk-alert');
  if(reason.length<10||confirmation!=='KONFIRMASI'){
    alert.className='inline-alert show error';
    alert.textContent=reason.length<10?'Alasan harus berisi minimal 10 karakter.':'Ketik KONFIRMASI dengan tepat.';
    return;
  }
  closeRiskConfirmation({reason});
}
function enhanceAccessibility(){
  $$('button:not([type])').forEach(button=>button.type='button');
  const focusable='button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  $$('.modal-overlay').forEach(modal=>{
    modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('tabindex','-1');
    const title=modal.querySelector('.modal-header h3');if(title){if(!title.id)title.id=`${modal.id}-title`;modal.setAttribute('aria-labelledby',title.id);}
    let previousFocus=null;
    new MutationObserver(()=>{
      if(modal.classList.contains('active')){previousFocus=document.activeElement;setTimeout(()=>modal.querySelector(focusable)?.focus(),0);}
      else if(previousFocus?.focus){previousFocus.focus();previousFocus=null;}
    }).observe(modal,{attributes:true,attributeFilter:['class']});
  });
  document.addEventListener('keydown',event=>{
    const modal=$('.modal-overlay.active');if(!modal)return;
    if(event.key==='Tab'){
      const items=[...modal.querySelectorAll(focusable)].filter(el=>el.offsetParent!==null);
      if(!items.length){event.preventDefault();modal.focus();return;}
      const first=items[0],last=items[items.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
    if(event.key==='Escape'){
      event.preventDefault();
      if(modal.id==='modal-risk-confirm')closeRiskConfirmation(null);
      else (modal.querySelector('.modal-close,.btn-secondary')||modal).click();
    }
  });
}
function showInlineAlert(id,msg,type='error'){const el=document.getElementById(id);if(!el)return;el.textContent=msg;el.className='inline-alert show'+(type==='warning'?' warning':'');}
function hideInlineAlert(id){const el=document.getElementById(id);if(!el)return;el.className='inline-alert';el.textContent='';}
async function loadPublicConfig(){const r=await fetch(CONFIG_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({function:'getPublicConfig',data:{}})});const d=await r.json();if(!d.success||!d.result?.url)throw new Error('Gagal memuat konfigurasi server');SUPABASE_URL=d.result.url;SUPABASE_KEY=d.result.anonKey;}
const API_CACHE_TTL=new Map([
  ['getOperationalDashboardV2',20_000],['getOperationalUsersV2',30_000],
  ['getSuperAdminOverviewV3',60_000],['getSuperAdminAuditV3',30_000],
  ['getUserNotificationsV2',30_000],['getMyPayroll',30_000],
  ['getAdminConfiguration',120_000],
]);
const ApiResponseCache=new Map(),ApiInFlight=new Map();
function clearApiResponseCache(){ApiResponseCache.clear();ApiInFlight.clear();}
async function apiCall(f,p={},options={}){
  const ttl=API_CACHE_TTL.get(f)||0,payload={...p};delete payload.token;
  const key=`${AppState.user?.idUser||AppState.user?.ID_User||'anon'}:${f}:${JSON.stringify(payload)}`;
  const cached=ApiResponseCache.get(key);
  if(ttl&&!options.force&&cached&&cached.expiresAt>Date.now())return cached.value;
  if(ttl&&!options.force&&ApiInFlight.has(key))return ApiInFlight.get(key);
  const request=(async()=>{try{
    const r=await fetch(CONFIG_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY},body:JSON.stringify({function:f,data:p})});
    const d=await r.json();if(!d.success)throw new Error(d.error||'Terjadi kesalahan pada server');
    // Cache hanya endpoint baca ber-TTL pendek; request identik bersamaan dideduplikasi.
    if(ttl)ApiResponseCache.set(key,{value:d.result,expiresAt:Date.now()+ttl});else clearApiResponseCache();
    return d.result;
  }catch(e){console.error(e);throw e;}finally{ApiInFlight.delete(key);}})();
  if(ttl)ApiInFlight.set(key,request);
  return request;
}

/* ===== OTP INPUT HELPERS ===== */
function setupOtpRow(rowId){const row=document.getElementById(rowId);if(!row)return;const inputs=[...row.querySelectorAll('input')];inputs.forEach((inp,idx)=>{inp.addEventListener('input',()=>{inp.value=inp.value.replace(/[^0-9]/g,'').slice(0,1);if(inp.value&&idx<inputs.length-1)inputs[idx+1].focus();});inp.addEventListener('keydown',ev=>{if(ev.key==='Backspace'&&!inp.value&&idx>0)inputs[idx-1].focus();});inp.addEventListener('paste',ev=>{ev.preventDefault();const txt=(ev.clipboardData||window.clipboardData).getData('text').replace(/[^0-9]/g,'').slice(0,inputs.length);txt.split('').forEach((ch,i)=>{if(inputs[i])inputs[i].value=ch;});const last=Math.min(txt.length,inputs.length)-1;if(last>=0)inputs[last].focus();});});}
function getOtpValue(rowId){const row=document.getElementById(rowId);if(!row)return'';return[...row.querySelectorAll('input')].map(i=>i.value).join('');}
function clearOtpRow(rowId){const row=document.getElementById(rowId);if(!row)return;row.querySelectorAll('input').forEach(i=>i.value='');const first=row.querySelector('input');if(first)first.focus();}

/* ===== RESEND COUNTDOWN (registrasi & reset) ===== */
function startResendCountdown(seconds,linkId,countdownId,timerKey){const link=document.getElementById(linkId),cd=document.getElementById(countdownId);if(!link||!cd)return;if(AppState[timerKey])clearInterval(AppState[timerKey]);let remaining=seconds;link.classList.add('disabled');function tick(){if(remaining<=0){clearInterval(AppState[timerKey]);AppState[timerKey]=null;link.classList.remove('disabled');cd.textContent='';return;}const m=Math.floor(remaining/60),s=remaining%60;cd.textContent=` (${m}:${String(s).padStart(2,'0')})`;remaining--;}
tick();AppState[timerKey]=setInterval(tick,1000);}

function parseApiError(error,fallback='Terjadi kesalahan'){
  const raw=String(error&&error.message?error.message:fallback||'Terjadi kesalahan');
  const parts=raw.split('::');
  return {code:parts.length>1?parts[0]:'',message:parts.length>1?parts.slice(1).join('::'):raw};
}

async function withBusyButton(button,loadingHtml,task){
  if(!button)return task();
  const original=button.innerHTML;
  button.disabled=true;
  button.innerHTML=loadingHtml;
  try{return await task();}
  finally{button.disabled=false;button.innerHTML=original;}
}

function bindEvents(ids,eventName,handler){
  ids.forEach(id=>document.getElementById(id)?.addEventListener(eventName,handler));
}
function bindClicks(ids,handler){bindEvents(ids,'click',handler);}
function bindAccessibleActivation(element,handler){
  if(!element)return;
  element.addEventListener('click',handler);
  element.addEventListener('keydown',event=>{
    if(event.key!=='Enter'&&event.key!==' ')return;
    event.preventDefault();handler(event);
  });
}
function dismissModal(modalId){document.getElementById(modalId)?.classList.remove('active');}
function bindPaginationControls({prevId,nextId,canPrev,canNext,onPrev,onNext}){
  document.getElementById(prevId)?.addEventListener('click',()=>{if(canPrev())onPrev();});
  document.getElementById(nextId)?.addEventListener('click',()=>{if(canNext())onNext();});
}
function skeletonCardsMarkup(count=1){
  const card='<div class="skel-card"><div class="skel skel-avatar"></div><div class="skel skel-line"></div><div class="skel skel-line short"></div></div>';
  return Array(count).fill(card).join('');
}
function skeletonRowsMarkup(count=1){
  const row='<div class="skel-row"><div class="skel skel-avatar"></div><div class="skel skel-line"></div><div class="skel skel-line short"></div></div>';
  return Array(count).fill(row).join('');
}
function tableMessageMarkup(message,style=''){
  const styleAttr=style?` style="${style}"`:'';
  return `<div class="table-empty"${styleAttr}>${escapeHtml(message)}</div>`;
}
function parseDateValue(value){
  if(!value)return null;
  const date=new Date(value);
  return Number.isNaN(date.getTime())?null:date;
}
function userField(user,...keys){
  for(const key of keys){const value=user?.[key];if(value!==undefined&&value!==null)return value;}
  return '';
}
function dateInputValue(value){return value?String(value).split('T')[0]:'';}
function normalizeUserEditorData(user){
  return {
    idUser:userField(user,'ID_User','idUser'),
    nama:userField(user,'Nama_Lengkap','nama_lengkap','namaLengkap'),
    username:userField(user,'Username','username'),
    email:userField(user,'Email','email'),
    wa:userField(user,'No_Whatsapp','no_whatsapp','noWhatsapp'),
    tempatLahir:userField(user,'Tempat_Lahir','tempat_lahir','tempatLahir'),
    tanggalLahir:dateInputValue(userField(user,'Tanggal_Lahir','tanggal_lahir','tanggalLahir')),
    jenisKelamin:userField(user,'Jenis_Kelamin','jenis_kelamin','jenisKelamin'),
    sppg:userField(user,'SPPG','sppg'),
    jabatan:userField(user,'Jabatan_Divisi','jabatan_divisi','jabatanDivisi'),
    mulaiKerja:dateInputValue(userField(user,'Tanggal_Mulai_Kerja','tanggal_mulai_kerja','tanggalMulaiKerja')),
    gaji:userField(user,'Gaji_Harian','gaji_harian','gajiHarian'),
    bank:userField(user,'Nama_Bank','nama_bank','namaBank'),
    nomorRekening:userField(user,'Nomor_Rekening','nomor_rekening','nomorRekening'),
    atasNamaRekening:userField(user,'Atas_Nama_Rekening','atas_nama_rekening','atasNamaRekening'),
    foto:userField(user,'URL_Foto_Profil','urlFotoProfil')
  };
}
function populateInputs(values){
  Object.entries(values).forEach(([selector,value])=>{const input=$(selector);if(input)input.value=value??'';});
}

async function verifyOtpFlow({alertId,rowId,buttonId,apiFunction,payload,onSuccess,errorFallback='Kode OTP salah'}){
  hideInlineAlert(alertId);
  const kode=getOtpValue(rowId);
  if(kode.length!==6){showInlineAlert(alertId,'Masukkan 6 digit kode verifikasi','warning');return false;}
  const button=$(buttonId);
  return withBusyButton(button,'<div class="spinner" style="width:20px;height:20px;border-width:2px"></div> Memverifikasi...',async()=>{
    try{
      const result=await apiCall(apiFunction,payload(kode));
      if(result&&result.success){await onSuccess(result);return true;}
      showInlineAlert(alertId,result?.message||'Verifikasi gagal');
    }catch(error){
      showInlineAlert(alertId,parseApiError(error,errorFallback).message);
      clearOtpRow(rowId);
    }
    return false;
  });
}

async function resendOtpFlow({buttonId,alertId,email,apiFunction,rowId,countdownId,timerKey}){
  const button=$(buttonId);if(button?.classList.contains('disabled'))return false;
  hideInlineAlert(alertId);
  try{
    const result=await apiCall(apiFunction,{email});
    if(result&&result.success){
      showAlert(result.message||'Kode berhasil dikirim ulang','success');
      startResendCountdown(result.cooldownDetik||120,buttonId.slice(1),countdownId.slice(1),timerKey);
      clearOtpRow(rowId);
      return true;
    }
  }catch(error){
    const parsed=parseApiError(error,'Gagal mengirim ulang kode');
    showInlineAlert(alertId,parsed.message,'warning');
  }
  return false;
}

/* ===== LOGIN ===== */
async function handleLogin(){
  hideInlineAlert('login-alert');
  $('#btn-goto-forgot').classList.remove('show');
  const e=$('#login-email').value.trim(),p=$('#login-password').value;
  if(!e||!p){showInlineAlert('login-alert','Mohon isi email dan password','warning');return;}
  const button=$('#btn-login');
  await withBusyButton(button,'<div class="spinner" style="width:20px;height:20px;border-width:2px"></div> Memproses...',async()=>{
    try{
      const r=await apiCall('login',{email:e,username:e,password:p});
      if(r&&r.token){
        AppState.token=r.token;AppState.user=r;
        localStorage.setItem('auth_token',r.token);localStorage.setItem('auth_user',JSON.stringify(r));
        showAlert('Login berhasil!','success');showApp();loadProfilLengkap();
        return;
      }
      showInlineAlert('login-alert',r?.message||'Login gagal');
    }catch(error){
      const parsed=parseApiError(error);
      showInlineAlert('login-alert',parsed.message,['AKUN_DIBEKUKAN','EMAIL_BELUM_VERIFIKASI'].includes(parsed.code)?'warning':'error');
      if(parsed.code==='PASSWORD_SALAH_TAMPIL_RESET'){
        $('#btn-goto-forgot').classList.add('show');$('#forgot-email').value=e;
      }
    }
  });
}

/* ===== REGISTRASI ===== */
async function handleRegister(){
  const n=$('#reg-nama').value.trim(),u=$('#reg-username').value.trim(),e=$('#reg-email').value.trim(),ce=$('#reg-confirm-email').value.trim(),p=$('#reg-password').value,cp=$('#reg-confirm-password').value,s=$('#reg-setuju').checked;
  if(!n||!u||!e||!p){showAlert('Semua field wajib diisi','warning');return;}
  if(e!==ce){showAlert('Email konfirmasi tidak cocok','error');return;}
  if(p!==cp){showAlert('Password konfirmasi tidak cocok','error');return;}
  if(p.length<6){showAlert('Password minimal 6 karakter','warning');return;}
  if(!s){showAlert('Anda harus menyetujui kebijakan','warning');return;}
  await withBusyButton($('#btn-register'),'<div class="spinner" style="width:20px;height:20px;border-width:2px"></div> Mendaftar...',async()=>{
    try{
      const r=await apiCall('registerUser',{namaLengkap:n,username:u,email:e,password:p,role:'user'});
      if(r&&r.success){
        AppState.pendingRegisterEmail=e;$('#verify-register-email').textContent=e;
        showAlert('Registrasi berhasil! Silakan cek email untuk kode verifikasi.','success');
        navigateTo('verify-register');startResendCountdown(120,'btn-resend-register','resend-register-countdown','resendTimerRegister');
      }else showAlert(r?.message||'Registrasi gagal','error');
    }catch(error){showAlert(parseApiError(error).message,'error');}
  });
}

async function handleVerifyRegister(){
  return verifyOtpFlow({
    alertId:'verify-register-alert',rowId:'verify-register-otp-row',buttonId:'#btn-verify-register',
    apiFunction:'verifyRegistrationOtp',payload:kode=>({email:AppState.pendingRegisterEmail,kodeOtp:kode}),
    onSuccess:()=>{showAlert('Email berhasil diverifikasi! Silakan login.','success');if(AppState.resendTimerRegister)clearInterval(AppState.resendTimerRegister);navigateTo('login');}
  });
}

async function handleResendRegister(){
  return resendOtpFlow({buttonId:'#btn-resend-register',alertId:'verify-register-alert',email:AppState.pendingRegisterEmail,apiFunction:'resendConfirmationEmail',rowId:'verify-register-otp-row',countdownId:'#resend-register-countdown',timerKey:'resendTimerRegister'});
}

/* ===== LUPA PASSWORD (FORGOT -> VERIFY -> NEW PASSWORD) ===== */
async function handleForgotPassword(){
  hideInlineAlert('forgot-password-alert');
  const email=$('#forgot-email').value.trim();
  if(!email){showInlineAlert('forgot-password-alert','Mohon isi email','warning');return;}
  await withBusyButton($('#btn-forgot-password'),'<div class="spinner" style="width:20px;height:20px;border-width:2px"></div> Mengirim...',async()=>{
    try{
      const r=await apiCall('requestResetPasswordByEmail',{email});
      if(r&&r.success){
        AppState.pendingResetEmail=email;$('#verify-reset-email').textContent=email;
        showAlert('Kode reset password telah dikirim ke email Anda.','success');navigateTo('verify-reset');
        startResendCountdown(r.cooldownDetik||120,'btn-resend-reset','resend-reset-countdown','resendTimerReset');
      }else showInlineAlert('forgot-password-alert',r?.message||'Gagal mengirim kode reset');
    }catch(error){const parsed=parseApiError(error);showInlineAlert('forgot-password-alert',parsed.message,parsed.code==='TUNGGU'?'warning':'error');}
  });
}

async function handleVerifyReset(){
  return verifyOtpFlow({
    alertId:'verify-reset-alert',rowId:'verify-reset-otp-row',buttonId:'#btn-verify-reset',
    apiFunction:'verifyResetPasswordOtp',payload:kode=>({email:AppState.pendingResetEmail,kodeOtp:kode}),
    onSuccess:r=>{AppState.pendingResetToken=r.resetToken;if(AppState.resendTimerReset)clearInterval(AppState.resendTimerReset);navigateTo('new-password');}
  });
}

async function handleResendReset(){
  return resendOtpFlow({buttonId:'#btn-resend-reset',alertId:'verify-reset-alert',email:AppState.pendingResetEmail,apiFunction:'requestResetPasswordByEmail',rowId:'verify-reset-otp-row',countdownId:'#resend-reset-countdown',timerKey:'resendTimerReset'});
}

async function handleUpdatePassword(){
  hideInlineAlert('new-password-alert');
  const p=$('#new-password').value,cp=$('#new-password-confirm').value;
  if(!p||!cp){showInlineAlert('new-password-alert','Mohon isi password baru dan konfirmasi','warning');return;}
  if(p!==cp){showInlineAlert('new-password-alert','Konfirmasi password tidak cocok');return;}
  if(p.length<6){showInlineAlert('new-password-alert','Password minimal 6 karakter','warning');return;}
  await withBusyButton($('#btn-update-password'),'<div class="spinner" style="width:20px;height:20px;border-width:2px"></div> Memperbarui...',async()=>{
    try{
      const r=await apiCall('resetPassword',{email:AppState.pendingResetEmail,token:AppState.pendingResetToken,newPassword:p});
      if(r&&r.success){
        showAlert('Password berhasil diubah! Silakan login.','success');$('#new-password').value='';$('#new-password-confirm').value='';
        AppState.pendingResetEmail='';AppState.pendingResetToken='';navigateTo('login');
      }else showInlineAlert('new-password-alert',r?.message||'Gagal update password');
    }catch(error){showInlineAlert('new-password-alert',parseApiError(error).message);}
  });
}

/* ===================================================================
   ADMIN MODULE
   =================================================================== */
const AdminState = {
  allAbsen: [],
  filteredAbsen: [],
  absenPage: 1,
  absenPageSize: 20,
  absenTotal: 0,
  attendanceValidationTab: 'ALL',
  attendanceSelected: new Map(),
  allUsers: [],
  filteredUsers: [],
  userPage: 1,
  userPageSize: 25,
  userTotal: 0,
  userFilterOptions: {},
  userViewMode: 'cards',
  selectedUser: null,
  allLogs: [],
  filteredLogs: [],
  logPage: 1,
  logPageSize: 25,
  realtimeChannel: null,
};

function isAdmin(){
  const u = AppState.user;
  if(!u) return false;
  const r = normalizeRole(u.role||u.Role);
  return r === 'ADMIN' || r === 'SUPER ADMIN';
}

function isSuperAdminUser(){
  const u=AppState.user;
  return !!u && normalizeRole(u.role||u.Role)==='SUPER ADMIN';
}

function setNavVisibility(selector,visible){
  document.querySelectorAll(selector).forEach(el=>el.classList.toggle('nav-role-hidden',!visible));
}
function setBottomNavRole(role){
  const nav=document.querySelector('.app-bottomnav');
  if(nav)nav.dataset.navRole=role;
}
function showAdminNav(){
  setNavVisibility('.admin-only-nav',true);
  setNavVisibility('.user-only-nav',false);
  setNavVisibility('.super-admin-only-nav',isSuperAdminUser());
  setNavVisibility('.non-super-admin-only-nav',!isSuperAdminUser());
  setBottomNavRole('admin');
  closeNavigationMenus();
}

function showUserNav(){
  setNavVisibility('.admin-only-nav',false);
  setNavVisibility('.super-admin-only-nav',false);
  setNavVisibility('.user-only-nav',true);
  setBottomNavRole('user');
  closeNavigationMenus();
}

/* ---- Realtime Supabase channel untuk Data Absen ---- */
function startAbsenRealtime(){
  if(AdminState.realtimeChannel) return; // sudah berjalan
  const sbUrl = SUPABASE_URL;
  const sbKey = SUPABASE_KEY;
  // Supabase Realtime via REST WebSocket
  const wsUrl = sbUrl.replace('https://','wss://') + '/realtime/v1/websocket?apikey=' + sbKey + '&vsn=1.0.0';
  try {
    const ws = new WebSocket(wsUrl);
    AdminState.realtimeChannel = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({topic:'realtime:public:Absensi',event:'phx_join',payload:{config:{postgres_changes:[{event:'*',schema:'public',table:'Absensi'}]}},ref:'1'}));
    };
    let refreshTimer=null;
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if(msg.event === 'postgres_changes' || (msg.payload && msg.payload.data)) {
          // Satukan burst event Realtime menjadi satu fetch halaman aktif.
          clearTimeout(refreshTimer);
          refreshTimer=setTimeout(()=>loadAdminAbsen(),750);
        }
      } catch {}
    };
    ws.onerror = () => { AdminState.realtimeChannel = null; };
    ws.onclose = () => { AdminState.realtimeChannel = null; };
  } catch { AdminState.realtimeChannel = null; }
}

function stopAbsenRealtime(){
  if(AdminState.realtimeChannel){
    try { AdminState.realtimeChannel.close(); } catch {}
    AdminState.realtimeChannel = null;
  }
}

/* ---- Load Data Absen ---- */
async function loadAdminAbsen(){
  const tbody = $('#absen-table-body');
  if(!tbody) return;
  const startDate=$('#absen-filter-start')?.value||'',endDate=$('#absen-filter-end')?.value||'';
  if(startDate&&endDate&&endDate<startDate){
    showAlert('Tanggal akhir filter tidak boleh sebelum tanggal mulai.','warning');
    return;
  }
  tbody.innerHTML='<tr><td colspan="8"><div class="loading-state"><span class="spinner"></span>Memuat data absensi...</div></td></tr>';
  try {
    const r = await apiCall('getAbsensiGroupedDataV2', {
      token:AppState.token,
      page:AdminState.absenPage,
      pageSize:AdminState.absenPageSize,
      search:$('#absen-search')?.value.trim()||'',
      startDate:startDate||undefined,
      endDate:endDate||undefined,
      sppg:$('#absen-filter-sppg')?.value||undefined,
      status:$('#absen-filter-status')?.value||undefined,
      source:$('#absen-filter-source')?.value||undefined,
    });
    AdminState.allAbsen = r?.absensi || [];
    AdminState.filteredAbsen = filterAttendanceValidationRows(AdminState.allAbsen);
    AdminState.absenTotal = Number(r?.total)||0;
    updateAttendanceFilterOptions(r?.filterOptions);
    renderAttendanceFilterSummary();
    renderAbsenTable();
  } catch(e) {
    if(tbody) tbody.innerHTML = `<tr><td colspan="8" class="table-empty"><svg class="table-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><div class="table-empty-title">Gagal memuat data</div><div class="table-empty-sub">${escapeHtml(e.message)}</div></td></tr>`;
  }
}

function filterAttendanceValidationRows(rows){
  const tab=AdminState.attendanceValidationTab;
  return rows.filter(row=>{
    const punches=row.punches||[],statuses=punches.map(p=>String(p.status||p.Status_Validasi||'').toUpperCase()),notes=punches.map(p=>String(p.catatan||p.Catatan_Validasi||'').toUpperCase());
    const complete=Boolean(row.jamMasuk&&row.jamPulang),single=punches.length===1||punches.some(p=>p.jenis==='PUNCH_TUNGGAL');
    if(tab==='INCOMPLETE')return !complete;
    if(tab==='SINGLE')return single;
    if(tab==='INVALID')return statuses.includes('DITOLAK')||statuses.includes('TIDAK VALID');
    if(tab==='CORRECTION')return statuses.includes('PERLU_KOREKSI');
    if(tab==='LATE')return notes.some(note=>note.includes('TERLAMBAT'));
    return true;
  });
}

function updateAttendanceFilterOptions(options){
  const select=$('#absen-filter-sppg');if(!select)return;
  const current=select.value;
  const rows=Array.isArray(options?.sppg)?options.sppg:[];
  select.innerHTML='<option value="">Semua SPPG</option>'+rows.map(value=>`<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
  if(rows.includes(current))select.value=current;
}

function renderAttendanceFilterSummary(){
  const summary=$('#absen-active-filter-summary');if(!summary)return;
  const labels=[];
  const search=$('#absen-search')?.value.trim();if(search)labels.push(`Pencarian: “${search}”`);
  const start=$('#absen-filter-start')?.value,end=$('#absen-filter-end')?.value;
  if(start||end)labels.push(`Tanggal: ${start?formatTanggal(start):'awal'} – ${end?formatTanggal(end):'sekarang'}`);
  const sppg=$('#absen-filter-sppg')?.value;if(sppg)labels.push(`SPPG: ${sppg}`);
  const status=$('#absen-filter-status')?.selectedOptions?.[0]?.text;if($('#absen-filter-status')?.value)labels.push(`Status: ${status}`);
  const source=$('#absen-filter-source')?.selectedOptions?.[0]?.text;if($('#absen-filter-source')?.value)labels.push(`Sumber: ${source}`);
  summary.textContent=labels.length?`${AdminState.absenTotal} data ditemukan · ${labels.join(' · ')}`:'';
  summary.classList.toggle('show',labels.length>0);
}

function filterAndRenderAbsen(){
  AdminState.absenPage = 1;
  loadAdminAbsen();
}

function resetAttendanceFilters(){
  ['absen-search','absen-filter-start','absen-filter-end','absen-filter-sppg','absen-filter-status','absen-filter-source'].forEach(id=>{
    const input=document.getElementById(id);if(input)input.value='';
  });
  filterAndRenderAbsen();
}

function renderAbsenTable(){
  const tbody = $('#absen-table-body');
  const pg = $('#absen-pagination');
  if(!tbody) return;
  const total = AdminState.absenTotal;
  const ps = AdminState.absenPageSize;
  const page = AdminState.absenPage;
  const totalPages = Math.max(1, Math.ceil(total / ps));
  const start = (page-1)*ps;
  const rows = AdminState.filteredAbsen;

  if(rows.length === 0){
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty"><svg class="table-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><div class="table-empty-title">Tidak ada antrean</div><div class="table-empty-sub">Tidak ada data pada kategori validasi ini.</div></td></tr>`;
    if(pg) pg.style.display = 'none';
    return;
  }

  tbody.innerHTML = rows.map(row => {
    const nama = row.namaLengkap||'-';
    const sppg = row.sppg||'-';
    const tgl = row.Tanggal ? formatTanggal(row.Tanggal) : '-';
    const masuk = row.jamMasuk||'-';
    const keluar = row.jamPulang||'-';
    const lengkap = row.jamMasuk && row.jamPulang;
    const punchTunggal = row.punches.length===1 || row.punches.some(p=>p.jenis==='PUNCH_TUNGGAL');
    const statusText = lengkap ? 'Lengkap' : (punchTunggal ? 'Punch tunggal valid' : (row.jamMasuk ? 'Belum Pulang' : 'Belum Datang'));
    const statusBadge = lengkap ? 'badge-success' : (punchTunggal || row.jamMasuk ? 'badge-warning' : 'badge-danger');
    const keterangan = `${row.punches.length} punch · ${row.sumber.join(', ')}`;
    const idUser=String(row.ID_User||row.idUser||''),key=`${idUser}|${row.Tanggal}`,selected=AdminState.attendanceSelected.has(key);
    return `<tr>
      <td><input class="attendance-row-check" type="checkbox" data-key="${escapeHtml(key)}" data-user="${escapeHtml(idUser)}" data-date="${escapeHtml(row.Tanggal||'')}" aria-label="Pilih absensi ${escapeHtml(nama)} ${escapeHtml(tgl)}" ${selected?'checked':''}></td>
      <td data-primary="true"><div style="font-weight:700">${escapeHtml(nama)}</div><div class="payroll-employee-meta">${escapeHtml(sppg)}</div></td>
      <td data-label="SPPG">${escapeHtml(sppg)}</td>
      <td data-label="Tanggal">${escapeHtml(tgl)}</td>
      <td data-label="Masuk">${escapeHtml(masuk)}</td>
      <td data-label="Keluar">${escapeHtml(keluar)}</td>
      <td data-label="Status"><span class="badge ${statusBadge}">${statusText}</span></td>
      <td data-label="Keterangan" style="color:var(--text-secondary)">${escapeHtml(keterangan)}</td>
    </tr>`;
  }).join('');
  updateAttendanceSelectionBar();

  if(pg){
    pg.hidden = false;
    $('#absen-pagination-info').textContent = `${start+1}–${Math.min(start+ps,total)} dari ${total} data`;
    $('#absen-prev-btn').disabled = page <= 1;
    $('#absen-next-btn').disabled = page >= totalPages;
  }
}

function updateAttendanceSelectionBar(){
  const count=AdminState.attendanceSelected.size;
  $('#attendance-selected-count').textContent=count;
  $('#attendance-selection-bar')?.classList.toggle('show',count>0);
  const all=$('#absen-select-all'),checks=[...$$('.attendance-row-check')];
  if(all){all.checked=checks.length>0&&checks.every(item=>item.checked);all.indeterminate=checks.some(item=>item.checked)&&!all.checked;}
}

async function validateSelectedAttendance(action){
  const items=[...AdminState.attendanceSelected.values()];if(!items.length)return;
  const result=await confirmRiskAction({title:'Validasi absensi massal',impact:`${items.length} data absensi akan diubah menjadi ${action.replaceAll('_',' ')}. Perubahan dicatat pada Audit Log.`});
  if(!result)return;
  try{
    await apiCall('validateAttendanceBulkV3',{token:AppState.token,action,items,reason:result.reason});
    AdminState.attendanceSelected.clear();
    showAlert('Validasi absensi berhasil disimpan.','success');
    await loadAdminAbsen();
  }catch(error){showAlert(error.message||'Validasi absensi gagal.','error');}
}

/* ---- Load Data Users ---- */
async function loadAdminUsers(){
  const container = $('#users-grid-container');
  if(!container) return;
  container.innerHTML = skeletonCardsMarkup(8);
  try {
    const r = await apiCall('getOperationalUsersV2', {
      token:AppState.token,page:AdminState.userPage,pageSize:AdminState.userPageSize,
      search:$('#users-search')?.value.trim()||'',
      role:$('#users-role-filter')?.value||'',sppg:$('#users-sppg-filter')?.value||'',
      division:$('#users-division-filter')?.value||'',account:$('#users-account-filter')?.value||'',
    });
    AdminState.allUsers = Array.isArray(r) ? r : (r?.users || []);
    AdminState.userTotal=Number(r?.total)||AdminState.allUsers.length;
    AdminState.userFilterOptions=r?.filterOptions||AdminState.userFilterOptions||{};
    populateUserFilterOptions(AdminState.userFilterOptions);
    filterAndRenderUsers();
  } catch(e) {
    container.innerHTML = tableMessageMarkup(`Gagal memuat data: ${e.message}`,'grid-column:1/-1');
  }
}

function populateUserFilterOptions(options={}){
  const fill=(id,values,label)=>{
    const select=$(id),current=select?.value||'';if(!select)return;
    select.innerHTML=`<option value="">Semua ${label}</option>`+[...new Set(values.filter(Boolean).map(String))].sort().map(value=>`<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
    if([...select.options].some(option=>option.value===current))select.value=current;
  };
  fill('#users-role-filter',options.roles||AdminState.allUsers.map(user=>normalizeRole(user.Role||user.role)),'role');
  fill('#users-sppg-filter',options.sppg||AdminState.allUsers.map(user=>user.SPPG||user.sppg),'SPPG');
  fill('#users-division-filter',options.divisions||AdminState.allUsers.map(user=>user.Jabatan_Divisi||user.jabatan_divisi),'divisi');
}

function filterAndRenderUsers(){
  const q = ($('#users-search')?.value||'').toLowerCase();
  const operational=$('#users-operational-filter')?.value||'';
  const role=$('#users-role-filter')?.value||'',sppgFilter=$('#users-sppg-filter')?.value||'',division=$('#users-division-filter')?.value||'',account=$('#users-account-filter')?.value||'';
  AdminState.filteredUsers = AdminState.allUsers.filter(u => {
    if(operational==='ONLINE'&&!u._online)return false;
    if(operational==='INCOMPLETE'&&Number(u._profileScore)>=100)return false;
    if(role&&normalizeRole(u.Role||u.role)!==role)return false;
    if(sppgFilter&&String(u.SPPG||u.sppg||'')!==sppgFilter)return false;
    if(division&&String(u.Jabatan_Divisi||u.jabatan_divisi||'')!==division)return false;
    const active=u.Status_Aktif===true||String(u.Status_Aktif).toUpperCase()==='TRUE';
    if(account==='ACTIVE'&&!active)return false;
    if(account==='INACTIVE'&&active)return false;
    if(!q)return true;
    const nama = (u.Nama_Lengkap||u.nama_lengkap||'').toLowerCase();
    const sppg = (u.SPPG||u.sppg||'').toLowerCase();
    const jabatan = (u.Jabatan_Divisi||u.jabatan_divisi||'').toLowerCase();
    return nama.includes(q) || sppg.includes(q) || jabatan.includes(q);
  });
  renderUsersGrid();
}

function renderUsersGrid(){
  const container = $('#users-grid-container');
  if(!container) return;
  const users = AdminState.filteredUsers;
  const pagination=$('#users-pagination'),totalPages=Math.max(1,Math.ceil(AdminState.userTotal/AdminState.userPageSize));
  if(pagination){
    pagination.hidden=false;
    const start=(AdminState.userPage-1)*AdminState.userPageSize;
    $('#users-pagination-info').textContent=`${AdminState.userTotal?start+1:0}â€“${Math.min(start+AdminState.userPageSize,AdminState.userTotal)} dari ${AdminState.userTotal} pengguna`;
    $('#users-prev-btn').disabled=AdminState.userPage<=1;
    $('#users-next-btn').disabled=AdminState.userPage>=totalPages;
  }
  container.className=AdminState.userViewMode==='list'?'users-list':'users-grid';
  if(users.length === 0){
    container.innerHTML = `<div class="table-empty" style="grid-column:1/-1"><svg class="table-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/></svg><div class="table-empty-title">Tidak ada pengguna ditemukan</div><div class="table-empty-sub">Coba ubah kata kunci pencarian Anda</div></div>`;
    return;
  }
  container.innerHTML = users.map((u,i) => {
    const nama = u.Nama_Lengkap||u.nama_lengkap||'-';
    const sppg = u.SPPG||u.sppg||'-';
    const jabatan = u.Jabatan_Divisi||u.jabatan_divisi||'-';
    const foto = u.URL_Foto_Profil||u.url_foto_profil||'';
    const inisial = nama.trim().charAt(0).toUpperCase();
    const avatarHtml = foto
      ? `<img src="${escapeHtml(foto)}" alt="${escapeHtml(nama)}" onerror="this.remove()">`
      : escapeHtml(inisial);
    const active=u.Status_Aktif===true||String(u.Status_Aktif).toUpperCase()==='TRUE',face=Boolean(u._hasFace||u.URL_Foto_Wajah_Ref),bank=Boolean(u.Nama_Bank&&u.Nomor_Rekening),salary=Number(u.Gaji_Harian)>0;
    if(AdminState.userViewMode==='list')return `<div class="user-list-row" data-user-index="${i}" role="button" tabindex="0">
      <div class="user-list-identity"><div class="user-list-avatar">${avatarHtml}</div><div><strong>${escapeHtml(nama)}</strong><span>${escapeHtml(u.Email||u.Username||'-')}</span></div></div>
      <div class="user-list-cell"><strong>${escapeHtml(normalizeRole(u.Role||'USER'))}</strong>Role</div>
      <div class="user-list-cell"><strong>${escapeHtml(sppg)}</strong>SPPG</div>
      <div class="user-list-cell"><strong>${escapeHtml(jabatan)}</strong>Divisi</div>
      <div class="user-list-cell"><strong>${u._online?'Online':active?'Offline':'Nonaktif'}</strong>Status</div>
      <div class="user-list-cell"><strong>${face?'Wajah ✓':'Wajah —'} · ${bank?'Rekening ✓':'Rekening —'}</strong>${salary?'Gaji tersedia':'Gaji kosong'} · ${u._todayPunches?.length?`${u._todayPunches.length} punch hari ini`:'Belum punch'} · Profil ${Number(u._profileScore)||0}%</div>
      <button class="btn btn-sm btn-secondary" type="button">Detail</button>
    </div>`;
    return `<div class="user-card" data-user-index="${i}" role="button" tabindex="0">
      <div class="user-avatar-wrap">${avatarHtml}</div>
      <div class="user-card-name">${escapeHtml(nama)}</div>
      <div class="user-card-sppg">${escapeHtml(sppg)}</div>
      <div class="user-card-jabatan">${escapeHtml(jabatan)}</div>
      <div class="user-card-status"><span class="presence-dot ${u._online?'online':''}"></span>${u._online?'Online':u._lastActivity?'Terakhir '+escapeHtml(formatDateTime(u._lastActivity)):'Offline'} · Profil ${Number(u._profileScore)||0}%</div>
      <div class="profile-completeness" title="Kelengkapan profil ${Number(u._profileScore)||0}%"><span style="width:${Math.max(0,Math.min(100,Number(u._profileScore)||0))}%"></span></div>
    </div>`;
  }).join('');
}

function openUserDetail(index){
  const u = AdminState.filteredUsers[index];
  if(!u) return;
  AdminState.selectedUser = u;
  const nama = u.Nama_Lengkap||u.nama_lengkap||'-';
  const foto = u.URL_Foto_Profil||u.url_foto_profil||'';
  const inisial = nama.trim().charAt(0).toUpperCase();

  $('#user-detail-title').textContent = nama;
  const avatarEl = $('#ud-avatar');
  if(foto){
    avatarEl.innerHTML = '';
    avatarEl.style.background = 'transparent';
    avatarEl.style.border = 'none';
    const img = document.createElement('img');
    img.src = foto;
    img.style.cssText = 'width:88px;height:88px;border-radius:50%;border:4px solid var(--surface);object-fit:cover';
    img.onerror = () => { avatarEl.textContent = inisial; };
    avatarEl.appendChild(img);
  } else {
    avatarEl.textContent = inisial;
  }
  $('#ud-nama').textContent = nama;
  $('#ud-role').textContent = u.Role||u.role||'USER';
  $('#ud-idcard').textContent = (u.ID_Card_Unik||u.id_card_unik) ? `ID Card: ${u.ID_Card_Unik||u.id_card_unik}` : '-';

  setInfo('ud-p-nama', nama);
  setInfo('ud-p-username', u.Username||u.username);
  setInfo('ud-p-email', u.Email||u.email);
  setInfo('ud-p-wa', u.No_Whatsapp||u.no_whatsapp);
  setInfo('ud-p-tempat-lahir', u.Tempat_Lahir||u.tempat_lahir);
  setInfo('ud-p-tanggal-lahir', u.Tanggal_Lahir||u.tanggal_lahir, formatTanggal);
  setInfo('ud-p-jk', u.Jenis_Kelamin||u.jenis_kelamin);
  setInfo('ud-p-sppg', u.SPPG||u.sppg);
  setInfo('ud-p-jabatan', u.Jabatan_Divisi||u.jabatan_divisi);
  setInfo('ud-p-mulai-kerja', u.Tanggal_Mulai_Kerja||u.tanggal_mulai_kerja, formatTanggal);
  setInfo('ud-p-gaji', u.Gaji_Harian||u.gaji_harian, formatRupiah);
  setInfo('ud-p-status', u.Status_Akun||u.status_akun||'Aktif');
  setInfo('ud-p-bank', u.Nama_Bank||u.nama_bank);
  setInfo('ud-p-nomor-rekening', u.Nomor_Rekening||u.nomor_rekening);
  setInfo('ud-p-rekening', u.Atas_Nama_Rekening||u.atas_nama_rekening);

  switchView('admin-user-detail');
}

function openAdminUpdateUserModal(){
  const u=AdminState.selectedUser;if(!u)return;
  const data=normalizeUserEditorData(u);
  hideInlineAlert('admin-update-user-alert');
  populateInputs({
    '#admin-update-user-id':data.idUser,'#auu-nama':data.nama,'#auu-wa':data.wa,'#auu-tempat-lahir':data.tempatLahir,
    '#auu-tanggal-lahir':data.tanggalLahir,'#auu-jk':data.jenisKelamin,'#auu-sppg':data.sppg,'#auu-jabatan':data.jabatan,
    '#auu-mulai-kerja':data.mulaiKerja,'#auu-gaji':data.gaji,'#auu-bank':data.bank,'#auu-nomor-rekening':data.nomorRekening,'#auu-rekening':data.atasNamaRekening
  });
  $('#modal-admin-update-user').classList.add('active');
}

async function handleSaveAdminUpdateUser(){
  hideInlineAlert('admin-update-user-alert');
  const userId=$('#admin-update-user-id').value;if(!userId){showInlineAlert('admin-update-user-alert','ID user tidak ditemukan');return;}
  const updates={Nama_Lengkap:$('#auu-nama').value.trim(),No_Whatsapp:$('#auu-wa').value.trim(),Tempat_Lahir:$('#auu-tempat-lahir').value.trim(),Tanggal_Lahir:$('#auu-tanggal-lahir').value||null,Jenis_Kelamin:$('#auu-jk').value,SPPG:$('#auu-sppg').value.trim(),Jabatan_Divisi:$('#auu-jabatan').value.trim(),Tanggal_Mulai_Kerja:$('#auu-mulai-kerja').value||null,Gaji_Harian:$('#auu-gaji').value?Number($('#auu-gaji').value):null,Nama_Bank:$('#auu-bank').value.trim(),Nomor_Rekening:$('#auu-nomor-rekening').value.trim(),Atas_Nama_Rekening:$('#auu-rekening').value.trim()};
  if(!updates.Nama_Lengkap){showInlineAlert('admin-update-user-alert','Nama lengkap tidak boleh kosong','warning');return;}
  await withBusyButton($('#btn-save-admin-update-user'),'<div class="spinner" style="width:18px;height:18px;border-width:2px"></div> Menyimpan...',async()=>{
    try{
      const r=await apiCall('updateData',{token:AppState.token,menu:'users',id:userId,data:updates});
      if(r&&r.success){showAlert('Data user berhasil diperbarui','success');Object.assign(AdminState.selectedUser,updates);openUserDetail(AdminState.filteredUsers.indexOf(AdminState.selectedUser));$('#modal-admin-update-user').classList.remove('active');loadAdminUsers();}
      else showInlineAlert('admin-update-user-alert',r?.message||'Gagal memperbarui data');
    }catch(error){showInlineAlert('admin-update-user-alert',parseApiError(error).message);}
  });
}

async function openAdminDeleteUserModal(){
  const u = AdminState.selectedUser;
  if(!u) return;
  const nama = u.Nama_Lengkap||u.nama_lengkap||'user ini';
  const confirmation=await confirmRiskAction({title:'Hapus akun pengguna',impact:`Akun ${nama} beserta akses masuknya akan dihapus. Data transaksi terkait dapat terdampak dan tindakan ini tidak dapat dibatalkan.`});
  if(!confirmation)return;
  await handleConfirmDeleteUser(confirmation.reason);
}

async function handleConfirmDeleteUser(reason){
  const u=AdminState.selectedUser;if(!u)return;
  const userId=u.ID_User;
  await withBusyButton($('#btn-admin-delete-user'),'<div class="spinner" style="width:18px;height:18px;border-width:2px"></div>',async()=>{
    try{
      const r=await apiCall('deleteData',{token:AppState.token,menu:'users',id:userId,reason});
      if(r&&r.success){showAlert('User berhasil dihapus','success');dismissModal('modal-admin-delete-user');AdminState.selectedUser=null;switchView('admin-users');loadAdminUsers();}
      else showAlert(r?.message||'Gagal menghapus user','error');
    }catch(error){showAlert(parseApiError(error).message,'error');}
  });
}

/* ---- Load Log Aktivitas ---- */
async function loadAdminLog(){
  const container = $('#log-list-container');
  if(!container) return;
  container.innerHTML = skeletonRowsMarkup(3);
  try {
    const r = await apiCall(isSuperAdminUser()?'getSuperAdminAuditV3':'getAuditLogEnriched', {token: AppState.token,limit:100});
    AdminState.allLogs = Array.isArray(r) ? r : (r?.logs || []);
    populateAuditFilters();
    filterAndRenderLog();
  } catch(e) {
    container.innerHTML = tableMessageMarkup(`Gagal memuat log: ${e.message}`);
  }
}

function filterAndRenderLog(){
  const q = ($('#log-search')?.value||'').toLowerCase();
  const role=$('#log-filter-role')?.value||'',sppg=$('#log-filter-sppg')?.value||'',type=$('#log-filter-type')?.value||'';
  const start=$('#log-filter-start')?.value||'',end=$('#log-filter-end')?.value||'';
  AdminState.filteredLogs = AdminState.allLogs.filter(log => {
    if(role&&normalizeRole(log._pelakuRole)!==normalizeRole(role))return false;
    if(sppg&&String(log._pelakuSppg||'')!==sppg)return false;
    if(type&&String(log.Jenis_Aktivitas||'')!==type)return false;
    const date=String(log.Waktu||'').slice(0,10);
    if(start&&date<start)return false;if(end&&date>end)return false;
    if(!q) return true;
    const nama = (log._pelakuNama||'').toLowerCase();
    const email = (log._pelakuEmail||'').toLowerCase();
    const aktivitas = (log.Jenis_Aktivitas||'').toLowerCase();
    return nama.includes(q) || email.includes(q) || aktivitas.includes(q);
  });
  AdminState.logPage = 1;
  renderLogList();
}

function populateAuditFilters(){
  const sppg=$('#log-filter-sppg'),type=$('#log-filter-type');if(!sppg||!type)return;
  const selectedSppg=sppg.value,selectedType=type.value;
  const sppgValues=[...new Set(AdminState.allLogs.map(row=>String(row._pelakuSppg||'').trim()).filter(Boolean))].sort();
  const typeValues=[...new Set(AdminState.allLogs.map(row=>String(row.Jenis_Aktivitas||'').trim()).filter(Boolean))].sort();
  sppg.innerHTML='<option value="">Semua SPPG</option>'+sppgValues.map(value=>`<option>${escapeHtml(value)}</option>`).join('');
  type.innerHTML='<option value="">Semua aktivitas</option>'+typeValues.map(value=>`<option>${escapeHtml(value)}</option>`).join('');
  sppg.value=selectedSppg;type.value=selectedType;
}

function getLogIcon(aktivitas){
  const a = (aktivitas||'').toLowerCase();
  if(a.includes('login') || a.includes('masuk')) return {cls:'log-icon-login', icon:'🔐'};
  if(a.includes('absen') || a.includes('hadir')) return {cls:'log-icon-absen', icon:'📋'};
  if(a.includes('update') || a.includes('edit') || a.includes('ubah')) return {cls:'log-icon-update', icon:'✏️'};
  if(a.includes('hapus') || a.includes('delete')) return {cls:'log-icon-delete', icon:'🗑️'};
  return {cls:'log-icon-other', icon:'📌'};
}

function formatWaktu(v){
  const d=parseDateValue(v);if(!d)return v||'-';
  return d.toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'})+' '+d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
}

function renderLogList(){
  const container = $('#log-list-container');
  const pg = $('#log-pagination');
  if(!container) return;
  const total = AdminState.filteredLogs.length;
  const ps = AdminState.logPageSize;
  const page = AdminState.logPage;
  const start = (page-1)*ps;
  const rows = AdminState.filteredLogs.slice(start, start+ps);

  if(rows.length === 0){
    container.innerHTML = `<div class="table-empty"><svg class="table-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><div class="table-empty-title">Tidak ada log ditemukan</div><div class="table-empty-sub">Belum ada aktivitas yang tercatat</div></div>`;
    if(pg) pg.style.display = 'none';
    return;
  }

  container.innerHTML = rows.map((log, idx) => {
    const nama = log._pelakuNama||'Tidak diketahui';
    const email = log._pelakuEmail||'-';
    const aktivitas = log.Jenis_Aktivitas||'-';
    const waktu = formatWaktu(log.Waktu);
    const {cls, icon} = getLogIcon(aktivitas);
    return `<div class="log-item" data-log-index="${start+idx}" role="button" tabindex="0">
      <div class="log-icon ${cls}">${icon}</div>
      <div class="log-body">
        <div class="log-user">${nama}</div>
        <div class="log-email">${email}</div>
        <div class="log-action">${aktivitas}</div>
      </div>
      <div class="log-time">${waktu}</div>
    </div>`;
  }).join('');

  if(pg){
    pg.hidden = false;
    const totalPages = Math.max(1, Math.ceil(total/ps));
    $('#log-pagination-info').textContent = `${start+1}–${Math.min(start+ps,total)} dari ${total} log`;
    $('#log-prev-btn').disabled = page <= 1;
    $('#log-next-btn').disabled = page >= totalPages;
  }
}

function openLogDetail(index){
  const log = AdminState.filteredLogs[index];
  if(!log) return;
  const nama = log._pelakuNama||'Tidak diketahui';
  const email = log._pelakuEmail||'-';
  const aktivitas = log.Jenis_Aktivitas||'-';
  const waktu = formatWaktu(log.Waktu);
  const ipAddr = log.IP_Address||'-';
  let detail = '-';
  if(log.Detail !== null && log.Detail !== undefined){
    detail = typeof log.Detail === 'string' ? log.Detail : JSON.stringify(log.Detail, null, 2);
  }
  const {cls, icon} = getLogIcon(aktivitas);
  const change=typeof log.Detail==='object'&&log.Detail?(log.Detail.before!==undefined||log.Detail.after!==undefined?`<div class="feature-card" style="margin-top:1rem"><strong>Perubahan sebelum → sesudah</strong><div class="info-grid" style="margin-top:.75rem"><div><div class="info-item-label">Sebelum</div><pre class="info-item-value">${escapeHtml(JSON.stringify(log.Detail.before??{},null,2))}</pre></div><div><div class="info-item-label">Sesudah</div><pre class="info-item-value">${escapeHtml(JSON.stringify(log.Detail.after??{},null,2))}</pre></div></div></div>`:''):'';

  $('#log-detail-body').innerHTML = `
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem">
      <div class="log-icon ${cls}" style="width:52px;height:52px;font-size:1.375rem;flex-shrink:0">${icon}</div>
      <div>
        <div style="font-size:1.0625rem;font-weight:800">${nama}</div>
        <div style="font-size:0.8125rem;color:var(--text-muted)">${email}</div>
      </div>
    </div>
    <div class="info-grid" style="gap:1rem">
      <div><div class="info-item-label">Aktivitas</div><div class="info-item-value" style="font-weight:600;color:var(--text)">${aktivitas}</div></div>
      <div><div class="info-item-label">Waktu</div><div class="info-item-value">${waktu}</div></div>
      <div><div class="info-item-label">IP Address</div><div class="info-item-value">${ipAddr}</div></div>
      <div><div class="info-item-label">Detail</div><pre class="info-item-value" style="white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:0.8125rem;margin:0"></pre></div>
    </div>
    ${change}
  `;
  const detailEl=$('#log-detail-body pre');
  if(detailEl)detailEl.textContent=detail;
  $('#modal-log-detail').classList.add('active');
}

/* ===================================================================
   ATTENDANCE, PAYROLL, AND COMPLAINT MODULES
   =================================================================== */
const FeatureState={
  adminComplaints:[],
  filteredAdminComplaints:[],
  adminConfiguration:null,
  myActivity:[],
  payrollEmployees:[],
  payrollSelected:new Set(),
  payrollPreview:{},
  payrollHistory:[],
  payrollActiveTab:'publish',
  payrollHistoryLoaded:false,
  payrollSignatureDrawn:{accountant:false,head:false},
  payrollSignatureReady:new Set(),
  recipientSignatureDrawn:false,
  recipientSignatureReady:false,
  recipientSlipId:'',
  superOverview:null,
  systemSettingTab:'access',
};

const SYSTEM_SETTING_DEFINITIONS=[
  {tab:'menu',key:'menu.user.complaints',label:'Menu Pengaduan USER',description:'Tampilkan pusat pengaduan untuk pengguna.',enabled:true},
  {tab:'menu',key:'menu.admin.payroll',label:'Menu Payroll ADMIN',description:'Izinkan ADMIN mengakses penerbitan payroll.',enabled:true},
  {tab:'menu',key:'menu.admin.audit',label:'Menu Audit Log',description:'Tampilkan audit operasional bagi ADMIN.',enabled:true},
  {tab:'attendance',key:'attendance.geofence_required',label:'Geofence wajib',description:'Tolak absensi di luar radius SPPG.',enabled:true},
  {tab:'attendance',key:'attendance.capture_gps_accuracy',label:'Simpan akurasi GPS',description:'Rekam metadata akurasi lokasi setiap punch.',enabled:true},
  {tab:'attendance',key:'attendance.allow_import_single_punch',label:'Punch tunggal impor',description:'Izinkan punch tunggal hasil impor dihitung valid.',enabled:true},
  {tab:'attendance',key:'attendance.correction_requires_audit',label:'Audit koreksi absensi',description:'Setiap koreksi wajib menyertakan alasan dan audit.',enabled:true},
  {tab:'payroll',key:'payroll.recipient_signature_required',label:'TTD penerima wajib',description:'Slip final memerlukan tanda tangan penerima.',enabled:true},
  {tab:'payroll',key:'payroll.accountant_signature_required',label:'TTD akuntan wajib',description:'Penerbitan slip memerlukan tanda tangan akuntan.',enabled:true},
  {tab:'payroll',key:'payroll.head_signature_required',label:'TTD Kepala SPPG wajib',description:'Penerbitan slip memerlukan tanda tangan kepala SPPG.',enabled:true},
  {tab:'payroll',key:'payroll.private_pdf',label:'PDF slip privat',description:'Batasi unduhan slip hanya untuk pihak berwenang.',enabled:true},
  {tab:'notification',key:'notification.new_slip',label:'Notifikasi slip baru',description:'Beri tahu pengguna saat slip diterbitkan.',enabled:true},
  {tab:'notification',key:'notification.complaint_reply',label:'Notifikasi balasan pengaduan',description:'Beri tahu pengguna saat tiket ditanggapi.',enabled:true},
  {tab:'notification',key:'notification.incomplete_attendance',label:'Pengingat absensi tidak lengkap',description:'Beri peringatan punch hari ini belum lengkap.',enabled:true},
  {tab:'notification',key:'notification.global_announcement',label:'Pengumuman global',description:'Izinkan SUPER ADMIN menerbitkan pengumuman lintas SPPG.',enabled:false},
  {tab:'security',key:'security.idle_session_expiry',label:'Kedaluwarsa sesi idle',description:'Akhiri sesi yang tidak aktif sesuai kebijakan.',enabled:true},
  {tab:'security',key:'security.revoke_on_password_reset',label:'Cabut sesi saat reset password',description:'Keluar dari seluruh perangkat setelah perubahan sandi.',enabled:true},
  {tab:'security',key:'security.risky_action_reason',label:'Alasan tindakan wajib',description:'Wajibkan alasan pada perubahan berisiko.',enabled:true},
  {tab:'security',key:'security.two_step_confirmation',label:'Konfirmasi dua tahap',description:'Tampilkan dampak lalu minta frasa konfirmasi.',enabled:true},
];

function formatDateTime(value){
  const date=parseDateValue(value);return date?date.toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'}):'-';
}

function safeExternalUrl(value){
  try{const url=new URL(String(value||''));return url.protocol==='https:'?url.href:'';}catch{return'';}
}

function loadBgnLogoAsPng(){
  if(BgnLogoPngPromise)return BgnLogoPngPromise;
  BgnLogoPngPromise=new Promise((resolve,reject)=>{
    const image=new Image();
    image.crossOrigin='anonymous';
    image.onload=()=>{
      try{
        const maxSide=600,scale=Math.min(1,maxSide/Math.max(image.naturalWidth||1,image.naturalHeight||1));
        const canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round((image.naturalWidth||1)*scale));
        canvas.height=Math.max(1,Math.round((image.naturalHeight||1)*scale));
        const context=canvas.getContext('2d');
        context.clearRect(0,0,canvas.width,canvas.height);
        context.drawImage(image,0,0,canvas.width,canvas.height);
        resolve(canvas.toDataURL('image/png'));
      }catch(error){reject(new Error('Logo BGN gagal dikonversi untuk PDF.'));}
    };
    image.onerror=()=>reject(new Error('Logo BGN tidak dapat dimuat dari Storage.'));
    image.src=`${LOGO_BGN_STORAGE_URL}?v=${Date.now()}`;
  }).catch(error=>{BgnLogoPngPromise=null;throw error;});
  return BgnLogoPngPromise;
}

function humanizeActivity(value){
  return String(value||'Aktivitas')
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map(word=>word.charAt(0).toUpperCase()+word.slice(1))
    .join(' ');
}

function summarizeActivityDetail(detail){
  if(!detail||typeof detail!=='object')return'';
  const hidden=/password|token|descriptor|hash|salt/i;
  return Object.entries(detail)
    .filter(([key,value])=>!hidden.test(key)&&value!==null&&value!==undefined&&typeof value!=='object')
    .slice(0,5)
    .map(([key,value])=>`${humanizeActivity(key)}: ${String(value)}`)
    .join(' · ');
}

async function loadMyActivity(){
  const list=$('#my-activity-list');if(!list)return;
  list.innerHTML='<div class="loading-state"><span class="spinner"></span>Memuat aktivitas...</div>';
  try{
    const result=await apiCall('getMyActivity',{token:AppState.token});
    FeatureState.myActivity=result?.logs||[];
    renderMyActivity();
  }catch(error){
    list.innerHTML=`<div class="table-empty"><div class="table-empty-title">Aktivitas gagal dimuat</div><div class="table-empty-sub">${escapeHtml(error.message)}</div></div>`;
  }
}

function renderMyActivity(){
  const list=$('#my-activity-list');if(!list)return;
  const query=($('#my-activity-search')?.value||'').trim().toLowerCase();
  const rows=FeatureState.myActivity.filter(row=>!query||`${row.Jenis_Aktivitas||''} ${JSON.stringify(row.Detail||{})}`.toLowerCase().includes(query));
  if(!rows.length){
    list.innerHTML='<div class="table-empty"><div class="table-empty-title">Belum ada aktivitas</div><div class="table-empty-sub">Aktivitas akun Anda akan tercatat di sini.</div></div>';
    return;
  }
  list.innerHTML=rows.map(row=>{
    const icon=getLogIcon(row.Jenis_Aktivitas),detail=summarizeActivityDetail(row.Detail);
    return `<article class="log-item"><div class="log-icon ${icon.cls}">${icon.icon}</div><div class="log-body"><div class="log-user">${escapeHtml(humanizeActivity(row.Jenis_Aktivitas))}</div>${detail?`<div class="activity-detail">${escapeHtml(detail)}</div>`:''}</div><time class="log-time">${escapeHtml(formatWaktu(row.Waktu))}</time></article>`;
  }).join('');
}

async function loadSuperAdminOverview(force=false){
  const panel=$('#super-admin-global-panel');if(!panel||!isSuperAdminUser())return;
  panel.classList.remove('hidden');
  try{
    const result=await apiCall('getSuperAdminOverviewV3',{token:AppState.token},{force});
    FeatureState.superOverview=result||{};
    const totals=result?.totals||{};
    $('#super-total-sppg').textContent=totals.sppg||0;
    $('#super-attendance-rate').textContent=`${totals.attendanceRate||0}%`;
    $('#super-payroll-total').textContent=formatRupiah(totals.payrollTotal||0);
    $('#super-admin-count').textContent=totals.admins||0;
    const body=$('#super-sppg-body'),rows=result?.bySppg||[];
    body.innerHTML=rows.length?rows.map(row=>`<tr>
      <td data-primary="true"><button class="btn btn-sm btn-secondary super-sppg-drilldown" type="button" data-sppg="${escapeHtml(row.sppg)}">${escapeHtml(row.sppg)}</button></td>
      <td data-label="Karyawan">${Number(row.employees)||0}</td><td data-label="Kehadiran">${Number(row.attendanceRate)||0}%</td>
      <td data-label="Punch lengkap">${Number(row.completePunchRate)||0}%</td><td data-label="Payroll">${escapeHtml(formatRupiah(row.payrollTotal||0))}</td>
      <td data-label="Slip menunggu">${Number(row.pendingSlips)||0}</td><td data-label="Pengaduan">${Number(row.openComplaints)||0}</td>
    </tr>`).join(''):'<tr><td colspan="7"><div class="table-empty">Belum ada data SPPG.</div></td></tr>';
    renderSystemQuality();
    renderSystemSettings();
  }catch(error){
    $('#super-sppg-body').innerHTML=`<tr><td colspan="7"><div class="table-empty">Gagal memuat dashboard global: ${escapeHtml(error.message)}</div></td></tr>`;
  }
}

function renderSystemQuality(key=''){
  const quality=FeatureState.superOverview?.quality||{};
  const mapping={duplicateNames:'quality-duplicates',withoutDivision:'quality-division',withoutSalary:'quality-salary',withoutBank:'quality-bank',slipsWithoutPdf:'quality-pdf',inactiveWithSession:'quality-session'};
  Object.entries(mapping).forEach(([name,id])=>{const el=$(`#${id}`);if(el)el.textContent=(quality[name]||[]).length;});
  const detail=$('#system-quality-detail');if(!detail)return;
  if(!key){detail.innerHTML='<div class="belum-absen-empty">Pilih indikator untuk melihat detail.</div>';return;}
  const rows=quality[key]||[];
  detail.innerHTML=rows.length?rows.slice(0,50).map(row=>`<div class="exception-item"><div><strong>${escapeHtml(row.name||row.label||row.id||'-')}</strong><span>${escapeHtml(row.sppg||'Lintas SPPG')}${row.count?` · ${Number(row.count)} akun`:''}</span></div><span class="badge badge-warning">Perlu ditinjau</span></div>`).join(''):'<div class="belum-absen-empty">Tidak ada anomali untuk kategori ini.</div>';
}

function renderSystemSettings(){
  const body=$('#system-settings-body');if(!body)return;
  $$('[data-setting-tab]').forEach(button=>{
    const active=button.dataset.settingTab===FeatureState.systemSettingTab;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));
  });
  if(FeatureState.systemSettingTab==='access'){
    body.innerHTML='<div class="system-setting-row"><div><strong>Role dan cakupan SPPG</strong><span>Backend aktif: perubahan role, penambahan, dan penghapusan cakupan diproses pada bagian di bawah dengan konfirmasi dua tahap serta Audit Log.</span></div><span class="badge badge-success">Terhubung</span></div>';
    return;
  }
  const values=new Map((FeatureState.superOverview?.settings||[]).map(row=>[row.Setting_Key,row]));
  const definitions=SYSTEM_SETTING_DEFINITIONS.filter(item=>item.tab===FeatureState.systemSettingTab);
  body.innerHTML=definitions.map(item=>{
    const row=values.get(item.key),enabled=row?.Setting_Value?.enabled??item.enabled;
    return `<div class="system-setting-row"><div><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.description)}${row?.Updated_At?` · Diperbarui ${escapeHtml(formatDateTime(row.Updated_At))}`:''}</span></div><button type="button" class="setting-toggle ${enabled?'active':''}" role="switch" aria-checked="${enabled}" aria-label="${escapeHtml(item.label)}" data-setting-key="${escapeHtml(item.key)}"></button></div>`;
  }).join('');
}

async function toggleSystemSetting(button){
  const definition=SYSTEM_SETTING_DEFINITIONS.find(item=>item.key===button.dataset.settingKey);if(!definition)return;
  const enabled=button.getAttribute('aria-checked')!=='true';
  const confirmation=await confirmRiskAction({title:'Ubah pengaturan sistem',impact:`${definition.label} akan ${enabled?'diaktifkan':'dinonaktifkan'} untuk aplikasi. Perubahan berlaku lintas SPPG dan dicatat sebelum–sesudah.`});
  if(!confirmation)return;
  button.disabled=true;
  try{
    const response=await apiCall('manageSystemSettingsV3',{token:AppState.token,mode:'UPDATE',key:definition.key,enabled,description:definition.description,reason:confirmation.reason});
    const setting=response?.setting;
    const settings=FeatureState.superOverview?.settings||[],index=settings.findIndex(row=>row.Setting_Key===definition.key);
    if(index>=0)settings[index]=setting;else settings.push(setting);
    renderSystemSettings();showAlert('Pengaturan sistem berhasil diperbarui.','success');
  }catch(error){button.disabled=false;showAlert(error.message||'Pengaturan gagal disimpan.','error');}
}

async function loadAdminConfiguration(){
  const accessBody=$('#config-access-body'),roleBody=$('#config-role-body');
  if(!accessBody||!roleBody)return;
  if(!isSuperAdminUser()){
    accessBody.innerHTML='<tr><td colspan="6"><div class="table-empty">Akses hanya untuk SUPER ADMIN.</div></td></tr>';
    roleBody.innerHTML='<tr><td colspan="4"><div class="table-empty">Akses hanya untuk SUPER ADMIN.</div></td></tr>';
    return;
  }
  accessBody.innerHTML='<tr><td colspan="6"><div class="loading-state"><span class="spinner"></span>Memuat konfigurasi...</div></td></tr>';
  roleBody.innerHTML='<tr><td colspan="4"><div class="loading-state"><span class="spinner"></span>Memuat akun...</div></td></tr>';
  try{
    const result=await apiCall('getAdminConfiguration',{token:AppState.token});
    FeatureState.adminConfiguration=result||{};
    renderAdminConfiguration();
    await loadSuperAdminOverview();
  }catch(error){
    accessBody.innerHTML=`<tr><td colspan="6"><div class="table-empty">Gagal memuat konfigurasi: ${escapeHtml(error.message)}</div></td></tr>`;
    roleBody.innerHTML='<tr><td colspan="4"><div class="table-empty">Data akun tidak tersedia.</div></td></tr>';
  }
}

function renderAdminConfiguration(){
  const data=FeatureState.adminConfiguration||{},admins=data.adminAccounts||[],sppg=data.masterSppg||[],access=data.access||[],accounts=data.accounts||[];
  $('#config-admin-count').textContent=admins.length;
  $('#config-access-count').textContent=access.filter(row=>row.Aktif===true||String(row.Aktif).toLowerCase()==='true').length;
  $('#config-sppg-count').textContent=sppg.length;

  const adminSelect=$('#config-admin-account'),sppgSelect=$('#config-admin-sppg');
  const selectedAdmin=adminSelect.value,selectedSppg=sppgSelect.value;
  adminSelect.innerHTML='<option value="">Pilih akun</option>'+admins.filter(row=>row.Email).map(row=>`<option value="${escapeHtml(row.Email)}">${escapeHtml(row.Nama_Lengkap||row.Email)} — ${escapeHtml(row.Role)} (${escapeHtml(row.Email)})</option>`).join('');
  sppgSelect.innerHTML='<option value="">Pilih SPPG</option>'+sppg.map(row=>`<option value="${escapeHtml(row.Nama_SPPG)}">${escapeHtml(row.Nama_SPPG)}${row.Yayasan?' — '+escapeHtml(row.Yayasan):''}</option>`).join('');
  if([...adminSelect.options].some(option=>option.value===selectedAdmin))adminSelect.value=selectedAdmin;
  if([...sppgSelect.options].some(option=>option.value===selectedSppg))sppgSelect.value=selectedSppg;

  const accessBody=$('#config-access-body');
  if(!access.length){
    accessBody.innerHTML='<tr><td colspan="6"><div class="table-empty"><div class="table-empty-title">Belum ada mapping akses</div><div class="table-empty-sub">Tambahkan akun dan SPPG melalui formulir di atas.</div></div></td></tr>';
  }else{
    accessBody.innerHTML=access.map(row=>`<tr><td><div class="config-account"><strong>${escapeHtml(row.Nama_Admin||row.Email||'-')}</strong><span>${escapeHtml(row.Email||'-')}</span></div></td><td><span class="badge badge-info">${escapeHtml(row.Role_Admin||'-')}</span></td><td>${escapeHtml(row.SPPG||'-')}</td><td>${escapeHtml(row.Yayasan||'-')}</td><td><span class="badge ${row.Aktif?'badge-success':'badge-gray'}">${row.Aktif?'Aktif':'Nonaktif'}</span></td><td><button class="btn btn-sm btn-secondary config-delete-access" type="button" data-access-id="${escapeHtml(row.ID_Akses)}">Hapus</button></td></tr>`).join('');
  }
  renderConfiguredRoles(accounts);
}

function renderConfiguredRoles(accounts=FeatureState.adminConfiguration?.accounts||[]){
  const body=$('#config-role-body');if(!body)return;
  const query=($('#config-account-search')?.value||'').trim().toLowerCase();
  const rows=accounts.filter(row=>normalizeRole(row.Role)!=='SUPER ADMIN').filter(row=>!query||`${row.Nama_Lengkap||''} ${row.Email||''} ${row.SPPG||''} ${row.Role||''}`.toLowerCase().includes(query));
  if(!rows.length){
    body.innerHTML='<tr><td colspan="4"><div class="table-empty">Tidak ada akun yang sesuai.</div></td></tr>';
    return;
  }
  body.innerHTML=rows.map(row=>`<tr><td><div class="config-account"><strong>${escapeHtml(row.Nama_Lengkap||'-')}</strong><span>${escapeHtml(row.Email||'Email belum diisi')}</span></div></td><td>${escapeHtml(row.SPPG||'-')}</td><td><span class="badge ${row.Status_Aktif?'badge-success':'badge-gray'}">${row.Status_Aktif?'Aktif':'Nonaktif'}</span></td><td><select class="config-role-select" data-config-user="${escapeHtml(row.ID_User)}" data-current-role="${escapeHtml(normalizeRole(row.Role))}"><option value="USER" ${normalizeRole(row.Role)==='USER'?'selected':''}>USER</option><option value="ADMIN" ${normalizeRole(row.Role)==='ADMIN'?'selected':''}>ADMIN</option><option value="AKUNTAN" ${normalizeRole(row.Role)==='AKUNTAN'?'selected':''}>AKUNTAN</option></select><div class="config-danger-note">Perubahan mengakhiri sesi aktif</div></td></tr>`).join('');
}

async function handleSaveAdminAccess(){
  const email=$('#config-admin-account').value,sppg=$('#config-admin-sppg').value;
  if(!email||!sppg){showAlert('Pilih akun dan SPPG terlebih dahulu.','warning');return;}
  const confirmation=await confirmRiskAction({title:'Tambahkan cakupan akses',impact:`Akun ${email} akan memperoleh akses operasional ke SPPG ${sppg}.`});
  if(!confirmation)return;
  const button=$('#btn-save-admin-access'),original=button.innerHTML;button.disabled=true;button.innerHTML='<span class="spinner" style="width:18px;height:18px;border-width:2px"></span>Menyimpan...';
  try{
    const result=await apiCall('saveAksesEmail',{token:AppState.token,email,sppg,aktif:true,reason:confirmation.reason});
    showAlert(result?.message||'Akses berhasil ditambahkan.','success');
    await loadAdminConfiguration();
  }catch(error){showAlert(error.message||'Gagal menambahkan akses.','error');}
  finally{button.disabled=false;button.innerHTML=original;}
}

async function deleteAdminAccess(id,button){
  if(!id)return;
  const confirmation=await confirmRiskAction({title:'Hapus cakupan akses',impact:'Mapping SPPG akan dihapus. Akun terkait segera kehilangan akses ke data pada cakupan tersebut.'});
  if(!confirmation)return;
  const original=button.innerHTML;button.disabled=true;button.innerHTML='<span class="spinner" style="width:16px;height:16px;border-width:2px"></span>';
  try{
    await apiCall('deleteAksesEmail',{token:AppState.token,idAkses:id,reason:confirmation.reason});
    showAlert('Cakupan akses berhasil dihapus.','success');
    await loadAdminConfiguration();
  }catch(error){showAlert(error.message||'Gagal menghapus akses.','error');button.disabled=false;button.innerHTML=original;}
}

async function changeConfiguredRole(select){
  const idUser=select.dataset.configUser,previous=select.dataset.currentRole,next=select.value;
  if(previous===next)return;
  const confirmation=await confirmRiskAction({title:'Ubah role akun',impact:`Role akun akan berubah dari ${previous} menjadi ${next}. Seluruh sesi aktif akun target akan langsung dicabut.`});
  if(!confirmation){select.value=previous;return;}
  select.disabled=true;
  try{
    const result=await apiCall('setConfiguredUserRole',{token:AppState.token,idUser,role:next,reason:confirmation.reason});
    showAlert(result?.message||'Role berhasil diperbarui.','success');
    await loadAdminConfiguration();
  }catch(error){showAlert(error.message||'Gagal memperbarui role.','error');select.value=previous;select.disabled=false;}
}

async function loadMyAbsensi(){
  const body=$('#my-absensi-body'); if(!body)return;
  body.innerHTML='<tr><td colspan="4"><div class="loading-state"><span class="spinner"></span>Memuat absensi...</div></td></tr>';
  try{
    const month=$('#my-absensi-month')?.value||'';
    const result=await apiCall('getMyAbsensi',{token:AppState.token,filterBulan:month||undefined});
    const rows=result?.rows||[];
    $('#my-absensi-complete').textContent=result?.totalHariKerja||0;
    $('#my-absensi-arrivals').textContent=result?.totalDatang||0;
    $('#my-absensi-departures').textContent=result?.totalPulang||0;
    if(!rows.length){body.innerHTML='<tr><td colspan="4"><div class="empty-state"><strong>Belum ada data absensi</strong>Ubah filter bulan atau lakukan absensi pertama Anda.</div></td></tr>';return;}
    body.innerHTML=rows.map(row=>{
      const punches=(row.punches||[]).map(p=>`<span class="punch-chip" title="${escapeHtml(p.jenis||'Punch')}">${escapeHtml((p.waktu||'-').slice(0,5))}</span>`).join('');
      const sources=[...new Set((row.punches||[]).map(p=>p.sumber||'APLIKASI'))];
      const status=row.lengkap?'Lengkap':row.status==='PUNCH_TUNGGAL_VALID'?'Punch tunggal valid':'Belum lengkap';
      const badge=row.lengkap?'badge-success':'badge-warning';
      return `<tr><td data-primary="true"><strong>${escapeHtml(formatTanggal(row.tanggal))}</strong></td><td data-label="Seluruh punch"><div class="punch-list">${punches||'-'}</div></td><td data-label="Status"><span class="badge ${badge}">${status}</span></td><td data-label="Sumber">${escapeHtml(sources.join(', ')||'-')}</td></tr>`;
    }).join('');
  }catch(error){body.innerHTML=`<tr><td colspan="4"><div class="empty-state"><strong>Data gagal dimuat</strong>${escapeHtml(error.message)}</div></td></tr>`;}
}

async function loadMyPayroll(){
  const body=$('#my-payroll-body'),profile=$('#my-payroll-profile'); if(!body||!profile)return;
  body.innerHTML='<tr><td colspan="7"><div class="loading-state"><span class="spinner"></span>Memuat payroll...</div></td></tr>';
  try{
    const result=await apiCall('getMyPayroll',{token:AppState.token});
    profile.innerHTML=`<strong>${escapeHtml(result?.namaLengkap||'Pengguna')}</strong><div class="helper-text">${escapeHtml(result?.jabatanDivisi||'-')} · ${escapeHtml(result?.sppg||'-')}</div>`;
    const rows=result?.payroll||[];
    if(!rows.length){body.innerHTML='<tr><td colspan="7"><div class="empty-state"><strong>Belum ada slip gaji</strong>Slip yang telah diterbitkan akan tampil di sini.</div></td></tr>';return;}
    body.innerHTML=rows.map(row=>`<tr>
      <td data-primary="true"><div class="slip-period">${escapeHtml(formatTanggal(row.periodeMulai))} - ${escapeHtml(formatTanggal(row.periodeAkhir))}</div><div class="slip-issued">Terbit ${escapeHtml(formatDateTime(row.diterbitkanAt))}${row.namaPenerbit?' · '+escapeHtml(row.namaPenerbit):''}</div></td>
      <td data-label="Hari kerja">${Number(row.jumlahHariKerja)||0} hari</td>
      <td data-label="Gaji harian">${escapeHtml(formatRupiah(row.gajiHarian))}</td>
      <td data-label="Bonus">${escapeHtml(formatRupiah(row.bonus||0))}</td>
      <td data-label="Potongan">${escapeHtml(formatRupiah(row.potongan||0))}${row.keteranganPotongan?`<div class="payroll-employee-meta">${escapeHtml(row.keteranganPotongan)}</div>`:''}</td>
      <td data-label="Total diterima"><strong class="payroll-total">${escapeHtml(formatRupiah(row.totalGaji))}</strong></td>
      <td data-label="Slip PDF">${row.perluTandaTangan
        ?`<button class="btn btn-primary btn-sm payroll-sign-btn" type="button" data-slip-sign="${escapeHtml(row.idSlip)}" data-slip-period="${escapeHtml(`${formatTanggal(row.periodeMulai)} - ${formatTanggal(row.periodeAkhir)}`)}">Tanda Tangani</button><div class="payroll-status-note">PDF menunggu TTD penerima</div>`
        :row.dapatDiunduh
          ?`<button class="btn btn-primary btn-sm payroll-download-btn" type="button" data-slip-download="${escapeHtml(row.idSlip)}">Unduh PDF</button>`
          :'<span class="payroll-status-note">Belum tersedia</span>'}</td>
    </tr>`).join('');
  }catch(error){body.innerHTML=`<tr><td colspan="7"><div class="empty-state"><strong>Payroll gagal dimuat</strong>${escapeHtml(error.message)}</div></td></tr>`;}
}

async function loadMyComplaints(){
  const list=$('#my-complaint-list'); if(!list)return;
  list.innerHTML='<div class="loading-state"><span class="spinner"></span>Memuat riwayat...</div>';
  try{
    const result=await apiCall('getRiwayatPengaduanSaya',{token:AppState.token});
    const rows=result?.pengaduan||[];
    if(!rows.length){list.innerHTML='<div class="feature-card empty-state"><strong>Belum ada pengaduan</strong>Pengaduan yang Anda kirim dan tanggapannya akan tersimpan di sini.</div>';return;}
    list.innerHTML=rows.map(row=>{
      const status=String(row.Status_Tiket||'BARU').toUpperCase();
      return `<article class="complaint-card ${status==='BARU'?'unread':''}" data-my-complaint-id="${escapeHtml(row.ID_Pengaduan)}"><div class="complaint-head"><div><div class="complaint-meta"><span class="badge badge-primary">${escapeHtml(row.Kategori||'Lainnya')}</span><span class="badge badge-neutral">${row.Jenis_Pengirim==='Anonymous'?'Anonim':'Dengan identitas'}</span><span class="badge ${ticketBadgeClass(status)}">${escapeHtml(ticketStatusLabel(status))}</span></div><div class="helper-text">${escapeHtml(formatDateTime(row.Timestamp))} · Tiket ${escapeHtml(row.ID_Pengaduan)}</div></div></div><div class="complaint-content">${escapeHtml(row.Isi_Pengaduan||'')}</div>${row.Tanggapan_Admin?`<div class="complaint-response"><strong>Tanggapan Admin</strong><br>${escapeHtml(row.Tanggapan_Admin)}<div class="helper-text">${escapeHtml(formatDateTime(row.Waktu_Tanggapan))}</div></div>`:''}${status!=='SELESAI'?'<div class="complaint-actions"><button class="btn btn-secondary btn-sm my-complaint-close-btn" type="button">Tandai Selesai</button></div>':''}</article>`;
    }).join('');
  }catch(error){list.innerHTML=`<div class="feature-card empty-state"><strong>Riwayat gagal dimuat</strong>${escapeHtml(error.message)}</div>`;}
}

async function handleSendComplaint(event){
  event.preventDefault();
  const category=$('#complaint-category').value,message=$('#complaint-message').value.trim(),anonymous=$('#complaint-anonymous').checked;
  if(!category){showAlert('Pilih kategori pengaduan.','warning');return;}
  if(message.length<10){showAlert('Isi pengaduan minimal 10 karakter.','warning');return;}
  const button=$('#btn-send-complaint'),original=button.innerHTML;button.disabled=true;button.innerHTML='<span class="spinner" style="width:18px;height:18px;border-width:2px"></span>Mengirim...';
  try{
    await apiCall('kirimPengaduan',{token:AppState.token,Kategori:category,Isi_Pengaduan:message,Jenis_Pengirim:anonymous?'Anonymous':'Terdaftar'});
    event.currentTarget.reset();$('#complaint-char-count').textContent='0';showAlert('Pengaduan berhasil dikirim.','success');await loadMyComplaints();
  }catch(error){showAlert(error.message||'Pengaduan gagal dikirim.','error');}
  finally{button.disabled=false;button.innerHTML=original;}
}

async function loadComplaintNotification(){
  if(!isAdmin())return;
  try{const result=await apiCall('getNotifikasiAdmin',{token:AppState.token});const count=Number(result?.jumlah)||0;$$('[data-complaint-count],#complaint-nav-count').forEach(badge=>{badge.textContent=count>99?'99+':String(count);badge.hidden=!count;});}catch(error){console.error('Gagal memuat notifikasi pengaduan',error);}
}

async function loadAdminComplaints(){
  const list=$('#admin-complaint-list');if(!list)return;
  list.innerHTML='<div class="loading-state"><span class="spinner"></span>Memuat inbox...</div>';
  try{const result=await apiCall('getDaftarPengaduan',{token:AppState.token});FeatureState.adminComplaints=result?.pengaduan||[];filterAdminComplaints();await loadComplaintNotification();}
  catch(error){list.innerHTML=`<div class="feature-card empty-state"><strong>Inbox gagal dimuat</strong>${escapeHtml(error.message)}</div>`;}
}

function filterAdminComplaints(){
  const status=$('#admin-complaint-status')?.value||'',category=$('#admin-complaint-category')?.value||'',query=($('#admin-complaint-search')?.value||'').toLowerCase();
  FeatureState.filteredAdminComplaints=FeatureState.adminComplaints.filter(row=>(!status||String(row.Status_Tiket||'BARU')===status)&&(!category||row.Kategori===category)&&(!query||`${row.Isi_Pengaduan||''} ${row._namaPengirim||''} ${row.ID_Pengaduan||''}`.toLowerCase().includes(query)));
  renderAdminComplaints();
}

function ticketStatusLabel(status){return({BARU:'Baru',DIPROSES:'Diproses',MENUNGGU_USER:'Menunggu User',SELESAI:'Selesai'})[String(status||'').toUpperCase()]||'Baru';}
function ticketBadgeClass(status){return status==='SELESAI'?'badge-success':status==='MENUNGGU_USER'?'badge-warning':status==='DIPROSES'?'badge-info':'badge-primary';}

function renderAdminComplaints(){
  const list=$('#admin-complaint-list');if(!list)return;const rows=FeatureState.filteredAdminComplaints;
  if(!rows.length){list.innerHTML='<div class="feature-card empty-state"><strong>Tidak ada pengaduan</strong>Tidak ada laporan yang sesuai dengan filter.</div>';return;}
  const isSuper=normalizeRole(AppState.user?.role||AppState.user?.Role)==='SUPER ADMIN';
  list.innerHTML=rows.map(row=>{
    const anonymous=row.Jenis_Pengirim==='Anonymous';
    const ticketStatus=String(row.Status_Tiket||'BARU').toUpperCase(),priority=String(row.Prioritas||'NORMAL').toUpperCase();
    const identity=anonymous&&!isSuper?'Anonim':(row._namaPengirim||row.User_Pengirim||'Tidak diketahui');
    const identityDetail=anonymous&&!isSuper?'Identitas disembunyikan':`${row._jabatanPengirim||'-'} · ${row._sppgPengirim||row.SPPG||'-'}${row._emailPengirim?' · '+row._emailPengirim:''}`;
    return `<article class="complaint-card ${ticketStatus==='BARU'?'unread':''}" data-complaint-id="${escapeHtml(row.ID_Pengaduan)}"><div class="complaint-head"><div><div class="complaint-meta"><span class="badge badge-primary">${escapeHtml(row.Kategori||'Lainnya')}</span><span class="badge badge-neutral">${anonymous?'Anonim':'Terdaftar'}</span><span class="badge ${ticketBadgeClass(ticketStatus)}">${escapeHtml(ticketStatusLabel(ticketStatus))}</span><span class="badge ${priority==='MENDESAK'||priority==='TINGGI'?'badge-danger':'badge-neutral'}">${escapeHtml(priority)}</span></div><strong>${escapeHtml(identity)}</strong><div class="helper-text">${escapeHtml(identityDetail)}<br>${escapeHtml(formatDateTime(row.Timestamp))} · Tiket ${escapeHtml(row.ID_Pengaduan)}</div></div></div><div class="complaint-content">${escapeHtml(row.Isi_Pengaduan||'')}</div>${row.Tanggapan_Admin?`<div class="complaint-response"><strong>Tanggapan terakhir</strong><br>${escapeHtml(row.Tanggapan_Admin)}<div class="helper-text">${escapeHtml(formatDateTime(row.Waktu_Tanggapan))}</div></div>`:''}<div class="complaint-actions"><select class="form-input ticket-status-select" aria-label="Status tiket"><option value="BARU" ${ticketStatus==='BARU'?'selected':''}>Baru</option><option value="DIPROSES" ${ticketStatus==='DIPROSES'?'selected':''}>Diproses</option><option value="MENUNGGU_USER" ${ticketStatus==='MENUNGGU_USER'?'selected':''}>Menunggu User</option><option value="SELESAI" ${ticketStatus==='SELESAI'?'selected':''}>Selesai</option></select><select class="form-input ticket-priority-select" aria-label="Prioritas tiket"><option value="RENDAH" ${priority==='RENDAH'?'selected':''}>Rendah</option><option value="NORMAL" ${priority==='NORMAL'?'selected':''}>Normal</option><option value="TINGGI" ${priority==='TINGGI'?'selected':''}>Tinggi</option><option value="MENDESAK" ${priority==='MENDESAK'?'selected':''}>Mendesak</option></select><button type="button" class="btn btn-secondary btn-sm complaint-status-btn">Simpan Status</button><input class="form-input complaint-response-input" maxlength="4000" placeholder="Ketik tanggapan untuk pengguna..."><button type="button" class="btn btn-primary btn-sm complaint-reply-btn">Kirim Tanggapan</button></div></article>`;
  }).join('');
}

async function replyComplaint(id,response,prioritas='NORMAL'){
  if(!String(response||'').trim()){showAlert('Tanggapan tidak boleh kosong.','warning');return;}
  try{await apiCall('simpanTanggapanAdmin',{token:AppState.token,idPengaduan:id,tanggapan:String(response).trim()});await apiCall('updateComplaintTicketV2',{token:AppState.token,idPengaduan:id,status:'MENUNGGU_USER',prioritas});showAlert('Tanggapan dikirim dan tiket menunggu User.','success');await loadAdminComplaints();}
  catch(error){showAlert(error.message,'error');}
}

async function updateComplaintTicket(id,status,prioritas){
  try{await apiCall('updateComplaintTicketV2',{token:AppState.token,idPengaduan:id,status,prioritas});showAlert('Status tiket diperbarui.','success');await loadAdminComplaints();await loadDashboardData();}
  catch(error){showAlert(error.message||'Status tiket gagal diperbarui.','error');}
}
async function closeMyComplaintTicket(id){
  try{await apiCall('closeMyComplaintTicketV2',{token:AppState.token,idPengaduan:id});showAlert('Tiket ditandai selesai.','success');await loadMyComplaints();await loadUserNotifications();}
  catch(error){showAlert(error.message||'Tiket gagal diselesaikan.','error');}
}

function setAdminPayrollTab(tab,loadHistory=true){
  const activeTab=tab==='history'?'history':'publish';
  FeatureState.payrollActiveTab=activeTab;
  $$('[data-payroll-tab]').forEach(button=>{
    const isActive=button.dataset.payrollTab===activeTab;
    button.classList.toggle('active',isActive);
    button.setAttribute('aria-selected',String(isActive));
    button.tabIndex=isActive?0:-1;
  });
  const publishPanel=$('#payroll-panel-publish'),historyPanel=$('#payroll-panel-history');
  if(publishPanel){
    const isHidden=activeTab!=='publish';
    publishPanel.hidden=isHidden;
    publishPanel.classList.toggle('hidden',isHidden);
    publishPanel.setAttribute('aria-hidden',String(isHidden));
  }
  if(historyPanel){
    const isHidden=activeTab!=='history';
    historyPanel.hidden=isHidden;
    historyPanel.classList.toggle('hidden',isHidden);
    historyPanel.setAttribute('aria-hidden',String(isHidden));
  }
  if(activeTab==='history'&&loadHistory&&!FeatureState.payrollHistoryLoaded)loadAdminPayrollHistory();
}

async function loadAdminPayroll(){
  const body=$('#admin-payroll-body');if(!body)return;
  setAdminPayrollTab(FeatureState.payrollActiveTab,false);
  setPayrollDefaultPeriod();
  body.innerHTML='<tr><td colspan="8"><div class="loading-state"><span class="spinner"></span>Memuat data payroll...</div></td></tr>';
  try{
    const result=await apiCall('getKaryawanForPayroll',{token:AppState.token});
    FeatureState.payrollEmployees=result?.karyawan||[];
    const validIds=new Set(FeatureState.payrollEmployees.map(row=>String(row.idUser)));
    FeatureState.payrollSelected=new Set([...FeatureState.payrollSelected].filter(id=>validIds.has(id)));
    renderAdminPayroll();
    if(FeatureState.payrollActiveTab==='history')await loadAdminPayrollHistory();
  }
  catch(error){body.innerHTML=`<tr><td colspan="8"><div class="empty-state"><strong>Data payroll gagal dimuat</strong>${escapeHtml(error.message)}</div></td></tr>`;}
}

function getFilteredPayrollEmployees(){
  const query=($('#payroll-search')?.value||'').trim().toLowerCase();
  return FeatureState.payrollEmployees.filter(row=>!query||`${row.namaLengkap||''} ${row.jabatanDivisi||''} ${row.sppg||''}`.toLowerCase().includes(query));
}

function renderAdminPayroll(){
  const all=FeatureState.payrollEmployees,rows=getFilteredPayrollEmployees();
  const ready=all.filter(row=>Number(row.gajiHarian)>0).length;$('#payroll-employee-count').textContent=all.length;$('#payroll-ready-count').textContent=ready;$('#payroll-incomplete-count').textContent=all.length-ready;
  const selectedCount=FeatureState.payrollSelected.size;
  $('#payroll-selected-count').textContent=selectedCount;
  const publishButton=$('#btn-open-payroll-publish');if(publishButton)publishButton.disabled=selectedCount===0;
  const selectableRows=rows.filter(row=>Number(row.gajiHarian)>0);
  const selectAll=$('#payroll-select-all');
  if(selectAll){
    const selectedVisible=selectableRows.filter(row=>FeatureState.payrollSelected.has(String(row.idUser))).length;
    selectAll.checked=selectableRows.length>0&&selectedVisible===selectableRows.length;
    selectAll.indeterminate=selectedVisible>0&&selectedVisible<selectableRows.length;
  }
  updatePayrollWizard();
  const body=$('#admin-payroll-body');if(!rows.length){body.innerHTML='<tr><td colspan="8"><div class="empty-state"><strong>Tidak ada karyawan</strong>Tidak ada data sesuai pencarian.</div></td></tr>';return;}
  body.innerHTML=rows.map(row=>{
    const ready=Number(row.gajiHarian)>0,id=String(row.idUser),preview=FeatureState.payrollPreview[id],days=preview?.jumlahHariKerja;
    const initials=(row.namaLengkap||'?').trim().split(/\s+/).slice(0,2).map(part=>part.charAt(0)).join('').toUpperCase();
    const subtotal=days===undefined?null:Number(row.gajiHarian)*(Number(days)||0);
    return `<tr>
      <td data-select="true"><input class="payroll-checkbox payroll-row-check" type="checkbox" data-payroll-id="${escapeHtml(id)}" ${FeatureState.payrollSelected.has(id)?'checked':''} ${ready?'':'disabled'} aria-label="Pilih ${escapeHtml(row.namaLengkap||'karyawan')}"></td>
      <td data-primary="true"><div class="payroll-employee-cell"><div class="payroll-avatar">${escapeHtml(initials||'?')}</div><div><strong>${escapeHtml(row.namaLengkap||'-')}</strong><div class="payroll-employee-meta">${escapeHtml(id)}</div></div></div></td>
      <td data-label="Jabatan">${escapeHtml(row.jabatanDivisi||'-')}</td><td data-label="SPPG">${escapeHtml(row.sppg||'-')}</td>
      <td data-label="Gaji harian">${escapeHtml(formatRupiah(row.gajiHarian))}</td>
      <td data-label="Hari kerja">${days===undefined?'<span class="helper-text">Belum dihitung</span>':`<strong>${Number(days)||0} hari</strong>`}</td>
      <td data-label="Subtotal">${subtotal===null?'-':escapeHtml(formatRupiah(subtotal))}</td>
      <td data-label="Status"><span class="badge ${ready?'badge-success':'badge-warning'}">${ready?'Siap':'Lengkapi gaji'}</span></td>
    </tr>`;
  }).join('');
}

function updatePayrollWizard(modalOpen=false){
  const hasPeriod=Boolean($('#payroll-period-start')?.value&&$('#payroll-period-end')?.value);
  const selected=[...FeatureState.payrollSelected];
  const previewReady=selected.length>0&&selected.every(id=>FeatureState.payrollPreview[id]);
  const states=[
    {active:!hasPeriod,done:hasPeriod},
    {active:hasPeriod&&!previewReady,done:previewReady},
    {active:modalOpen||previewReady,done:false},
  ];
  states.forEach((state,index)=>{
    const step=$(`#payroll-wizard-step-${index+1}`);if(!step)return;
    step.classList.toggle('active',state.active);
    step.classList.toggle('done',state.done);
  });
}

function validatePayrollPeriod(){
  const start=$('#payroll-period-start')?.value||'',end=$('#payroll-period-end')?.value||'';
  if(!start||!end){showAlert('Isi tanggal mulai dan tanggal akhir periode.','warning');return null;}
  if(end<start){showAlert('Tanggal akhir tidak boleh sebelum tanggal mulai.','warning');return null;}
  return{start,end};
}

async function previewPayrollAttendance(showSuccess=true){
  const period=validatePayrollPeriod();if(!period)return false;
  const ids=[...FeatureState.payrollSelected];
  if(!ids.length){showAlert('Pilih minimal satu karyawan untuk menghitung hari kerja.','warning');return false;}
  const button=$('#btn-payroll-preview'),original=button?.innerHTML;
  if(button){button.disabled=true;button.innerHTML='<span class="spinner" style="width:16px;height:16px;border-width:2px"></span> Menghitung...';}
  try{
    const result=await apiCall('getAbsensiForPayrollPreview',{token:AppState.token,periodeMulai:period.start,periodeAkhir:period.end,idUserList:ids});
    FeatureState.payrollPreview={...FeatureState.payrollPreview,...(result?.absensiPerUser||{})};
    renderAdminPayroll();
    if(showSuccess)showAlert('Hari kerja berhasil dihitung dari absensi valid.','success');
    return true;
  }catch(error){showAlert(error.message||'Gagal menghitung hari kerja.','error');return false;}
  finally{if(button){button.disabled=false;button.innerHTML=original;}}
}

function setPayrollDefaultPeriod(){
  const start=$('#payroll-period-start'),end=$('#payroll-period-end');if(!start||!end||start.value||end.value)return;
  const now=new Date(),year=now.getFullYear(),month=now.getMonth();
  const localDate=(date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  start.value=localDate(new Date(year,month,1));end.value=localDate(new Date(year,month+1,0));
}

async function openPayrollPublishModal(){
  const period=validatePayrollPeriod();if(!period)return;
  if(!FeatureState.payrollSelected.size){showAlert('Pilih minimal satu karyawan.','warning');return;}
  if(FeatureState.payrollSelected.size>50){showAlert('Maksimal 50 karyawan per batch.','warning');return;}
  const complete=await previewPayrollAttendance(false);if(!complete)return;
  const selected=FeatureState.payrollEmployees.filter(row=>FeatureState.payrollSelected.has(String(row.idUser)));
  const selectedSppg=new Set(selected.map(row=>String(row.sppg||'').trim()).filter(Boolean));
  if(selectedSppg.size!==1){showAlert('Pilih karyawan dari satu SPPG saja untuk setiap batch tanda tangan.','warning');return;}
  $('#payroll-modal-period').textContent=`${formatTanggal(period.start)} - ${formatTanggal(period.end)}`;
  $('#payroll-modal-count').textContent=`${selected.length} karyawan`;
  $('#payroll-modal-signer').textContent=AppState.user?.namaLengkap||AppState.user?.Nama_Lengkap||'-';
  const body=$('#payroll-adjustment-body');
  body.innerHTML=selected.map(row=>{
    const id=String(row.idUser),days=Number(FeatureState.payrollPreview[id]?.jumlahHariKerja)||0,subtotal=Number(row.gajiHarian)*days;
    return `<tr data-payroll-adjustment="${escapeHtml(id)}" data-subtotal="${subtotal}">
      <td data-primary="true"><strong>${escapeHtml(row.namaLengkap||'-')}</strong><div class="payroll-employee-meta">${escapeHtml(row.sppg||'-')}</div></td>
      <td data-label="Hari / subtotal"><strong>${days} hari</strong><div class="payroll-employee-meta">${escapeHtml(formatRupiah(subtotal))}</div></td>
      <td data-label="Bonus"><input class="form-input payroll-money-input payroll-bonus-input" type="number" min="0" max="1000000000" step="1000" value="0" inputmode="numeric" aria-label="Bonus ${escapeHtml(row.namaLengkap||'')}"></td>
      <td data-label="Potongan"><input class="form-input payroll-money-input payroll-deduction-input" type="number" min="0" max="1000000000" step="1000" value="0" inputmode="numeric" aria-label="Potongan ${escapeHtml(row.namaLengkap||'')}"></td>
      <td data-label="Keterangan"><input class="form-input payroll-note-input payroll-deduction-note" type="text" maxlength="300" placeholder="Opsional"></td>
      <td data-label="Total bersih"><span class="payroll-total">${escapeHtml(formatRupiah(subtotal))}</span></td>
    </tr>`;
  }).join('');
  hideInlineAlert('payroll-publish-alert');
  FeatureState.payrollSignatureDrawn={accountant:false,head:false};
  $('#payroll-accountant-name').value='';
  $('#payroll-head-name').value='';
  $('#modal-payroll-publish').classList.add('active');
  updatePayrollWizard(true);
  requestAnimationFrame(()=>{
    initializeSignatureCanvas('payroll-accountant-signature-canvas','accountant',true);
    initializeSignatureCanvas('payroll-head-signature-canvas','head',true);
  });
}

function updatePayrollAdjustmentTotals(event){
  const targetRow=event?.target?.closest?.('[data-payroll-adjustment]');
  const rows=targetRow?[targetRow]:[...$('#payroll-adjustment-body').querySelectorAll('[data-payroll-adjustment]')];
  rows.forEach(row=>{
    const subtotal=Number(row.dataset.subtotal)||0,bonus=Math.max(0,Number(row.querySelector('.payroll-bonus-input').value)||0),deduction=Math.max(0,Number(row.querySelector('.payroll-deduction-input').value)||0);
    row.querySelector('.payroll-total').textContent=formatRupiah(Math.max(0,subtotal+bonus-deduction));
  });
}

function closePayrollPublishModal(){
  $('#modal-payroll-publish')?.classList.remove('active');
  updatePayrollWizard(false);
}

function initializeSignatureCanvas(canvasId,stateKey,clear=false){
  const canvas=$(`#${canvasId}`);if(!canvas)return;
  const ctx=canvas.getContext('2d');
  if(clear){
    ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
    if(stateKey==='recipient')FeatureState.recipientSignatureDrawn=false;else FeatureState.payrollSignatureDrawn[stateKey]=false;
  }
  if(stateKey==='recipient'&&FeatureState.recipientSignatureReady)return;
  if(stateKey!=='recipient'&&FeatureState.payrollSignatureReady.has(stateKey))return;
  if(stateKey==='recipient')FeatureState.recipientSignatureReady=true;else FeatureState.payrollSignatureReady.add(stateKey);
  ctx.lineWidth=5;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#0f172a';
  let drawing=false;
  const point=(event)=>{const rect=canvas.getBoundingClientRect(),source=event.touches?.[0]||event;return{x:(source.clientX-rect.left)*(canvas.width/rect.width),y:(source.clientY-rect.top)*(canvas.height/rect.height)};};
  const start=(event)=>{event.preventDefault();drawing=true;const p=point(event);ctx.beginPath();ctx.moveTo(p.x,p.y);};
  const move=(event)=>{if(!drawing)return;event.preventDefault();const p=point(event);ctx.lineTo(p.x,p.y);ctx.stroke();if(stateKey==='recipient')FeatureState.recipientSignatureDrawn=true;else FeatureState.payrollSignatureDrawn[stateKey]=true;};
  const stop=()=>{if(drawing){drawing=false;ctx.closePath();}};
  canvas.addEventListener('pointerdown',start);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);canvas.addEventListener('pointerleave',stop);
}

function clearSignatureCanvas(canvasId,stateKey){
  const canvas=$(`#${canvasId}`),ctx=canvas?.getContext('2d');if(!ctx)return;
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  if(stateKey==='recipient')FeatureState.recipientSignatureDrawn=false;else FeatureState.payrollSignatureDrawn[stateKey]=false;
}

async function publishPayrollSlips(){
  hideInlineAlert('payroll-publish-alert');
  const namaAkuntan=$('#payroll-accountant-name').value.trim(),namaKepalaSppg=$('#payroll-head-name').value.trim();
  if(!namaAkuntan){showInlineAlert('payroll-publish-alert','Isi nama Akuntan.','warning');return;}
  if(!namaKepalaSppg){showInlineAlert('payroll-publish-alert','Isi nama Kepala SPPG.','warning');return;}
  if(!FeatureState.payrollSignatureDrawn.accountant){showInlineAlert('payroll-publish-alert','Bubuhkan tanda tangan Akuntan.','warning');return;}
  if(!FeatureState.payrollSignatureDrawn.head){showInlineAlert('payroll-publish-alert','Bubuhkan tanda tangan Kepala SPPG.','warning');return;}
  const period=validatePayrollPeriod();if(!period)return;
  const rows=[...$('#payroll-adjustment-body').querySelectorAll('[data-payroll-adjustment]')];
  const karyawanData=rows.map(row=>({
    idUser:row.dataset.payrollAdjustment,
    bonus:Math.max(0,Math.round(Number(row.querySelector('.payroll-bonus-input').value)||0)),
    potongan:Math.max(0,Math.round(Number(row.querySelector('.payroll-deduction-input').value)||0)),
    keteranganPotongan:row.querySelector('.payroll-deduction-note').value.trim(),
  }));
  const invalid=rows.find((row,index)=>Number(row.dataset.subtotal)+(karyawanData[index].bonus||0)-(karyawanData[index].potongan||0)<0);
  if(invalid){showInlineAlert('payroll-publish-alert','Potongan tidak boleh membuat total gaji menjadi negatif.','warning');return;}
  const button=$('#btn-confirm-payroll-publish'),original=button.innerHTML;button.disabled=true;button.innerHTML='<span class="spinner" style="width:17px;height:17px;border-width:2px"></span> Menyiapkan slip...';
  try{
    const logoBgnBase64=await loadBgnLogoAsPng();
    const result=await apiCall('prosesPayroll',{
      token:AppState.token,
      periodeMulai:period.start,
      periodeAkhir:period.end,
      karyawanData,
      namaAkuntan,
      namaKepalaSppg,
      tandaTanganAkuntanBase64:$('#payroll-accountant-signature-canvas').toDataURL('image/png'),
      tandaTanganKepalaSppgBase64:$('#payroll-head-signature-canvas').toDataURL('image/png'),
      logoBgnBase64,
    });
    closePayrollPublishModal();FeatureState.payrollSelected.clear();FeatureState.payrollPreview={};renderAdminPayroll();FeatureState.payrollHistoryLoaded=false;await loadAdminPayrollHistory();setAdminPayrollTab('history',false);
    showAlert(result?.message||'Slip dikirim ke akun karyawan untuk tanda tangan penerima.','success');
  }catch(error){showInlineAlert('payroll-publish-alert',error.message||'Penerbitan slip gagal.');}
  finally{button.disabled=false;button.innerHTML=original;}
}

async function loadAdminPayrollHistory(){
  const body=$('#admin-payroll-history-body');if(!body)return;
  body.innerHTML='<tr><td colspan="6"><div class="loading-state"><span class="spinner"></span>Memuat riwayat slip...</div></td></tr>';
  try{
    const result=await apiCall('getAllSlipGajiList',{token:AppState.token});
    FeatureState.payrollHistory=(result?.slipGaji||[]).sort((a,b)=>new Date(b.Diterbitkan_At||b.Created_At||0)-new Date(a.Diterbitkan_At||a.Created_At||0));
    FeatureState.payrollHistoryLoaded=true;
    const rows=FeatureState.payrollHistory.slice(0,30);
    if(!rows.length){body.innerHTML='<tr><td colspan="6"><div class="empty-state"><strong>Belum ada slip diterbitkan</strong>Slip baru akan tampil di sini.</div></td></tr>';return;}
    body.innerHTML=rows.map(row=>`<tr>
      <td data-primary="true"><strong>${escapeHtml(row._namaKaryawan||row.ID_User||'-')}</strong></td>
      <td data-label="Periode"><div class="slip-period">${escapeHtml(formatTanggal(row.Periode_Mulai))} - ${escapeHtml(formatTanggal(row.Periode_Akhir))}</div><div class="slip-issued">${escapeHtml(formatDateTime(row.Diterbitkan_At||row.Created_At))}</div></td>
      <td data-label="SPPG">${escapeHtml(row._sppgKaryawan||row.SPPG||'-')}</td><td data-label="Total"><strong>${escapeHtml(formatRupiah(row.Total_Gaji_Diterima))}</strong></td>
      <td data-label="Status"><span class="badge ${row.Status_Penerbitan==='DITERBITKAN'?'badge-success':'badge-warning'}">${escapeHtml(row.Status_Penerbitan||'DRAFT')}</span></td>
      <td data-label="PDF">${row.PDF_Storage_Path||row.URL_PDF_Slip?`<button class="btn btn-secondary btn-sm payroll-download-btn" type="button" data-slip-download="${escapeHtml(row.ID_Slip)}">Unduh PDF</button>`:'-'}</td>
    </tr>`).join('');
  }catch(error){FeatureState.payrollHistoryLoaded=false;body.innerHTML=`<tr><td colspan="6"><div class="empty-state"><strong>Riwayat gagal dimuat</strong>${escapeHtml(error.message)}</div></td></tr>`;}
}

function openRecipientSignatureModal(idSlip,period){
  if(!idSlip)return;
  FeatureState.recipientSlipId=idSlip;
  FeatureState.recipientSignatureDrawn=false;
  $('#recipient-signature-period').textContent=period||'Periksa slip sebelum menandatangani';
  hideInlineAlert('recipient-signature-alert');
  $('#modal-payroll-recipient-signature').classList.add('active');
  requestAnimationFrame(()=>initializeSignatureCanvas('payroll-recipient-signature-canvas','recipient',true));
}

function closeRecipientSignatureModal(){
  $('#modal-payroll-recipient-signature')?.classList.remove('active');
  FeatureState.recipientSlipId='';
}

async function confirmRecipientSignature(){
  hideInlineAlert('recipient-signature-alert');
  if(!FeatureState.recipientSlipId){showInlineAlert('recipient-signature-alert','Slip tidak ditemukan. Muat ulang halaman.','warning');return;}
  if(!FeatureState.recipientSignatureDrawn){showInlineAlert('recipient-signature-alert','Bubuhkan tanda tangan penerima terlebih dahulu.','warning');return;}
  const button=$('#btn-confirm-recipient-signature'),original=button.innerHTML;
  button.disabled=true;button.innerHTML='<span class="spinner" style="width:17px;height:17px;border-width:2px"></span> Membuat PDF final...';
  try{
    const result=await apiCall('signPayrollReceipt',{
      token:AppState.token,
      idSlip:FeatureState.recipientSlipId,
      tandaTanganPenerimaBase64:$('#payroll-recipient-signature-canvas').toDataURL('image/png'),
    });
    closeRecipientSignatureModal();
    await loadMyPayroll();
    showAlert(result?.message||'Slip berhasil ditandatangani dan PDF final tersedia.','success');
  }catch(error){showInlineAlert('recipient-signature-alert',error.message||'Slip gagal ditandatangani.');}
  finally{button.disabled=false;button.innerHTML=original;}
}

async function downloadPayrollSlip(idSlip,button){
  if(!idSlip)return;
  const original=button?.innerHTML;if(button){button.disabled=true;button.innerHTML='<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> Menyiapkan...';}
  try{
    const result=await apiCall('getSlipDownloadUrl',{token:AppState.token,idSlip});
    const url=safeExternalUrl(result?.url);if(!url)throw new Error('Tautan PDF tidak valid');
    const filename=String(result?.filename||'slip-gaji.pdf').replace(/[\\/:*?"<>|]+/g,'-');
    try{
      const response=await fetch(url);
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const pdfBlob=await response.blob();
      if(!pdfBlob.size)throw new Error('File PDF kosong');
      const blobUrl=URL.createObjectURL(pdfBlob);
      const anchor=document.createElement('a');
      anchor.href=blobUrl;
      anchor.download=filename;
      anchor.style.display='none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(()=>URL.revokeObjectURL(blobUrl),1000);
    }catch(downloadError){
      console.warn('Unduhan Blob tidak tersedia, menggunakan tautan langsung.',downloadError);
      window.location.assign(url);
    }
    showAlert('Unduhan slip PDF dimulai.','success');
  }catch(error){showAlert(error.message||'Slip gagal diunduh.','error');}
  finally{if(button){button.disabled=false;button.innerHTML=original;}}
}

/* ===== EDIT PROFIL ===== */
function openEditProfil(){
  const u=AppState.user;if(!u)return;
  const data=normalizeUserEditorData(u);
  hideInlineAlert('edit-profil-alert');
  const avatar=$('#edit-profil-avatar');
  if(data.foto)avatar.innerHTML=`<img src="${data.foto}" alt="Foto profil">`;
  else avatar.textContent=data.nama?String(data.nama).trim().charAt(0).toUpperCase():'?';
  populateInputs({
    '#edit-nama':data.nama,'#edit-username':data.username,'#edit-tempat-lahir':data.tempatLahir,'#edit-tanggal-lahir':data.tanggalLahir,
    '#edit-jk':data.jenisKelamin,'#edit-email':data.email,'#edit-wa':data.wa,'#edit-bank':data.bank,
    '#edit-nomor-rekening':data.nomorRekening,'#edit-rekening':data.atasNamaRekening
  });
  $('#modal-edit-profil').classList.add('active');
}
function closeEditProfil(){$('#modal-edit-profil').classList.remove('active');}
async function handleSaveEditProfil(){
  hideInlineAlert('edit-profil-alert');
  const updates={Nama_Lengkap:$('#edit-nama').value.trim(),Tempat_Lahir:$('#edit-tempat-lahir').value.trim(),Tanggal_Lahir:$('#edit-tanggal-lahir').value||null,Jenis_Kelamin:$('#edit-jk').value,Email:$('#edit-email').value.trim(),No_Whatsapp:$('#edit-wa').value.trim(),Nama_Bank:$('#edit-bank').value.trim(),Nomor_Rekening:$('#edit-nomor-rekening').value.trim(),Atas_Nama_Rekening:$('#edit-rekening').value.trim()};
  if(!updates.Nama_Lengkap){showInlineAlert('edit-profil-alert','Nama lengkap tidak boleh kosong','warning');return;}
  await withBusyButton($('#btn-save-edit-profil'),'<div class="spinner" style="width:18px;height:18px;border-width:2px"></div> Menyimpan...',async()=>{
    try{
      const r=await apiCall('updateProfil',{token:AppState.token,updates});
      if(r&&r.success){showAlert('Profil berhasil diperbarui','success');await loadProfilLengkap();closeEditProfil();}
      else showInlineAlert('edit-profil-alert',r?.message||'Gagal memperbarui profil');
    }catch(error){showInlineAlert('edit-profil-alert',parseApiError(error).message);}
  });
}

/* ===== GANTI PASSWORD PROFIL DENGAN OTP ===== */
function setProfilePasswordStep(step){
  const steps=['email','otp','password'];
  steps.forEach((name,index)=>{
    const panel=$(`#profile-password-panel-${name}`);
    if(panel)panel.classList.toggle('hidden',name!==step);
    const indicator=document.querySelector(`[data-profile-password-step-indicator="${name}"]`);
    if(indicator){
      const activeIndex=steps.indexOf(step);
      indicator.classList.toggle('active',name===step);
      indicator.classList.toggle('done',index<activeIndex);
    }
  });
}
function resetProfilePasswordFlow(){
  if(AppState.resendTimerProfilePassword){
    clearInterval(AppState.resendTimerProfilePassword);
    AppState.resendTimerProfilePassword=null;
  }
  AppState.profilePasswordEmail='';
  AppState.profilePasswordResetToken='';
  hideInlineAlert('profile-password-alert');
  clearOtpRow('profile-password-otp-row');
  $('#profile-new-password').value='';
  $('#profile-new-password-confirm').value='';
  $('#resend-profile-password-countdown').textContent='';
  $('#btn-resend-profile-password').classList.remove('disabled');
  setProfilePasswordStep('email');
}
function openProfilePasswordModal(){
  resetProfilePasswordFlow();
  const email=String(AppState.user?.email||AppState.user?.Email||'').trim();
  $('#profile-password-email').value=email;
  $('#modal-profile-password').classList.add('active');
  setTimeout(()=>$('#profile-password-email').focus(),50);
}
function closeProfilePasswordModal(){
  $('#modal-profile-password').classList.remove('active');
  resetProfilePasswordFlow();
}
function profilePasswordErrorMessage(error,fallback){return parseApiError(error,fallback).message;}
async function requestProfilePasswordOtp(isResend=false){
  if(isResend&&$('#btn-resend-profile-password').classList.contains('disabled'))return;
  hideInlineAlert('profile-password-alert');
  const email=String(isResend?AppState.profilePasswordEmail:$('#profile-password-email').value).trim().toLowerCase();
  if(!email){showInlineAlert('profile-password-alert','Masukkan email akun yang terdaftar.','warning');return;}
  const button=isResend?$('#btn-resend-profile-password'):$('#btn-request-profile-password-otp');
  const original=button.innerHTML;button.classList.add('disabled');button.disabled=true;
  if(!isResend)button.innerHTML='<span class="spinner" style="width:17px;height:17px;border-width:2px"></span> Mengirim...';
  try{
    const result=await apiCall('requestProfilePasswordOtp',{token:AppState.token,email});
    AppState.profilePasswordEmail=email;
    $('#profile-password-otp-email').textContent=email;
    clearOtpRow('profile-password-otp-row');
    setProfilePasswordStep('otp');
    startResendCountdown(result?.cooldownDetik||120,'btn-resend-profile-password','resend-profile-password-countdown','resendTimerProfilePassword');
    showAlert(isResend?'Kode OTP baru telah dikirim.':'Kode OTP telah dikirim ke email Anda.','success');
  }catch(error){
    showInlineAlert('profile-password-alert',profilePasswordErrorMessage(error,'Gagal mengirim kode OTP.'),String(error?.message||'').startsWith('TUNGGU::')?'warning':'error');
  }finally{
    button.disabled=false;
    if(!isResend)button.innerHTML=original;
    if(!AppState.resendTimerProfilePassword)button.classList.remove('disabled');
  }
}
async function verifyProfilePasswordOtp(){
  hideInlineAlert('profile-password-alert');
  const kodeOtp=getOtpValue('profile-password-otp-row');
  if(kodeOtp.length!==6){showInlineAlert('profile-password-alert','Masukkan 6 digit kode OTP.','warning');return;}
  const button=$('#btn-verify-profile-password-otp'),original=button.innerHTML;
  button.disabled=true;button.innerHTML='<span class="spinner" style="width:17px;height:17px;border-width:2px"></span> Memverifikasi...';
  try{
    const result=await apiCall('verifyProfilePasswordOtp',{token:AppState.token,email:AppState.profilePasswordEmail,kodeOtp});
    if(!result?.resetToken)throw new Error('Token penggantian password tidak diterima.');
    AppState.profilePasswordResetToken=result.resetToken;
    if(AppState.resendTimerProfilePassword){clearInterval(AppState.resendTimerProfilePassword);AppState.resendTimerProfilePassword=null;}
    setProfilePasswordStep('password');
    $('#profile-new-password').focus();
  }catch(error){
    clearOtpRow('profile-password-otp-row');
    showInlineAlert('profile-password-alert',profilePasswordErrorMessage(error,'Kode OTP tidak valid.'));
  }finally{
    button.disabled=false;button.innerHTML=original;
  }
}
async function submitProfilePassword(){
  hideInlineAlert('profile-password-alert');
  const newPassword=$('#profile-new-password').value;
  const confirmation=$('#profile-new-password-confirm').value;
  if(!newPassword||!confirmation){showInlineAlert('profile-password-alert','Isi password baru dan konfirmasinya.','warning');return;}
  if(newPassword!==confirmation){showInlineAlert('profile-password-alert','Konfirmasi password baru tidak cocok.');return;}
  if(newPassword.length<6){showInlineAlert('profile-password-alert','Password baru minimal 6 karakter.','warning');return;}
  if(newPassword.length>128){showInlineAlert('profile-password-alert','Password baru maksimal 128 karakter.','warning');return;}
  if(!AppState.profilePasswordResetToken){showInlineAlert('profile-password-alert','Verifikasi OTP belum lengkap. Silakan ulangi proses.','warning');setProfilePasswordStep('email');return;}
  const button=$('#btn-submit-profile-password'),original=button.innerHTML;
  button.disabled=true;button.innerHTML='<span class="spinner" style="width:17px;height:17px;border-width:2px"></span> Menyimpan...';
  try{
    const result=await apiCall('changeProfilePasswordWithOtp',{
      token:AppState.token,
      email:AppState.profilePasswordEmail,
      resetToken:AppState.profilePasswordResetToken,
      newPassword,
    });
    if(!result?.success)throw new Error(result?.message||'Password gagal diperbarui.');
    $('#modal-profile-password').classList.remove('active');
    handleLogout();
    showAlert('Password berhasil diubah. Seluruh sesi telah dicabut; silakan login kembali.','success');
  }catch(error){
    showInlineAlert('profile-password-alert',profilePasswordErrorMessage(error,'Password gagal diperbarui.'));
  }finally{
    button.disabled=false;button.innerHTML=original;
  }
}

/* ===== CROP FOTO PROFIL ===== */
const CropState={img:null,scale:1,minScale:1,offsetX:0,offsetY:0,dragging:false,lastX:0,lastY:0,canvasSize:320};

function openCropModalFromFile(file){
  if(!file.type.startsWith('image/')){showAlert('File harus berupa gambar','error');return;}
  const reader=new FileReader();
  reader.onload=(e)=>{
    const img=new Image();
    img.onload=()=>{ openCropModalWithImage(img); };
    img.onerror=()=>showAlert('File bukan gambar yang valid','error');
    img.src=e.target.result;
  };
  reader.onerror=()=>showAlert('Gagal membaca file','error');
  reader.readAsDataURL(file);
}

function openCropModalFromUrl(url){
  const img=new Image();
  img.crossOrigin='anonymous';
  img.onload=()=>{ openCropModalWithImage(img); };
  img.onerror=()=>showAlert('Gagal memuat foto saat ini','error');
  img.src=url;
}

function openCropModalWithImage(img){
  CropState.img=img;
  const size=CropState.canvasSize;
  const minScale=Math.max(size/img.width, size/img.height);
  CropState.minScale=minScale;
  CropState.scale=minScale;
  CropState.offsetX=0;
  CropState.offsetY=0;
  $('#crop-zoom').value=100;
  drawCropCanvas();
  $('#modal-crop-foto').classList.add('active');
}

let CropDrawFrame=0;
function drawCropCanvas(){
  if(CropDrawFrame)return;
  CropDrawFrame=requestAnimationFrame(()=>{
    CropDrawFrame=0;
    const canvas=$('#crop-canvas');
    if(!canvas)return;
    const ctx=canvas.getContext('2d');
    const size=CropState.canvasSize;
    if(canvas.width!==size)canvas.width=size;
    if(canvas.height!==size)canvas.height=size;
    ctx.clearRect(0,0,size,size);
    const img=CropState.img;
    if(!img)return;
    const w=img.width*CropState.scale;
    const h=img.height*CropState.scale;
    const x=(size-w)/2+CropState.offsetX;
    const y=(size-h)/2+CropState.offsetY;
    ctx.drawImage(img,x,y,w,h);
  });
}

function clampCropOffset(){
  const size=CropState.canvasSize;
  const w=CropState.img.width*CropState.scale;
  const h=CropState.img.height*CropState.scale;
  const maxOffsetX=Math.max(0,(w-size)/2);
  const maxOffsetY=Math.max(0,(h-size)/2);
  CropState.offsetX=Math.min(maxOffsetX,Math.max(-maxOffsetX,CropState.offsetX));
  CropState.offsetY=Math.min(maxOffsetY,Math.max(-maxOffsetY,CropState.offsetY));
}

function getCropResultBase64(){
  const outSize=400;
  const out=document.createElement('canvas');
  out.width=outSize;out.height=outSize;
  const ctx=out.getContext('2d');
  const size=CropState.canvasSize;
  const ratio=outSize/size;
  const img=CropState.img;
  const w=img.width*CropState.scale*ratio;
  const h=img.height*CropState.scale*ratio;
  const x=(outSize-w)/2+CropState.offsetX*ratio;
  const y=(outSize-h)/2+CropState.offsetY*ratio;
  ctx.drawImage(img,x,y,w,h);
  return out.toDataURL('image/jpeg',0.9);
}

function closeCropModal(){
  $('#modal-crop-foto').classList.remove('active');
  CropState.img=null;
}

const FaceRegState={stream:null,detectLoop:null,smileHoldMs:0,lastTs:0,busy:false};
const FACE_SMILE_HOLD_TARGET_MS=900;
const FACE_SMILE_THRESHOLD=0.7;

function resetFaceSessionState(state){state.smileHoldMs=0;state.lastTs=0;state.busy=false;}
async function startFaceCameraSession({state,videoSelector,canvasSelector,statusSelector,beforeDetection,onDetect}){
  resetFaceSessionState(state);
  const status=$(statusSelector);if(status)status.textContent='Memuat kamera...';
  state.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:480},height:{ideal:480}},audio:false});
  const video=$(videoSelector);video.srcObject=state.stream;
  await new Promise(resolve=>{video.onloadedmetadata=()=>resolve();});
  if(status)status.textContent='Memuat model deteksi wajah...';
  await loadFaceApiModels();
  const canvas=$(canvasSelector);canvas.width=video.videoWidth||480;canvas.height=video.videoHeight||480;
  if(beforeDetection)await beforeDetection();
  if(status)status.textContent='Posisikan wajah di dalam bingkai';
  onDetect();
}
function stopFaceCameraSession(state,canvasSelector){
  if(state.detectLoop)cancelAnimationFrame(state.detectLoop);state.detectLoop=null;
  if(state.stream){state.stream.getTracks().forEach(track=>track.stop());state.stream=null;}
  const canvas=$(canvasSelector);if(canvas){const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);}
}
async function runFaceDetectionLoop({state,videoSelector,canvasSelector,statusSelector,progressSelector,smilePrompt,onComplete,reschedule}){
  if(state.busy){state.detectLoop=requestAnimationFrame(reschedule);return;}
  const video=$(videoSelector),canvas=$(canvasSelector);
  if(!video||video.readyState<2){state.detectLoop=requestAnimationFrame(reschedule);return;}
  const opts=new faceapi.TinyFaceDetectorOptions({inputSize:224,scoreThreshold:0.5});
  const result=await faceapi.detectSingleFace(video,opts).withFaceLandmarks().withFaceExpressions().withFaceDescriptor();
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
  const now=performance.now(),dt=state.lastTs?now-state.lastTs:0;state.lastTs=now;
  if(!result){state.smileHoldMs=0;$(statusSelector).textContent='Wajah tidak terdeteksi';$(progressSelector).style.width='0%';state.detectLoop=requestAnimationFrame(reschedule);return;}
  const box=result.detection.box;ctx.strokeStyle='#4f46e5';ctx.lineWidth=3;ctx.strokeRect(box.x,box.y,box.width,box.height);
  const smileScore=(result.expressions&&result.expressions.happy)||0;
  if(smileScore>=FACE_SMILE_THRESHOLD){state.smileHoldMs=Math.min(FACE_SMILE_HOLD_TARGET_MS,state.smileHoldMs+dt);$(statusSelector).textContent='Bagus, tahan senyumnya...';}
  else{state.smileHoldMs=Math.max(0,state.smileHoldMs-dt*2);$(statusSelector).textContent=smilePrompt;}
  $(progressSelector).style.width=Math.round((state.smileHoldMs/FACE_SMILE_HOLD_TARGET_MS)*100)+'%';
  if(state.smileHoldMs>=FACE_SMILE_HOLD_TARGET_MS){state.busy=true;await onComplete(result);return;}
  state.detectLoop=requestAnimationFrame(reschedule);
}

function updateFaceStatusBadge(){
  const u=AppState.user;if(!u)return;
  const hasFace=Boolean(u.Wajah_Terdaftar||u.wajahTerdaftar||u.faceDescriptor||u.Face_Descriptor_JSON);
  const badge=$('#profil-face-status'),label=$('#profil-face-status-text'),btnLabel=$('#btn-daftar-wajah-label');
  if(!badge)return;
  if(hasFace){
    badge.classList.remove('not-registered');badge.classList.add('registered');
    if(label)label.textContent='Wajah Sudah Terdaftar';
    if(btnLabel)btnLabel.textContent='Perbarui Wajah';
  }else{
    badge.classList.remove('registered');badge.classList.add('not-registered');
    if(label)label.textContent='Wajah Belum Terdaftar';
    if(btnLabel)btnLabel.textContent='Daftarkan Wajah';
  }
}

async function openDaftarWajah(){
  hideInlineAlert('daftar-wajah-alert');$('#facecam-progress-bar').style.width='0%';$('#modal-daftar-wajah').classList.add('active');
  try{await startFaceCameraSession({state:FaceRegState,videoSelector:'#facecam-video',canvasSelector:'#facecam-canvas',statusSelector:'#facecam-status',onDetect:faceRegDetectLoop});}
  catch(error){console.error(error);$('#facecam-status').textContent='';showInlineAlert('daftar-wajah-alert',error&&error.name==='NotAllowedError'?'Izin kamera ditolak. Aktifkan akses kamera untuk melanjutkan.':'Gagal mengakses kamera.');}
}

function closeDaftarWajah(){
  $('#modal-daftar-wajah').classList.remove('active');stopFaceCameraSession(FaceRegState,'#facecam-canvas');
}

async function faceRegDetectLoop(){
  return runFaceDetectionLoop({state:FaceRegState,videoSelector:'#facecam-video',canvasSelector:'#facecam-canvas',statusSelector:'#facecam-status',progressSelector:'#facecam-progress-bar',smilePrompt:'Tersenyumlah untuk melanjutkan',reschedule:faceRegDetectLoop,onComplete:result=>handleFaceCaptureComplete(result.descriptor,$('#facecam-video'))});
}

const AbsenScanState={stream:null,detectLoop:null,smileHoldMs:0,lastTs:0,busy:false,coords:null};

function getCurrentPositionPromise(){
  return new Promise((resolve)=>{
    if(!navigator.geolocation){resolve(null);return;}
    navigator.geolocation.getCurrentPosition(
      (pos)=>resolve({lat:pos.coords.latitude,lng:pos.coords.longitude}),
      ()=>resolve(null),
      {enableHighAccuracy:true,timeout:8000,maximumAge:0}
    );
  });
}

async function openAbsenScan(){
  const overlay=$('#absen-result-overlay');overlay.classList.remove('show','success','error');
  $('#absen-facecam-hint').textContent='Posisikan wajah Anda di dalam bingkai, lalu tersenyumlah';$('#absen-progress-bar').style.width='0%';AbsenScanState.coords=null;
  try{await startFaceCameraSession({state:AbsenScanState,videoSelector:'#absen-facecam-video',canvasSelector:'#absen-facecam-canvas',statusSelector:'#absen-facecam-status',beforeDetection:async()=>{$('#absen-facecam-status').textContent='Mendeteksi lokasi Anda...';AbsenScanState.coords=await getCurrentPositionPromise();},onDetect:absenScanDetectLoop});}
  catch(error){console.error(error);$('#absen-facecam-status').textContent=error&&error.name==='NotAllowedError'?'Izin kamera ditolak. Aktifkan akses kamera untuk melanjutkan.':'Gagal mengakses kamera.';}
}

function closeAbsenScan(){stopFaceCameraSession(AbsenScanState,'#absen-facecam-canvas');}

async function absenScanDetectLoop(){
  return runFaceDetectionLoop({state:AbsenScanState,videoSelector:'#absen-facecam-video',canvasSelector:'#absen-facecam-canvas',statusSelector:'#absen-facecam-status',progressSelector:'#absen-progress-bar',smilePrompt:'Tersenyumlah untuk absen',reschedule:absenScanDetectLoop,onComplete:result=>handleAbsenScanComplete(result.descriptor)});
}

async function handleAbsenScanComplete(descriptor){
  $('#absen-facecam-status').textContent='Memverifikasi...';
  const overlay=$('#absen-result-overlay'),icon=$('#absen-result-icon'),title=$('#absen-result-title'),detail=$('#absen-result-detail');
  try{
    const faceDescriptorScan=Array.from(descriptor);
    const idUser=AppState.user?.idUser||AppState.user?.ID_User;
    const r=await apiCall('recordAbsensiSelf',{
      token:AppState.token,
      idUser,
      faceDescriptorScan,
      lat:AbsenScanState.coords?AbsenScanState.coords.lat:null,
      lng:AbsenScanState.coords?AbsenScanState.coords.lng:null
    });
    if(r&&r.success){
      overlay.classList.add('show','success');
      overlay.classList.remove('error');
      icon.textContent='✓';
      title.textContent=`Absen ${r.message} Berhasil`;
      detail.textContent=`${r.nama||''} • ${r.waktu||''}`;
    }else{
      overlay.classList.add('show','error');
      overlay.classList.remove('success');
      icon.textContent='✕';
      title.textContent='Absen Gagal';
      detail.textContent=r?.message||'Silakan coba lagi';
    }
  }catch(err){
    overlay.classList.add('show','error');
    overlay.classList.remove('success');
    icon.textContent='✕';
    title.textContent='Absen Gagal';
    detail.textContent=err&&err.message?err.message:'Terjadi kesalahan';
  }
  setTimeout(()=>{
    closeAbsenScan();
    switchView('dashboard');
  },5000);
}

async function handleFaceCaptureComplete(descriptor,video){
  $('#facecam-status').textContent='Menyimpan data wajah...';
  try{
    const shot=document.createElement('canvas');
    shot.width=video.videoWidth||480;
    shot.height=video.videoHeight||480;
    const sctx=shot.getContext('2d');
    sctx.translate(shot.width,0);
    sctx.scale(-1,1);
    sctx.drawImage(video,0,0,shot.width,shot.height);
    const fotoWajahBase64=shot.toDataURL('image/png');
    const faceDescriptor=Array.from(descriptor);
    const r=await apiCall('updateFaceDescriptor',{token:AppState.token,faceDescriptor,fotoWajahBase64});
    if(r&&r.success){
      if(AppState.user){
        AppState.user.Wajah_Terdaftar=true;
        localStorage.setItem('auth_user',JSON.stringify(AppState.user));
      }
      updateFaceStatusBadge();
      showAlert('Wajah berhasil didaftarkan','success');
      closeDaftarWajah();
    }else{
      showInlineAlert('daftar-wajah-alert',r?.message||'Gagal menyimpan data wajah');
      FaceRegState.smileHoldMs=0;
      FaceRegState.busy=false;
      FaceRegState.detectLoop=requestAnimationFrame(faceRegDetectLoop);
    }
  }catch(err){
    showInlineAlert('daftar-wajah-alert',err&&err.message?err.message:'Terjadi kesalahan saat menyimpan data wajah');
    FaceRegState.smileHoldMs=0;
    FaceRegState.busy=false;
    FaceRegState.detectLoop=requestAnimationFrame(faceRegDetectLoop);
  }
}

async function handleSaveCropFoto(){
  if(!CropState.img)return;
  const b=$('#btn-save-crop-foto'),o=b.innerHTML;
  b.disabled=true,b.innerHTML='<div class="spinner" style="width:16px;height:16px;border-width:2px"></div>';
  try{
    const fotoProfilBase64=getCropResultBase64();
    const r=await apiCall('updateFotoProfil',{token:AppState.token,fotoProfilBase64});
    if(r&&r.success){
      if(AppState.user){
        AppState.user.URL_Foto_Profil=r.url;
        AppState.user.urlFotoProfil=r.url;
        localStorage.setItem('auth_user',JSON.stringify(AppState.user));
      }
      $('#edit-profil-avatar').innerHTML=`<img src="${r.url}" alt="Foto profil">`;
      renderProfilFromUser();
      showAlert('Foto profil berhasil diperbarui','success');
      closeCropModal();
    }else{
      showAlert(r?.message||'Gagal memperbarui foto profil','error');
    }
  }catch(err){
    showAlert(err&&err.message?err.message:'Gagal memperbarui foto profil','error');
  }finally{
    b.disabled=false,b.innerHTML=o;
  }
}

function initCropDragEvents(){
  const stage=$('#crop-stage');
  const start=(clientX,clientY)=>{ CropState.dragging=true; CropState.lastX=clientX; CropState.lastY=clientY; };
  const move=(clientX,clientY)=>{
    if(!CropState.dragging)return;
    CropState.offsetX+=clientX-CropState.lastX;
    CropState.offsetY+=clientY-CropState.lastY;
    CropState.lastX=clientX;CropState.lastY=clientY;
    clampCropOffset();
    drawCropCanvas();
  };
  const end=()=>{ CropState.dragging=false; };
  stage.addEventListener('mousedown',(e)=>start(e.clientX,e.clientY));
  window.addEventListener('mousemove',(e)=>move(e.clientX,e.clientY));
  window.addEventListener('mouseup',end);
  stage.addEventListener('touchstart',(e)=>{const t=e.touches[0];start(t.clientX,t.clientY);},{passive:true});
  stage.addEventListener('touchmove',(e)=>{const t=e.touches[0];move(t.clientX,t.clientY);},{passive:true});
  stage.addEventListener('touchend',end);
}

async function checkSession(){
  try{if(window.HadirlyCookieSession?.restoreCookieSession)await window.HadirlyCookieSession.restoreCookieSession();}catch{}
  const st=localStorage.getItem('auth_token'),su=localStorage.getItem('auth_user');
  if(!st||!su){localStorage.removeItem('auth_token');localStorage.removeItem('auth_user');return false;}
  try{const r=await apiCall('checkSession',{token:st});if(r&&r.valid){AppState.token=st;AppState.user=r.user||JSON.parse(su);return true;}}
  catch(error){console.error(error);}
  localStorage.removeItem('auth_token');localStorage.removeItem('auth_user');return false;
}

function getInstallPlatform(){
  const ua=navigator.userAgent||'',platform=navigator.platform||'';
  const ios=/iPhone|iPad|iPod/i.test(ua)||(platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const android=/Android/i.test(ua);
  const edge=/Edg\//i.test(ua);
  const chrome=/(Chrome|CriOS)\//i.test(ua)&&!/Edg|OPR\//i.test(ua);
  const safari=/Safari\//i.test(ua)&&!/(Chrome|CriOS|Edg|OPR|Android)\//i.test(ua);
  return {ios,android,edge,chrome,safari};
}

function renderManualInstallInstructions(){
  const platform=getInstallPlatform(),box=$('#install-instructions'),button=$('#btn-install-app');
  if(!box||!button)return;
  if(platform.ios){
    if(platform.safari){
      box.innerHTML='<strong>Instal di iPhone/iPad:</strong><ol><li>Tekan tombol <b>Bagikan</b> di Safari.</li><li>Pilih <b>Tambahkan ke Layar Utama</b>.</li><li>Tekan <b>Tambah</b>, lalu buka ikon Presence SPPG.</li></ol>';
    }else{
      box.innerHTML='<strong>Gunakan Safari untuk instalasi.</strong><ol><li>Buka halaman ini di Safari.</li><li>Tekan <b>Bagikan</b>.</li><li>Pilih <b>Tambahkan ke Layar Utama</b>.</li></ol>';
    }
  }else if(platform.android){
    box.innerHTML='<strong>Instal di Android:</strong><ol><li>Buka menu browser <b>⋮</b>.</li><li>Pilih <b>Instal aplikasi</b> atau <b>Tambahkan ke layar utama</b>.</li><li>Buka Presence SPPG dari ikon yang dibuat.</li></ol>';
  }else if(platform.chrome||platform.edge){
    box.innerHTML='<strong>Instal di komputer:</strong><ol><li>Klik ikon instalasi di sisi kanan address bar.</li><li>Atau buka menu browser dan pilih <b>Instal Presence SPPG</b>.</li><li>Buka aplikasi dari Desktop, Dock, atau Start Menu.</li></ol>';
  }else{
    box.innerHTML='<strong>Browser ini tidak mendukung instalasi langsung.</strong><ol><li>Buka halaman ini menggunakan Google Chrome atau Microsoft Edge.</li><li>Pilih <b>Instal Presence SPPG</b> dari address bar atau menu browser.</li></ol>';
  }
  box.classList.add('show');
  button.textContent='Lihat Petunjuk Instalasi';
}

async function handleInstallApp(){
  const status=$('#install-status'),button=$('#btn-install-app');
  if(DeferredInstallPrompt){
    button.disabled=true;
    status.textContent='Membuka konfirmasi instalasi...';
    const prompt=DeferredInstallPrompt;
    DeferredInstallPrompt=null;
    await prompt.prompt();
    const choice=await prompt.userChoice;
    if(choice.outcome==='accepted'){
      status.textContent='Instalasi diterima. Setelah selesai, buka Presence SPPG dari ikon aplikasi.';
    }else{
      status.textContent='Instalasi dibatalkan. Aplikasi harus diinstal untuk melanjutkan.';
      renderManualInstallInstructions();
    }
    button.disabled=false;
    return;
  }
  renderManualInstallInstructions();
  status.textContent='Ikuti petunjuk di atas, lalu buka aplikasi dari ikon yang terpasang.';
}

async function registerPwaServiceWorker(){
  if(!('serviceWorker' in navigator))return null;
  try{
    const registration=await navigator.serviceWorker.register('./service-worker.js',{scope:'./'});
    registration.update().catch(()=>{});
    return registration;
  }catch(error){
    console.error('Service worker gagal didaftarkan',error);
    return null;
  }
}

async function enforceMandatoryInstall(){
  await registerPwaServiceWorker();
  if(isInstalledApp())return true;
  const gate=$('#install-gate');
  gate?.classList.add('active');
  gate?.setAttribute('aria-modal','true');
  document.body.style.overflow='hidden';
  $('#btn-install-app')?.addEventListener('click',handleInstallApp);
  const platform=getInstallPlatform();
  if(platform.ios||(!platform.chrome&&!platform.edge&&!platform.android))renderManualInstallInstructions();
  return false;
}

window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();
  DeferredInstallPrompt=event;
  const button=$('#btn-install-app'),instructions=$('#install-instructions'),status=$('#install-status');
  if(button){button.disabled=false;button.textContent='Instal Presence SPPG';}
  instructions?.classList.remove('show');
  if(status)status.textContent='Aplikasi siap diinstal pada perangkat ini.';
});

window.addEventListener('appinstalled',()=>{
  DeferredInstallPrompt=null;
  const status=$('#install-status');
  if(status)status.textContent='Presence SPPG berhasil diinstal. Buka dari ikon aplikasi untuk melanjutkan.';
});

window.matchMedia('(display-mode: standalone)').addEventListener?.('change',event=>{
  if(event.matches)window.location.reload();
});

function hideAppBootLoader(){
  const loader=$('#app-boot-loader');
  if(!loader)return;
  loader.classList.add('hidden');
  window.setTimeout(()=>loader.remove(),220);
}

async function initApp(){
  if(!await enforceMandatoryInstall()){hideAppBootLoader();return;}
  try{await loadPublicConfig();}catch{hideAppBootLoader();$('#auth-layout').classList.remove('hidden');showAlert('Gagal terhubung ke server. Muat ulang halaman.','error');return;}
  const globalPanel=$('#super-admin-global-panel'),globalView=$('#view-super-dashboard');
  if(globalPanel&&globalView)globalView.appendChild(globalPanel);
  enhanceAccessibility();

  setupOtpRow('verify-register-otp-row');
  setupOtpRow('verify-reset-otp-row');
  setupOtpRow('profile-password-otp-row');

  $('#btn-login').addEventListener('click',handleLogin);
  $('#btn-to-register').addEventListener('click',()=>navigateTo('register'));
  $('#btn-register').addEventListener('click',handleRegister);
  bindClicks(['btn-to-login','btn-verify-register-to-login','btn-forgot-to-login','btn-verify-reset-to-login'],()=>navigateTo('login'));
  $('#login-email').addEventListener('keypress',ev=>{if(ev.key==='Enter')$('#login-password').focus();});
  $('#login-password').addEventListener('keypress',ev=>{if(ev.key==='Enter')handleLogin();});

  $('#btn-verify-register').addEventListener('click',handleVerifyRegister);
  $('#btn-resend-register').addEventListener('click',handleResendRegister);

  $('#btn-goto-forgot').addEventListener('click',()=>navigateTo('forgot-password'));
  $('#btn-forgot-password').addEventListener('click',handleForgotPassword);

  $('#btn-verify-reset').addEventListener('click',handleVerifyReset);
  $('#btn-resend-reset').addEventListener('click',handleResendReset);

  $('#btn-update-password').addEventListener('click',handleUpdatePassword);

  window.location.hash.slice(1)==='register'&&navigateTo('register');

  $$('.app-nav-item[data-view],.app-bottomnav-item[data-view],.sidebar-absen-btn[data-view],.app-topbar-dropdown-item[data-view],.mobile-more-menu-item[data-view]').forEach(e=>e.addEventListener('click',()=>{
    const v = e.dataset.view;
    if(AppState.currentView==='absen-scan' && v!=='absen-scan') closeAbsenScan();
    switchView(v);
  }));
  $('#btn-logout').addEventListener('click',handleLogout);
  $('#btn-topbar-profile')?.addEventListener('click',(ev)=>{
    ev.stopPropagation();
    const dropdown=$('#topbar-dropdown'),willOpen=!dropdown?.classList.contains('active');
    closeNavigationMenus();
    if(willOpen){dropdown?.classList.add('active');$('#btn-topbar-profile')?.setAttribute('aria-expanded','true');}
  });
  $('#btn-topbar-profile')?.addEventListener('keydown',(ev)=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();ev.currentTarget.click();}});
  $('#btn-notifications')?.addEventListener('click',(ev)=>{
    ev.stopPropagation();
    const panel=$('#notification-panel'),willOpen=!panel?.classList.contains('active');
    closeNavigationMenus();
    panel?.classList.toggle('active',willOpen);
    ev.currentTarget.setAttribute('aria-expanded',String(willOpen));
    if(willOpen)loadUserNotifications();
  });
  $('#btn-mobile-more')?.addEventListener('click',(ev)=>{
    ev.stopPropagation();
    const menu=$('#mobile-more-menu'),willOpen=!menu?.classList.contains('active');
    closeNavigationMenus();
    if(willOpen){menu?.classList.add('active');$('#btn-mobile-more')?.setAttribute('aria-expanded','true');}
  });
  document.addEventListener('click',(ev)=>{
    const topbarDropdown=$('#topbar-dropdown'),profileButton=$('#btn-topbar-profile'),moreMenu=$('#mobile-more-menu'),moreButton=$('#btn-mobile-more'),notificationPanel=$('#notification-panel'),notificationButton=$('#btn-notifications');
    const insideTopbar=topbarDropdown?.contains(ev.target)||profileButton?.contains(ev.target);
    const insideMore=moreMenu?.contains(ev.target)||moreButton?.contains(ev.target);
    const insideNotifications=notificationPanel?.contains(ev.target)||notificationButton?.contains(ev.target);
    if(!insideTopbar&&!insideMore)closeNavigationMenus();
    if(!insideNotifications){notificationPanel?.classList.remove('active');notificationButton?.setAttribute('aria-expanded','false');}
  });
  document.addEventListener('keydown',(ev)=>{if(ev.key==='Escape'){closeNavigationMenus();$('#notification-panel')?.classList.remove('active');$('#btn-notifications')?.setAttribute('aria-expanded','false');}});
  document.addEventListener('visibilitychange',()=>{if(AppState.token)apiCall('presenceHeartbeat',{token:AppState.token,clientState:document.hidden?'HIDDEN':'ACTIVE'}).catch(()=>{});});
  $$('[data-exception-view]').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.exceptionView)));
  $('#btn-dashboard-absen-cta')?.addEventListener('click',()=>{
    switchView('absen-scan');
  });

  ['notification-list','dashboard-notification-list'].forEach(id=>document.getElementById(id)?.addEventListener('click',event=>{
    const button=event.target?.closest?.('[data-notification-view]');if(!button)return;
    $('#notification-panel')?.classList.remove('active');
    $('#btn-notifications')?.setAttribute('aria-expanded','false');
    switchView(button.dataset.notificationView||'dashboard');
  }));
  $('#absen-table-body')?.addEventListener('change',event=>{
    const input=event.target?.closest?.('.attendance-row-check');if(!input)return;
    if(input.checked)AdminState.attendanceSelected.set(input.dataset.key,{idUser:input.dataset.user,tanggal:input.dataset.date});
    else AdminState.attendanceSelected.delete(input.dataset.key);
    updateAttendanceSelectionBar();
  });
  const activateDelegatedRow=(event,containerSelector,rowSelector,handler)=>{
    if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;
    const container=$(containerSelector),row=event.target?.closest?.(rowSelector);if(!container||!row||!container.contains(row))return;
    if(event.type==='keydown')event.preventDefault();handler(row);
  };
  $('#users-grid-container')?.addEventListener('click',event=>activateDelegatedRow(event,'#users-grid-container','[data-user-index]',row=>openUserDetail(Number(row.dataset.userIndex))));
  $('#users-grid-container')?.addEventListener('keydown',event=>activateDelegatedRow(event,'#users-grid-container','[data-user-index]',row=>openUserDetail(Number(row.dataset.userIndex))));
  $('#log-list-container')?.addEventListener('click',event=>activateDelegatedRow(event,'#log-list-container','[data-log-index]',row=>openLogDetail(Number(row.dataset.logIndex))));
  $('#log-list-container')?.addEventListener('keydown',event=>activateDelegatedRow(event,'#log-list-container','[data-log-index]',row=>openLogDetail(Number(row.dataset.logIndex))));
  $('#super-sppg-body')?.addEventListener('click',event=>{
    const button=event.target?.closest?.('.super-sppg-drilldown');if(!button)return;
    switchView('admin-users');setTimeout(()=>{const search=$('#users-search');if(search){search.value=button.dataset.sppg||'';search.dispatchEvent(new Event('input'));}},0);
  });
  $('#system-settings-body')?.addEventListener('click',event=>{const button=event.target?.closest?.('[data-setting-key]');if(button)toggleSystemSetting(button);});
  $('#config-access-body')?.addEventListener('click',event=>{const button=event.target?.closest?.('.config-delete-access');if(button)deleteAdminAccess(button.dataset.accessId,button);});
  $('#config-role-body')?.addEventListener('change',event=>{const select=event.target?.closest?.('.config-role-select');if(select)changeConfiguredRole(select);});
  $('#my-payroll-body')?.addEventListener('click',event=>{
    const download=event.target?.closest?.('[data-slip-download]');if(download){downloadPayrollSlip(download.dataset.slipDownload,download);return;}
    const sign=event.target?.closest?.('[data-slip-sign]');if(sign)openRecipientSignatureModal(sign.dataset.slipSign,sign.dataset.slipPeriod);
  });
  $('#my-complaint-list')?.addEventListener('click',event=>{
    const button=event.target?.closest?.('.my-complaint-close-btn');if(!button)return;
    const card=button.closest('[data-my-complaint-id]');if(card)closeMyComplaintTicket(card.dataset.myComplaintId);
  });
  $('#admin-complaint-list')?.addEventListener('click',event=>{
    const button=event.target?.closest?.('.complaint-status-btn,.complaint-reply-btn');if(!button)return;
    const card=button.closest('.complaint-card');if(!card)return;const id=card.dataset.complaintId;
    if(button.classList.contains('complaint-status-btn'))updateComplaintTicket(id,card.querySelector('.ticket-status-select').value,card.querySelector('.ticket-priority-select').value);
    else replyComplaint(id,card.querySelector('.complaint-response-input').value,card.querySelector('.ticket-priority-select').value);
  });
  $('#admin-payroll-body')?.addEventListener('change',event=>{
    const input=event.target?.closest?.('.payroll-row-check');if(!input)return;
    const id=input.dataset.payrollId;if(input.checked)FeatureState.payrollSelected.add(id);else FeatureState.payrollSelected.delete(id);
    const count=FeatureState.payrollSelected.size;$('#payroll-selected-count').textContent=count;
    const publish=$('#btn-open-payroll-publish');if(publish)publish.disabled=count===0;
    const checks=[...$('#admin-payroll-body').querySelectorAll('.payroll-row-check:not(:disabled)')],selectAll=$('#payroll-select-all');
    if(selectAll){selectAll.checked=checks.length>0&&checks.every(item=>item.checked);selectAll.indeterminate=checks.some(item=>item.checked)&&!selectAll.checked;}
    updatePayrollWizard();
  });
  $('#payroll-adjustment-body')?.addEventListener('input',event=>{if(event.target?.closest?.('.payroll-money-input'))updatePayrollAdjustmentTotals(event);});
  $('#admin-payroll-history-body')?.addEventListener('click',event=>{const button=event.target?.closest?.('[data-slip-download]');if(button)downloadPayrollSlip(button.dataset.slipDownload,button);});

  $('#my-absensi-month')?.addEventListener('change',loadMyAbsensi);
  $('#complaint-form')?.addEventListener('submit',handleSendComplaint);
  $('#complaint-message')?.addEventListener('input',(event)=>{$('#complaint-char-count').textContent=event.target.value.length;});
  $('#btn-refresh-my-complaints')?.addEventListener('click',loadMyComplaints);
  $('#btn-refresh-my-activity')?.addEventListener('click',loadMyActivity);
  $('#my-activity-search')?.addEventListener('input',renderMyActivity);
  $('#btn-refresh-admin-complaints')?.addEventListener('click',loadAdminComplaints);
  $('#admin-complaint-status')?.addEventListener('change',filterAdminComplaints);
  $('#admin-complaint-category')?.addEventListener('change',filterAdminComplaints);
  $('#admin-complaint-search')?.addEventListener('input',filterAdminComplaints);
  $('#btn-refresh-admin-config')?.addEventListener('click',loadAdminConfiguration);
  $('#btn-refresh-super-dashboard')?.addEventListener('click',()=>loadSuperAdminOverview(true));
  $('#btn-save-admin-access')?.addEventListener('click',handleSaveAdminAccess);
  $$('[data-setting-tab]').forEach(button=>button.addEventListener('click',()=>{FeatureState.systemSettingTab=button.dataset.settingTab;renderSystemSettings();}));
  $$('#system-quality-grid [data-quality-key]').forEach(button=>button.addEventListener('click',()=>renderSystemQuality(button.dataset.qualityKey)));
  $('#config-account-search')?.addEventListener('input',()=>renderConfiguredRoles());
  $$('[data-payroll-tab]').forEach(button=>{
    button.addEventListener('click',()=>setAdminPayrollTab(button.dataset.payrollTab));
    button.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      const next=event.key==='ArrowLeft'||event.key==='Home'?'publish':'history';
      setAdminPayrollTab(next);
      $(`[data-payroll-tab="${next}"]`)?.focus();
    });
  });
  $('#payroll-search')?.addEventListener('input',renderAdminPayroll);
  $('#payroll-select-all')?.addEventListener('change',(event)=>{
    getFilteredPayrollEmployees().filter(row=>Number(row.gajiHarian)>0).forEach(row=>{
      const id=String(row.idUser);if(event.target.checked)FeatureState.payrollSelected.add(id);else FeatureState.payrollSelected.delete(id);
    });
    renderAdminPayroll();
  });
  bindEvents(['payroll-period-start','payroll-period-end'],'change',()=>{FeatureState.payrollPreview={};renderAdminPayroll();});
  $('#btn-payroll-preview')?.addEventListener('click',()=>previewPayrollAttendance(true));
  $('#btn-open-payroll-publish')?.addEventListener('click',openPayrollPublishModal);
  $('#btn-refresh-payroll-history')?.addEventListener('click',loadAdminPayrollHistory);
  bindClicks(['btn-close-payroll-publish','btn-cancel-payroll-publish'],closePayrollPublishModal);
  $('#btn-clear-accountant-signature')?.addEventListener('click',()=>clearSignatureCanvas('payroll-accountant-signature-canvas','accountant'));
  $('#btn-clear-head-signature')?.addEventListener('click',()=>clearSignatureCanvas('payroll-head-signature-canvas','head'));
  $('#btn-confirm-payroll-publish')?.addEventListener('click',publishPayrollSlips);
  bindClicks(['btn-close-recipient-signature','btn-cancel-recipient-signature'],closeRecipientSignatureModal);
  $('#btn-clear-recipient-signature')?.addEventListener('click',()=>clearSignatureCanvas('payroll-recipient-signature-canvas','recipient'));
  $('#btn-confirm-recipient-signature')?.addEventListener('click',confirmRecipientSignature);

  // Admin: update user modal
  $('#btn-admin-update-user')?.addEventListener('click', openAdminUpdateUserModal);
  $('#btn-admin-delete-user')?.addEventListener('click', openAdminDeleteUserModal);
  bindClicks(['btn-close-risk','btn-cancel-risk'],()=>closeRiskConfirmation(null));
  $('#btn-risk-next')?.addEventListener('click',advanceRiskConfirmation);
  $('#btn-risk-confirm')?.addEventListener('click',finishRiskConfirmation);
  bindClicks(['btn-close-admin-update-user','btn-cancel-admin-update-user'],()=>dismissModal('modal-admin-update-user'));
  $('#btn-save-admin-update-user')?.addEventListener('click', handleSaveAdminUpdateUser);
  $('#btn-back-from-user-detail')?.addEventListener('click',()=>switchView('admin-users'));
  bindClicks(['btn-close-log-detail','btn-close-log-detail-footer'],()=>dismissModal('modal-log-detail'));

  // Admin: search input listeners
  let absenSearchTimer;
  $('#absen-search')?.addEventListener('input',()=>{clearTimeout(absenSearchTimer);absenSearchTimer=setTimeout(filterAndRenderAbsen,300);});
  ['absen-filter-start','absen-filter-end','absen-filter-sppg','absen-filter-status','absen-filter-source'].forEach(id=>{
    document.getElementById(id)?.addEventListener('change',filterAndRenderAbsen);
  });
  $('#btn-reset-absen-filter')?.addEventListener('click',resetAttendanceFilters);
  let usersSearchTimer;
  $('#users-search')?.addEventListener('input',()=>{clearTimeout(usersSearchTimer);usersSearchTimer=setTimeout(()=>{AdminState.userPage=1;loadAdminUsers();},300);});
  $('#users-operational-filter')?.addEventListener('change',filterAndRenderUsers);
  ['users-role-filter','users-sppg-filter','users-division-filter','users-account-filter'].forEach(id=>document.getElementById(id)?.addEventListener('change',()=>{AdminState.userPage=1;loadAdminUsers();}));
  $$('[data-user-view]').forEach(button=>button.addEventListener('click',()=>{
    AdminState.userViewMode=button.dataset.userView;
    $$('[data-user-view]').forEach(item=>item.classList.toggle('active',item===button));
    renderUsersGrid();
  }));
  $$('[data-validation-tab]').forEach(button=>button.addEventListener('click',()=>{
    AdminState.attendanceValidationTab=button.dataset.validationTab;
    $$('[data-validation-tab]').forEach(item=>item.classList.toggle('active',item===button));
    AdminState.attendanceSelected.clear();AdminState.absenPage=1;loadAdminAbsen();
  }));
  $('#absen-select-all')?.addEventListener('change',event=>{
    $$('.attendance-row-check').forEach(input=>{input.checked=event.target.checked;input.dispatchEvent(new Event('change'));});
  });
  $$('[data-attendance-action]').forEach(button=>button.addEventListener('click',()=>validateSelectedAttendance(button.dataset.attendanceAction)));
  $('#log-search')?.addEventListener('input', filterAndRenderLog);
  $$('#audit-filter-grid input,#audit-filter-grid select').forEach(input=>input.addEventListener('change',filterAndRenderLog));

  // Admin: pagination
  bindPaginationControls({prevId:'absen-prev-btn',nextId:'absen-next-btn',canPrev:()=>AdminState.absenPage>1,canNext:()=>AdminState.absenPage<Math.ceil(AdminState.absenTotal/AdminState.absenPageSize),onPrev:()=>{AdminState.absenPage--;loadAdminAbsen();},onNext:()=>{AdminState.absenPage++;loadAdminAbsen();}});
  bindPaginationControls({prevId:'users-prev-btn',nextId:'users-next-btn',canPrev:()=>AdminState.userPage>1,canNext:()=>AdminState.userPage<Math.ceil(AdminState.userTotal/AdminState.userPageSize),onPrev:()=>{AdminState.userPage--;loadAdminUsers();},onNext:()=>{AdminState.userPage++;loadAdminUsers();}});
  bindPaginationControls({prevId:'log-prev-btn',nextId:'log-next-btn',canPrev:()=>AdminState.logPage>1,canNext:()=>AdminState.logPage<Math.max(1,Math.ceil(AdminState.filteredLogs.length/AdminState.logPageSize)),onPrev:()=>{AdminState.logPage--;renderLogList();},onNext:()=>{AdminState.logPage++;renderLogList();}});
  $('#btn-open-edit-profil').addEventListener('click',openEditProfil);
  $('#btn-open-profile-password').addEventListener('click',openProfilePasswordModal);
  $('#btn-profile-password-inline')?.addEventListener('click',openProfilePasswordModal);
  bindClicks(['btn-close-profile-password','btn-cancel-profile-password'],closeProfilePasswordModal);
  $('#btn-request-profile-password-otp').addEventListener('click',()=>requestProfilePasswordOtp(false));
  $('#btn-resend-profile-password').addEventListener('click',()=>requestProfilePasswordOtp(true));
  $('#btn-verify-profile-password-otp').addEventListener('click',verifyProfilePasswordOtp);
  $('#btn-submit-profile-password').addEventListener('click',submitProfilePassword);
  $('#profile-password-email').addEventListener('keypress',event=>{if(event.key==='Enter')requestProfilePasswordOtp(false);});
  $('#profile-new-password-confirm').addEventListener('keypress',event=>{if(event.key==='Enter')submitProfilePassword();});
  $('#btn-open-daftar-wajah').addEventListener('click',openDaftarWajah);
  bindClicks(['btn-close-daftar-wajah','btn-cancel-daftar-wajah'],closeDaftarWajah);
  $('#btn-ubah-foto-profil').addEventListener('click',()=>{
    const fotoUrl=AppState.user?.urlFotoProfil||AppState.user?.URL_Foto_Profil||'';
    if(fotoUrl){ openCropModalFromUrl(fotoUrl); } else { $('#input-foto-profil').click(); }
  });
  $('#input-foto-profil').addEventListener('change',(e)=>{const f=e.target.files[0];if(f)openCropModalFromFile(f);e.target.value='';});
  bindClicks(['btn-close-edit-profil','btn-cancel-edit-profil'],closeEditProfil);
  $('#btn-save-edit-profil').addEventListener('click',handleSaveEditProfil);
  bindClicks(['btn-close-crop-foto','btn-cancel-crop-foto'],closeCropModal);
  $('#btn-save-crop-foto').addEventListener('click',handleSaveCropFoto);
  $('#btn-pilih-foto-baru').addEventListener('click',()=>$('#input-foto-profil').click());
  $('#crop-zoom').addEventListener('input',(e)=>{
    const pct=Number(e.target.value)/100;
    CropState.scale=CropState.minScale*pct;
    clampCropOffset();
    drawCropCanvas();
  });
  initCropDragEvents();
  const hs=await checkSession();
  if(hs){showApp(),loadProfilLengkap();}else{$('#auth-layout').classList.remove('hidden'),navigateTo('login');}
  hideAppBootLoader();
}
document.readyState==='loading'?document.addEventListener('DOMContentLoaded',initApp):initApp();
