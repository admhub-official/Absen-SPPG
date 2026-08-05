import {apiClient} from './api-client.js';
const call=(name)=>(payload={})=>apiClient.call(name,payload);
export const attendanceService=Object.freeze({mine:call('getAbsensiSaya'),record:call('recordAbsensiSelf'),summary:call('getAttendanceSummary')});
export const userService=Object.freeze({profile:call('getProfile'),updateProfile:call('updateProfile'),changePassword:call('changePassword'),refreshFace:call('updateFaceDescriptor')});
export const deviceService=Object.freeze({list:()=>window.getMyAttendanceDevices?.()||[],revoke:(deviceId)=>window.revokeMyAttendanceDevice?.(deviceId),queue:(status='PENDING')=>window.getAttendanceDeviceReviewQueue?.(status),review:(deviceId,status,reason)=>window.reviewAttendanceDevice?.(deviceId,status,reason)});
export const complaintService=Object.freeze({list:call('getPengaduan'),create:call('createPengaduan'),detail:call('getPengaduanDetail'),reply:call('replyPengaduan'),markRead:call('markPengaduanRead')});
async function listPayrollSlips({status='DITERBITKAN',page=1,pageSize=30}={}){
  const response=await fetch('https://szwwpnbbsmjsbzzcecyj.supabase.co/functions/v1/PayrollListPage',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({token:localStorage.getItem('auth_token')||'',status,page,pageSize})
  });
  const payload=await response.json().catch(()=>({success:false,error:'Respons daftar payroll tidak valid.'}));
  if(!response.ok||payload?.success===false)throw new Error(payload?.error||'Gagal mengambil daftar slip payroll.');
  return payload;
}
export const payrollService=Object.freeze({history:call('getPayrollHistory'),list:listPayrollSlips,detail:call('getPayrollSlipDetail'),issue:call('issuePayrollSlips'),sign:call('signPayrollSlip'),download:call('getPayrollDownloadUrl')});