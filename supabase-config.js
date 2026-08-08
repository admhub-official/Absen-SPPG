window.ABSEN_SUPABASE_CONFIG = Object.freeze({
  projectUrl: 'https://szwwpnbbsmjsbzzcecyj.supabase.co',
  functionName: 'AbsenV2',
  sessionGatewayFunctionName: 'SessionGateway',
  deviceTrustFunctionName: 'DeviceTrust',
  attendanceLocationFunctionName: 'AttendanceLocation',
  payrollUserFunctionName: 'PayrollUser',
  complaintsFunctionName: 'Complaints',
  digitalIdentityFunctionName: 'DigitalIdentity',
  employmentContractsFunctionName: 'EmploymentContracts',
  operationsV2FunctionName: 'OperationsV2'
});

function isInstalledApp() {
  const displayModes = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'];
  const displayModeInstalled = displayModes.some((mode) => {
    try { return window.matchMedia?.(`(display-mode: ${mode})`)?.matches === true; }
    catch { return false; }
  });
  const iosStandalone = navigator.standalone === true;
  const trustedWebActivity = String(document.referrer || '').startsWith('android-app://');
  return displayModeInstalled || iosStandalone || trustedWebActivity;
}

(() => {
  if (window.__HADIRLY_SESSION_GATEWAY_FETCH__) return;
  window.__HADIRLY_SESSION_GATEWAY_FETCH__ = true;
  const nativeFetch = window.fetch.bind(window);
  const config = window.ABSEN_SUPABASE_CONFIG;
  const projectOrigin = new URL(config.projectUrl).origin;
  const gatewayUrl = `${config.projectUrl}/functions/v1/${config.sessionGatewayFunctionName || 'SessionGateway'}`;
  const legacyTargets = new Set([
    'AbsenV2','AttendanceLocation','PayrollUser','ProfileOps','DeviceTrust',
    'SecurityOps','ProductionReadiness','AttendanceCorrections','AttendanceImport','EmploymentContracts'
  ]);

  window.fetch = async function hadilySessionGatewayFetch(input, init = {}) {
    const urlText = typeof input === 'string' ? input : input instanceof URL ? input.href : '';
    if (!urlText) return nativeFetch(input, init);
    let url;
    try { url = new URL(urlText, location.href); } catch { return nativeFetch(input, init); }
    const prefix = '/functions/v1/';
    if (url.origin !== projectOrigin || !url.pathname.startsWith(prefix)) return nativeFetch(input, init);
    const target = decodeURIComponent(url.pathname.slice(prefix.length).split('/')[0] || '');
    if (!legacyTargets.has(target)) return nativeFetch(input, init);
    const method = String(init.method || 'GET').toUpperCase();
    if (method !== 'POST' || typeof init.body !== 'string') return nativeFetch(input, init);
    let payload;
    try { payload = JSON.parse(init.body); } catch { return nativeFetch(input, init); }
    const sourceHeaders = new Headers(init.headers || {});
    const proxyHeaders = new Headers({ 'Content-Type': 'application/json' });
    const idempotency = sourceHeaders.get('x-idempotency-key');
    if (idempotency) proxyHeaders.set('x-idempotency-key', idempotency);
    return nativeFetch(gatewayUrl, {
      method: 'POST',
      headers: proxyHeaders,
      body: JSON.stringify({ target, payload }),
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    });
  };
  window.HadirlySessionGateway = Object.freeze({ nativeFetch, legacyTargets });
})();

