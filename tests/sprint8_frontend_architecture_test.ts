import { assert, assertStringIncludes } from "jsr:@std/assert";

const read = (path: string) => Deno.readTextFile(path);

Deno.test("Sprint 8 exposes modular app shell", async () => {
  const bootstrap = await read("src/app/bootstrap.js");
  const router = await read("src/app/router.js");
  const store = await read("src/stores/app-store.js");
  assertStringIncludes(bootstrap, "window.AbsenApp");
  assertStringIncludes(bootstrap, "createRouter");
  assertStringIncludes(router, "hashchange");
  assertStringIncludes(store, "absen:state-change");
});

Deno.test("Sprint 8 standardizes UI states and responsive lists", async () => {
  const states = await read("src/components/ui-state.js");
  const list = await read("src/components/responsive-data-list.js");
  const css = await read("src/styles/app-system.css");
  assertStringIncludes(states, "renderLoading");
  assertStringIncludes(states, "renderEmpty");
  assertStringIncludes(states, "renderError");
  assertStringIncludes(list, "data-label");
  assertStringIncludes(css, "@media(max-width:720px)");
});

Deno.test("legacy SecurityOps bootstrap starts modular frontend", async () => {
  const client = await read("security-ops-client.js");
  assertStringIncludes(client, "import('./src/app/bootstrap.js')");
  assert(!client.includes("document.write"));
});
