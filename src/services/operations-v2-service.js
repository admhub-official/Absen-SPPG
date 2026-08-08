import { ApiClientError } from './api-client.js';

async function call(action, payload = {}) {
  const config = window.ABSEN_SUPABASE_CONFIG || {};
  const token = window.HadirlySessionContext?.token?.() || '';
  if (!token) throw new ApiClientError('Sesi login tidak tersedia.', { code: 'SESSION_REQUIRED' });
  const response = await fetch(`${config.projectUrl}/functions/v1/OperationsV2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, token, ...payload })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.success === false) throw new ApiClientError(body?.message || 'Layanan operasi tidak tersedia.', { code: body?.code, requestId: body?.requestId, status: response.status, details: body?.details });
  return body.result;
}

export const releaseOperationsService = Object.freeze({
  listFeatureFlags: () => call('listFeatureFlags'),
  setFeatureFlag: (key, enabled, options = {}) => call('setFeatureFlag', { key, enabled, ...options }),
  transitionPayroll: (slipId, userId, toStatus, options = {}) => call('transitionPayroll', { slipId, userId, toStatus, ...options }),
  listPayrollWorkflow: (filters = {}) => call('listPayrollWorkflow', filters),
  logComplaintIdentityAccess: (complaintId, reason, requestId) => call('logComplaintIdentityAccess', { complaintId, reason, requestId }),
  listComplaintPrivacyLog: () => call('listComplaintPrivacyLog'),
  listUserAccess: (filters = {}) => call('listUserAccess', filters),
  grantUserAccess: (userId, sppg, options = {}) => call('grantUserAccess', { userId, sppg, ...options }),
  recordUserSecurityEvent: (userId, eventType, options = {}) => call('recordUserSecurityEvent', { userId, eventType, ...options })
});
