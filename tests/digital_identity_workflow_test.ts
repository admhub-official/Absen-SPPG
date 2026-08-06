const read = (path: string) => Deno.readTextFile(path);

Deno.test("digital identity database is private, versioned, and compatible", async () => {
  const migration = await read("supabase/migrations/20260807060000_digital_identity_cards.sql");

  for (const marker of [
    'create table if not exists public."Digital_ID_Cards"',
    '"Public_Token_Hash" text not null unique',
    '"ID_Card_PDF_SHA256" text not null',
    'digital_id_cards_one_active_per_user',
    'where "Status" = \'ACTIVE\'',
    'alter table public."Digital_ID_Cards" enable row level security',
    "'digital-id-cards'",
    "false,",
    'users_id_card_unik_unique',
    'where nullif(trim("ID_Card_Unik"), \'\') is null',
  ]) {
    if (!migration.includes(marker)) throw new Error(`digital identity migration missing ${marker}`);
  }
  if (migration.includes('"Public_Token" text')) {
    throw new Error("raw public verification tokens must not be persisted");
  }
});

Deno.test("digital identity backend generates signed QR and printable PDFs", async () => {
  const endpoint = await read("supabase/functions/DigitalIdentity/index.ts");
  const deploy = await read("deploy-supabase.ps1");
  const config = await read("supabase-config.js");

  for (const action of [
    "getMyDigitalIdentity",
    "generateMyDigitalIdentity",
    "regenerateMyDigitalIdentity",
    "verifyDigitalIdentity",
  ]) {
    if (!endpoint.includes(action)) throw new Error(`DigitalIdentity missing ${action}`);
  }
  for (const marker of [
    'authenticateUserSession(db, payload.token)',
    'sha256Hex(publicToken)',
    'Public_Token_Hash: tokenHash',
    'QRCode.toBuffer(verificationUrl',
    'buildIdCardPdf(profile, qrPng, generatedAt)',
    'buildQrPdf(profile, qrPng, generatedAt)',
    'createSignedUrl(path, SIGNED_URL_SECONDS)',
    'URL_ID_Card_PDF: paths.idCardPdf',
    'Status: "REVOKED"',
    'confirmation) !== "REGENERATE"',
  ]) {
    if (!endpoint.includes(marker)) throw new Error(`DigitalIdentity backend missing ${marker}`);
  }
  if (!endpoint.includes('if (action === "verifyDigitalIdentity")')) {
    throw new Error("public verification must be isolated before session authentication");
  }
  if (!deploy.includes('"DigitalIdentity"')) {
    throw new Error("DigitalIdentity must be in the production deployment allowlist");
  }
  for (const action of [
    "getMyDigitalIdentity",
    "generateMyDigitalIdentity",
    "regenerateMyDigitalIdentity",
  ]) {
    if (!config.includes(`'${action}'`)) throw new Error(`frontend gateway missing ${action}`);
  }
  if (!config.includes("digitalIdentityFunctionName: 'DigitalIdentity'")) {
    throw new Error("DigitalIdentity must be configured as the canonical function");
  }
});

Deno.test("profile provides responsive generate download and print controls", async () => {
  const controller = await read("src/app/digital-id-card.js");
  const css = await read("src/styles/pages/digital-id-card.css");
  const bootstrap = await read("src/app/bootstrap.js");
  const verifyPage = await read("verify-id.html");
  const serviceWorker = await read("sw.js");

  for (const action of [
    'data-digital-id-action="generate"',
    'data-digital-id-action="download-card"',
    'data-digital-id-action="print-card"',
    'data-digital-id-action="download-qr"',
    'data-digital-id-action="print-qr"',
    'data-digital-id-action="regenerate"',
  ]) {
    if (!controller.includes(action)) throw new Error(`profile digital identity missing ${action}`);
  }
  for (const marker of [
    "window.apiCall(functionName",
    "getMyDigitalIdentity",
    "generateMyDigitalIdentity",
    "regenerateMyDigitalIdentity",
    "window.open(resolved, '_blank'",
    "URL.createObjectURL",
    "#p-id-card-digital",
    "#p-qr-code",
  ]) {
    if (!controller.includes(marker)) throw new Error(`profile controller missing ${marker}`);
  }
  for (const rule of [
    "background:linear-gradient(145deg,#dbeafe,#bfdbfe)",
    "border-radius:16px",
    "@media(min-width:480px){.digital-identity-actions{grid-template-columns:repeat(4",
    "@media(max-width:479px)",
    "grid-template-columns:repeat(2",
    "min-height:44px",
  ]) {
    if (!css.includes(rule)) throw new Error(`digital identity CSS missing ${rule}`);
  }
  if (!bootstrap.includes("'./src/app/digital-id-card.js'")) {
    throw new Error("bootstrap must load the digital identity controller");
  }
  if (!bootstrap.includes("'./src/styles/pages/digital-id-card.css'")) {
    throw new Error("bootstrap must load the digital identity stylesheet");
  }
  if (!verifyPage.includes("action:'verifyDigitalIdentity'")) {
    throw new Error("public verification page must call the canonical verification action");
  }
  if (!serviceWorker.includes("'./verify-id.html'")) {
    throw new Error("verification page must be part of the PWA shell");
  }
});
