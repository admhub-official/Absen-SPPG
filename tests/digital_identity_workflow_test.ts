const read = (path: string) => Deno.readTextFile(path);

Deno.test("digital identity database supports private pending approval workflow", async () => {
  const baseMigration = await read("supabase/migrations/20260807060000_digital_identity_cards.sql");
  const approvalMigration = await read("supabase/migrations/20260807070000_id_card_approval_workflow.sql");

  for (const marker of [
    'create table if not exists public."Digital_ID_Cards"',
    '"Public_Token_Hash" text not null unique',
    '"ID_Card_PDF_SHA256" text not null',
    'digital_id_cards_one_active_per_user',
    'alter table public."Digital_ID_Cards" enable row level security',
    "'digital-id-cards'",
    'users_id_card_unik_unique',
  ]) {
    if (!baseMigration.includes(marker)) throw new Error(`digital identity base migration missing ${marker}`);
  }
  for (const marker of [
    "check (\"Status\" in ('PENDING', 'ACTIVE', 'REVOKED'))",
    '"Requested_At" timestamptz',
    '"Approved_At" timestamptz',
    '"Head_SPPG_Name" text',
    '"Head_SPPG_Signature_Storage_Path" text',
    'digital_id_cards_one_pending_per_user',
    'create or replace function public.approve_digital_id_card',
    "'REPLACED_BY_APPROVED_CARD'",
  ]) {
    if (!approvalMigration.includes(marker)) throw new Error(`ID card approval migration missing ${marker}`);
  }
  if (baseMigration.includes('"Public_Token" text') || approvalMigration.includes('"Public_Token" text')) {
    throw new Error("raw public verification tokens must not be persisted");
  }
});

Deno.test("DigitalIdentity remains the canonical approval and verification backend", async () => {
  const endpoint = await read("supabase/functions/DigitalIdentity/index.ts");
  const deploy = await read("deploy-supabase.ps1");
  const config = await read("supabase-config.js");

  for (const action of [
    "getMyDigitalIdentity",
    "generateMyDigitalIdentity",
    "regenerateMyDigitalIdentity",
    "getIdCardAdminOverview",
    "approveIdCardRequests",
    "verifyDigitalIdentity",
  ]) {
    if (!endpoint.includes(action)) throw new Error(`DigitalIdentity missing ${action}`);
  }

  for (const marker of [
    'authenticateUserSession(db, payload.token)',
    'BGN_LOGO_URL',
    'Logo%20BGN/LOGO_BGN.png',
    'Tanggal_Mulai_Kerja',
    'officialOwnershipNote(profile)',
    'drawCircularImage(',
    'detectImageType(',
    'CR80_PORTRAIT',
    'Status: "PENDING"',
    'getCardByStatus(auth.idUser, "PENDING")',
    'requireIdCardAdmin(auth)',
    'signatureDataUrl',
    'approve_digital_id_card',
    'Head_SPPG_Signature_Storage_Path',
    '.eq("Status", "ACTIVE")',
    'createSignedUrl(path, SIGNED_URL_SECONDS)',
  ]) {
    if (!endpoint.includes(marker)) throw new Error(`DigitalIdentity backend missing ${marker}`);
  }
  if (!endpoint.includes('if (action === "verifyDigitalIdentity")')) {
    throw new Error("public verification must be isolated before session authentication");
  }

  const obsoleteSection = deploy.split('$ObsoleteFunctions = @(')[1]?.split('\n)')[0] || '';
  const productionSection = deploy.split('$FunctionNames = @(')[1]?.split('\n)')[0] || '';
  if (!obsoleteSection.includes('"DigitalIdentityPrint"') || !obsoleteSection.includes('"ResetDigitalIdentityOnce"')) {
    throw new Error("retired and one-time ID card helpers must remain on the idempotent cleanup list");
  }
  if (!productionSection.includes('"DigitalIdentity"') || productionSection.includes('"DigitalIdentityPrint"')) {
    throw new Error("production allowlist must contain only DigitalIdentity for the ID workflow backend");
  }

  for (const action of [
    "getMyDigitalIdentity",
    "generateMyDigitalIdentity",
    "regenerateMyDigitalIdentity",
    "getIdCardAdminOverview",
    "approveIdCardRequests",
  ]) {
    if (!config.includes(`'${action}'`)) throw new Error(`frontend gateway missing ${action}`);
  }
});

