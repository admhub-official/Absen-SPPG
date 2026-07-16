window.ABSEN_SUPABASE_CONFIG = window.ABSEN_SUPABASE_CONFIG || {
  projectUrl: 'https://szwwpnbbsmjsbzzcecyj.supabase.co',
  functionUrl: 'https://szwwpnbbsmjsbzzcecyj.supabase.co/functions/v1/Absen',
  functionName: 'Absen',
  apiKey: ''
};

(() => {
  'use strict';
  const C = window.ABSEN_SUPABASE_CONFIG || {};
  let sessionToken = '';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rupiah = v => new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(v)||0);

  function addStyles(){
    if(document.getElementById('payroll-hotfix-style')) return;
    const s=document.createElement('style');
    s.id='payroll-hotfix-style';
    s.textContent=`.payroll-hotfix-menu{display:flex!important;align-items:center;gap:.65rem;width:100%;padding:.65rem .8rem;border:0;background:transparent;color:inherit;cursor:pointer;text-align:left;border-radius:.65rem;font:inherit}.payroll-hotfix-menu:hover{background:rgba(99,102,241,.09)}.payroll-hotfix-modal{position:fixed;inset:0;z-index:9800;background:rgba(15,23,42,.7);display:flex;align-items:center;justify-content:center;padding:16px}.payroll-hotfix-card{background:#fff;color:#0f172a;width:min(1100px,100%);max-height:92vh;overflow:auto;border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.25)}.payroll-hotfix-head{position:sticky;top:0;background:#fff;z-index:2;display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #e2e8f0}.payroll-hotfix-body{padding:20px}.payroll-hotfix-close{border:0;background:#eef2ff;color:#4338ca;width:36px;height:36px;border-radius:50%;font-size:21px;cursor:pointer}.payroll-hotfix-table{width:100%;border-collapse:collapse;font-size:13px}.payroll-hotfix-table th,.payroll-hotfix-table td{padding:10px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top}.payroll-hotfix-table th{background:#f8fafc}.payroll-hotfix-empty{text-align:center;padding:32px;color:#64748b}.payroll-hotfix-badge{display:inline-block;padding:3px 8px;border-radius:999px;background:#e0e7ff;color:#3730a3;font-weight:700;font-size:11px}@media(max-width:700px){.payroll-hotfix-modal{padding:0}.payroll-hotfix-card{height:100vh;max-height:100vh;border-radius:0}.payroll-hotfix-body{padding:12px}}.payroll-hotfix-hamburger{display:none;align-items:center;justify-content:center;width:38px;height:38px;border-radius:50%;border:1px solid #e2e8f0;background:transparent;cursor:pointer;margin-right:.5rem;color:inherit;flex-shrink:0}.hotfix-sidebar-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:390;display:none}.hotfix-sidebar-backdrop.active{display:block}@media(max-width:767px){.payroll-hotfix-hamburger{display:flex}.app-sidebar{display:flex!important;position:fixed;top:0;left:0;height:100vh;width:248px;max-width:82vw;z-index:400;transform:translateX(-100%);transition:transform .25s ease;box-shadow:0 0 40px rgba(0,0,0,.35)}.app-sidebar.hotfix-mobile-open{transform:translateX(0)}}`;
    document.head.appendChild(s);
  }

  function modal(title, body='<div class="payroll-hotfix-empty">Memuat...</div>'){
    addStyles(); document.getElementById('payroll-hotfix-modal')?.remove();
    const m=document.createElement('div'); m.id='payroll-hotfix-modal'; m.className='payroll-hotfix-modal';
    m.innerHTML=`<div class="payroll-hotfix-card"><div class="payroll-hotfix-head"><h2>${esc(title)}</h2><button class="payroll-hotfix-close">×</button></div><div class="payroll-hotfix-body">${body}</div></div>`;
    m.querySelector('.payroll-hotfix-close').onclick=()=>m.remove(); m.onclick=e=>{if(e.target===m)m.remove()}; document.body.appendChild(m); return m;
  }

  function collect(value,out,depth=0){
    if(depth>6||value==null)return;
    if(typeof value==='string'){
      if(value.length>20)out.push(value);
      try{collect(JSON.parse(value),out,depth+1)}catch{}
      return;
    }
    if(typeof value==='object')Object.entries(value).forEach(([k,v])=>{if(/token|session|uuid/i.test(k))collect(v,out,depth+1)});
  }
  function tokenCandidates(){
    const out=[];
    [localStorage,sessionStorage].forEach(store=>{try{for(let i=0;i<store.length;i++){const k=store.key(i),v=store.getItem(k);if(/token|session|uuid/i.test(k||''))out.unshift(v);collect(v,out)}}catch{}});
    ['currentUser','CurrentUser','currentSession','session','SESSION','authData','userData','APP_STATE','AuthState'].forEach(k=>{try{collect(window[k],out)}catch{}});
    return [...new Set(out.filter(v=>typeof v==='string'&&v.length>20))];
  }

  async function callAbsen(functionName,data={}){
    const r=await fetch(C.functionUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({function:functionName,data})});
    const j=await r.json();
    if(!r.ok||j.success===false)throw Error(j.error||'Permintaan gagal');
    return j.result ?? j;
  }
  async function ensureToken(){
    if(sessionToken)return sessionToken;
    for(const t of tokenCandidates()){
      try{await callAbsen('checkSession',{token:t});sessionToken=t;return t}catch{}
    }
    throw Error('Sesi aplikasi tidak ditemukan. Silakan logout lalu login kembali.');
  }
  async function absenApi(fn,payload={}){const token=await ensureToken();return callAbsen(fn,{token,...payload})}

  async function openMyAbsen(){
    const m=modal('My Absen');
    try{
      const x=await absenApi('getMyAbsensi'),rows=x.rows||[];
      m.querySelector('.payroll-hotfix-body').innerHTML=rows.length?`<table class="payroll-hotfix-table"><thead><tr><th>Tanggal</th><th>Datang</th><th>Pulang</th><th>Status</th></tr></thead><tbody>${rows.map(a=>`<tr><td>${esc(a.tanggal)}</td><td>${esc(a.datang||'-')}</td><td>${esc(a.pulang||'-')}</td><td><span class="payroll-hotfix-badge">${a.lengkap?'Lengkap':'Belum lengkap'}</span></td></tr>`).join('')}</tbody></table><p style="margin-top:14px">Total hari kerja lengkap: <b>${x.totalHariKerja||0}</b></p>`:'<div class="payroll-hotfix-empty">Belum ada data absensi.</div>';
    }catch(e){m.querySelector('.payroll-hotfix-body').innerHTML=`<div class="payroll-hotfix-empty">${esc(e.message)}</div>`}
  }

  async function openMyPayroll(){
    const m=modal('My Payroll');
    try{
      const x=await absenApi('getMyPayroll'),rows=x.payroll||[];
      m.querySelector('.payroll-hotfix-body').innerHTML=`<p style="margin-bottom:14px"><b>${esc(x.namaLengkap||'')}</b><br>${esc(x.jabatanDivisi||'')} · ${esc(x.sppg||'')}</p>${rows.length?`<table class="payroll-hotfix-table"><thead><tr><th>Periode</th><th>Hari kerja</th><th>Gaji harian</th><th>Total</th><th>Slip</th></tr></thead><tbody>${rows.map(s=>`<tr><td>${esc(s.periodeMulai)} – ${esc(s.periodeAkhir)}</td><td>${s.jumlahHariKerja||0}</td><td>${rupiah(s.gajiHarian)}</td><td><b>${rupiah(s.totalGaji)}</b></td><td>${s.urlPdf?`<a href="${esc(s.urlPdf)}" target="_blank" rel="noopener">Buka PDF</a>`:'Belum ada PDF'}</td></tr>`).join('')}</tbody></table>`:'<div class="payroll-hotfix-empty">Belum ada slip gaji.</div>'}`;
    }catch(e){m.querySelector('.payroll-hotfix-body').innerHTML=`<div class="payroll-hotfix-empty">${esc(e.message)}</div>`}
  }

  async function openPayroll(){
    const m=modal('Payroll');
    try{
      const x=await absenApi('getKaryawanForPayroll'),rows=x.karyawan||[];
      m.querySelector('.payroll-hotfix-body').innerHTML=rows.length?`<table class="payroll-hotfix-table"><thead><tr><th>Karyawan</th><th>Jabatan</th><th>SPPG</th><th>Gaji harian</th></tr></thead><tbody>${rows.map(u=>`<tr><td><b>${esc(u.namaLengkap)}</b></td><td>${esc(u.jabatanDivisi||'-')}</td><td>${esc(u.sppg||'-')}</td><td>${rupiah(u.gajiHarian)}</td></tr>`).join('')}</tbody></table>`:'<div class="payroll-hotfix-empty">Belum ada karyawan yang dapat diproses payroll.</div>';
    }catch(e){m.querySelector('.payroll-hotfix-body').innerHTML=`<div class="payroll-hotfix-empty">${esc(e.message)}</div>`}
  }

  async function openConfig(){
    const m=modal('Konfigurasi Admin','<div class="payroll-hotfix-empty">Konfigurasi akses ADMIN/AKUNTAN sudah disiapkan di database. Form pengaturan akan diaktifkan setelah handler konfigurasi ditambahkan ke router Absen.</div>');
    try{await ensureToken()}catch(e){m.querySelector('.payroll-hotfix-body').innerHTML=`<div class="payroll-hotfix-empty">${esc(e.message)}</div>`}
  }

  function add(parent,id,label,handler,before=null,nav=false){
    if(!parent||document.getElementById(id))return;
    const b=document.createElement('button');b.id=id;b.type='button';b.className=nav?'app-nav-item':'app-topbar-dropdown-item';b.textContent=label;b.onclick=e=>{e.preventDefault();e.stopPropagation();handler()};
    before&&before.parentNode===parent?parent.insertBefore(b,before):parent.appendChild(b);
  }
  function visibleRole(){return String(document.querySelector('.app-topbar-profile-role')?.textContent||'').trim().toUpperCase()}
  function visibleName(){return String(document.querySelector('.app-topbar-profile-name')?.textContent||'').trim().toUpperCase()}
  function visibleName(){return String(document.querySelector('.app-topbar-profile-name')?.textContent||'').trim().toUpperCase()}
  function ensureHamburger(){
    if(window.innerWidth>=768)return;
    const topbar=document.querySelector('.app-topbar');
    if(!topbar)return;
    let backdrop=document.getElementById('hotfix-sidebar-backdrop');
    if(!backdrop){
      backdrop=document.createElement('div');
      backdrop.id='hotfix-sidebar-backdrop';
      backdrop.className='hotfix-sidebar-backdrop';
      document.body.appendChild(backdrop);
    }
    const sidebar=document.querySelector('.app-sidebar');
    const closeSidebar=()=>{sidebar?.classList.remove('hotfix-mobile-open');backdrop.classList.remove('active')};
    backdrop.onclick=closeSidebar;
    if(sidebar&&!sidebar.dataset.hotfixBound){
      sidebar.addEventListener('click',e=>{if(e.target.closest('.app-nav-item'))closeSidebar()});
      sidebar.dataset.hotfixBound='1';
    }
    if(document.getElementById('hotfix-hamburger'))return;
    const btn=document.createElement('button');
    btn.id='hotfix-hamburger';btn.type='button';btn.className='payroll-hotfix-hamburger';btn.setAttribute('aria-label','Buka menu');
    btn.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
    btn.onclick=()=>{sidebar?.classList.toggle('hotfix-mobile-open');backdrop.classList.toggle('active')};
    topbar.insertBefore(btn,topbar.firstChild);
  }
  function installMenus(){
  function installMenus(){
    addStyles();
    ensureHamburger();
    const drop=document.querySelector('.app-topbar-dropdown'),nav=document.querySelector('.app-nav');
    const logout=drop&&[...drop.children].find(e=>/log\s*out|logout|keluar/i.test(e.textContent||''));
    add(drop,'hotfix-my-absen','My Absen',openMyAbsen,logout);
    add(drop,'hotfix-my-payroll','My Payroll',openMyPayroll,logout);
    const role=visibleRole();
    if(['ADMIN','AKUNTAN','SUPER ADMIN'].includes(role))add(nav,'hotfix-payroll','Payroll',openPayroll,null,true);
    const realRole=String((typeof AppState!=='undefined'&&AppState.user&&(AppState.user.role||AppState.user.Role))||'').trim().toUpperCase().replace(/_/g,' ');
    const probableSuper=realRole?realRole==='SUPER ADMIN':(role==='SUPER ADMIN'||(role==='ADMIN'&&visibleName()==='ADMIN'));
    if(probableSuper)add(nav,'hotfix-admin-config','Konfigurasi Admin',openConfig,null,true);
  }
  document.addEventListener('DOMContentLoaded',installMenus);
  installMenus();
  let hotfixPollCount=0;
  const hotfixPollId=setInterval(()=>{
    installMenus();
    hotfixPollCount++;
    if(hotfixPollCount>=25)clearInterval(hotfixPollId); // berhenti otomatis setelah ~20 detik
  },800);
})();