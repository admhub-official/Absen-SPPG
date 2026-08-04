import {apiClient} from './api-client.js';
const call=(name)=>(payload={})=>apiClient.call(name,payload);
export const attendanceService=Object.freeze({mine:call('getAbsensiSaya'),record:call('recordAbsensiSelf'),summary:call('getAttendanceSummary')});
export const userService=Object.freeze({profile:call('getProfile'),updateProfile:call('updateProfile'),changePassword:call('changePassword'),refreshFace:call('updateFaceDescriptor')});
export const deviceService=Object.freeze({list:()=>window.getMyAttendanceDevices?.()||[],revoke:(deviceId)=>window.revokeMyAttendanceDevice?.(deviceId),queue:(status='PENDING')=>window.getAttendanceDeviceReviewQueue?.(status),review:(deviceId,status,reason)=>window.reviewAttendanceDevice?.(deviceId,status,reason)});
export const complaintService=Object.freeze({list:call('getPengaduan'),create:call('createPengaduan'),detail:call('getPengaduanDetail'),reply:call('replyPengaduan'),markRead:call('markPengaduanRead')});
export const payrollService=Object.freeze({history:call('getPayrollHistory'),detail:call('getPayrollSlipDetail'),issue:call('issuePayrollSlips'),sign:call('signPayrollSlip'),download:call('getPayrollDownloadUrl')});