Deno.test("profile preview and downloaded PDF share one stable 300 DPI CR80 master raster", async () => {
  const controller = await read("src/app/digital-id-card.js");
  const renderer = await read("src/app/digital-id-card-master-renderer.js");
  const css = await read("src/styles/pages/digital-id-card.css");
  const rendererCss = await read("src/styles/pages/digital-id-card-master-renderer.css");
  const bootstrap = await read("src/app/bootstrap.js");
  const serviceWorker = await read("sw.js");
  const config = await read("supabase-config.js");

  for (const marker of [
    'Buat ID Card',
    'Menunggu Persetujuan Kepala SPPG',
    'Daftar ID Card',
    'Pengajuan ID Card',
    'id-card-pending-nav-count',
    'id-card-select-all',
    'TTD Pilihan',
    'Setujui Semua',
    'id-card-signature-canvas',
    'Nama Kepala SPPG',
    "api('getIdCardAdminOverview')",
    "api('approveIdCardRequests'",
    "canvas.toDataURL('image/png')",
    'BGN_LOGO',
  ]) {
    if (!controller.includes(marker)) throw new Error(`ID card controller missing ${marker}`);
  }

  for (const marker of [
    'const CARD_WIDTH = 638',
    'const CARD_HEIGHT = 1011',
    '53.98 * 72 / 25.4',
    '85.6 * 72 / 25.4',
    'digital-id-master-canvas',
    "canvas.toBlob",
    "'image/jpeg', 0.97",
    'buildTwoPagePdf',
    '/Count 2',
    '/MediaBox [0 0',
    'SATUAN PELAYANAN PEMENUHAN GIZI (SPPG)',
    'KODE ID CARD',
    'KEPALA SPPG',
    'imageFromUrl(data.photoUrl)',
    'imageFromUrl(data.qrUrl)',
    'imageFromUrl(data.signatureUrl)',
    'function dataSignature(data)',
    'function stagingCanvas()',
    'function commitCanvas(target, staging)',
    'pair.dataset.masterSignature',
    'function mutationTouchesCard(mutation)',
    "document.addEventListener('click', handleCardAction, true)",
  ]) {
    if (!renderer.includes(marker)) throw new Error(`CR80 master renderer missing ${marker}`);
  }
  if (renderer.includes('new MutationObserver(queueRender)')) {
    throw new Error("global unfiltered mutation rerender must not return because it causes preview flicker");
  }
  if (!renderer.includes("download-card") || !renderer.includes("print-card")) {
    throw new Error("download and print must be intercepted by the WYSIWYG renderer");
  }

  for (const rule of [
    '.digital-id-portrait-card',
    'aspect-ratio:53.98/85.6',
    '.id-card-admin-nav-group',
    '.id-card-signature-canvas',
  ]) {
    if (!css.includes(rule)) throw new Error(`ID card base CSS missing ${rule}`);
  }
  for (const rule of [
    '.digital-id-master-preview',
    '.digital-id-master-canvas',
    'aspect-ratio:53.98/85.6',
    '.has-master-preview>.digital-id-portrait-card',
  ]) {
    if (!rendererCss.includes(rule)) throw new Error(`master renderer CSS missing ${rule}`);
  }

  for (const retiredAsset of ['digital-id-card-print-sync.js', 'digital-id-card-v2.css']) {
    if (bootstrap.includes(retiredAsset) || serviceWorker.includes(retiredAsset)) {
      throw new Error(`retired ID card asset still referenced: ${retiredAsset}`);
    }
  }
  if (!bootstrap.includes("const VERSION = '26.11.39'")) {
    throw new Error("bootstrap asset version must be bumped for the flicker fix");
  }
  if (!bootstrap.includes("'./src/app/digital-id-card-master-renderer.js'")) {
    throw new Error("bootstrap must load the CR80 master renderer after the ID card controller");
  }
  if (!bootstrap.includes("'./src/styles/pages/digital-id-card-master-renderer.css'")) {
    throw new Error("bootstrap must load the CR80 master renderer stylesheet");
  }
  if (!serviceWorker.includes("const APP_VERSION = '26.11.39'")) {
    throw new Error("service worker asset version must match bootstrap");
  }
  if (!serviceWorker.includes("const CACHE = 'absen-sppg-hadirly-v80'")) {
    throw new Error("service worker cache namespace must be bumped for the fixed assets");
  }
  if (!serviceWorker.includes('digital-id-card-master-renderer.js') || !serviceWorker.includes('digital-id-card-master-renderer.css')) {
    throw new Error("master renderer assets must be cached for the PWA");
  }
  if (!config.includes("import('./src/app/bootstrap.js?v=26.11.39')")) {
    throw new Error("top-level bootstrap import must match the fixed renderer asset version");
  }
  if (!serviceWorker.includes("'./verify-id.html'")) {
    throw new Error("verification page must remain part of the PWA shell");
  }
});

