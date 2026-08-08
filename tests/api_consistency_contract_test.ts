const read = (path: string) => Deno.readTextFile(path);

Deno.test("legacy frontend V2/V3 calls are routed to OperationsV2 handlers", async () => {
  const config = await read("supabase-config.js");
  const operations = await read("supabase/functions/OperationsV2/index.ts");
  for (const name of ["getAbsensiGroupedDataV2", "validateAttendanceBulkV3", "getSuperAdminAuditV3"]) {
    if (!config.includes(`'${name}'`)) throw new Error(`supabase-config missing ${name} route`);
    if (!operations.includes(`action === \"${name}\"`)) throw new Error(`OperationsV2 missing ${name} handler`);
  }
  if (!config.includes("functionName === 'manageSystemSettingsV3'")) {
    throw new Error("legacy system settings call is not bridged to SystemSettings");
  }
});

Deno.test("attendance validation preserves the canonical database status vocabulary", async () => {
  const operations = await read("supabase/functions/OperationsV2/index.ts");
  if (!operations.includes('action === "DITOLAK" ? "TIDAK_VALID" : action')) {
    throw new Error("DITOLAK must persist as canonical TIDAK_VALID");
  }
  if (operations.includes('action === "DITOLAK" ? "INVALID" : action')) {
    throw new Error("legacy INVALID status must not be introduced by bulk validation");
  }
});

Deno.test("modular PlatformOps and WorkforceOps services call their edge endpoints directly", async () => {
  const platform = await read("src/services/platform-ops-service.js");
  const workforce = await read("src/services/workforce-ops-service.js");
  if (!platform.includes("/functions/v1/PlatformOps") || platform.includes("apiClient.call('PlatformOps'")) {
    throw new Error("PlatformOps service routing is inconsistent");
  }
  if (!workforce.includes("/functions/v1/WorkforceOps") || workforce.includes("apiClient.call('WorkforceOps'")) {
    throw new Error("WorkforceOps service routing is inconsistent");
  }
});

Deno.test("derived API fields use canonical camelCase enrich names", async () => {
  const settingsBackend = await read("supabase/functions/SystemSettings/index.ts");
  const settingsFrontend = await read("src/app/system-settings.js");
  const securityUi = await read("security-operations-ui.js");
  if (!settingsBackend.includes("_enabled:") || settingsBackend.includes("Enabled: Boolean(row.Setting_Value?.enabled)")) {
    throw new Error("SystemSettings derived enabled field is not canonical");
  }
  if (!settingsFrontend.includes("row?._enabled") || settingsFrontend.includes("row?.Enabled")) {
    throw new Error("SystemSettings frontend still consumes legacy Enabled enrich field");
  }
  for (const legacy of ["security_events", "high_risk_events", "open_incidents", "critical_incidents", "pending_devices", "blocked_devices", "failed_challenges", "rejected_events"]) {
    if (securityUi.includes(legacy)) throw new Error(`Security UI still consumes legacy ${legacy} field`);
  }
});

Deno.test("payroll list uses the standard result envelope", async () => {
  const backend = await read("supabase/functions/PayrollListPage/index.ts");
  const history = await read("src/features/payroll/payroll-history.js");
  const domains = await read("src/services/domain-services.js");
  if (!backend.includes("success: true, result")) throw new Error("PayrollListPage does not expose result envelope");
  if (!history.includes("payload?.result || {}")) throw new Error("Payroll history does not read result envelope");
  if (!domains.includes("payload?.result ||")) throw new Error("Domain payroll service does not read result envelope");
});

Deno.test("domain services no longer reference audited dead legacy API names", async () => {
  const source = await read("src/services/domain-services.js");
  for (const dead of [
    "getAbsensiSaya", "getAttendanceSummary", "getProfile", "updateProfile",
    "getPengaduan", "createPengaduan", "getPengaduanDetail", "replyPengaduan", "markPengaduanRead",
    "getPayrollHistory", "getPayrollSlipDetail", "issuePayrollSlips", "signPayrollSlip", "getPayrollDownloadUrl",
  ]) {
    if (source.includes(`'${dead}'`)) throw new Error(`dead API name still referenced: ${dead}`);
  }
});
