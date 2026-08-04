import { releaseOperationsService } from '../../services/operations-v2-service.js';
import { renderLoading, renderEmpty, renderError } from '../../components/ui-state.js';
import { renderResponsiveDataList } from '../../components/responsive-data-list.js';

const role=()=>String(window.AppState?.user?.Role||window.AppState?.user?.role||'').toUpperCase().replace(/_/g,' ');
const isSuper=()=>role()==='SUPER ADMIN';

export async function renderReleaseOperationsPage(container){
  if(!container)return;
  renderLoading(container,'Memuat kontrol release…');
  try{
    const [flags,payroll,access]=await Promise.all([
      releaseOperationsService.listFeatureFlags(),
      releaseOperationsService.listPayrollWorkflow(),
      releaseOperationsService.listUserAccess()
    ]);
    container.innerHTML=`<section class="feature-page"><header class="feature-header"><div><h2>Release 11–15</h2><p>Enforcement presensi, payroll, privasi, dan akses pengguna.</p></div></header><div class="feature-tabs" role="tablist" aria-label="Release operations"><button type="button" class="is-active" role="tab" aria-selected="true" data-release-tab="flags">Feature Flags</button><button type="button" role="tab" aria-selected="false" data-release-tab="payroll">Payroll</button><button type="button" role="tab" aria-selected="false" data-release-tab="access">Akses User</button><button type="button" role="tab" aria-selected="false" data-release-tab="privacy">Audit Privasi</button></div><div id="release-workspace" class="feature-page__body" role="tabpanel"></div></section>`;
    const workspace=container.querySelector('#release-workspace');
    const showFlags=()=>flags.length?renderResponsiveDataList(workspace,{rows:flags,columns:[{key:'Flag_Key',label:'Flag'},{key:'Enabled',label:'Aktif',value:r=>r.Enabled?'Ya':'Tidak'},{key:'Scope_SPPG',label:'Scope'},{key:'Updated_At',label:'Diperbarui'}],onSelect:isSuper()?async row=>{if(!confirm(`${row.Enabled?'Nonaktifkan':'Aktifkan'} ${row.Flag_Key}?`))return;await releaseOperationsService.setFeatureFlag(row.Flag_Key,!row.Enabled,{scopeSppg:row.Scope_SPPG,config:row.Config});showFlags();}:undefined}):renderEmpty(workspace,'Belum ada feature flag.');
    const showPayroll=()=>payroll.length?renderResponsiveDataList(workspace,{rows:payroll,columns:[{key:'Slip_ID',label:'Slip'},{key:'ID_User',label:'User'},{key:'Status',label:'Status'},{key:'Version',label:'Versi'},{key:'Updated_At',label:'Diperbarui'}]}):renderEmpty(workspace,'Belum ada workflow payroll V2.');
    const showAccess=()=>access.length?renderResponsiveDataList(workspace,{rows:access,columns:[{key:'ID_User',label:'User'},{key:'SPPG',label:'SPPG'},{key:'Role_Scope',label:'Role Scope'},{key:'Active',label:'Aktif',value:r=>r.Active?'Ya':'Tidak'},{key:'Valid_Until',label:'Berlaku Sampai'}]}):renderEmpty(workspace,'Belum ada mapping akses V2.');
    const showPrivacy=async()=>{if(!isSuper())return renderEmpty(workspace,'Audit privasi hanya untuk Super Admin.');renderLoading(workspace,'Memuat audit privasi…');try{const rows=await releaseOperationsService.listComplaintPrivacyLog();rows.length?renderResponsiveDataList(workspace,{rows,columns:[{key:'Complaint_ID',label:'Pengaduan'},{key:'Actor_ID',label:'Aktor'},{key:'Action',label:'Aksi'},{key:'Reason',label:'Alasan'},{key:'Created_At',label:'Waktu'}]}):renderEmpty(workspace,'Belum ada akses identitas anonim.');}catch(error){renderError(workspace,error,{onRetry:showPrivacy});}};
    const handlers={flags:showFlags,payroll:showPayroll,access:showAccess,privacy:showPrivacy};
    const activate=(button)=>{container.querySelectorAll('[data-release-tab]').forEach(item=>{const active=item===button;item.classList.toggle('is-active',active);item.setAttribute('aria-selected',String(active));});workspace.replaceChildren();handlers[button.dataset.releaseTab]?.();};
    container.querySelectorAll('[data-release-tab]').forEach(button=>button.addEventListener('click',()=>activate(button)));
    showFlags();
  }catch(error){renderError(container,error,{onRetry:()=>renderReleaseOperationsPage(container)});}
}
