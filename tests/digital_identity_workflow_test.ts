const read = (path: string) => Deno.readTextFile(path);

Deno.test("digital identity database supports private pending approval workflow", async () => {
  const baseMigration = await read("supabase/migrations/20260807060000_digital_identity_cards.sql");
  const approvalMigration = await read("supabase/migrations/20260807070000_id_card_approval_workflow.sql");
  for (const marker of ['create table if not exists public."Digital_ID_Cards"','"Public_Token_Hash" text not null unique','"ID_Card_PDF_SHA256" text not null','digital_id_cards_one_active_per_user','alter table public."Digital_ID_Cards" enable row level security',"'digital-id-cards'",'users_id_card_unik_unique']) if (!baseMigration.includes(marker)) throw new Error(`digital identity base migration missing ${marker}`);
  for (const marker of ["check (\"Status\" in ('PENDING', 'ACTIVE', 'REVOKED'))",'"Requested_At" timestamptz','"Approved_At" timestamptz','"Head_SPPG_Name" text','"Head_SPPG_Signature_Storage_Path" text','digital_id_cards_one_pending_per_user','create or replace function public.approve_digital_id_card',"'REPLACED_BY_APPROVED_CARD'"]) if (!approvalMigration.includes(marker)) throw new Error(`ID card approval migration missing ${marker}`);
  if (baseMigration.includes('"Public_Token" text') || approvalMigration.includes('"Public_Token" text')) throw new Error("raw public verification tokens must not be persisted");
});

Deno.test("DigitalIdentity remains the canonical approval and verification backend", async () => {
  const endpoint=await read("supabase/functions/DigitalIdentity/index.ts"),deploy=await read("deploy-supabase.ps1"),config=await read("supabase-config.js");
  for(const action of ["getMyDigitalIdentity","generateMyDigitalIdentity","regenerateMyDigitalIdentity","getIdCardAdminOverview","approveIdCardRequests","verifyDigitalIdentity"]) if(!endpoint.includes(action))throw new Error(`DigitalIdentity missing ${action}`);
  for(const marker of ['authenticateUserSession(db, payload.token)','BGN_LOGO_URL','Logo%20BGN/LOGO_BGN.png','Tanggal_Mulai_Kerja','officialOwnershipNote(profile)','drawCircularImage(','detectImageType(','CR80_PORTRAIT','Status: "PENDING"','getCardByStatus(auth.idUser, "PENDING")','requireIdCardAdmin(auth)','signatureDataUrl','approve_digital_id_card','Head_SPPG_Signature_Storage_Path','.eq("Status", "ACTIVE")','createSignedUrl(path, SIGNED_URL_SECONDS)']) if(!endpoint.includes(marker))throw new Error(`DigitalIdentity backend missing ${marker}`);
  if(!endpoint.includes('if (action === "verifyDigitalIdentity")'))throw new Error("public verification must be isolated before session authentication");
  const obsolete=deploy.split('$ObsoleteFunctions = @(')[1]?.split('\n)')[0]||'',publicFns=deploy.split('$PublicFunctionNames = @(')[1]?.split('\n)')[0]||'';
  if(!obsolete.includes('"DigitalIdentityPrint"')||!obsolete.includes('"ResetDigitalIdentityOnce"'))throw new Error("retired ID card helpers must remain on cleanup list");
  if(!publicFns.includes('"DigitalIdentity"')||publicFns.includes('"DigitalIdentityPrint"'))throw new Error("public production allowlist must contain canonical DigitalIdentity only");
  for(const action of ["getMyDigitalIdentity","generateMyDigitalIdentity","regenerateMyDigitalIdentity","getIdCardAdminOverview","approveIdCardRequests"]) if(!config.includes(`'${action}'`))throw new Error(`frontend gateway missing ${action}`);
});