Deno.test("profile employment editor can update employment data but never daily salary", async () => {
  const editor = await read("src/app/profile-employment-editor.js");
  const profileOps = await read("supabase/functions/ProfileOps/index.ts");
  const bootstrap = await read("src/app/bootstrap.js");
  const serviceWorker = await read("sw.js");
  const deploy = await read("deploy-supabase.ps1");

  for (const field of ["SPPG", "Yayasan", "Jabatan_Divisi", "Tanggal_Mulai_Kerja"]) {
    if (!editor.includes(field) || !profileOps.includes(field)) throw new Error(`employment field missing: ${field}`);
  }
  for (const marker of [
    'id="edit-gaji-harian"',
    'disabled aria-readonly="true"',
    '/functions/v1/ProfileOps',
    "event.stopImmediatePropagation()",
    "Nama_Lengkap",
    "Nomor_Rekening",
  ]) {
    if (!editor.includes(marker)) throw new Error(`profile employment editor missing ${marker}`);
  }
  for (const marker of [
    'Object.prototype.hasOwnProperty.call(updates, "Gaji_Harian")',
    'Gaji Harian hanya dapat diubah oleh ADMIN/SUPER ADMIN',
    'Object.prototype.hasOwnProperty.call(updates, "Role")',
    'Object.prototype.hasOwnProperty.call(updates, "Status_Aktif")',
    'resolveFoundation',
    'Master_SPPG',
    'Jenis_Aktivitas: "UPDATE_PROFIL"',
  ]) {
    if (!profileOps.includes(marker)) throw new Error(`ProfileOps protection missing ${marker}`);
  }
  const stringFields = profileOps.split('const stringFields')[1]?.split('];')[0] || '';
  if (stringFields.includes('Gaji_Harian')) throw new Error("Gaji_Harian must not be part of the self-service update field list");

  if (!bootstrap.includes("'./src/app/profile-employment-editor.js'")) {
    throw new Error("bootstrap must load the profile employment editor");
  }
  if (!serviceWorker.includes('profile-employment-editor.js')) {
    throw new Error("profile employment editor must be cached by the PWA");
  }
  const productionSection = deploy.split('$FunctionNames = @(')[1]?.split('\n)')[0] || '';
  if (!productionSection.includes('"ProfileOps"')) throw new Error("ProfileOps must be in the production deployment allowlist");
});
