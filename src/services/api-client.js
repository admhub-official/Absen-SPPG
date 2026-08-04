export class ApiClientError extends Error{constructor(message,{code,requestId,status,details}={}){super(message);this.name='ApiClientError';this.code=code;this.requestId=requestId;this.status=status;this.details=details;}}
export function createApiClient(){return Object.freeze({async call(action,payload={}){if(typeof window.apiCall!=='function')throw new ApiClientError('API aplikasi belum siap.',{code:'API_NOT_READY'});try{return await window.apiCall(action,payload);}catch(error){if(error instanceof ApiClientError)throw error;throw new ApiClientError(error?.message||'Permintaan gagal.',{code:error?.code,requestId:error?.requestId,status:error?.status,details:error?.details});}},token(){return localStorage.getItem('auth_token')||'';}});}
export const apiClient=createApiClient();
// Compatibility export untuk modul lama yang belum termigrasi penuh.
export const apiCall=(action,payload={})=>apiClient.call(action,payload);
