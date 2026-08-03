import { assert, assertEquals } from "jsr:@std/assert";

const root = new URL("../", import.meta.url);

async function read(path: string) {
  return await Deno.readTextFile(new URL(path, root));
}

Deno.test("security operations UI exposes required workspaces", async () => {
  const source = await read("security-operations-ui.js");
  for (const workspace of ["dashboard", "incidents", "audit", "devices"]) {
    assert(source.includes(`data-security-tab=\"${workspace}\"`) || source.includes(`state.tab === '${workspace}'`));
  }
});

Deno.test("security operations UI uses existing secure clients", async () => {
  const source = await read("security-operations-ui.js");
  assert(source.includes("window.SecurityOpsClient"));
  assert(source.includes("window.getMyAttendanceDevices"));
  assert(source.includes("window.reviewAttendanceDevice"));
  assert(source.includes("window.revokeMyAttendanceDevice"));
});

Deno.test("security UI bootstrap loads stylesheet and scripts once", async () => {
  const config = await read("supabase-config.js");
  assert(config.includes("security-operations-ui.css"));
  assert(config.includes("security-ops-client.js"));
  assert(config.includes("security-operations-ui.js"));
  assert(config.includes("document.querySelector(`script[src=\"${src}\"]`)"));
});

Deno.test("device and security launchers remain role aware", async () => {
  const source = await read("security-operations-ui.js");
  assert(source.includes("SUPER ADMIN"));
  assert(source.includes("AKUNTAN"));
  assert(source.includes("Perangkat Saya"));
  assertEquals(source.includes("Security Ops"), true);
});
