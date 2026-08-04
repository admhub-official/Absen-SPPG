(() => {
  const config = window.ABSEN_SUPABASE_CONFIG || {};
  const functionName = 'SecurityOps';
  const VERSION='23.1.0';
  let unavailableUntil=0;

  async function callSecurityOps(action, payload = {}) {
    if(Date.now()<unavailableUntil){const error=new Error('Layanan Security Operations belum aktif.');error.code='SERVICE_UNAVAILABLE';throw error;}
    const token = localStorage.getItem('auth_token');
    if (!token) throw new Error('Sesi login tidak tersedia.');
    try{
      const response = await fetch(`${config.projectUrl}/functions/v1/${functionName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, token, ...payload })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.success === false) {
        if(response.status===404||response.status>=500)unavailableUntil=Date.now()+60_000;
        const error = new Error(body?.message || (response.status===404?'Layanan Security Operations belum dideploy.':'Layanan keamanan tidak tersedia.'));
        error.code = body?.code || (response.status===404?'SERVICE_NOT_DEPLOYED':undefined);
        error.requestId = body?.requestId;
        throw error;
      }
      unavailableUntil=0;
      return body.result;
    }catch(error){
      if(error instanceof TypeError){unavailableUntil=Date.now()+60_000;const friendly=new Error('Layanan Security Operations belum dapat dihubungi.');friendly.code='SERVICE_UNAVAILABLE';throw friendly;}
      throw error;
    }
  }

  window.SecurityOpsClient = Object.freeze({
    getDashboard: (since) => callSecurityOps('dashboard', { since }),
    listIncidents: (filters = {}) => callSecurityOps('listIncidents', filters),
    updateIncident: (incidentId, status, options = {}) => callSecurityOps('updateIncident', { incidentId, status, ...options }),
    createIncidentFromEvent: (eventId, title) => callSecurityOps('createIncidentFromEvent', { eventId, title }),
    exploreAudit: (filters = {}) => callSecurityOps('auditExplorer', filters),
    recordMetric: (service, metric, value, options = {}) => callSecurityOps('recordMetric', { service, metric, value, ...options })
  });

  if (!window.AbsenApp) {
    import(`./src/app/bootstrap.js?v=${VERSION}`).catch((error) => {
      console.warn('Modular frontend tidak dapat dimuat; aplikasi utama tetap berjalan.', error);
    });
  }
})();
