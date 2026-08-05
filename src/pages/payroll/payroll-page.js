import {payrollService} from '../../services/domain-services.js';
import {renderLoading,renderEmpty,renderError} from '../../components/ui-state.js';

const PAGE_SIZE=30;
const money=(value)=>`Rp ${Math.round(Number(value)||0).toLocaleString('id-ID')}`;
const date=(value)=>value?new Intl.DateTimeFormat('id-ID',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(value)):'-';
const escapeHtml=(value)=>String(value??'').replace(/[&<>'"]/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));

export function createPayrollPage({root}){
  let tab='issue';
  const pages={history:1,draft:1};
  const state={history:null,draft:null};

  function shell(){
    root.innerHTML=`<section class="app-feature-page payroll-page">
      <header>
        <div><h2>Payroll</h2><p>Kelola penerbitan, riwayat slip, dan slip yang masih berstatus draft.</p></div>
        <div class="app-tabs" role="tablist" aria-label="Menu Payroll">
          <button type="button" data-payroll-tab="issue">Penerbitan Slip</button>
          <button type="button" data-payroll-tab="history">Riwayat Slip Diterbitkan</button>
          <button type="button" data-payroll-tab="draft">Draft</button>
        </div>
      </header>
      <div data-payroll-content></div>
    </section>`;
    root.querySelectorAll('[data-payroll-tab]').forEach((button)=>button.addEventListener('click',()=>selectTab(button.dataset.payrollTab)));
  }

  function markActive(){
    root.querySelectorAll('[data-payroll-tab]').forEach((button)=>{
      const active=button.dataset.payrollTab===tab;
      button.classList.toggle('active',active);
      button.setAttribute('aria-selected',String(active));
    });
  }

  async function selectTab(next){
    tab=next;
    markActive();
    if(tab==='issue')return renderIssue();
    await loadList(tab,pages[tab]);
  }

  function renderIssue(){
    const target=root.querySelector('[data-payroll-content]');
    target.innerHTML=`<div class="app-empty payroll-issuance-card">
      <strong>Penerbitan Slip</strong>
      <p>Buka form penerbitan untuk memilih periode dan karyawan yang akan dibuatkan slip.</p>
      <button type="button" data-open-legacy-payroll>Buka Penerbitan Slip</button>
    </div>`;
    target.querySelector('[data-open-legacy-payroll]')?.addEventListener('click',()=>window.openPayrollIssuance?.());
  }

  async function loadList(kind,page){
    const target=root.querySelector('[data-payroll-content]');
    renderLoading(target,kind==='draft'?'Memuat slip draft…':'Memuat riwayat slip…');
    try{
      const status=kind==='draft'?'DRAFT':'DITERBITKAN';
      const data=await payrollService.list({status,page,pageSize:PAGE_SIZE});
      state[kind]=data;
      pages[kind]=data.page||page;
      renderList(kind,data);
    }catch(error){
      renderError(target,error,{retry:()=>loadList(kind,pages[kind])});
    }
  }

  function pageButtons(current,total){
    const values=[];
    const start=Math.max(1,current-2);
    const end=Math.min(total,start+4);
    for(let value=Math.max(1,end-4);value<=end;value+=1)values.push(value);
    return values;
  }

  function renderList(kind,data){
    const target=root.querySelector('[data-payroll-content]');
    const rows=Array.isArray(data?.items)?data.items:[];
    const total=Number(data?.total||0);
    const current=Number(data?.page||1);
    const totalPages=Number(data?.totalPages||0);
    const first=total?((current-1)*PAGE_SIZE)+1:0;
    const last=Math.min(current*PAGE_SIZE,total);
    if(!rows.length){
      renderEmpty(target,kind==='draft'?'Tidak ada slip berstatus draft.':'Belum ada slip yang diterbitkan.');
      return;
    }
    const title=kind==='draft'?'Slip Draft':'Riwayat Slip Diterbitkan';
    target.innerHTML=`<section class="payroll-list-panel">
      <div class="payroll-list-summary"><strong>${title}</strong><span>Menampilkan ${first}–${last} dari ${total} slip</span></div>
      <div class="payroll-table-wrap">
        <table class="payroll-table">
          <thead><tr><th>No.</th><th>Nama</th><th>Periode</th><th>Hari</th><th>Total</th><th>Status</th><th>${kind==='draft'?'Dibuat':'Diterbitkan'}</th></tr></thead>
          <tbody>${rows.map((row,index)=>`<tr data-slip-id="${escapeHtml(row.ID_Slip)}" tabindex="0">
            <td>${first+index}</td>
            <td><strong>${escapeHtml(row.Nama_Lengkap||'-')}</strong><small>${escapeHtml(row.Jabatan_Divisi||'-')} · ${escapeHtml(row.SPPG||'-')}</small></td>
            <td>${date(row.Periode_Mulai)} – ${date(row.Periode_Akhir)}</td>
            <td>${Number(row.Jumlah_Hari_Kerja)||0}</td>
            <td>${money(row.Total_Gaji_Diterima)}</td>
            <td><span class="status-badge status-${String(row.Status_Penerbitan||'').toLowerCase()}">${escapeHtml(row.Status_Penerbitan||'-')}</span></td>
            <td>${date(kind==='draft'?row.Created_At:row.Diterbitkan_At)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
      <nav class="payroll-pagination" aria-label="Pagination ${title}">
        <button type="button" data-page="${current-1}" ${current<=1?'disabled':''}>Sebelumnya</button>
        <div class="payroll-page-numbers">${pageButtons(current,totalPages).map((value)=>`<button type="button" data-page="${value}" class="${value===current?'active':''}" aria-current="${value===current?'page':'false'}">${value}</button>`).join('')}</div>
        <button type="button" data-page="${current+1}" ${current>=totalPages?'disabled':''}>Berikutnya</button>
      </nav>
    </section>`;
    target.querySelectorAll('[data-page]').forEach((button)=>button.addEventListener('click',()=>{
      const next=Number(button.dataset.page);
      if(next>=1&&next<=totalPages&&next!==current)loadList(kind,next);
    }));
    target.querySelectorAll('[data-slip-id]').forEach((row)=>{
      const open=()=>window.openPayrollSlipDetail?.(row.dataset.slipId);
      row.addEventListener('click',open);
      row.addEventListener('keydown',(event)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}});
    });
  }

  async function load(){
    shell();
    markActive();
    renderIssue();
  }

  return Object.freeze({load,refresh:()=>tab==='issue'?renderIssue():loadList(tab,pages[tab])});
}
