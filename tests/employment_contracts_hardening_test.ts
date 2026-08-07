const read = (path: string) => Deno.readTextFile(path);

Deno.test("employment contracts enforce identity, lifecycle and ADMIN master scope guards", async () => {
  const migration = await read("supabase/migrations/20260807150200_employment_contracts_hardening.sql");
  for (const marker of [
    "users_nik_format_check",
    "^[0-9]{16}$",
    "employment_contract_dates_check",
    "employment_contracts_one_open_primary_per_user",
    "DRAFT",
    "WAITING_MITRA",
    "WAITING_HEAD",
    "WAITING_EMPLOYEE",
    "enforce_contract_scoped_master_write",
    "GLOBAL_MASTER_REQUIRES_SUPER_ADMIN",
    "MASTER_SCOPE_FORBIDDEN",
    "enforce_contract_sppg_master_write",
    "Master_Jabatan",
    "Master_Job_Description",
    "Master_Jam_Kerja",
    "Master_Employment_Terms",
    "Master_Contract_Compensation",
    "Master_SOP_References",
    "Master_Contract_Templates",
  ]) {
    if (!migration.includes(marker)) throw new Error(`employment hardening missing ${marker}`);
  }
});
