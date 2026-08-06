const read = (path: string) => Deno.readTextFile(path);

Deno.test("complaint workflow is canonical, idempotent, scoped, and privacy safe", async () => {
  const endpoint = await read("supabase/functions/Complaints/index.ts");
  const frontend = await read("supabase-config.js");
  const deploy = await read("deploy-supabase.ps1");

  for (const functionName of [
    "kirimPengaduan",
    "getRiwayatPengaduanSaya",
    "getNotifikasiAdmin",
    "getDaftarPengaduan",
    "tandaiSudahDibaca",
    "simpanTanggapanAdmin",
    "updateComplaintTicketV2",
    "closeMyComplaintTicketV2",
  ]) {
    if (!endpoint.includes(`case \"${functionName}\"`)) {
      throw new Error(`Complaints endpoint missing ${functionName}`);
    }
    if (!frontend.includes(`'${functionName}'`)) {
      throw new Error(`frontend does not route ${functionName} to Complaints`);
    }
  }

  if (!frontend.includes("complaintsFunctionName: 'Complaints'")) {
    throw new Error("Complaints function must be configured as the canonical endpoint");
  }
  if (!endpoint.includes("generateComplaintId(payload.idempotencyKey)")) {
    throw new Error("complaint submissions must use a stable idempotency key");
  }
  if (!endpoint.includes('insert.error.code === "23505"')) {
    throw new Error("duplicate complaint retries must resolve safely");
  }
  if (!endpoint.includes("async function auditBestEffort")) {
    throw new Error("audit failure must not reverse an already stored complaint");
  }
  if (!endpoint.includes('User_Pengirim: "Anonymous"') || !endpoint.includes("User: null")) {
    throw new Error("anonymous identity must be redacted for non-super-admin readers");
  }
  if (!endpoint.includes("accessibleSppgs(auth)")) {
    throw new Error("admin inbox operations must be scoped by SPPG access");
  }
  if (!deploy.includes('"Complaints"')) {
    throw new Error("Complaints must be included in the production deploy allowlist");
  }
});

Deno.test("profile update modal owns a real bounded scroll container", async () => {
  const css = await read("src/styles/pages/profile-forms-modals.css");
  const controller = await read("src/app/profile-forms-modals.js");

  for (const requiredCss of [
    "display:flex;flex-direction:column",
    ".modal-body{flex:1 1 auto;min-height:0",
    "overflow-y:auto",
    "-webkit-overflow-scrolling:touch",
    "calc(100dvh - env(safe-area-inset-top))",
  ]) {
    if (!css.includes(requiredCss)) throw new Error(`profile modal missing ${requiredCss}`);
  }
  if (!controller.includes("centerControlInModal")) {
    throw new Error("focused profile fields must be kept inside the modal viewport");
  }
  if (!controller.includes("data-modal-viewport")) {
    throw new Error("profile modal overlays must be explicitly enhanced");
  }
});

Deno.test("attendance import dialog provides accessible staged responsive UX", async () => {
  const controller = await read("src/app/attendance-import.js");
  const css = await read("src/styles/attendance-import.css");

  for (const marker of [
    'role=\"dialog\"',
    'aria-modal=\"true\"',
    'data-stage=\"source\"',
    'data-stage=\"review\"',
    'data-stage=\"done\"',
    "attendance-import-dropzone",
    "attendance-import-commit-hint",
    "setBusy(true",
    "refreshCommitState",
  ]) {
    if (!controller.includes(marker)) throw new Error(`attendance import missing ${marker}`);
  }
  for (const rule of [
    "body.attendance-import-open{overflow:hidden}",
    ".attendance-import-panel{display:flex;flex-direction:column",
    ".attendance-import-body{flex:1 1 auto;min-height:0;overflow:auto",
    "@media(max-width:700px)",
    ".attendance-import-table tr{display:grid",
  ]) {
    if (!css.includes(rule)) throw new Error(`attendance import CSS missing ${rule}`);
  }
});
