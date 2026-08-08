const read = (path: string) => Deno.readTextFile(path);

interface AbortRuntime {
  rotate: (reason?: string) => number;
  abortPending: (reason?: string) => number;
  generation: () => number;
  isSessionBoundRequest: (input: RequestInfo | URL, init?: RequestInit) => boolean;
}

interface FakeWindow extends EventTarget {
  fetch: typeof fetch;
  location: { href: string; origin: string };
  ABSEN_SUPABASE_CONFIG: { projectUrl: string };
  __HADIRLY_SESSION_REQUEST_ABORT__?: boolean;
  HadirlySessionRequestAbort?: AbortRuntime;
}

Deno.test("session request abort cancels private in-flight fetches but preserves public auth flows", async () => {
  const source = await read("src/app/session-request-abort.js");
  const calls: Array<{ url: string; signal: AbortSignal | null }> = [];

  const fakeWindow = new EventTarget() as FakeWindow;
  fakeWindow.location = { href: "https://hadirly.org/#dashboard", origin: "https://hadirly.org" };
  fakeWindow.ABSEN_SUPABASE_CONFIG = { projectUrl: "https://project.supabase.co" };
  fakeWindow.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const signal = init.signal ?? (input instanceof Request ? input.signal : null);
    calls.push({ url, signal });
    if (!signal) return Promise.resolve(new Response("{}", { status: 200 }));
    return new Promise<Response>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        return;
      }
      signal.addEventListener("abort", () => reject(signal.reason ?? new DOMException("Aborted", "AbortError")), { once: true });
      void resolve;
    });
  }) as typeof fetch;

  const run = new Function("window", "URL", "Request", "AbortController", "AbortSignal", "DOMException", source);
  run(fakeWindow, URL, Request, AbortController, AbortSignal, DOMException);

  const runtime = fakeWindow.HadirlySessionRequestAbort;
  if (!runtime) throw new Error("session request abort runtime was not installed");

  const pending = fakeWindow.fetch("https://hadirly.org/api/functions/AbsenV2", {
    method: "POST",
    body: JSON.stringify({ function: "getDashboardData" }),
  }).then(
    () => null,
    (error: unknown) => error,
  );

  await Promise.resolve();
  if (!calls[0]?.signal) throw new Error("private API request did not receive a session AbortSignal");
  if (calls[0].signal.aborted) throw new Error("private API request started already aborted");

  runtime.rotate("TEST_SESSION_CHANGE");
  const abortError = await pending;
  if (!calls[0].signal.aborted) throw new Error("private API request was not physically aborted");
  if (!(abortError instanceof DOMException) || abortError.name !== "AbortError") {
    throw new Error("private API request did not reject with AbortError");
  }

  await fakeWindow.fetch("https://project.supabase.co/functions/v1/AbsenV2", {
    method: "POST",
    body: JSON.stringify({ function: "getPublicConfig", data: {} }),
  });
  if (calls[1]?.signal) throw new Error("public pre-login function must not inherit the session AbortSignal");

  await fakeWindow.fetch("https://hadirly.org/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: "demo", password: "demo" }),
  });
  if (calls[2]?.signal) throw new Error("login request must not inherit the previous session AbortSignal");
});

Deno.test("logout rotates stale requests before server revoke and bootstrap initializes abort layer first", async () => {
  const logout = await read("src/app/logout-session-guard.js");
  const bootstrap = await read("src/app/bootstrap.js");
  const sw = await read("sw.js");

  const rotateIndex = logout.indexOf("HadirlySessionRequestAbort?.rotate?.('LOGOUT_START')");
  const revokeIndex = logout.indexOf("window.apiCall('logout', { token }, { force: true })");
  if (rotateIndex < 0 || revokeIndex < 0 || rotateIndex > revokeIndex) {
    throw new Error("logout must abort stale private requests before server revoke");
  }

  const abortImport = bootstrap.indexOf("import './session-request-abort.js';");
  const bffImport = bootstrap.indexOf("import './http-only-session-bridge.js';");
  if (abortImport !== 0 || bffImport < 0 || abortImport > bffImport) {
    throw new Error("session request abort layer must initialize before the HttpOnly BFF bridge");
  }
  if (!sw.includes("'./src/app/session-request-abort.js'")) {
    throw new Error("service worker shell must precache the session request abort runtime");
  }
});

Deno.test("quality requires browser smoke before production readiness marker", async () => {
  const workflow = await read(".github/workflows/quality.yml");
  const browserSmoke = await read("tests/browser_public_smoke.mjs");

  for (const marker of [
    "browser-smoke:",
    "needs: deno-quality",
    "node tests/browser_public_smoke.mjs",
    "production-readiness:",
    "needs: [deno-quality, browser-smoke]",
    "status=deployable",
  ]) {
    if (!workflow.includes(marker)) throw new Error(`quality workflow missing gated marker: ${marker}`);
  }
  const browserBlock = workflow.split("browser-smoke:")[1]?.split("production-readiness:")[0] || "";
  if (browserBlock.includes("github.event_name == 'push'")) {
    throw new Error("browser smoke must run on pull requests as well as main pushes");
  }
  const readinessBlock = workflow.split("production-readiness:")[1] || "";
  if (!readinessBlock.includes("github.event_name == 'push' && github.ref == 'refs/heads/main'")) {
    throw new Error("production readiness marker must remain restricted to main pushes");
  }
  for (const marker of [
    "#register",
    "#btn-to-login",
    "#btn-to-register",
    "page.goBack",
    "#route-that-does-not-exist",
    "expectOnlyAuthPage('page-login')",
  ]) {
    if (!browserSmoke.includes(marker)) throw new Error(`browser smoke missing navigation assertion: ${marker}`);
  }
});
