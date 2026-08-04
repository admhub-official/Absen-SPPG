const read = (path: string) => Deno.readTextFile(path);

Deno.test("frontend has one modular bootstrap owner", async () => {
  const config = await read("supabase-config.js");
  const client = await read("security-ops-client.js");
  const bootstrap = await read("src/app/bootstrap.js");

  const configBootstrapImports = config.match(/import\(['"]\.\/src\/app\/bootstrap\.js/g) ?? [];
  if (configBootstrapImports.length !== 1) {
    throw new Error(`supabase-config must start bootstrap exactly once; found ${configBootstrapImports.length}`);
  }
  if (client.includes("src/app/bootstrap.js")) {
    throw new Error("security-ops-client must not bootstrap the application");
  }
  if (!bootstrap.includes("canonicalPath") || !bootstrap.includes("loadedAssets")) {
    throw new Error("bootstrap must deduplicate versioned and unversioned assets");
  }
});

Deno.test("legacy security loader was removed", async () => {
  const config = await read("supabase-config.js");
  if (config.includes("loadScript('./security-ops-client.js')")) {
    throw new Error("legacy Security Operations loader is still present");
  }
  if (config.includes("loadStyle('./security-operations-ui.css')")) {
    throw new Error("legacy Security Operations stylesheet loader is still present");
  }
});

Deno.test("security client is idempotent", async () => {
  const client = await read("security-ops-client.js");
  if (!client.includes("if (window.SecurityOpsClient) return")) {
    throw new Error("security client must prevent duplicate global initialization");
  }
});
