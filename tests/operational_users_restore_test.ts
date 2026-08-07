const read = (path: string) => Deno.readTextFile(path);

Deno.test("Data Users is served by OperationsV2 with scoped operational metadata", async () => {
  const endpoint = await read("supabase/functions/OperationsV2/index.ts");
  const config = await read("supabase-config.js");
  const index = await read("index.html");
  const deploy = await read("deploy-supabase.ps1");

  for (const marker of [
    'action === "getOperationalUsersV2"',
    'async function operationalUsers',
    'requireOperationalRole(auth)',
    'allowedSppg(auth)',
    'Akses_Email',
    'filterOptions',
    '_online',
    '_profileScore',
    '_todayPunches',
    'pageSize',
  ]) {
    if (!endpoint.includes(marker)) throw new Error(`OperationsV2 Data Users missing ${marker}`);
  }

  if (!index.includes("apiCall('getOperationalUsersV2'")) throw new Error("Data Users frontend no longer calls operational users endpoint");
  for (const marker of [
    "operationsV2FunctionName: 'OperationsV2'",
    "OPERATIONS_V2_WORKFLOW_FUNCTIONS = new Set(['getOperationalUsersV2'])",
    'return callOperationsV2(functionName,payload)',
  ]) {
    if (!config.includes(marker)) throw new Error(`frontend OperationsV2 routing missing ${marker}`);
  }
  const production = deploy.split('$FunctionNames = @(')[1]?.split('\n)')[0] || '';
  if (!production.includes('"OperationsV2"')) throw new Error("OperationsV2 must remain on production deploy allowlist");
});
