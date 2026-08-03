import { assert, assertEquals } from "jsr:@std/assert";

const migration = await Deno.readTextFile("supabase/migrations/20260803230000_sprint6_production_readiness.sql");
const readinessFunction = await Deno.readTextFile("supabase/functions/ProductionReadiness/index.ts");
const deployScript = await Deno.readTextFile("deploy-supabase.ps1");

Deno.test("Sprint 6 migration creates policy and deployment audit tables", () => {
  assert(migration.includes('create table if not exists public."Attendance_Policies"'));
  assert(migration.includes('create table if not exists public."Deployment_Audit"'));
});

Deno.test("Sprint 6 migration exposes readiness and travel evaluation RPCs", () => {
  assert(migration.includes("public.evaluate_attendance_readiness"));
  assert(migration.includes("public.production_readiness_report"));
  assert(migration.includes("public.detect_impossible_travel"));
});

Deno.test("device enforcement remains feature flagged by default", () => {
  const match = migration.match(/"Require_Trusted_Device" boolean not null default (true|false)/);
  assert(match);
  assertEquals(match[1], "false");
});

Deno.test("revoked and blocked devices are denied by readiness evaluation", () => {
  assert(migration.includes("v_device.\"Status\" in ('BLOCKED','REVOKED')"));
  assert(migration.includes("DEVICE_NOT_ALLOWED"));
});

Deno.test("ProductionReadiness endpoint uses shared HTTP and validation modules", () => {
  assert(readinessFunction.includes('../_shared/http.ts'));
  assert(readinessFunction.includes('../_shared/validation.ts'));
  assert(readinessFunction.includes('../_shared/contracts.ts'));
});

Deno.test("deployment script includes ProductionReadiness", () => {
  assert(deployScript.includes('"ProductionReadiness"'));
});