(() => {
  if (window.__ABSEN_SECURITY_CONFIGURED__) return;
  window.__ABSEN_SECURITY_CONFIGURED__ = true;

  let registeredDevice = null;
  let deviceRegistrationPromise = null;
  let deviceRegistrationRetryAfter = 0;
  let deviceRegistrationWarnedAt = 0;
  const IDEMPOTENT_FUNCTIONS = new Set(['recordAbsensiSelf', 'recordAbsensi']);
  const PAYROLL_WORKFLOW_FUNCTIONS = new Set(['prosesPayroll','getMyPayroll','getSlipDownloadUrl','signPayrollReceipt']);
  const COMPLAINT_WORKFLOW_FUNCTIONS = new Set(['kirimPengaduan','getRiwayatPengaduanSaya','getNotifikasiAdmin','getDaftarPengaduan','tandaiSudahDibaca','simpanTanggapanAdmin','updateComplaintTicketV2','closeMyComplaintTicketV2']);
  const DIGITAL_IDENTITY_WORKFLOW_FUNCTIONS = new Set(['getMyDigitalIdentity','generateMyDigitalIdentity','regenerateMyDigitalIdentity','getIdCardAdminOverview','approveIdCardRequests']);
  const EMPLOYMENT_CONTRACT_WORKFLOW_FUNCTIONS = new Set([
    'getMyEmploymentContracts','getEmploymentContractDetail','getAdminEmploymentContracts','getContractMasterData',
    'saveContractMaster','createEmploymentContract','signEmploymentContract','cancelEmploymentContract','endEmploymentContract'
  ]);
  const OPERATIONS_V2_WORKFLOW_FUNCTIONS = new Set(['getOperationalUsersV2','getOperationalDashboardV2']);
  const DEVICE_KEY_STORAGE = 'absen:device-key:v1';

  function getOrCreateDeviceKey() {
    try {
      const existing = localStorage.getItem(DEVICE_KEY_STORAGE);
      if (existing && existing.length >= 32) return existing;
      const key = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
      localStorage.setItem(DEVICE_KEY_STORAGE, key);
      return key;
    } catch { return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, ''); }
  }
  const deviceKey = getOrCreateDeviceKey();

  function deviceMetadata() {
    const ua = navigator.userAgent || '';
    const platform = navigator.userAgentData?.platform || navigator.platform || 'Unknown';
    let browser = 'Browser';
    if (/Edg\//.test(ua)) browser = 'Microsoft Edge';
    else if (/Chrome\//.test(ua)) browser = 'Google Chrome';
    else if (/Firefox\//.test(ua)) browser = 'Mozilla Firefox';
    else if (/Safari\//.test(ua)) browser = 'Safari';
    return { deviceKey, deviceName: `${platform} · ${browser}`, platform, browser };
  }

  async function callDeviceTrust(action, payload = {}) {
    const token = localStorage.getItem('auth_token'); if (!token) throw new Error('Sesi login tidak tersedia.');
    const response = await fetch(`${window.ABSEN_SUPABASE_CONFIG.projectUrl}/functions/v1/${window.ABSEN_SUPABASE_CONFIG.deviceTrustFunctionName}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action, token, ...payload }) });
    const body = await response.json().catch(() => ({})); if (!response.ok || body?.success === false) throw new Error(body?.message || 'Gagal memproses identitas perangkat.'); return body?.result;
  }
  async function callWorkflow(slug, functionName, payload, fallback) {
    const token = payload.token || localStorage.getItem('auth_token'); if (!token) throw new Error('Sesi login tidak tersedia.');
    const response = await fetch(`${window.ABSEN_SUPABASE_CONFIG.projectUrl}/functions/v1/${slug}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ function:functionName, data:{ ...payload, token } }), cache:'no-store' });
    const body = await response.json().catch(() => ({})); if (!response.ok || body?.success === false) { const hint = body?.requestId ? ` (${body.requestId})` : ''; throw new Error(`${body?.error || body?.message || fallback}${hint}`); } return body?.result;
  }
  async function callOperationsV2(name,payload={}) {
    const token = payload.token || localStorage.getItem('auth_token'); if (!token) throw new Error('Sesi login tidak tersedia.');
    const response = await fetch(`${window.ABSEN_SUPABASE_CONFIG.projectUrl}/functions/v1/${window.ABSEN_SUPABASE_CONFIG.operationsV2FunctionName || 'OperationsV2'}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:name, ...payload, token }), cache:'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.success === false) { const hint=body?.requestId?` (${body.requestId})`:''; throw new Error(`${body?.message || body?.code || 'Layanan operasional tidak tersedia.'}${hint}`); }
    return body?.result;
  }
  const callPayrollWorkflow = (name,payload={}) => callWorkflow(window.ABSEN_SUPABASE_CONFIG.payrollUserFunctionName || 'PayrollUser', name, payload, 'Workflow payroll tidak tersedia.');
  async function callComplaintWorkflow(name,payload={}) { const isSubmission=name==='kirimPengaduan'; const result=await callWorkflow(window.ABSEN_SUPABASE_CONFIG.complaintsFunctionName || 'Complaints',name,{...payload,...(isSubmission?{idempotencyKey:payload.idempotencyKey||getOrCreateIdempotencyKey('kirimPengaduan')}:{})},'Workflow pengaduan tidak tersedia.'); if(isSubmission)clearIdempotencyKey('kirimPengaduan'); return result; }
  const callDigitalIdentityWorkflow = (name,payload={}) => callWorkflow(window.ABSEN_SUPABASE_CONFIG.digitalIdentityFunctionName || 'DigitalIdentity', name, payload, 'Layanan QR dan ID Card tidak tersedia.');
  const callEmploymentContractWorkflow = (name,payload={}) => callWorkflow(window.ABSEN_SUPABASE_CONFIG.employmentContractsFunctionName || 'EmploymentContracts', name, payload, 'Layanan Perjanjian Kerja tidak tersedia.');

  async function ensureDeviceRegistered() {
    if (registeredDevice) return registeredDevice;
    if (Date.now() < deviceRegistrationRetryAfter) return null;
    if (deviceRegistrationPromise) return deviceRegistrationPromise;
    deviceRegistrationPromise = callDeviceTrust('registerDevice', deviceMetadata())
      .then((device)=>{registeredDevice=device||null;deviceRegistrationRetryAfter=0;return registeredDevice;})
      .catch((error)=>{
        deviceRegistrationRetryAfter=Date.now()+60_000;
        if(Date.now()-deviceRegistrationWarnedAt>60_000){deviceRegistrationWarnedAt=Date.now();console.warn('Device registration deferred',error);}
        return null;
      })
      .finally(()=>{deviceRegistrationPromise=null;});
    return deviceRegistrationPromise;
  }
  function resetDeviceContext(){ registeredDevice = null; deviceRegistrationPromise = null; deviceRegistrationRetryAfter = 0; }
  function getOrCreateIdempotencyKey(functionName) { const storageKey=`absen:idempotency:${functionName}`; try { const current=JSON.parse(sessionStorage.getItem(storageKey)||'null'); if(current?.key&&Number(current.expiresAt)>Date.now())return current.key; const key=crypto.randomUUID();sessionStorage.setItem(storageKey,JSON.stringify({key,expiresAt:Date.now()+2*60*1000}));return key;} catch{return crypto.randomUUID();} }
  function clearIdempotencyKey(functionName){try{sessionStorage.removeItem(`absen:idempotency:${functionName}`);}catch{}}

  window.getMyAttendanceDevices=()=>callDeviceTrust('listMyDevices');
  window.revokeMyAttendanceDevice=(deviceId)=>callDeviceTrust('revokeMyDevice',{deviceId});
  window.reviewAttendanceDevice=(deviceId,status,reason)=>callDeviceTrust('reviewDevice',{deviceId,status,reason});
  window.getAttendanceDeviceReviewQueue=(status='PENDING')=>callDeviceTrust('listReviewQueue',{status});
  window.HadirlySecurityContext=Object.freeze({resetDeviceContext});
  window.addEventListener('absen:session-changed',(event)=>{
    if(event.detail?.authenticated===false)resetDeviceContext();
  });

  window.addEventListener('DOMContentLoaded', () => {
    const originalApiCall = window.apiCall;
    if (typeof originalApiCall === 'function' && !window.__ABSEN_API_WRAPPED__) {
      window.__ABSEN_API_WRAPPED__ = true;
      window.apiCall = async function securityAwareApiCall(functionName, payload = {}) {
        if (functionName === 'logout') return originalApiCall(functionName, payload);
        if (OPERATIONS_V2_WORKFLOW_FUNCTIONS.has(functionName)) return callOperationsV2(functionName,payload);
        if (EMPLOYMENT_CONTRACT_WORKFLOW_FUNCTIONS.has(functionName)) return callEmploymentContractWorkflow(functionName,payload);
        if (DIGITAL_IDENTITY_WORKFLOW_FUNCTIONS.has(functionName)) return callDigitalIdentityWorkflow(functionName,payload);
        if (COMPLAINT_WORKFLOW_FUNCTIONS.has(functionName)) return callComplaintWorkflow(functionName,payload);
        if (PAYROLL_WORKFLOW_FUNCTIONS.has(functionName)) return callPayrollWorkflow(functionName,payload);
        if (localStorage.getItem('auth_token')) await ensureDeviceRegistered();
        const securedPayload = { ...payload, deviceKey, deviceId:registeredDevice?.Device_ID || registeredDevice?.deviceId || null, ...(IDEMPOTENT_FUNCTIONS.has(functionName) ? { idempotencyKey:payload.idempotencyKey || getOrCreateIdempotencyKey(functionName) } : {}) };
        const result = await originalApiCall(functionName, securedPayload); if (IDEMPOTENT_FUNCTIONS.has(functionName)) clearIdempotencyKey(functionName); return result;
      };
    }
    if (localStorage.getItem('auth_token')) void ensureDeviceRegistered();
  });
})();

(async () => {
  try {
    if (!globalThis.HADIRLY_RELEASE) await import('./src/app/release-version.js');
    if (!globalThis.HADIRLY_PWA_ASSETS) await import('./src/app/pwa-shell-assets.js');
    const version = globalThis.HADIRLY_RELEASE?.version;
    if (!version) throw new Error('Release version Hadirly belum dimuat.');
    await import(`./src/app/bootstrap.js?v=${version}`);
  } catch (error) {
    console.warn('Frontend modular gagal dimuat; aplikasi utama tetap berjalan.', error);
  }
})();
