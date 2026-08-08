const read = (path: string) => Deno.readTextFile(path);

Deno.test("Master Jabatan is one Jabatan atau Divisi field with automatic code", async () => {
  const migration = await read("supabase/migrations/20260807191500_employment_master_document_seed.sql");
  const ui = await read("src/app/employment-master-normalization.js");
  const assets = await read("src/app/pwa-shell-assets.js");
  const release = await read("src/app/release-version.js");
  const sw = await read("sw.js");
  const config = await read("supabase-config.js");
  for (const marker of ["normalize_master_jabatan_contract",'new."Divisi" := new."Nama_Jabatan"',"new.\"Kode_Jabatan\" := left('JBT-' || v_slug, 40)","PENGAWAS GIZI","PENGAWAS KEUANGAN","PENGAWAS SANITASI","JURU MASAK","REF-BGN-401.1-2025","REF-ORG-SPPG-2026","REF-JAM-SPPG-2026"]) if (!migration.includes(marker)) throw new Error(`master migration missing ${marker}`);
  for (const marker of ["Jabatan atau Divisi *","Kode dibuat otomatis oleh sistem","m-kode-jabatan","m-divisi","codeFor"]) if (!ui.includes(marker)) throw new Error(`master UI normalization missing ${marker}`);
  if (!assets.includes("'./src/app/employment-master-normalization.js'")) throw new Error("master normalization script must load");
  if (!release.includes("version = '26.11.57'") || !release.includes("cacheName = 'absen-sppg-hadirly-v98'")) throw new Error("frontend/PWA release mismatch");
  if (!sw.includes('...ASSETS.scripts.map(versioned)')) throw new Error("PWA must cache shared script manifest");
  if (!config.includes("await import('./src/app/release-version.js')") || !config.includes('bootstrap.js?v=${version}')) throw new Error("bootstrap import must use shared release version");
});

Deno.test("document master seeds job descriptions, schedules, and SOP references", async () => {
  const migration = await read("supabase/migrations/20260807191500_employment_master_document_seed.sql");
  for (const marker of ["Master_Job_Description","Master_Jam_Kerja","MENEJMAN SOP SPPG","Keputusan Kepala BGN RI Nomor 401.1 Tahun 2025","time '03:00', time '11:00'","time '08:00', time '16:00'","time '16:00', time '00:00'","time '00:00', time '08:00'","time '03:00', time '08:00'","time '07:00', time '14:00'","time '13:00', time '21:00'","SOP-15","313 hari","6 hari kerja per minggu"]) if (!migration.includes(marker)) throw new Error(`document seed missing ${marker}`);
  if (/\('ADMIN',\s*\$txt\$|\('ADMIN PUSAT',\s*\$txt\$/i.test(migration)) throw new Error("unsupported Admin job description must not be invented from source documents");
});
