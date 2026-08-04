import { releaseOperationsService } from '../../services/operations-v2-service.js';
import { renderLoading, renderEmpty, renderError } from '../../components/ui-state.js';
import { renderResponsiveDataList } from '../../components/responsive-data-list.js';

const DEVICE_FLAG='ATTENDANCE_DEVICE_ENFORCEMENT';
const role=()=>String(window.AppState?.user?.Role||window.AppState?.user?.role||'').toUpperCase().replace(/_/g,' ');
const isSuper=()=>role()==='SUPER ADMIN';
const listValue=value=>Array.isArray(value)?value.map(String).join(', '):'';
const parseList=value=>[...new Set(String(value||'').split(',').map(item=>item.trim()).filter(Boolean))];

function renderDevicePolicy(workspace,flags,refresh){
  const row=flags.find(item=>item.Flag_Key===DEVICE_FLAG)||{Flag_Key:DEVICE_FLAG,Enabled:false,Config:{}};
  const config=row.Config&&typeof row.Config==='object'?row.Config:{};
  workspace.innerHTML=`<section class="feature-card device-policy-card"><header class="feature-header"><div><h3>Kebijakan Device Trust</h3><p>Atur apakah perangkat harus terdaftar dan dipercaya sebelum digunakan untuk presensi.</p></div><span class="status-badge ${row.Enabled?'is-success':'is-muted'}">${row.Enabled?'Aktif':'Nonaktif'}</span></header><div class="feature-alert ${row.Enabled?'is-warning':'is-info'}"><strong>${row.Enabled?'Perhatian rollout':'Mode aman'}</strong><span>${row.Enabled?'Pastikan perangkat pengguna sudah terdaftar sebelum mewajibkan TRUSTED.':'Login dan presensi tidak diblokir oleh status perangkat.'}</span></div><div class="compact-form-grid"><label class="setting-row"><span><strong>Aktifkan Device Trust</strong><small>Menjalankan kebijakan perangkat pada backend.</small></span><input id="device-policy-enabled" type="checkbox" ${row.Enabled?'checked':''} ${isSuper()?'':'disabled'}></label><label class="setting-row"><span><strong>Wajib berstatus TRUSTED</strong><small>Perangkat PENDING tidak dapat dipakai untuk presensi.</small></span><input id="device-policy-trusted" type="checkbox" ${config.requireTrusted?'checked':''} ${isSuper()?'':'disabled'}></label><label class="setting-row"><span><strong>Tampilkan menu Perangkat Saya saat nonaktif</strong><small>Biarkan pengguna melihat registry walau enforcement belum aktif.</small></span><input id="device-policy-show-menu" type="checkbox" ${config.showMyDevicesWhenDisabled?'checked':''} ${isSuper()?'':'disabled'}></label><label class="form-field"><span>Aktif hanya untuk SPPG</span><input id="device-policy-enabled-sppg" type="text" value="${listValue(config.enabledSppg)}" placeholder="Contoh: DARMARAJA, PAKUALAM" ${isSuper()?'':'disabled'}><small>Kosong berarti mengikuti toggle global untuk semua SPPG.</small></label><label class="form-field"><span>Pengecualian SPPG</span><input id="device-policy-disabled-sppg" type="text" value="${listValue(config.disabledSppg)}" placeholder="SPPG yang belum siap" ${isSuper()?'':'disabled'}></label><label class="form-field feature-span-full"><span>Catatan rollout</span><textarea id="device-policy-note" rows="2" ${isSuper()?'':'disabled'}>${String(config.rolloutNote||'')}</textarea></label></div>${isSuper()?'<div class="feature-actions"><button id="btn-save-device-policy" type="button" class="feature-button feature-button--primary">Simpan Kebijakan</button></div>':''}</section>`;
  workspace.querySelector('#btn-save-device-policy')?.addEventListener('click',async event=>{
    const button=event.currentTarget;
    const enabled=workspace.querySelector('#device-policy-enabled').checked;
    const nextConfig={
      requireTrusted:workspace.querySelector('#device-policy-trusted').checked,
      showMyDevicesWhenDisabled:workspace.querySelector('#device-policy-show-menu').checked,
      enabledSppg:parseList(workspace.querySelector('#device-policy-enabled-sppg').value),
      disabledSppg:parseList(workspace.querySelector('#device-policy-disabled-sppg').value),
      rolloutNote:workspace.querySelector('#device-policy-note').value.trim()
    };
    if(enabled&&!confirm('Aktifkan Device Trust? Pastikan registry perangkat dan proses approval sudah siap.'))return;
    button.disabled=true;button.textContent='Menyimpan…';
    try{await releaseOperationsService.setFeatureFlag(DEVICE_FLAG,enabled,{config:nextConfig});await refresh();}
    catch(error){renderError(workspace,error,{onRetry:refresh});}
  });
}

