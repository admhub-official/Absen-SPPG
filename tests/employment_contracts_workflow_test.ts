const read = (path: string) => Deno.readTextFile(path);

Deno.test("employment contract module owns complete lifecycle, masters, PDF, QR and profile identity", async () => {
  const migration = await read("supabase/migrations/20260807150000_employment_contracts_module.sql");
  const defaults = await read("supabase/migrations/20260807150100_employment_contracts_master_defaults.sql");
  const endpoint = await read("supabase/functions/EmploymentContracts/index.ts");
  const profileOps = await read("supabase/functions/ProfileOps/index.ts");
  const frontend = await read("src/app/employment-contracts.js");
  const navigation = await read("src/app/employment-contract-navigation.js");
  const css = await read("src/styles/pages/employment-contracts.css");
  const navigationCss = await read("src/styles/pages/employment-contract-navigation.css");
  const verify = await read("verify-contract.html");
  const assets = await read("src/app/pwa-shell-assets.js");
  const sw = await read("sw.js");
  const config = await read("supabase-config.js");
  const deploy = await read("deploy-supabase.ps1");

  for (const marker of [
    'add column if not exists "NIK" text',
    'add column if not exists "Alamat" text',
    'Master_Job_Description','Master_Jam_Kerja','Master_Employment_Terms','Master_Contract_Compensation',
    'Master_Contract_Templates','Employment_Contracts','Employment_Contract_Signatures','Employment_Contract_Audit_Log',
    'next_employment_contract_number','PK/SPPG-','employment-contracts','WAITING_MITRA','WAITING_HEAD','WAITING_EMPLOYEE',
    'Final_PDF_SHA256','Public_Token_Hash','Template_Content_Snapshot','Snapshot',
  ]) if (!migration.includes(marker)) throw new Error(`migration missing ${marker}`);
  if (!defaults.includes("when 'DARMARAJA' then 'DRJ'")) throw new Error("Darmaraja contract code DRJ must be seeded");

  for (const action of ['getMyEmploymentContracts','getEmploymentContractDetail','getAdminEmploymentContracts','getContractMasterData','saveContractMaster','createEmploymentContract','signEmploymentContract','cancelEmploymentContract','endEmploymentContract','verifyEmploymentContract']) {
    if (!endpoint.includes(action)) throw new Error(`EmploymentContracts missing ${action}`);
    if (action !== 'verifyEmploymentContract' && !config.includes(`'${action}'`)) throw new Error(`frontend gateway missing ${action}`);
  }
  for (const marker of ['PDFDocument.create()','QRCode.toDataURL','SHA-256','contract-final.pdf','Signature_Progress','SUPERSEDED','acceptedStatement','Employment_Contract_Signatures','createSignedUrl']) {
    if (!endpoint.includes(marker)) throw new Error(`final document flow missing ${marker}`);
  }
  if (!endpoint.includes('if (fn === "verifyEmploymentContract")')) throw new Error("public verification must run before session authentication");

  for (const marker of ['Perjanjian Kerja Saya','Perjanjian Kerja','Master Perjanjian Kerja','SPPG & Yayasan','Jabatan & Divisi','Job Description','Jam Kerja','Status Kerja & Kontrak','Kompensasi','Template Perjanjian','SOP / Referensi','Nomor Kontrak','TTD MITRA','TTD KEPALA SPPG','Tanda Tangan Karyawan']) {
    if (!frontend.includes(marker)) throw new Error(`frontend employment workspace missing ${marker}`);
  }
  for (const marker of [
    'function syncNavigation()',
    'const sessionSignature =',
    'employment-contract-personal-nav',
    'data-employment-view="employment-admin"',
    'data-employment-view="employment-master"',
    'function ensurePersonalNavigation(personal, authenticated)',
    'function ensureAdminNavigation(sidebar, mobile, authorized)',
    'session-sync-v4',
    "window.addEventListener('absen:session-changed'",
    "['ADMIN', 'SUPER ADMIN']",
    'function forceViewVisible(view)',
    'async function waitForController()',
    'async function openEmploymentView(view)',
    'requestAnimationFrame(() => forceViewVisible(view))',
    'void openEmploymentView(button.dataset.employmentView)',
    "'employment-my': 'openMy'",
    "'employment-admin': 'openAdmin'",
    "'employment-master': 'openMaster'",
    'Modul Perjanjian Kerja belum siap',
  ]) if (!navigation.includes(marker)) throw new Error(`employment navigation runtime missing ${marker}`);
  for (const dead of ['makeSentinel(', 'retrySync(', 'retryTimers', 'observeSessionUi', 'new MutationObserver']) {
    if (navigation.includes(dead)) throw new Error(`employment navigation dead/churn code returned: ${dead}`);
  }
  if (navigation.includes('event.stopPropagation()')) {
    throw new Error('employment navigation must not swallow click propagation before the controller is ready');
  }
  if (!navigationCss.includes('.employment-contract-admin-nav') || !navigationCss.includes('.employment-contract-mobile-admin-nav')) {
    throw new Error('employment navigation integration CSS missing');
  }
  if (!css.includes('.employment-contract-view') || !css.includes('.employment-contract-signature-canvas')) throw new Error("employment contract responsive CSS missing");
  if (!verify.includes('PERJANJIAN TERVERIFIKASI') || !verify.includes('SHA-256 Dokumen')) throw new Error("contract verification page missing safe verification fields");

  for (const marker of ['NIK','Alamat','getProfileEmployment','NIK harus terdiri dari 16 digit']) {
    if (!profileOps.includes(marker)) throw new Error(`ProfileOps missing ${marker}`);
  }
  const selfEditableFields = profileOps.split('const stringFields')[1]?.split('];')[0] || '';
  if (selfEditableFields.includes('Gaji_Harian')) throw new Error("daily salary must not become self-editable");
  if (!profileOps.includes('Object.prototype.hasOwnProperty.call(updates, "Gaji_Harian")')) {
    throw new Error("ProfileOps must explicitly reject daily salary changes");
  }

  const workspaceIndex = assets.indexOf("'./src/app/employment-contracts.js'");
  const navigationIndex = assets.indexOf("'./src/app/employment-contract-navigation.js'");
  if (workspaceIndex < 0 || navigationIndex < 0 || navigationIndex <= workspaceIndex) throw new Error('contract navigation sync must load after workspace controller');
  if (!assets.includes("'./src/styles/pages/employment-contracts.css'") || !assets.includes("'./src/styles/pages/employment-contract-navigation.css'")) throw new Error("shared asset manifest must load employment contract styles");
  if (!sw.includes("'./verify-contract.html'") || !sw.includes('...ASSETS.scripts.map(versioned)') || !sw.includes('...ASSETS.styles.map(versioned)')) throw new Error("PWA shell must consume employment contract assets through shared manifest");
  if (!config.includes("employmentContractsFunctionName: 'EmploymentContracts'")) throw new Error("EmploymentContracts function slug missing");
  if (!deploy.includes('"EmploymentContracts"')) throw new Error("EmploymentContracts must be in production deployment allowlist");
});
