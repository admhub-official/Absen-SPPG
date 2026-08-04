import {apiClient} from './api-client.js';
const call=(action,payload={})=>apiClient.call('PlatformOps',{action,...payload});
export const platformOpsService=Object.freeze({readiness:()=>call('readiness'),privacyRequest:(type,reason)=>call('privacyRequest',{type,reason}),retentionPolicies:()=>call('retentionPolicies'),purgePreview:()=>call('purgePreview')});