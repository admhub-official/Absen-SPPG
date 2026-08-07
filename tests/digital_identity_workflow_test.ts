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

Deno.test("digital identity backend creates portrait BGN cards and approves them safely", async () => {
  const endpoint = await read("supabase/functions/DigitalIdentity/index.ts");
  const printEndpoint = await read("supabase/functions/DigitalIdentityPrint/index.ts");
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
  for (const marker of [
    'DigitalIdentity',
    'refreshMyActiveIdCardPdf',
    'refreshApprovedIdCardPdfs',
    'SATUAN PELAYANAN PEMENUHAN GIZI (SPPG)',
    'Head_SPPG_Name',
    'URL_Foto_Profil',
    'sniff(bytes',
  ]) {
    if (!printEndpoint.includes(marker)) throw new Error(`DigitalIdentityPrint missing ${marker}`);
  }
  if (!endpoint.includes('if (action === "verifyDigitalIdentity")')) {
    throw new Error("public verification must be isolated before session authentication");
  }
  if (!deploy.includes('"DigitalIdentity"') || !deploy.includes('"DigitalIdentityPrint"')) {
    throw new Error("Digital identity functions must remain in the production deployment allowlist");
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

Deno.test("profile and ADMIN UI expose request badge bulk selection signature canvas and print sync", async () => {
  const controller = await read("src/app/digital-id-card.js");
  const syncController = await read("src/app/digital-id-card-print-sync.js");
  const css = await read("src/styles/pages/digital-id-card.css");
  const cssV2 = await read("src/styles/pages/digital-id-card-v2.css");
  const bootstrap = await read("src/app/bootstrap.js");
  const serviceWorker = await read("sw.js");

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
    'DigitalIdentityPrint',
    'refreshMyActiveIdCardPdf',
    'refreshApprovedIdCardPdfs',
    'digital-id-back-title-copy',
    'SATUAN PELAYANAN PEMENUHAN GIZI (SPPG)',
  ]) {
    if (!syncController.includes(marker)) throw new Error(`ID card print sync missing ${marker}`);
  }
  for (const rule of [
    '.digital-id-portrait-card',
    'aspect-ratio:53.98/85.6',
    '.digital-id-photo-circle',
    'border-radius:50%',
    '.id-card-admin-nav-group',
    '.id-card-signature-canvas',
    '@media(max-width:600px)',
  ]) {
    if (!css.includes(rule)) throw new Error(`ID card CSS missing ${rule}`);
  }
  for (const rule of ['.digital-id-back-title-copy', '.digital-id-head-signature', '.digital-id-back-title img']) {
    if (!cssV2.includes(rule)) throw new Error(`ID card synchronized CSS missing ${rule}`);
  }
  if (!bootstrap.includes("const VERSION = '26.11.36'")) {
    throw new Error("bootstrap asset version must be bumped for the synchronized ID card renderer");
  }
  if (!bootstrap.includes("'./src/app/digital-id-card-print-sync.js'")) {
    throw new Error("bootstrap must load the ID card print sync controller");
  }
  if (!bootstrap.includes("'./src/styles/pages/digital-id-card-v2.css'")) {
    throw new Error("bootstrap must load synchronized ID card styles");
  }
  if (!serviceWorker.includes("const APP_VERSION = '26.11.36'")) {
    throw new Error("service worker asset version must match bootstrap");
  }
  if (!serviceWorker.includes("'./verify-id.html'")) {
    throw new Error("verification page must remain part of the PWA shell");
  }
});
