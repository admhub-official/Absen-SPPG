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

Deno.test("DigitalIdentity is the single canonical portrait card renderer", async () => {
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
    'bytes[0] === 0x89',
    'bytes[0] === 0xff',
    'CR80_PORTRAIT',
    'Status: "PENDING"',
    'getCardByStatus(auth.idUser, "PENDING")',
    'requireIdCardAdmin(auth)',
    'signatureDataUrl',
    'approve_digital_id_card',
    'Head_SPPG_Signature_Storage_Path',
    '.eq("Status", "ACTIVE")',
    'createSignedUrl(path, SIGNED_URL_SECONDS)',
    'SATUAN PELAYANAN PEMENUHAN GIZI (SPPG)',
    'backLogoSize',
    'cardY + 49',
  ]) {
    if (!endpoint.includes(marker)) throw new Error(`DigitalIdentity backend missing ${marker}`);
  }
  if (endpoint.includes('VERIFIKASI ID CARD')) {
    throw new Error("legacy dark verification header must not return to the PDF renderer");
  }
  if (!endpoint.includes('if (action === "verifyDigitalIdentity")')) {
    throw new Error("public verification must be isolated before session authentication");
  }

  const obsoleteSection = deploy.split('$ObsoleteFunctions = @(')[1]?.split('\n)')[0] || '';
  const productionSection = deploy.split('$FunctionNames = @(')[1]?.split('\n)')[0] || '';
  if (!obsoleteSection.includes('"DigitalIdentityPrint"')) {
    throw new Error("retired DigitalIdentityPrint must remain on the idempotent cleanup list");
  }
  if (!productionSection.includes('"DigitalIdentity"') || productionSection.includes('"DigitalIdentityPrint"')) {
    throw new Error("production allowlist must contain only the canonical DigitalIdentity renderer");
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

Deno.test("profile and ADMIN UI render the final card layout without override shims", async () => {
  const controller = await read("src/app/digital-id-card.js");
  const css = await read("src/styles/pages/digital-id-card.css");
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
    'digital-id-back-title-copy',
    'SATUAN PELAYANAN PEMENUHAN GIZI (SPPG)',
    'institutionHeader(profile',
    'adminBound',
  ]) {
    if (!controller.includes(marker)) throw new Error(`ID card controller missing ${marker}`);
  }
  if (controller.includes('VERIFIKASI ID CARD')) {
    throw new Error("legacy preview header must not return");
  }
  const frontPreview = controller.split('function frontPreview')[1]?.split('function backPreview')[0] || '';
  if (frontPreview.includes('digital-id-official-note')) {
    throw new Error("front preview must not render the ownership note and hide it with CSS");
  }

  for (const rule of [
    '.digital-id-portrait-card',
    'aspect-ratio:53.98/85.6',
    '.digital-id-photo-circle',
    'border-radius:50%',
    '.digital-id-back-title-copy',
    '.digital-id-back-title img',
    '.digital-id-head-signature',
    'min-height:84px',
    '.id-card-admin-nav-group',
    '.id-card-signature-canvas',
    '@media(max-width:600px)',
  ]) {
    if (!css.includes(rule)) throw new Error(`ID card CSS missing ${rule}`);
  }
  if (css.includes('.digital-id-front>.digital-id-official-note')) {
    throw new Error("dead CSS for the removed front note must stay deleted");
  }

  for (const retiredAsset of [
    'digital-id-card-print-sync.js',
    'digital-id-card-v2.css',
  ]) {
    if (bootstrap.includes(retiredAsset) || serviceWorker.includes(retiredAsset)) {
      throw new Error(`retired ID card asset still referenced: ${retiredAsset}`);
    }
  }
  if (!bootstrap.includes("const VERSION = '26.11.37'")) {
    throw new Error("bootstrap asset version must be bumped after dead-code cleanup");
  }
  if (!serviceWorker.includes("const APP_VERSION = '26.11.37'")) {
    throw new Error("service worker asset version must match bootstrap");
  }
  if (!serviceWorker.includes("const CACHE = 'absen-sppg-hadirly-v78'")) {
    throw new Error("service worker cache namespace must be bumped after asset removal");
  }
  if (!config.includes("import('./src/app/bootstrap.js?v=26.11.37')")) {
    throw new Error("top-level bootstrap import must match the cleaned asset version");
  }
  if (!serviceWorker.includes("'./verify-id.html'")) {
    throw new Error("verification page must remain part of the PWA shell");
  }
});