Deno.test("profile preview and downloaded PDF share one stable 300 DPI CR80 master raster", async () => {
  const controller=await read("src/app/digital-id-card.js"),renderer=await read("src/app/digital-id-card-master-renderer.js"),css=await read("src/styles/pages/digital-id-card.css"),rendererCss=await read("src/styles/pages/digital-id-card-master-renderer.css"),bootstrap=await read("src/app/bootstrap.js"),assets=await read("src/app/pwa-shell-assets.js"),release=await read("src/app/release-version.js"),serviceWorker=await read("sw.js"),config=await read("supabase-config.js");
  for(const marker of ['Buat ID Card','Menunggu Persetujuan Kepala SPPG','Daftar ID Card','Pengajuan ID Card','id-card-pending-nav-count','id-card-select-all','TTD Pilihan','Setujui Semua','id-card-signature-canvas','Nama Kepala SPPG',"api('getIdCardAdminOverview')","api('approveIdCardRequests'","canvas.toDataURL('image/png')",'BGN_LOGO']) if(!controller.includes(marker))throw new Error(`ID card controller missing ${marker}`);
  for(const marker of ['const CARD_WIDTH = 638','const CARD_HEIGHT = 1011','53.98 * 72 / 25.4','85.6 * 72 / 25.4','digital-id-master-canvas',"canvas.toBlob","'image/jpeg', 0.97",'buildTwoPagePdf','/Count 2','/MediaBox [0 0','SATUAN PELAYANAN PEMENUHAN GIZI (SPPG)','KODE ID CARD','KEPALA SPPG','imageFromUrl(data.photoUrl)','imageFromUrl(data.qrUrl)','imageFromUrl(data.signatureUrl)','function dataSignature(data)','function stagingCanvas()','function commitCanvas(target, staging)','pair.dataset.masterSignature','function mutationTouchesCard(mutation)',"document.addEventListener('click', handleCardAction, true)"]) if(!renderer.includes(marker))throw new Error(`CR80 master renderer missing ${marker}`);
  if(renderer.includes('new MutationObserver(queueRender)'))throw new Error("global unfiltered mutation rerender must not return");
  if(!renderer.includes("download-card")||!renderer.includes("print-card"))throw new Error("download and print must be intercepted by WYSIWYG renderer");
  for(const rule of ['.digital-id-portrait-card','aspect-ratio:53.98/85.6','.id-card-admin-nav-group','.id-card-signature-canvas'])if(!css.includes(rule))throw new Error(`ID card base CSS missing ${rule}`);
  for(const rule of ['.digital-id-master-preview','.digital-id-master-canvas','aspect-ratio:53.98/85.6','.has-master-preview>.digital-id-portrait-card'])if(!rendererCss.includes(rule))throw new Error(`master renderer CSS missing ${rule}`);
  for(const retired of ['digital-id-card-print-sync.js','digital-id-card-v2.css'])if(assets.includes(retired)||serviceWorker.includes(retired))throw new Error(`retired ID card asset still referenced: ${retired}`);
  if(!bootstrap.includes('HADIRLY_RELEASE?.version')||!bootstrap.includes('HADIRLY_PWA_ASSETS'))throw new Error("bootstrap must use shared release and asset manifests");
  if(!release.includes("version = '26.11.53'")||!release.includes("cacheName = 'absen-sppg-hadirly-v94'"))throw new Error("shared release version/cache mismatch");
  if(!assets.includes("'./src/app/digital-id-card-master-renderer.js'")||!assets.includes("'./src/styles/pages/digital-id-card-master-renderer.css'"))throw new Error("shared asset manifest must load CR80 master renderer assets");
  if(!serviceWorker.includes('...ASSETS.scripts.map(versioned)')||!serviceWorker.includes('...ASSETS.styles.map(versioned)'))throw new Error("service worker must cache shared asset manifest");
  if(!config.includes("await import('./src/app/release-version.js')")||!config.includes('bootstrap.js?v=${version}'))throw new Error("top-level bootstrap must use shared release version");
  if(!serviceWorker.includes("'./verify-id.html'"))throw new Error("ID verification page must remain in PWA shell");
});

Deno.test("profile employment editor can update identity/employment data but never daily salary", async () => {
  const editor=await read("src/app/profile-employment-editor.js"),profileIdentity=await read("src/app/profile-contract-identity.js"),profileOps=await read("supabase/functions/ProfileOps/index.ts"),assets=await read("src/app/pwa-shell-assets.js"),deploy=await read("deploy-supabase.ps1");
  for(const field of ["NIK","Alamat","SPPG","Yayasan","Jabatan_Divisi","Tanggal_Mulai_Kerja"]) if(!editor.includes(field)||!profileOps.includes(field))throw new Error(`employment field missing: ${field}`);
  for(const marker of ['edit-gaji-harian','disabled aria-readonly="true"','/functions/v1/ProfileOps','event.stopImmediatePropagation()','Nama_Lengkap','Nomor_Rekening']) if(!editor.includes(marker))throw new Error(`profile editor missing ${marker}`);
  for(const marker of ['Object.prototype.hasOwnProperty.call(updates, "Gaji_Harian")','Gaji Harian hanya dapat diubah oleh ADMIN/SUPER ADMIN','Object.prototype.hasOwnProperty.call(updates, "Role")','Object.prototype.hasOwnProperty.call(updates, "Status_Aktif")','resolveFoundation','Master_SPPG','UPDATE_PROFIL','getProfileEmployment']) if(!profileOps.includes(marker))throw new Error(`ProfileOps protection missing ${marker}`);
  for(const marker of ["p-nik","p-alamat","getProfileEmployment","NIK","Alamat Lengkap"]) if(!profileIdentity.includes(marker))throw new Error(`profile contract identity display missing ${marker}`);
  const stringFields=profileOps.split('const stringFields')[1]?.split('];')[0]||'';if(stringFields.includes('Gaji_Harian'))throw new Error("Gaji_Harian must not be self-editable");
  if(!assets.includes("'./src/app/profile-employment-editor.js'")||!assets.includes("'./src/app/profile-contract-identity.js'"))throw new Error("profile identity assets must be loaded and cached through shared manifest");
  const internal=deploy.split('$InternalFunctionNames = @(')[1]?.split('\n)')[0]||'',aliases=deploy.split('$GatewayAliases = @(')[1]?.split('\n)')[0]||'';
  if(!internal.includes('"ProfileOpsCore"')||!aliases.includes('"ProfileOps"'))throw new Error("ProfileOps must deploy as a gateway alias backed by ProfileOpsCore");
});
