const read = (path: string) => Deno.readTextFile(path);

async function assertMissing(path: string) {
  try {
    await Deno.stat(path);
    throw new Error(`obsolete attendance artifact still exists: ${path}`);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

Deno.test("attendance gateways have explicit and non-overlapping ownership", async () => {
  const core = await read("supabase/functions/AbsenCore/index.ts");
  const gateway = await read("supabase/functions/Absen/index.ts");
  const proxy = await read("supabase/functions/Absen/proxy.ts");
  const location = await read("supabase/functions/AttendanceLocation/index.ts");
  const v2 = await read("supabase/functions/AbsenV2/index.ts");
  const architecture = await read("docs/architecture/attendance-edge-functions.md");

  if (!core.includes("raw.githubusercontent.com") || !core.includes("/supabase/functions/Absen/index.ts")) {
    throw new Error("AbsenCore must remain a pinned legacy implementation");
  }
  if (!gateway.includes("./proxy.ts") || gateway.includes("geofence-gateway.ts")) {
    throw new Error("Absen must use the canonical proxy directly");
  }
  if (!proxy.includes("/functions/v1/AbsenCore")) {
    throw new Error("Absen proxy must forward legacy operations to AbsenCore");
  }
  if (!proxy.includes("/functions/v1/AttendanceLocation")) {
    throw new Error("Absen proxy must route location operations through the AttendanceLocation compatibility endpoint");
  }
  if (proxy.includes("AbsenLegacy")) {
    throw new Error("Absen proxy must not depend on the obsolete AbsenLegacy alias");
  }
  for (const operation of ["getAttendanceLocationPolicy", "checkAttendanceLocation", "recordAbsensiSelf"]) {
    if (!proxy.includes(operation)) throw new Error(`Absen location routing missing ${operation}`);
  }
  for (const sourceToken of ["Lokasi_SPPG", "attendance.geofence_required", "is_face_attendance_enabled"]) {
    if (!location.includes(sourceToken)) throw new Error(`AttendanceLocation backend source missing ${sourceToken}`);
  }
  for (const forbidden of ["SPPG_LOCATIONS", "RADIUS_ABSEN_METER", "coreCompatibilityPoint"]) {
    if (proxy.includes(forbidden) || location.includes(forbidden)) {
      throw new Error(`Active location backend must not contain legacy hardcode: ${forbidden}`);
    }
  }
  if (!v2.includes("/functions/v1/Absen") || !v2.includes("Attendance_Challenges")) {
    throw new Error("AbsenV2 must protect attendance and forward to Absen");
  }
  for (const path of ["supabase/functions/Absen/geofence-gateway.ts", "supabase/functions/AbsenProxy/index.ts"]) await assertMissing(path);
  for (const token of ["Frontend tidak boleh memanggil `AbsenCore`", "AttendanceLocation", "AbsenV2", "Urutan deployment"]) {
    if (!architecture.includes(token)) throw new Error(`attendance architecture missing ${token}`);
  }
});

Deno.test("deployment routes public attendance endpoints through gateway-backed cores", async () => {
  const deploy = await read("deploy-supabase.ps1");
  const internal = deploy.split('$InternalFunctionNames = @(')[1]?.split('\n)')[0] || '';
  const aliases = deploy.split('$GatewayAliases = @(')[1]?.split('\n)')[0] || '';
  for (const required of ['"AbsenCore"','"Absen"','"AbsenV2Core"','"AttendanceLocationCore"']) {
    if (!internal.includes(required)) throw new Error(`internal attendance deploy missing ${required}`);
  }
  for (const required of ['"AbsenV2"','"AttendanceLocation"']) {
    if (!aliases.includes(required)) throw new Error(`attendance compatibility gateway missing ${required}`);
  }
  if (!deploy.includes('Set-Content -LiteralPath $AliasIndex -Value $GatewaySource')) {
    throw new Error("legacy attendance aliases must deploy SessionGateway source");
  }
  const obsoleteBlock = deploy.match(/\$ObsoleteFunctions\s*=\s*@\(([\s\S]*?)\n\)/)?.[1] ?? "";
  for (const obsolete of ["AbsenLegacy", "AbsenProxy"]) {
    if (!obsoleteBlock.includes(`\"${obsolete}\"`)) throw new Error(`${obsolete} must be removed by production cleanup`);
  }
});

Deno.test("frontend source does not call internal attendance functions directly", async () => {
  const frontendPaths = ["index.html","supabase-config.js","security-ops-client.js","src/services/api-client.js","src/services/domain-services.js","src/services/attendance-correction-service.js"];
  for (const path of frontendPaths) {
    const source = await read(path);
    if (source.includes("functions/v1/AbsenCore") || source.includes("'AbsenCore'") || source.includes('"AbsenCore"')) throw new Error(`${path} must not call AbsenCore directly`);
    if (source.includes("functions/v1/AbsenLegacy") || source.includes("'AbsenLegacy'") || source.includes('"AbsenLegacy"')) throw new Error(`${path} must not call obsolete AbsenLegacy directly`);
  }
});
