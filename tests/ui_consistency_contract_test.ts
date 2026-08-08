import { assert, assertEquals } from "jsr:@std/assert@1";

const read = (path: string) => Deno.readTextFile(path);

Deno.test("UI shell uses aligned tokens and reusable variants", async () => {
  const [index, shell, tokens, components] = await Promise.all([
    read("index.html"),
    read("src/legacy/index-shell.css"),
    read("src/styles/foundation/tokens.css"),
    read("src/styles/foundation/components.css"),
  ]);

  for (const marker of ["--success:#059669", "--danger:#dc2626", "--radius:.625rem", "--radius-lg:1rem"]) {
    assert(shell.includes(marker));
  }
  for (const marker of [
    "--ui-danger-200",
    "--ui-danger-800",
    "--ui-bottomnav-height",
    "--ui-bottomnav-clearance",
    "--ui-bottomnav-scan-size",
  ]) assert(tokens.includes(marker));
  for (const marker of [
    ".btn-danger{",
    ".btn-danger-soft{",
    ".modal-card--compact",
    ".signature-panel-actions",
    ".profile-photo-editor",
  ]) assert(components.includes(marker));

  assert(index.includes("<span>Presence SPPG</span>"));
  assert(!index.includes('<div style="flex:1"></div>'));
  assert(!index.includes('app-topbar-profile-wrap" style='));
  assert(!/<div class="modal-card" style="max-width:(?:400|420|500|520|620)px"/.test(index));
  assert(!index.includes('<span style="color:var(--danger)">*</span>'));
  assert(!index.includes('style="background:#fee2e2;color:#991b1b;border:1.5px solid #fca5a5"'));
});

Deno.test("mobile topbar and bottomnav share responsive geometry", async () => {
  const [index, shell, mobile, responsive, app, components] = await Promise.all([
    read("index.html"),
    read("src/legacy/index-shell.css"),
    read("src/styles/mobile-ui-refresh.css"),
    read("src/styles/responsive-overrides.css"),
    read("src/legacy/index-app.js"),
    read("src/styles/foundation/components.css"),
  ]);

  assert(shell.includes(".app-topbar-profile-wrap{position:relative;flex-shrink:0}"));
  assert(shell.includes(".app-topbar-brand span{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}"));
  assert(shell.includes("width:var(--ui-bottomnav-scan-size);height:var(--ui-bottomnav-scan-size)"));
  assert(shell.includes("margin-top:calc(-1 * var(--ui-bottomnav-scan-lift))"));
  assert(shell.includes("bottom:calc(var(--ui-bottomnav-height) + .5rem + env(safe-area-inset-bottom))"));
  assert(mobile.includes("padding-bottom:var(--ui-bottomnav-clearance)!important"));
  assert(mobile.includes("min-height:var(--ui-bottomnav-height)!important"));
  assert(responsive.includes("body{padding-bottom:var(--ui-bottomnav-height)"));
  assert(responsive.includes("scroll-margin-bottom:var(--ui-bottomnav-clearance)"));

  const scanButtons = index.match(/class="app-bottomnav-item app-bottomnav-item-scan/g) ?? [];
  assertEquals(scanButtons.length, 1);
  const scanLabels = index.match(/<span class="app-bottomnav-scan-label">Absen<\/span>/g) ?? [];
  assertEquals(scanLabels.length, 1);
  assert(index.includes('data-nav-role="user"'));
  assert(!/admin-only-nav[^"]*"[^>]*style="display:none"/.test(index));
  assert(!index.includes('id="absen-pagination" style="display:none"'));
  assert(!index.includes('id="users-pagination" style="display:none"'));
  assert(!index.includes('id="log-pagination" style="display:none"'));
  assert(!index.includes('id="crop-zoom" min="100" max="300" value="100" style='));
  assert(index.includes('class="crop-zoom-row"'));
  assert(index.includes('class="crop-zoom-hint"'));

  for (const marker of [
    "function setNavVisibility(selector,visible)",
    "setBottomNavRole('admin')",
    "setBottomNavRole('user')",
    "pg.hidden = false;",
    "pagination.hidden=false;",
    "badge.hidden=!count",
  ]) assert(app.includes(marker));
  assert(!app.includes("document.querySelectorAll('.admin-only-nav').forEach(el => el.style.display"));
  assert(!app.includes("pagination.style.display='flex'"));

  for (const marker of [
    ".nav-role-hidden{display:none!important}",
    ".app-nav-section-label{",
    ".crop-zoom-row{",
    '.app-bottomnav[data-nav-role="admin"] .app-bottomnav-item-scan{order:3}',
  ]) assert(components.includes(marker));
});
