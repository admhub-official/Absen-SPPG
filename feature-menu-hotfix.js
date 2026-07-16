(() => {
  'use strict';
  const C = window.ABSEN_SUPABASE_CONFIG || {};
  let apiKey = '', sessionToken = '', sessionInfo = null;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rupiah = v => new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(v)||0);

  function addStyles(){
    if(document.getElementById('payroll-hotfix-style')) return;
    const s=document.createElement('style');
    s.id='payroll-hotfix-style';
    s.textContent=`.payroll-hotfix-menu{display:flex!important;align-items:center;gap:.65rem;width:100%;padding:.65rem .8rem;border:0;background:transparent;color:inherit;cursor:pointer;text-align:left;border-radius:.65rem;font:inherit}.payroll-hotfix-menu:hover{background:rgba(99,102,241,.09)}.payroll-hotfix-modal{position:fixed;inset:0;z-index:15000;background:rgba(15,23,42,.7);display:flex;align-items:center;justify-content:center;padding:16px}.payroll-hotfix-card{background:#fff;color:#0f172a;width:min(1100px,100%);max-height:92vh;overflow:auto;border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.25)}.payroll-hotfix-head{position:sticky;top:0;background:#fff;z-index:2;display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #e2e8f0}.payroll-hotfix-body{padding:20px}.payroll-hotfix-close{border:0;background:#eef2ff;color:#4338ca;width:36px;height:36px;border-radius:50%;font-size:21px;cursor:pointer}.payroll-hotfix-table{width:100%;border-collapse:collapse;font-size:13px}.payroll-hotfix-table th,.payroll-hotfix-table td{padding:10px;border-bottom:1px solid #e2e8f0;text-align:left}.payroll-hotfix-table th{background:#f8fafc}.payroll-hotfix-empty{text-align:center;padding:32px;color:#64748b}.payroll-hotfix-btn{border:0;border-radius:9px;background:#4f46e5;color:#fff;padding:8px 12px;font-weight:700;cursor:pointer}.payroll-hotfix-badge{display:inline-block;padding:3px 8px;border-radius:999px;background:#e0e7ff;color:#3730a3;font-weight:700;font-size:11px}@media(max-width:700px){.payroll-hotfix-modal{padding:0}.payroll-hotfix-card{height:100vh;max-height:100vh;border-radius:0}.payroll-hotfix-body{padding:12px}}`;
    document.head.appendChild(s);
  }

  function modal(title, body='<div class="payroll-hotfix-empty">Memuat...</div>'){
    addStyles(); document.getElementById('payroll-hotfix-modal')?.remove();
    const m=document.createElement('div'); m.id='payroll-hotfix-modal'; m.className='payroll-hotfix-modal';
    m.innerHTML=`<div class="payroll-hotfix-card"><div class="payroll-hotfix-head"><h2>${esc(title)}</h2><button class="payroll-hotfix-close">×</button></div><div class="payroll-hotfix-body">${body}</div></div>`;
    m.querySelector('.payroll-hotfix-close').onclick=()=>m.remove(); m.onclick=e=>{if(e.target===m)m.remove()}; document.body.appendChild(m); return m;
  }

  function collect(value,out,depth=0){
    if(depth>5 || value==null) return;
    if(typeof value==='string'){ if(value.length>20) out.push(value); try{collect(JSON.parse(value),out,depth+1)}catch{} return; }
    if(typeof value==='object') Object.entries(value).forEach(([k,v])=>{ if(/token|session|uuid/i.test(k)) collect(v,out,depth+1); });
  }
  function tokenCandidates(){
    const out=[];
    [localStorage,sessionStorage].forEach(store=>{try{for(let i=0;i<store.length;i++){const k=store.key(i),v=store.getItem(k);if(/token|session|uuid/i.test(k||'')) out.unshift(v);collect(v,out)}}catch{}});
    try{collect(document.cookie,out)}catch{}
    ['currentUser','CurrentUser','currentSession','session','SESSION','authData','userData','APP_STATE'].forEach(k=>{try{collect(window[k],out)}catch{}});
    return [...new Set(out.filter(v=>typeof v==='string'&&v.length>20))];
  }
  async function getKey(){
    if(apiKey) return apiKey;
    if(C.apiKey) return apiKey=C.apiKey;
    const r=await fetch(C.functionUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({function:'getPublicConfig',data:{}})});
    const j=await r.json(); apiKey=(j.result||j).anonKey||''; if(!apiKey) throw Error('Kunci API tidak tersedia'); return apiKey;
  }
  async function rpc(name,body){
    const k=await getKey(); const r=await fetch(`${C.projectUrl}/rest/v1/rpc/${name}`,{method:'POST',headers:{'Content-Type':'application/json','apikey':k,'Authorization':`Bearer ${k}`},body:JSON.stringify(body)}); const j=await r.json(); if(!r.ok) throw Error(j.message||j.error||'Permintaan gagal'); return j;
  }
  async function ensureSession(){
    if(sessionInfo&&sessionToken) return sessionInfo;
    for(const t of tokenCandidates()){try{const s=await rpc('payroll_api',{p_action:'session',p_token:t,p_payload:{}});sessionToken=t;sessionInfo=s;return s}catch{}}
    throw Error('Sesi aplikasi tidak ditemukan. Silakan logout lalu login kembali.');
  }
  async function payrollApi(action,payload={}){await ensureSession();return rpc('payroll_api',{p_action:action,p_token:sessionToken,p_payload:payload})}

  async function openMyAbsen(){
    const m=modal('My Absen'); try{const x=await payrollApi('myAbsensi'),rows=x.rows||[];m.querySelector('.payroll-hotfix-body').innerHTML=rows.length?`<table class="payroll-hotfix-table"><thead><tr><th>Tanggal</th><th>Jenis</th><th>Waktu</th><th>SPPG</th><th>Yayasan</th><th>Status</th></tr></thead><tbody>${rows.map(a=>`<tr><td>${esc(a.Tanggal)}</td><td>${esc(a.Jenis_Absen)}</td><td>${a.Waktu_Timestamp?new Date(a.Waktu_Timestamp).toLocaleString('id-ID'):'-'}</td><td>${esc(a.SPPG||'-')}</td><td>${esc(a.Yayasan||'-')}</td><td>${esc(a.Status_Validasi||'-')}</td></tr>`).join('')}</tbody></table>`:'<div class="payroll-hotfix-empty">Belum ada data absensi.</div>'}catch(e){m.querySelector('.payroll-hotfix-body').innerHTML=`<div class="payroll-hotfix-empty">${esc(e.message)}</div>`}
  }
  async function openMyPayroll(){
    const m=modal('My Payroll'); try{const x=await payrollApi('myPayroll'),rows=x.rows||[];m.querySelector('.payroll-hotfix-body').innerHTML=rows.length?`<table class="payroll-hotfix-table"><thead><tr><th>Periode</th><th>Hari kerja</th><th>Total diterima</th><th>Status</th></tr></thead><tbody>${rows.map(s=>`<tr><td>${esc(s.Periode_Mulai)} – ${esc(s.Periode_Akhir)}</td><td>${s.Jumlah_Hari_Kerja||0}</td><td><b>${rupiah(s.Total_Gaji_Diterima)}</b></td><td><span class="payroll-hotfix-badge">${esc(s.Status_Penerbitan||'TERBIT')}</span></td></tr>`).join('')}</tbody></table>`:'<div class="payroll-hotfix-empty">Belum ada slip gaji yang diterbitkan.</div>'}catch(e){m.querySelector('.payroll-hotfix-body').innerHTML=`<div class="payroll-hotfix-empty">${esc(e.message)}</div>`}
  }
  async function openPayroll(){
    const m=modal('Payroll'); try{const x=await payrollApi('slips'),rows=x.rows||[],users=x.users||[],map=new Map(users.map(u=>[u.ID_User,u]));m.querySelector('.payroll-hotfix-body').innerHTML=rows.length?`<table class="payroll-hotfix-table"><thead><tr><th>Karyawan</th><th>SPPG / Yayasan</th><th>Periode</th><th>Total</th><th>Status</th></tr></thead><tbody>${rows.map(s=>{const u=map.get(s.ID_User)||{};return`<tr><td><b>${esc(u.Nama_Lengkap||s.ID_User)}</b><br>${esc(u.Jabatan_Divisi||'')}</td><td>${esc(s.SPPG||u.SPPG||'-')}<br>${esc(s.Yayasan||u.Yayasan||'-')}</td><td>${esc(s.Periode_Mulai)} – ${esc(s.Periode_Akhir)}</td><td><b>${rupiah(s.Total_Gaji_Diterima)}</b></td><td><span class="payroll-hotfix-badge">${esc(s.Status_Penerbitan||'DRAFT')}</span></td></tr>`}).join('')}</tbody></table>`:'<div class="payroll-hotfix-empty">Belum ada data payroll.</div>'}catch(e){m.querySelector('.payroll-hotfix-body').innerHTML=`<div class="payroll-hotfix-empty">${esc(e.message)}</div>`}
  }
  async function openConfig(){
    const m=modal('Konfigurasi Admin'); try{const x=await payrollApi('config');m.querySelector('.payroll-hotfix-body').innerHTML=`<p>Pengaturan akses ADMIN dan AKUNTAN berdasarkan SPPG serta Yayasan.</p><table class="payroll-hotfix-table"><thead><tr><th>Email</th><th>Role</th><th>SPPG</th><th>Yayasan</th></tr></thead><tbody>${(x.admins||[]).map(a=>`<tr><td>${esc(a.Email)}</td><td>${esc(a.Role)}</td><td>${esc(a.SPPG||'-')}</td><td>${esc(a.Yayasan||'-')}</td></tr>`).join('')}</tbody></table>`}catch(e){m.querySelector('.payroll-hotfix-body').innerHTML=`<div class="payroll-hotfix-empty">${esc(e.message)}</div>`}
  }

  function add(parent,id,label,handler,before=null){
    if(!parent||document.getElementById(id)) return;
    const b=document.createElement('button');b.id=id;b.type='button';b.className='payroll-hotfix-menu';b.textContent=label;b.onclick=e=>{e.preventDefault();e.stopPropagation();handler()};
    before&&before.parentNode===parent?parent.insertBefore(b,before):parent.appendChild(b);
  }
  function visibleRole(){return String(document.querySelector('.app-topbar-profile-role')?.textContent||'').trim().toUpperCase()}
  function visibleName(){return String(document.querySelector('.app-topbar-profile-name')?.textContent||'').trim().toUpperCase()}
  function installMenus(){
    addStyles();
    const drop=document.querySelector('.app-topbar-dropdown'); const nav=document.querySelector('.app-nav');
    const logout=drop&&[...drop.children].find(e=>/log\s*out|logout|keluar/i.test(e.textContent||''));
    add(drop,'hotfix-my-absen','My Absen',openMyAbsen,logout); add(drop,'hotfix-my-payroll','My Payroll',openMyPayroll,logout);
    const role=visibleRole(); if(['ADMIN','AKUNTAN','SUPER ADMIN'].includes(role)) add(nav,'hotfix-payroll','Payroll',openPayroll);
    const probableSuper=role==='SUPER ADMIN'||(role==='ADMIN'&&visibleName()==='ADMIN'); if(probableSuper) add(nav,'hotfix-admin-config','Konfigurasi Admin',openConfig);
    ensureSession().then(s=>{const r=String(s?.user?.role||'').toUpperCase();if(['ADMIN','AKUNTAN','SUPER ADMIN'].includes(r))add(nav,'hotfix-payroll','Payroll',openPayroll);if(r==='SUPER ADMIN'||s?.user?.is_super_admin===true)add(nav,'hotfix-admin-config','Konfigurasi Admin',openConfig)}).catch(()=>{});
  }
  document.addEventListener('DOMContentLoaded',installMenus); installMenus(); setInterval(installMenus,1000);
})();