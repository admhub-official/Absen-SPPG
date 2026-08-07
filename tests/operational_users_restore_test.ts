const read = (path: string) => Deno.readTextFile(path);

Deno.test("Data Users and operational dashboard are served safely by OperationsV2", async () => {
  const endpoint = await read("supabase/functions/OperationsV2/index.ts");
  const config = await read("supabase-config.js");
  const index = await read("index.html");
  const deploy = await read("deploy-supabase.ps1");

  for (const marker of [
    'action === "getOperationalUsersV2"','action === "getOperationalDashboardV2"','async function operationalUsers','async function operationalDashboard','requireOperationalRole(auth)','allowedSppg(auth)','Akses_Email','USER_SAFE_COLUMNS','URL_Foto_Profil','Waktu_Timestamp','Last_Activity_At','filterOptions','_online','_profileScore','_todayPunches','pendingRecipientSignatures','profilBelumLengkap','pageSize',
  ]) if (!endpoint.includes(marker)) throw new Error(`OperationsV2 operational API missing ${marker}`);

  if (endpoint.includes('select("ID_User,Jenis_Absen,Jam,Tanggal")') || endpoint.includes('.order("Jam"')) throw new Error("Data Users must use Absensi.Waktu_Timestamp");
  if (endpoint.includes('db.from("Users").select("*")')) throw new Error("Data Users must never expose every Users column");
  for (const secret of ["Password_Hash", "Password_Salt", "Token_Reset_Password", "Face_Descriptor_JSON"]) {
    const safeColumns = endpoint.split("const USER_SAFE_COLUMNS")[1]?.split("].join")[0] || "";
    if (safeColumns.includes(secret)) throw new Error(`sensitive Users field leaked: ${secret}`);
  }
  if (!index.includes("apiCall('getOperationalUsersV2'")) throw new Error("Data Users frontend no longer calls operational users endpoint");
  if (!index.includes("'getOperationalDashboardV2'")) throw new Error("Dashboard frontend no longer calls operational dashboard endpoint");
  for (const marker of ["operationsV2FunctionName: 'OperationsV2'","'getOperationalUsersV2','getOperationalDashboardV2'",'return callOperationsV2(functionName,payload)']) if (!config.includes(marker)) throw new Error(`frontend OperationsV2 routing missing ${marker}`);
  const publicFns = deploy.split('$PublicFunctionNames = @(')[1]?.split('\n)')[0] || '';
  if (!publicFns.includes('"OperationsV2"')) throw new Error("OperationsV2 must remain on public production deploy allowlist");
});
