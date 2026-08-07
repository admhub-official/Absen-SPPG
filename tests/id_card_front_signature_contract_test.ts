const read = (path: string) => Deno.readTextFile(path);

Deno.test("front ID Card renders Kepala SPPG signature and keeps PDF canvas in sync", async () => {
  const renderer = await read("src/app/id-card-front-signature-renderer.js");
  const css = await read("src/styles/pages/id-card-front-signature.css");
  const assets = await read("src/app/pwa-shell-assets.js");
  const release = await read("src/app/release-version.js");
  const sw = await read("sw.js");
  for (const marker of ["digital-id-front-head-signature","KEPALA SPPG","MENUNGGU PERSETUJUAN","digital-id-master-canvas[data-side=\"front\"]","download-card","paintPair(pair)"]) if (!renderer.includes(marker)) throw new Error(`front signature renderer missing ${marker}`);
  for (const marker of [".digital-id-front-head-signature", "max-width:96px", "border-top:1px solid #e2e8f0"]) if (!css.includes(marker)) throw new Error(`front signature style missing ${marker}`);
  const frontRendererIndex = assets.indexOf("'./src/app/id-card-front-signature-renderer.js'");
  const masterRendererIndex = assets.indexOf("'./src/app/digital-id-card-master-renderer.js'");
  if (frontRendererIndex < 0 || masterRendererIndex < 0 || frontRendererIndex > masterRendererIndex) throw new Error("front signature renderer must load before master renderer");
  if (!assets.includes("'./src/styles/pages/id-card-front-signature.css'")) throw new Error("front signature stylesheet is not loaded");
  if (!release.includes("version = '26.11.52'") || !release.includes("cacheName = 'absen-sppg-hadirly-v93'")) throw new Error("frontend release/cache must match current release");
  if (!sw.includes('...ASSETS.scripts.map(versioned)') || !assets.includes("id-card-front-signature-renderer.js")) throw new Error("PWA shell does not cache front signature renderer");
});
