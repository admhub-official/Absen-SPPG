const read = (path: string) => Deno.readTextFile(path);

Deno.test("bootstrap loads the compact mobile UI runtime", async () => {
  const bootstrap = await read("src/app/bootstrap.js");
  if (!bootstrap.includes("mobile-ui-refresh.css")) throw new Error("mobile refresh stylesheet missing");
  if (!bootstrap.includes("mobile-ui-refresh.js")) throw new Error("mobile refresh runtime missing");
});

Deno.test("mobile filters are collapsed only for known filter containers", async () => {
  const runtime = await read("src/app/mobile-ui-refresh.js");
  if (!runtime.includes("document.createElement('details')")) throw new Error("filter accordion missing");
  for (const id of ["users-filter-grid", "audit-filter-grid", "absen-filter-grid"]) {
    if (!runtime.includes(id)) throw new Error(`known filter missing: ${id}`);
  }
  if (runtime.includes(".filters") || runtime.includes(".filter-grid")) {
    throw new Error("generic filter selectors must not be enhanced automatically");
  }
  if (!runtime.includes("mobile-filter-panel__count")) throw new Error("active filter count missing");
});

Deno.test("mobile enhancement avoids document-wide mutation", async () => {
  const runtime = await read("src/app/mobile-ui-refresh.js");
  if (runtime.includes("MutationObserver")) throw new Error("document-wide MutationObserver is not allowed");
  for (const forbidden of [".modal", ".dialog", "[role=\"dialog\"]", "[role=\"tablist\"]"]) {
    if (runtime.includes(forbidden)) throw new Error(`generic selector is unsafe: ${forbidden}`);
  }
});

Deno.test("mobile CSS is scoped and does not override every form control", async () => {
  const css = await read("src/styles/mobile-ui-refresh.css");
  for (const unsafe of [".form-input,input,select,textarea", ".btn,button", "[role=\"tablist\"]{"]) {
    if (css.includes(unsafe)) throw new Error(`global mobile override is not allowed: ${unsafe}`);
  }
  if (!css.includes("html.mobile-ui-active")) throw new Error("mobile overrides must be scoped");
  for (const token of ["mobile-kpi-strip", "mobile-card-list", "mobile-tab-strip"]) {
    if (!css.includes(`.${token}`)) throw new Error(`missing mobile primitive ${token}`);
  }
});

Deno.test("mobile enhancements avoid business logic", async () => {
  const runtime = await read("src/app/mobile-ui-refresh.js");
  for (const forbidden of ["fetch(", "apiCall(", "localStorage.setItem", "window.location="]) {
    if (runtime.includes(forbidden)) throw new Error(`UI runtime must not perform business action: ${forbidden}`);
  }
});
