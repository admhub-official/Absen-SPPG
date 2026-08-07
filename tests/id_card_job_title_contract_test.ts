const read = (path: string) => Deno.readTextFile(path);

Deno.test("ID Card job title comes only from Jabatan_Divisi", async () => {
  const editor = await read("src/app/profile-employment-editor.js");
  const bootstrap = await read("src/app/bootstrap.js");
  const migration = await read("supabase/migrations/20260807114500_require_id_card_job_title.sql");

  for (const marker of [
    "normalizedJobTitle",
    "Jabatan_Divisi",
    "Jabatan / Divisi belum diatur",
    "ID Card tidak akan menggunakan Role akun sebagai pengganti jabatan",
    "generateButton.disabled = true",
    "jobTitleSource: 'Jabatan_Divisi'",
  ]) {
    if (!editor.includes(marker)) throw new Error(`employment guard missing ${marker}`);
  }

  const profileEditorIndex = bootstrap.indexOf("'./src/app/profile-employment-editor.js'");
  const digitalIdIndex = bootstrap.indexOf("'./src/app/digital-id-card.js'");
  if (profileEditorIndex < 0 || digitalIdIndex < 0 || profileEditorIndex > digitalIdIndex) {
    throw new Error("employment guard must load before the ID Card controller");
  }

  for (const marker of [
    "create or replace function public.require_id_card_job_title()",
    '"Jabatan_Divisi"',
    "ID_CARD_JOB_TITLE_REQUIRED",
    "before insert on public.\"Digital_ID_Cards\"",
    "Role akun tidak boleh menjadi fallback jabatan pada ID Card",
  ]) {
    if (!migration.includes(marker)) throw new Error(`job title migration missing ${marker}`);
  }
});