export async function renderReleaseOperationsPage(container){
  if(!container)return;
  renderLoading(container,'Memuat kontrol release…');
  try{
    let [flags,payroll,access]=await Promise.all([
      releaseOperationsService.listFeatureFlags(),
      releaseOperationsService.listPayrollWorkflow(),
      releaseOperationsService.listUserAccess()
    ]);
    container.innerHTML=`<section class="feature-page"><header class="feature-header"><div><h2>Pengaturan Sistem</h2><p>Kontrol release, keamanan perangkat, payroll, privasi, dan akses pengguna.</p></div></header><div class="feature-tabs" role="tablist" aria-label="Pengaturan sistem"><button type="button" class="is-active" role="tab" aria-selected="true" data-release-tab="device">Device Trust</button><button type="button" role="tab" aria-selected="false" data-release-tab="flags">Feature Flags</button><button type="button" role="tab" aria-selected="false" data-release-tab="payroll">Payroll</button><button type="button" role="tab" aria-selected="false" data-release-tab="access">Akses User</button><button type="button" role="tab" aria-selected="false" data-release-tab="privacy">Audit Privasi</button></div><div id="release-workspace" class="feature-page__body" role="tabpanel"></div></section>`;
    const workspace=container.querySelector('#release-workspace');
    const refreshDevice=async()=>{renderLoading(workspace,'Memuat kebijakan perangkat…');flags=await releaseOperationsService.listFeatureFlags();renderDevicePolicy(workspace,flags,refreshDevice);};
    const showFlags=()=>flags.length?renderResponsiveDataList(workspace,{rows:flags,columns:[{key:'Flag_Key',label:'Flag'},{key:'Enabled',label:'Aktif',value:r=>r.Enabled?'Ya':'Tidak'},{key:'Scope_SPPG',label:'Scope'},{key:'Updated_At',label:'Diperbarui'}],onSelect:isSuper()?async row=>{if(!confirm(`${row.Enabled?'Nonaktifkan':'Aktifkan'} ${row.Flag_Key}?`))return;await releaseOperationsService.setFeatureFlag(row.Flag_Key,!row.Enabled,{scopeSppg:row.Scope_SPPG,config:row.Config});flags=await releaseOperationsService.listFeatureFlags();showFlags();}:undefined}):renderEmpty(workspace,'Belum ada feature flag.');
    const showPayroll=()=>payroll.length?renderResponsiveDataList(workspace,{rows:payroll,columns:[{key:'Slip_ID',label:'Slip'},{key:'ID_User',label:'User'},{key:'Status',label:'Status'},{key:'Version',label:'Versi'},{key:'Updated_At',label:'Diperbarui'}]}):renderEmpty(workspace,'Belum ada workflow payroll V2.');
    const showAccess=()=>access.length?renderResponsiveDataList(workspace,{rows:access,columns:[{key:'ID_User',label:'User'},{key:'SPPG',label:'SPPG'},{key:'Role_Scope',label:'Role Scope'},{key:'Active',label:'Aktif',value:r=>r.Active?'Ya':'Tidak'},{key:'Valid_Until',label:'Berlaku Sampai'}]}):renderEmpty(workspace,'Belum ada mapping akses V2.');
    const showPrivacy=async()=>{if(!isSuper())return renderEmpty(workspace,'Audit privasi hanya untuk Super Admin.');renderLoading(workspace,'Memuat audit privasi…');try{const rows=await releaseOperationsService.listComplaintPrivacyLog();rows.length?renderResponsiveDataList(workspace,{rows,columns:[{key:'Complaint_ID',label:'Pengaduan'},{key:'Actor_ID',label:'Aktor'},{key:'Action',label:'Aksi'},{key:'Reason',label:'Alasan'},{key:'Created_At',label:'Waktu'}]}):renderEmpty(workspace,'Belum ada akses identitas anonim.');}catch(error){renderError(workspace,error,{onRetry:showPrivacy});}};
    const handlers={device:refreshDevice,flags:showFlags,payroll:showPayroll,access:showAccess,privacy:showPrivacy};
    const activate=button=>{container.querySelectorAll('[data-release-tab]').forEach(item=>{const active=item===button;item.classList.toggle('is-active',active);item.setAttribute('aria-selected',String(active));});workspace.replaceChildren();handlers[button.dataset.releaseTab]?.();};
    container.querySelectorAll('[data-release-tab]').forEach(button=>button.addEventListener('click',()=>activate(button)));
    refreshDevice();
  }catch(error){renderError(container,error,{onRetry:()=>renderReleaseOperationsPage(container)});}
}
