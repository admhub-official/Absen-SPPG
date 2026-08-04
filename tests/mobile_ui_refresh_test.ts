const read = (path: string) => Deno.readTextFile(path);

Deno.test("bootstrap loads the compact mobile UI runtime", async () => {
  const bootstrap = await read("src/app/bootstrap.js");
  if (!bootstrap.includes("mobile-ui-refresh.css")) throw new Error("mobile refresh stylesheet missing");
  if (!bootstrap.includes("mobile-ui-refresh.js")) throw new Error("mobile refresh runtime missing");
});

Deno.test("mobile filters are collapsed by default", async () => {
  const runtime = await read("src/app/mobile-ui-refresh.js");
  if (!runtime.includes("document.createElement('details')")) throw new Error("filter accordion missing");
  if (runtime.includes("panel.open=true") || runtime.includes("panel.setAttribute('open'")) {
    throw new Error("generated filter panel must remain collapsed by default");
  }
  if (!runtime.includes("mobile-filter-panel__count")) throw new Error("active filter count missing");
});

Deno.test("mobile layout supports KPI strips, card tables and bottom sheets", async () => {
  const runtime = await read("src/app/mobile-ui-refresh.js");
  const css = await read("src/styles/mobile-ui-refresh.css");
  for (const token of ["mobile-kpi-strip", "mobile-card-list", "mobile-tab-strip", "mobile-bottom-sheet"]) {
    if (!runtime.includes(token) || !css.includes(`.${token}`)) throw new Error(`missing mobile primitive ${token}`);
  }
  if (!css.includes("--mobile-header-height:56px")) throw new Error("compact mobile header token missing");
  if (!css.includes("--mobile-control-height:44px")) throw new Error("touch target token missing");
});

Deno.test("mobile enhancements avoid blocking business logic", async () => {
  const runtime = await read("src/app/mobile-ui-refresh.js");
  for (const forbidden of ["fetch(", "apiCall(", "localStorage.setItem", "window.location="]) {
    if (runtime.includes(forbidden)) throw new Error(`UI runtime must not perform business action: ${forbidden}`);
  }
});
