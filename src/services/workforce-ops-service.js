import { ApiClientError } from './api-client.js';

const endpoint = () => `${window.ABSEN_SUPABASE_CONFIG?.projectUrl || ''}/functions/v1/WorkforceOps`;
const token = () => window.HadirlySessionContext?.token?.() || localStorage.getItem('auth_token') || '';

async function call(action, payload = {}) {
  const authToken = token();
  if (!authToken) throw new ApiClientError('Sesi login tidak tersedia.', { code: 'SESSION_REQUIRED' });
  const response = await fetch(endpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, token: authToken, ...payload }),
    cache: 'no-store'
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.success === false) {
    throw new ApiClientError(body?.message || 'Layanan operasional SDM tidak tersedia.', {
      code: body?.code,
      requestId: body?.requestId,
      status: response.status,
      details: body?.details
    });
  }
  return body?.result;
}

export const workforceOpsService = Object.freeze({
  listNotifications: (options = {}) => call('listNotifications', options),
  markNotificationRead: (notificationId) => call('markNotificationRead', { notificationId }),
  getPreferences: () => call('notificationPreferences'),
  savePreferences: (options) => call('notificationPreferences', { save: true, ...options }),
  assignShift: (payload) => call('assignShift', payload),
  listShiftAssignments: (filters = {}) => call('listShiftAssignments', filters),
  analyticsSummary: (filters) => call('analyticsSummary', filters),
  scheduleReport: (payload) => call('scheduleReport', payload),
});
