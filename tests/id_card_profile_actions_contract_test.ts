const read = (path: string) => Deno.readTextFile(path);

Deno.test("profile ID Card exposes only request/renew and download actions", async () => {
  const policy = await read("src/app/id-card-profile-action-policy.js");
  const assets = await read("src/app/pwa-shell-assets.js");
  const serviceWorker = await read("sw.js");

  for (const removed of ["print-card", "download-qr", "print-qr"]) {
    if (!policy.includes(`'${removed}'`)) throw new Error(`profile action policy missing ${removed}`);
  }
  for (const marker of [
    "button.remove()",
    "id-card-profile-actions-compact",
    "grid-template-columns:repeat(2,minmax(0,1fr))",
  ]) {
    if (!policy.includes(marker)) throw new Error(`profile action policy missing ${marker}`);
  }
  if (policy.includes("'download-card'")) {
    throw new Error("Unduh ID Card must remain available in the profile action bar");
  }

  const policyIndex = assets.indexOf("'./src/app/id-card-profile-action-policy.js'");
  const controllerIndex = assets.indexOf("'./src/app/digital-id-card.js'");
  if (policyIndex < 0 || controllerIndex < 0 || policyIndex > controllerIndex) {
    throw new Error("profile action policy must load before the ID Card controller");
  }
  if (!serviceWorker.includes('...ASSETS.scripts.map(versioned)') || !assets.includes('id-card-profile-action-policy.js')) {
    throw new Error("profile action policy must be included in the shared PWA shell");
  }
});
