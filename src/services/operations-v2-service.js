import { apiCall } from './api-client.js';

const call = (action, payload = {}) => apiCall('OperationsV2', { action, ...payload });

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
