const read = (path: string) => Deno.readTextFile(path);

Deno.test("attendance gateways have explicit and non-overlapping ownership", async () => {
  const core = await read("supabase/functions/AbsenCore/index.ts");
  const gateway = await read("supabase/functions/Absen/index.ts");
  const gatewayEntrypoint = await read("supabase/functions/Absen/geofence-gateway.ts");
  const gatewayImplementation = await read("supabase/functions/Absen/proxy.ts");
  const location = await read("supabase/functions/AttendanceLocation/index.ts");
  const v2 = await read("supabase/functions/AbsenV2/index.ts");
  const architecture = await read("docs/architecture/attendance-edge-functions.md");

  if (!core.includes("raw.githubusercontent.com") || !core.includes("/supabase/functions/Absen/index.ts")) {
    throw new Error("AbsenCore must remain a pinned legacy implementation");
  }
  if (!gateway.includes("geofence-gateway.ts") || !gatewayEntrypoint.includes("./proxy.ts")) {
    throw new Error("Absen must use the canonical compatibility proxy");
  }
  if (!gatewayImplementation.includes("/functions/v1/AttendanceLocation")) {
    throw new Error("Absen must route location operations to AttendanceLocation");
  }
  if (!gatewayImplementation.includes("/functions/v1/AbsenLegacy")) {
    throw new Error("Absen must preserve forwarding for non-location legacy operations");
  }
  for (const operation of ["getAttendanceLocationPolicy", "checkAttendanceLocation", "recordAbsensiSelf"]) {
    if (!gatewayImplementation.includes(operation)) {
      throw new Error(`Absen location routing missing ${operation}`);
    }
  }
  for (const sourceToken of ["Lokasi_SPPG", "attendance.geofence_required", "is_face_attendance_enabled"]) {
    if (!location.includes(sourceToken)) {
      throw new Error(`AttendanceLocation backend source missing ${sourceToken}`);
    }
  }
  for (const forbidden of ["SPPG_LOCATIONS", "RADIUS_ABSEN_METER", "coreCompatibilityPoint"]) {
    if (gatewayImplementation.includes(forbidden) || location.includes(forbidden)) {
      throw new Error(`Active location backend must not contain legacy hardcode: ${forbidden}`);
    }
  }
  if (!v2.includes("/functions/v1/Absen") || !v2.includes("Attendance_Challenges")) {
    throw new Error("AbsenV2 must protect attendance and forward to Absen");
  }
  for (const token of ["Frontend tidak boleh memanggil `AbsenCore`", "AttendanceLocation", "AbsenV2", "Urutan deployment"]) {
    if (!architecture.includes(token)) throw new Error(`attendance architecture missing ${token}`);
  }
});

Deno.test("deployment includes attendance functions in dependency order", async () => {
  const deploy = await read("deploy-supabase.ps1");
  const core = deploy.indexOf('"AbsenCore"');
  const location = deploy.indexOf('"AttendanceLocation"', core + 1);
  const gateway = deploy.indexOf('"Absen"', location + 1);
  const v2 = deploy.indexOf('"AbsenV2"', gateway + 1);

  if (core < 0 || location < 0 || gateway < 0 || v2 < 0) {
    throw new Error("deployment must include AbsenCore, AttendanceLocation, Absen, and AbsenV2");
  }
  if (!(core < location && location < gateway && gateway < v2)) {
    throw new Error("attendance functions must deploy in AbsenCore -> AttendanceLocation -> Absen -> AbsenV2 order");
  }
});

Deno.test("frontend source does not call AbsenCore directly", async () => {
  const frontendPaths = [
    "index.html",
    "supabase-config.js",
    "security-ops-client.js",
    "src/services/api-client.js",
    "src/services/domain-services.js",
    "src/services/attendance-correction-service.js",
  ];

  for (const path of frontendPaths) {
    const source = await read(path);
    if (source.includes("functions/v1/AbsenCore") || source.includes("'AbsenCore'") || source.includes('"AbsenCore"')) {
      throw new Error(`${path} must not call AbsenCore directly`);
    }
  }
});
