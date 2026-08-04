import { apiCall } from './api-client.js';
const call=(action,payload={})=>apiCall('WorkforceOps',{action,...payload});
export const workforceOpsService=Object.freeze({
 listNotifications:(options={})=>call('listNotifications',options),
 markNotificationRead:(notificationId)=>call('markNotificationRead',{notificationId}),
 getPreferences:()=>call('notificationPreferences'),
 savePreferences:(options)=>call('notificationPreferences',{save:true,...options}),
 assignShift:(payload)=>call('assignShift',payload),
 listShiftAssignments:(filters={})=>call('listShiftAssignments',filters),
 analyticsSummary:(filters)=>call('analyticsSummary',filters),
 scheduleReport:(payload)=>call('scheduleReport',payload)
});
