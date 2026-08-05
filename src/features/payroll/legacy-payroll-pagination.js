const PROJECT_URL='https://szwwpnbbsmjsbzzcecyj.supabase.co';
const LIST_ENDPOINT=`${PROJECT_URL}/functions/v1/PayrollListPage`;
const PAGE_SIZE=30;
const payrollState={tab:'publish',historyPage:1,draftPage:1,installed:false};

const esc=(value)=>String(value??'').replace(/[&<>'"]/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const rupiah=(value)=>`Rp ${Math.round(Number(value)||0).toLocaleString('id-ID')}`;
const tanggal=(value)=>{
  if(!value)return '-';
  const parsed=new Date(value);
  return Number.isNaN(parsed.getTime())?String(value):new Intl.DateTimeFormat('id-ID',{day:'2-digit',month:'short',year:'numeric'}).format(parsed);
};

async function fetchSlipPage(status,page){
  const response=await fetch(LIST_ENDPOINT,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({token:localStorage.getItem('auth_token')||'',status,page,pageSize:PAGE_SIZE})
  });
  const payload=await response.json().catch(()=>({success:false,error:'Respons daftar slip tidak valid.'}));
  if(!response.ok||payload?.success===false)throw new Error(payload?.error||'Gagal memuat daftar slip.');
  return payload;
}

function pageNumbers(current,total){
  if(total<=1)return [1];
  let start=Math.max(1,current-2);
  let end=Math.min(total,start+4);
  start=Math.max(1,end-4);
  return Array.from({length:end-start+1},(_,index)=>start+index);
}

function ensureLegacyPayrollMarkup(){
  const tabs=document.querySelector('#view-admin-payroll .payroll-tabs');
  const historyPanel=document.getElementById('payroll-panel-history');
  if(!tabs||!historyPanel)return false;

  let draftTab=document.getElementById('payroll-tab-draft');
  if(!draftTab){
    draftTab=document.createElement('button');
    draftTab.className='payroll-tab';
    draftTab.id='payroll-tab-draft';
    draftTab.type='button';
    draftTab.setAttribute('role','tab');
    draftTab.setAttribute('aria-selected','false');
    draftTab.setAttribute('aria-controls','payroll-panel-draft');
    draftTab.tabIndex=-1;
    draftTab.dataset.payrollTab='draft';
    draftTab.textContent='Draft';
    tabs.appendChild(draftTab);
  }

  let draftPanel=document.getElementById('payroll-panel-draft');
  if(!draftPanel){
    draftPanel=document.createElement('section');
    draftPanel.id='payroll-panel-draft';
    draftPanel.className='payroll-tab-panel hidden';
    draftPanel.hidden=true;
    draftPanel.setAttribute('role','tabpanel');
    draftPanel.setAttribute('aria-labelledby','payroll-tab-draft');
    draftPanel.innerHTML=`<div class="admin-card">
      <div class="admin-card-header payroll-history-head"><div><div class="admin-card-title">Slip Draft</div><div class="helper-text">Slip yang belum diterbitkan. Maksimal 30 data pada setiap halaman.</div></div><button class="btn btn-secondary btn-sm" id="btn-refresh-payroll-draft" type="button">Muat Ulang</button></div>
      <div class="data-table-wrap payroll-responsive-table mobile-card-table"><table class="data-table payroll-history-table"><thead><tr><th>No.</th><th><span class="desktop-only">Karyawan</span><span class="mobile-only">User</span></th><th>Periode</th><th>SPPG</th><th>Total</th><th>Status</th><th>Dibuat</th></tr></thead><tbody id="admin-payroll-draft-body"><tr><td colspan="7"><div class="loading-state"><span class="spinner"></span>Memuat slip draft...</div></td></tr></tbody></table></div>
      <div class="pagination" id="admin-payroll-draft-pagination"></div>
    </div>`;
    historyPanel.insertAdjacentElement('afterend',draftPanel);
  }

  const historyTable=historyPanel.querySelector('table');
  if(historyTable&&!historyTable.dataset.paginationUpdated){
    historyTable.dataset.paginationUpdated='true';
    historyTable.querySelector('thead').innerHTML='<tr><th>No.</th><th><span class="desktop-only">Karyawan</span><span class="mobile-only">User</span></th><th>Periode</th><th>SPPG</th><th>Total</th><th>Status</th><th>PDF</th></tr>';
    const oldBody=document.getElementById('admin-payroll-history-body');
    if(oldBody)oldBody.innerHTML='<tr><td colspan="7"><div class="loading-state"><span class="spinner"></span>Memuat riwayat slip...</div></td></tr>';
    if(!document.getElementById('admin-payroll-history-pagination')){
      const pagination=document.createElement('div');
      pagination.className='pagination';
      pagination.id='admin-payroll-history-pagination';
      historyPanel.querySelector('.admin-card')?.appendChild(pagination);
    }
  }

  if(!document.getElementById('legacy-payroll-pagination-style')){
    const style=document.createElement('style');
    style.id='legacy-payroll-pagination-style';
    style.textContent=`
      #view-admin-payroll .payroll-history-table td:first-child,#view-admin-payroll .payroll-history-table th:first-child{width:58px;text-align:center}
      #view-admin-payroll .payroll-history-table td:nth-child(2) strong{display:block}
      #view-admin-payroll .payroll-history-table td:nth-child(2) small{display:block;color:var(--text-muted);margin-top:.2rem}
      #view-admin-payroll .pagination{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:1rem;flex-wrap:wrap;border-top:1px solid var(--border)}
      #view-admin-payroll .pagination-info{font-size:.78rem;color:var(--text-muted)}
      #view-admin-payroll .pagination-btns{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap}
      #view-admin-payroll .pagination-btn{min-width:36px;height:36px;padding:0 .65rem;border:1px solid var(--border);background:var(--surface);border-radius:.55rem;color:var(--text);cursor:pointer;font-weight:600}
      #view-admin-payroll .pagination-btn.active{background:var(--primary);border-color:var(--primary);color:#fff}
      #view-admin-payroll .pagination-btn:disabled{opacity:.45;cursor:not-allowed}
      @media(max-width:760px){#view-admin-payroll .pagination{align-items:stretch}.pagination-info{width:100%;text-align:center}.pagination-btns{justify-content:center}.payroll-history-table th,.payroll-history-table td{font-size:.65rem;padding:.48rem .35rem}.payroll-history-table td:first-child,.payroll-history-table th:first-child{width:36px}}
    `;
    document.head.appendChild(style);
  }
  return true;
}

function switchPanel(tab){
  payrollState.tab=tab;
  document.querySelectorAll('#view-admin-payroll [data-payroll-tab]').forEach((button)=>{
    const active=button.dataset.payrollTab===tab;
    button.classList.toggle('active',active);
    button.setAttribute('aria-selected',String(active));
    button.tabIndex=active?0:-1;
  });
  ['publish','history','draft'].forEach((name)=>{
    const panel=document.getElementById(`payroll-panel-${name}`);
    if(!panel)return;
    const hidden=name!==tab;
    panel.hidden=hidden;
    panel.classList.toggle('hidden',hidden);
    panel.setAttribute('aria-hidden',String(hidden));
  });
}

function renderPagination(kind,data){
  const current=Number(data.page||1);
  const totalPages=Number(data.totalPages||0);
  const total=Number(data.total||0);
  const first=total?((current-1)*PAGE_SIZE)+1:0;
  const last=Math.min(current*PAGE_SIZE,total);
  const host=document.getElementById(`admin-payroll-${kind}-pagination`);
  if(!host)return;
  host.innerHTML=`<span class="pagination-info">Menampilkan ${first}–${last} dari ${total} slip · Halaman ${current} dari ${Math.max(totalPages,1)}</span><div class="pagination-btns">
    <button class="pagination-btn" data-payroll-page="${current-1}" ${current<=1?'disabled':''}>Sebelumnya</button>
    ${pageNumbers(current,Math.max(totalPages,1)).map((page)=>`<button class="pagination-btn ${page===current?'active':''}" data-payroll-page="${page}" ${page===current?'aria-current="page"':''}>${page}</button>`).join('')}
    <button class="pagination-btn" data-payroll-page="${current+1}" ${current>=totalPages?'disabled':''}>Berikutnya</button>
  </div>`;
  host.querySelectorAll('[data-payroll-page]').forEach((button)=>button.addEventListener('click',()=>{
    const page=Number(button.dataset.payrollPage);
    if(page<1||page>totalPages||page===current)return;
    if(kind==='history')payrollState.historyPage=page;else payrollState.draftPage=page;
    loadLegacySlipList(kind,page);
  }));
}

async function downloadSlip(idSlip,button){
  if(typeof window.apiCall!=='function')return;
  const original=button.innerHTML;
  button.disabled=true;
  button.textContent='Memuat…';
  try{
    const result=await window.apiCall('getSlipDownloadUrl',{token:localStorage.getItem('auth_token')||'',idSlip});
    if(!result?.url)throw new Error('Tautan PDF tidak tersedia.');
    const anchor=document.createElement('a');anchor.href=result.url;anchor.download=result.filename||`slip-${idSlip}.pdf`;anchor.rel='noopener';document.body.appendChild(anchor);anchor.click();anchor.remove();
  }catch(error){
    if(typeof window.showAlert==='function')window.showAlert(error?.message||'Gagal mengunduh PDF','error');
    else alert(error?.message||'Gagal mengunduh PDF');
  }finally{button.disabled=false;button.innerHTML=original;}
}

async function loadLegacySlipList(kind,page=1){
  ensureLegacyPayrollMarkup();
  const isDraft=kind==='draft';
  const body=document.getElementById(isDraft?'admin-payroll-draft-body':'admin-payroll-history-body');
  if(!body)return;
  body.innerHTML=`<tr><td colspan="7"><div class="loading-state"><span class="spinner"></span>Memuat ${isDraft?'slip draft':'riwayat slip'}...</div></td></tr>`;
  try{
    const data=await fetchSlipPage(isDraft?'DRAFT':'DITERBITKAN',page);
    const rows=Array.isArray(data.items)?data.items:[];
    const first=rows.length?((Number(data.page||1)-1)*PAGE_SIZE)+1:0;
    if(!rows.length){
      body.innerHTML=`<tr><td colspan="7"><div class="belum-absen-empty">${isDraft?'Tidak ada slip berstatus DRAFT.':'Belum ada slip yang diterbitkan.'}</div></td></tr>`;
    }else{
      body.innerHTML=rows.map((row,index)=>`<tr>
        <td data-label="No.">${first+index}</td>
        <td data-label="Karyawan"><strong>${esc(row.Nama_Lengkap||'-')}</strong><small>${esc(row.Jabatan_Divisi||'-')}</small></td>
        <td data-label="Periode">${tanggal(row.Periode_Mulai)} – ${tanggal(row.Periode_Akhir)}</td>
        <td data-label="SPPG">${esc(row.SPPG||'-')}</td>
        <td data-label="Total">${rupiah(row.Total_Gaji_Diterima)}</td>
        <td data-label="Status"><span class="status-badge">${esc(row.Status_Penerbitan||'-')}</span></td>
        <td data-label="${isDraft?'Dibuat':'PDF'}">${isDraft?tanggal(row.Created_At):(row.PDF_Storage_Path?`<button class="btn btn-secondary btn-sm" type="button" data-download-slip="${esc(row.ID_Slip)}">Unduh</button>`:'Belum tersedia')}</td>
      </tr>`).join('');
      body.querySelectorAll('[data-download-slip]').forEach((button)=>button.addEventListener('click',()=>downloadSlip(button.dataset.downloadSlip,button)));
    }
    renderPagination(kind,data);
  }catch(error){
    body.innerHTML=`<tr><td colspan="7"><div class="belum-absen-empty">${esc(error?.message||'Gagal memuat data payroll.')}</div></td></tr>`;
  }
}

function installLegacyPayrollPatch(){
  if(payrollState.installed||!ensureLegacyPayrollMarkup())return;
  payrollState.installed=true;
  const tabs=document.querySelector('#view-admin-payroll .payroll-tabs');
  tabs?.addEventListener('click',(event)=>{
    const button=event.target.closest('[data-payroll-tab]');
    if(!button)return;
    const tab=button.dataset.payrollTab;
    if(!['publish','history','draft'].includes(tab))return;
    event.preventDefault();
    event.stopImmediatePropagation();
    switchPanel(tab);
    if(tab==='history')loadLegacySlipList('history',payrollState.historyPage);
    if(tab==='draft')loadLegacySlipList('draft',payrollState.draftPage);
  },true);
  document.getElementById('btn-refresh-payroll-history')?.addEventListener('click',(event)=>{event.stopImmediatePropagation();loadLegacySlipList('history',payrollState.historyPage);},true);
  document.getElementById('btn-refresh-payroll-draft')?.addEventListener('click',()=>loadLegacySlipList('draft',payrollState.draftPage));
  window.loadAdminPayrollHistory=()=>loadLegacySlipList('history',payrollState.historyPage);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(installLegacyPayrollPatch,0),{once:true});
else setTimeout(installLegacyPayrollPatch,0);

const observer=new MutationObserver(()=>{if(!payrollState.installed)installLegacyPayrollPatch();});
observer.observe(document.documentElement,{childList:true,subtree:true});
