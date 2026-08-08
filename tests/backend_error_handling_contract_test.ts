const read = (path: string) => Deno.readTextFile(path);

Deno.test("modern edge functions surface persistence and validation failures", async () => {
  const absenV2 = await read("supabase/functions/AbsenV2/index.ts");
  for (const marker of ["persistIdempotencyBestEffort", "IDEMPOTENCY_UPDATE_DEFERRED", "IDEMPOTENCY_CLEANUP_FAILED"]) {
    if (!absenV2.includes(marker)) throw new Error(`AbsenV2 hardening missing ${marker}`);
  }
  for (const legacy of [
    'if (isIdempotent) await supabase.from("API_Idempotency").update',
    'new Date(existing.Expires_At).getTime() <= Date.now()) await supabase.from("API_Idempotency").delete',
  ]) {
    if (absenV2.includes(legacy)) throw new Error(`AbsenV2 still has unchecked idempotency write: ${legacy}`);
  }

  const operations = await read("supabase/functions/OperationsV2/index.ts");
  for (const marker of ["function requiredBoolean", "function plainObject", "function optionalIsoDateTime", "function workflowStatus"]) {
    if (!operations.includes(marker)) throw new Error(`OperationsV2 validation missing ${marker}`);
  }
  if (operations.includes("Enabled: Boolean(body.enabled)")) throw new Error("feature flag boolean coercion must not accept string false");
  if (!operations.includes('Before_Data: plainObject(body.beforeData, "beforeData")')) throw new Error("beforeData object validation missing");
  if (!operations.includes('After_Data: plainObject(body.afterData, "afterData")')) throw new Error("afterData object validation missing");
});

Deno.test("payroll workflow checks audit, cleanup, and final status persistence", async () => {
  const payroll = await read("supabase/functions/Absen/payroll-signature-workflow.ts");
  for (const marker of [
    "cleanupStorageBestEffort",
    "cleanupRowsBestEffort",
    "PAYROLL_FINAL_STATUS_DEFERRED",
    "if (result.error) throw result.error;",
  ]) if (!payroll.includes(marker)) throw new Error(`payroll persistence hardening missing ${marker}`);
  if (payroll.includes('await supabase.from("Payroll")\n        .update({ Status_Penerbitan: "DITERBITKAN" })')) {
    throw new Error("final payroll status update must inspect the returned error");
  }
});

Deno.test("digital identity no longer masks database failures as missing data", async () => {
  const source = await read("supabase/functions/DigitalIdentity/index.ts");
  if (!source.includes("if (result.error) throw result.error;\n  if (!result.data) throw new Error(\"ACCOUNT_INACTIVE\");")) {
    throw new Error("DigitalIdentity profile lookup must distinguish DB failure from missing account");
  }
  if (source.includes('getProfile(String(cardResult.data.ID_User)).catch(() => null)')) {
    throw new Error("verification must not convert profile DB failure into INACTIVE");
  }
  if (source.includes('getCardByStatus(auth.idUser, "PENDING").catch(() => null)')) {
    throw new Error("duplicate request race lookup must not swallow DB errors");
  }
  if (!source.includes("DIGITAL_ID_ARTIFACT_CLEANUP_DEFERRED") || !source.includes("if (result.error) throw result.error;")) {
    throw new Error("DigitalIdentity storage cleanup errors must be observed");
  }
});

Deno.test("employment contracts check signed URL and compensation query errors", async () => {
  const source = await read("supabase/functions/EmploymentContracts/index.ts");
  if (!source.includes('if (result.error) throw new Error("Tautan dokumen gagal dibuat: " + result.error.message);')) {
    throw new Error("EmploymentContracts signed URL errors are not surfaced");
  }
  if (!source.includes('if (compResult.error) throw new Error("Master kompensasi gagal dibaca: " + compResult.error.message);')) {
    throw new Error("EmploymentContracts compensation query errors are not surfaced");
  }
});

Deno.test("pinned AbsenCore remains isolated behind the hardened public proxy", async () => {
  const core = await read("supabase/functions/AbsenCore/index.ts");
  const proxy = await read("supabase/functions/Absen/proxy.ts");
  if (!core.includes("raw.githubusercontent.com") || !core.includes("52f97758af5c174346a3ceee78bb5db852e19a72")) {
    throw new Error("legacy core boundary changed unexpectedly");
  }
  for (const marker of ["function mappedError", "function legacyFailure", "function forwardResponse", "LEGACY_CORE_URL"]) {
    if (!proxy.includes(marker)) throw new Error(`public Absen proxy boundary missing ${marker}`);
  }
  if (!proxy.includes("if (failure) return json({ ...failure.body, requestId }, failure.status, requestId);")) {
    throw new Error("legacy success:false envelopes must be promoted to HTTP errors at the public boundary");
  }
});