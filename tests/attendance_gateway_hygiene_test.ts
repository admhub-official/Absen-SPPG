const read = (path: string) => Deno.readTextFile(path);

Deno.test("attendance gateways have explicit and non-overlapping ownership", async () => {
  const core = await read("supabase/functions/AbsenCore/index.ts");
  const gateway = await read("supabase/functions/Absen/index.ts");
  const gatewayImplementation = await read("supabase/functions/Absen/geofence-gateway.ts");
  const v2 = await read("supabase/functions/AbsenV2/index.ts");
  const architecture = await read("docs/architecture/attendance-edge-functions.md");

  if (!core.includes("raw.githubusercontent.com") || !core.includes("/supabase/functions/Absen/index.ts")) {
    throw new Error("AbsenCore must remain a pinned legacy implementation");
  }
  if (!gateway.includes("geofence-gateway.ts")) {
    throw new Error("Absen must remain the compatibility/geofence gateway");
  }
  if (!gatewayImplementation.includes("/functions/v1/AbsenCore")) {
    throw new Error("Absen gateway must forward legacy operations to AbsenCore");
  }
  if (!v2.includes("/functions/v1/Absen") || !v2.includes("Attendance_Challenges")) {
    throw new Error("AbsenV2 must protect attendance and forward to Absen");
  }
  for (const token of ["Frontend tidak boleh memanggil `AbsenCore`", "AbsenV2", "Urutan deployment"]) {
    if (!architecture.includes(token)) throw new Error(`attendance architecture missing ${token}`);
  }
});

Deno.test("deployment includes attendance functions in dependency order", async () => {
  const deploy = await read("deploy-supabase.ps1");
  const core = deploy.indexOf('"AbsenCore"');
  const gateway = deploy.indexOf('"Absen"', core + 1);
  const v2 = deploy.indexOf('"AbsenV2"', gateway + 1);

  if (core < 0 || gateway < 0 || v2 < 0) {
    throw new Error("deployment must include AbsenCore, Absen, and AbsenV2");
  }
  if (!(core < gateway && gateway < v2)) {
    throw new Error("attendance functions must deploy in AbsenCore -> Absen -> AbsenV2 order");
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
