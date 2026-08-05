const PROJECT_URL='https://szwwpnbbsmjsbzzcecyj.supabase.co';
const LIST_ENDPOINT=`${PROJECT_URL}/functions/v1/PayrollListPage`;
const PAGE_SIZE=30;
const historyState={page:1,installed:false};

const esc=(value)=>String(value??'').replace(/[&<>\'\"]/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const rupiah=(value)=>`Rp ${Math.round(Number(value)||0).toLocaleString('id-ID')}`;
const tanggal=(value)=>{
  if(!value)return '-';
  const parsed=new Date(value);
  return Number.isNaN(parsed.getTime())?String(value):new Intl.DateTimeFormat('id-ID',{day:'2-digit',month:'short',year:'numeric'}).format(parsed);
};
const errorText=(error)=>{
  if(typeof error==='string')return error;
  if(error?.message)return String(error.message);
  try{return JSON.stringify(error);}catch{return 'Gagal memuat riwayat slip.';}
};

async function fetchHistoryPage(page){
  const response=await fetch(LIST_ENDPOINT,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({token:localStorage.getItem('auth_token')||'',status:'HISTORY',page,pageSize:PAGE_SIZE})
  });
  const payload=await response.json().catch(()=>({success:false,error:'Respons daftar slip tidak valid.'}));
  if(!response.ok||payload?.success===false)throw new Error(errorText(payload?.error||`HTTP ${response.status}`));
  return payload;
}

function pageNumbers(current,total){
  if(total<=1)return [1];
  let start=Math.max(1,current-2);
  let end=Math.min(total,start+4);
  start=Math.max(1,end-4);
  return Array.from({length:end-start+1},(_,index)=>start+index);
}

function removeUnusedPayrollUi(){
  ['payroll-tab-draft','payroll-panel-draft','payroll-tab-ttd-massal','payroll-panel-ttd-massal','modal-ttd-massal'].forEach((id)=>document.getElementById(id)?.remove());
}

function ensureHistoryMarkup(){
  removeUnusedPayrollUi();
  const view=document.getElementById('view-admin-payroll');
  const tabs=view?.querySelector('.payroll-tabs');
  const historyPanel=document.getElementById('payroll-panel-history');
  if(!view||!tabs||!historyPanel)return false;

  tabs.querySelectorAll('.payroll-tab').forEach((button)=>{
    if(button.id==='payroll-tab-publish')button.dataset.payrollTab='publish';
    if(button.id==='payroll-tab-history')button.dataset.payrollTab='history';
  });

  const historyTable=historyPanel.querySelector('table');
  if(historyTable&&!historyTable.dataset.historyUpdated){
    historyTable.dataset.historyUpdated='true';
    historyTable.querySelector('thead').innerHTML='<tr><th>No.</th><th><span class="desktop-only">Karyawan</span><span class="mobile-only">User</span></th><th>Periode</th><th>SPPG</th><th>Total</th><th>Status</th><th>PDF</th></tr>';
    document.getElementById('admin-payroll-history-body')?.replaceChildren();
  }
  if(!document.getElementById('admin-payroll-history-pagination')){
    const pagination=document.createElement('div');
    pagination.className='pagination';
    pagination.id='admin-payroll-history-pagination';
    historyPanel.querySelector('.admin-card')?.appendChild(pagination);
  }
  if(!document.getElementById('payroll-history-only-style')){
    const style=document.createElement('style');
    style.id='payroll-history-only-style';
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
      .status-waiting-recipient{background:#fff7ed;color:#9a3412;border:1px solid #fed7aa}
      @media(max-width:760px){#view-admin-payroll .pagination{align-items:stretch}.pagination-info{width:100%;text-align:center}.pagination-btns{justify-content:center}.payroll-history-table th,.payroll-history-table td{font-size:.65rem;padding:.48rem .35rem}.payroll-history-table td:first-child,.payroll-history-table th:first-child{width:36px}}
    `;
    document.head.appendChild(style);
  }
  return true;
}

function switchPanel(tab){
  document.querySelectorAll('#view-admin-payroll [data-payroll-tab]').forEach((button)=>{
    const active=button.dataset.payrollTab===tab;
    button.classList.toggle('active',active);
    button.setAttribute('aria-selected',String(active));
    button.tabIndex=active?0:-1;
  });
  ['publish','history'].forEach((name)=>{
    const panel=document.getElementById(`payroll-panel-${name}`);
    if(!panel)return;
    const hidden=name!==tab;
    panel.hidden=hidden;
    panel.classList.toggle('hidden',hidden);
    panel.setAttribute('aria-hidden',String(hidden));
  });
}

function renderPagination(data){
  const current=Number(data.page||1);
  const totalPages=Math.max(1,Number(data.totalPages||0));
  const total=Number(data.total||0);
  const first=total?((current-1)*PAGE_SIZE)+1:0;
  const last=Math.min(current*PAGE_SIZE,total);
  const host=document.getElementById('admin-payroll-history-pagination');
  if(!host)return;
  host.innerHTML=`<span class="pagination-info">Menampilkan ${first}–${last} dari ${total} slip · Halaman ${current} dari ${totalPages}</span><div class="pagination-btns">
    <button class="pagination-btn" data-history-page="${current-1}" ${current<=1?'disabled':''}>Sebelumnya</button>
    ${pageNumbers(current,totalPages).map((page)=>`<button class="pagination-btn ${page===current?'active':''}" data-history-page="${page}" ${page===current?'aria-current="page"':''}>${page}</button>`).join('')}
    <button class="pagination-btn" data-history-page="${current+1}" ${current>=totalPages?'disabled':''}>Berikutnya</button>
  </div>`;
  host.querySelectorAll('[data-history-page]').forEach((button)=>button.addEventListener('click',()=>{
    const page=Number(button.dataset.historyPage);
    if(page<1||page>totalPages||page===current)return;
    historyState.page=page;
    loadHistory(page);
  }));
}

async function downloadSlip(idSlip,button){
  if(typeof window.apiCall!=='function')return;
  const original=button.innerHTML;
  button.disabled=true;button.textContent='Memuat…';
  try{
    const result=await window.apiCall('getSlipDownloadUrl',{token:localStorage.getItem('auth_token')||'',idSlip});
    if(!result?.url)throw new Error('Tautan PDF tidak tersedia.');
    const anchor=document.createElement('a');anchor.href=result.url;anchor.download=result.filename||`slip-${idSlip}.pdf`;anchor.rel='noopener';document.body.appendChild(anchor);anchor.click();anchor.remove();
  }catch(error){
    const message=errorText(error);
    if(typeof window.showAlert==='function')window.showAlert(message,'error');else alert(message);
  }finally{button.disabled=false;button.innerHTML=original;}
}

async function loadHistory(page=1){
  if(!ensureHistoryMarkup())return;
  const body=document.getElementById('admin-payroll-history-body');
  if(!body)return;
  body.innerHTML='<tr><td colspan="7"><div class="loading-state"><span class="spinner"></span>Memuat riwayat slip...</div></td></tr>';
  try{
    const data=await fetchHistoryPage(page);
    const rows=Array.isArray(data.items)?data.items:[];
    const first=rows.length?((Number(data.page||1)-1)*PAGE_SIZE)+1:0;
    body.innerHTML=rows.length?rows.map((row,index)=>{
      const waiting=row.Status_Penerbitan==='MENUNGGU_TTD_PENERIMA';
      const statusText=waiting?'Menunggu TTD Penerima':'Diterbitkan';
      const pdf=waiting
        ? '<button class="btn btn-secondary btn-sm" type="button" disabled>Menunggu TTD</button>'
        : row.PDF_Storage_Path?`<button class="btn btn-secondary btn-sm" type="button" data-download-slip="${esc(row.ID_Slip)}">Unduh</button>`:'Belum tersedia';
      return `<tr>
        <td data-label="No.">${first+index}</td>
        <td data-label="Karyawan"><strong>${esc(row.Nama_Lengkap||'-')}</strong><small>${esc(row.Jabatan_Divisi||'-')}</small></td>
        <td data-label="Periode">${tanggal(row.Periode_Mulai)} – ${tanggal(row.Periode_Akhir)}</td>
        <td data-label="SPPG">${esc(row.SPPG||'-')}</td>
        <td data-label="Total">${rupiah(row.Total_Gaji_Diterima)}</td>
        <td data-label="Status"><span class="status-badge ${waiting?'status-waiting-recipient':''}">${statusText}</span></td>
        <td data-label="PDF">${pdf}</td>
      </tr>`;
    }).join(''):'<tr><td colspan="7"><div class="belum-absen-empty">Belum ada riwayat slip.</div></td></tr>';
    body.querySelectorAll('[data-download-slip]').forEach((button)=>button.addEventListener('click',()=>downloadSlip(button.dataset.downloadSlip,button)));
    renderPagination(data);
  }catch(error){
    body.innerHTML=`<tr><td colspan="7"><div class="belum-absen-empty">${esc(errorText(error))}</div></td></tr>`;
    const pagination=document.getElementById('admin-payroll-history-pagination');if(pagination)pagination.innerHTML='';
  }
}

function installHistory(){
  if(historyState.installed||!ensureHistoryMarkup())return;
  historyState.installed=true;
  document.querySelector('#view-admin-payroll .payroll-tabs')?.addEventListener('click',(event)=>{
    const button=event.target.closest('[data-payroll-tab]');
    if(!button||!['publish','history'].includes(button.dataset.payrollTab))return;
    event.preventDefault();event.stopImmediatePropagation();
    switchPanel(button.dataset.payrollTab);
    if(button.dataset.payrollTab==='history')loadHistory(historyState.page);
  },true);
  document.getElementById('btn-refresh-payroll-history')?.addEventListener('click',(event)=>{event.stopImmediatePropagation();loadHistory(historyState.page);},true);
  window.loadAdminPayrollHistory=()=>loadHistory(historyState.page);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(installHistory,0),{once:true});
else setTimeout(installHistory,0);
const observer=new MutationObserver(()=>{removeUnusedPayrollUi();if(!historyState.installed)installHistory();});
observer.observe(document.documentElement,{childList:true,subtree:true});
