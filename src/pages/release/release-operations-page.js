import { releaseOperationsService } from '../../services/operations-v2-service.js';
import { renderLoading, renderEmpty, renderError } from '../../components/ui-state.js';
import { renderResponsiveDataList } from '../../components/responsive-data-list.js';

const role=()=>String(window.AppState?.user?.Role||window.AppState?.user?.role||'').toUpperCase().replace(/_/g,' ');
const isSuper=()=>role()==='SUPER ADMIN';
const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function renderReleaseOperationsPage(container){
  if(!container)return;
  renderLoading(container,'Memuat kontrol release…');
  try{
    const [flags,payroll,access]=await Promise.all([
      releaseOperationsService.listFeatureFlags(),
      releaseOperationsService.listPayrollWorkflow(),
      releaseOperationsService.listUserAccess()
    ]);
    container.innerHTML=`<section class="feature-page"><header class="feature-header"><div><h2>Release 11–15</h2><p>Enforcement presensi, workflow payroll, privasi pengaduan, dan akses pengguna.</p></div></header>
      <div class="feature-tabs"><button data-release-tab="flags">Feature Flags</button><button data-release-tab="payroll">Payroll</button><button data-release-tab="access">Akses User</button><button data-release-tab="privacy">Audit Privasi</button></div>
      <div id="release-workspace"></div></section>`;
    const workspace=container.querySelector('#release-workspace');
    const showFlags=()=>{
      if(!flags.length){renderEmpty(workspace,'Belum ada feature flag.');return;}
      renderResponsiveDataList(workspace,flags,[
        {key:'Flag_Key',label:'Flag'},{key:'Enabled',label:'Aktif',render:r=>r.Enabled?'Ya':'Tidak'},{key:'Scope_SPPG',label:'Scope'},{key:'Updated_At',label:'Diperbarui'}
      ],{onRowSelect:isSuper()?async row=>{if(!confirm(`${row.Enabled?'Nonaktifkan':'Aktifkan'} ${row.Flag_Key}?`))return;await releaseOperationsService.setFeatureFlag(row.Flag_Key,!row.Enabled,{scopeSppg:row.Scope_SPPG,config:row.Config});location.reload();}:undefined});
    };
    const showPayroll=()=>payroll.length?renderResponsiveDataList(workspace,payroll,[{key:'Slip_ID',label:'Slip'},{key:'ID_User',label:'User'},{key:'Status',label:'Status'},{key:'Version',label:'Versi'},{key:'Updated_At',label:'Diperbarui'}]):renderEmpty(workspace,'Belum ada workflow payroll V2.');
    const showAccess=()=>access.length?renderResponsiveDataList(workspace,access,[{key:'ID_User',label:'User'},{key:'SPPG',label:'SPPG'},{key:'Role_Scope',label:'Role Scope'},{key:'Active',label:'Aktif',render:r=>r.Active?'Ya':'Tidak'},{key:'Valid_Until',label:'Berlaku Sampai'}]):renderEmpty(workspace,'Belum ada mapping akses V2.');
    const showPrivacy=async()=>{if(!isSuper()){renderEmpty(workspace,'Audit privasi hanya untuk Super Admin.');return;}renderLoading(workspace,'Memuat audit privasi…');const rows=await releaseOperationsService.listComplaintPrivacyLog();rows.length?renderResponsiveDataList(workspace,rows,[{key:'Complaint_ID',label:'Pengaduan'},{key:'Actor_ID',label:'Aktor'},{key:'Action',label:'Aksi'},{key:'Reason',label:'Alasan'},{key:'Created_At',label:'Waktu'}]):renderEmpty(workspace,'Belum ada akses identitas anonim.');};
    const handlers={flags:showFlags,payroll:showPayroll,access:showAccess,privacy:showPrivacy};
    container.querySelectorAll('[data-release-tab]').forEach(button=>button.addEventListener('click',()=>handlers[button.dataset.releaseTab]?.()));
    showFlags();
  }catch(error){renderError(container,error,{retry:()=>renderReleaseOperationsPage(container)});}
}
