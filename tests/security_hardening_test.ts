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

Deno.test("critical attendance otp and device boundaries stay database enforced", async () => {
  const migration = await read(
    "supabase/migrations/20260808231000_security_boundary_hardening.sql",
  );
  for (const token of [
    "enforce_self_attendance_identity",
    "enforce_email_otp_attempt_counter",
    "claim_reset_otp_attempt_before_token",
    "review_attendance_device",
  ]) {
    if (!migration.includes(token)) throw new Error(`missing security boundary ${token}`);
  }
});

Deno.test("reset otp verification is throttled by ip and email at the public gateway", async () => {
  const proxy = await read("supabase/functions/Absen/proxy.ts");
  for (const token of [
    "verifyResetPasswordOtp",
    "consume_api_rate_limit",
    "VERIFY_RESET_OTP_IP",
    "VERIFY_RESET_OTP_EMAIL",
    "RATE_LIMITED",
  ]) {
    if (!proxy.includes(token)) throw new Error(`missing reset otp throttle ${token}`);
  }
});

Deno.test("operations v2 scopes arbitrary user and payroll targets", async () => {
  const operations = await read("supabase/functions/OperationsV2/index.ts");
  for (const token of [
    "assertUserInScope",
    "PAYROLL_NOT_FOUND",
    "listPayrollWorkflow",
    "listUserAccess",
    "recordUserSecurityEvent",
  ]) {
    if (!operations.includes(token)) throw new Error(`missing OperationsV2 scope guard ${token}`);
  }
});

Deno.test("workforce single-sppg scope is strict-type safe", async () => {
  const workforce = await read("supabase/functions/WorkforceOps/index.ts");
  if (!workforce.includes("if (scope.length === 1) return scope[0]!;")) {
    throw new Error("WorkforceOps single-SPPG scope must assert the checked array element");
  }
});
