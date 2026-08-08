import { ApiClientError } from './api-client.js';

const endpoint = () => `${window.ABSEN_SUPABASE_CONFIG?.projectUrl || ''}/functions/v1/PlatformOps`;
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
    throw new ApiClientError(body?.message || 'Layanan platform tidak tersedia.', {
      code: body?.code,
      requestId: body?.requestId,
      status: response.status,
      details: body?.details
    });
  }
  return body?.result;
}

export const platformOpsService = Object.freeze({
  readiness: () => call('readiness'),
  privacyRequest: (type, reason) => call('privacyRequest', { type, reason }),
  retentionPolicies: () => call('retentionPolicies'),
  purgePreview: () => call('purgePreview')
});
