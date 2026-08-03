(() => {
  const config = window.ABSEN_SUPABASE_CONFIG || {};
  const functionName = 'SecurityOps';

  async function callSecurityOps(action, payload = {}) {
    const token = localStorage.getItem('auth_token');
    if (!token) throw new Error('Sesi login tidak tersedia.');
    const response = await fetch(`${config.projectUrl}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token, ...payload })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.success === false) {
      const error = new Error(body?.message || 'Layanan keamanan tidak tersedia.');
      error.code = body?.code;
      error.requestId = body?.requestId;
      throw error;
    }
    return body.result;
  }

  window.SecurityOpsClient = Object.freeze({
    getDashboard: (since) => callSecurityOps('dashboard', { since }),
    listIncidents: (filters = {}) => callSecurityOps('listIncidents', filters),
    updateIncident: (incidentId, status, options = {}) => callSecurityOps('updateIncident', { incidentId, status, ...options }),
    createIncidentFromEvent: (eventId, title) => callSecurityOps('createIncidentFromEvent', { eventId, title }),
    exploreAudit: (filters = {}) => callSecurityOps('auditExplorer', filters),
    recordMetric: (service, metric, value, options = {}) => callSecurityOps('recordMetric', { service, metric, value, ...options })
  });
})();
