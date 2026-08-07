const read = (path: string) => Deno.readTextFile(path);

Deno.test("sidebar navigation has one canonical shell and no dead collapse aliases", async () => {
  const index = await read("index.html");
  const shell = await read("src/styles/layout/app-shell.css");
  const mobileCss = await read("src/styles/mobile-ui-refresh.css");
  const responsive = await read("src/styles/responsive-overrides.css");

  const count = (source: string, marker: string) => source.split(marker).length - 1;
  if (count(index, '<aside class="app-sidebar">') !== 1) throw new Error("app must render exactly one sidebar shell");
  if (count(index, '<nav class="app-nav">') !== 1) throw new Error("app must render exactly one desktop navigation list");
  if (count(index, '<nav class="app-bottomnav">') !== 1) throw new Error("app must render exactly one mobile bottom navigation");

  for (const dead of ["sidebar-is-collapsed", "sidebar-toggle-button", ".mobile-bottom-nav"]) {
    if (shell.includes(dead)) throw new Error(`app shell still contains dead navigation code: ${dead}`);
  }
  for (const marker of [
    "--app-sidebar-expanded:248px",
    "--app-sidebar-tablet:76px",
    "@media(min-width:768px) and (max-width:1023px)",
    "@media(max-width:767px)",
  ]) if (!shell.includes(marker)) throw new Error(`app shell missing canonical responsive marker: ${marker}`);

  if (!mobileCss.includes("html.mobile-ui-active .app-bottomnav")) throw new Error("mobile refresh must target canonical app-bottomnav");
  if (mobileCss.includes(".mobile-bottom-nav")) throw new Error("legacy mobile-bottom-nav alias must not return");
  if (responsive.includes("compact-bottom-nav") || responsive.includes("compact-topbar")) {
    throw new Error("unused compact navigation aliases must remain removed");
  }
});

Deno.test("sidebar helpers are scoped and dynamic employment navigation is idempotent", async () => {
  const layout = await read("src/app/layout-enhancements.js");
  const branding = await read("src/app/hadirly-branding.js");
  const employment = await read("src/app/employment-contract-navigation.js");

  if (layout.includes("isolateTabs")) throw new Error("generic layout helper must not own feature tab state");
  if (layout.includes("document.documentElement,{childList:true,subtree:true,attributes:true")) {
    throw new Error("layout helper must not observe the whole document and attributes");
  }
  for (const marker of [
    "document.querySelector('#app-layout .app-content')",
    "observer.observe(root,{childList:true,subtree:true})",
  ]) if (!layout.includes(marker)) throw new Error(`layout observer is not scoped: ${marker}`);

  if (branding.includes("new MutationObserver")) throw new Error("branding must not keep a global mutation observer");
  for (const marker of ["absen:app-ready", "absen:session-changed", "HadirlyBranding"]) {
    if (!branding.includes(marker)) throw new Error(`branding refresh contract missing ${marker}`);
  }

  for (const dead of ["retryTimers", "makeSentinel", "observeSessionUi", "new MutationObserver"]) {
    if (employment.includes(dead)) throw new Error(`employment navigation still contains churn/dead code: ${dead}`);
  }
  for (const marker of [
    "ensurePersonalNavigation",
    "ensureAdminNavigation",
    "session-sync-v4",
    "document.addEventListener('click'",
    "[data-employment-view]",
  ]) if (!employment.includes(marker)) throw new Error(`employment navigation missing idempotent contract: ${marker}`);
});

Deno.test("sidebar cleanup release assets stay version aligned", async () => {
  const bootstrap = await read("src/app/bootstrap.js");
  const sw = await read("sw.js");
  const config = await read("supabase-config.js");

  if (!bootstrap.includes("const VERSION = '26.11.48'")) throw new Error("frontend version mismatch");
  if (!sw.includes("const APP_VERSION = '26.11.48'") || !sw.includes("absen-sppg-hadirly-v89")) {
    throw new Error("PWA release/cache mismatch");
  }
  if (!config.includes("bootstrap.js?v=26.11.48")) throw new Error("bootstrap import version mismatch");
});
