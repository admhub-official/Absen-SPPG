const read = (path: string) => Deno.readTextFile(path);

Deno.test("face attendance status RPC is not exposed to API roles", async () => {
  const migration = await read(
    "supabase/migrations/20260805145500_restrict_face_attendance_status_rpc.sql",
  );
  if (!migration.includes("function public.is_face_attendance_enabled(text)")) {
    throw new Error("face attendance status RPC hardening is missing");
  }
  if (!migration.includes("from public, anon, authenticated")) {
    throw new Error("face attendance status RPC must be revoked from public API roles");
  }
});
