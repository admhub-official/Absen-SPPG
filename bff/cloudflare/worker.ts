type Env = {
  HADIRLY_ORIGIN?: string;
  SUPABASE_URL?: string;
  SESSION_MAX_AGE_SECONDS?: string;
  ALLOW_LEGACY_EXCHANGE?: string;
};

type JsonObject = Record<string, unknown>;

const COOKIE_NAME = "__Host-hadirly_session";
const DEFAULT_ORIGIN = "https://hadirly.org";
const DEFAULT_SUPABASE_URL = "https://szwwpnbbsmjsbzzcecyj.supabase.co";
const DEFAULT_MAX_AGE = 28_800;
const CSRF_HEADER = "X-Hadirly-CSRF";
const CSRF_VALUE = "1";

// Only browser-facing endpoints are eligible. SessionGateway itself and every *Core
// implementation are intentionally excluded so the browser cannot choose an internal target.
const PROXY_TARGETS = new Set([
  "AbsenV2",
  "AttendanceLocation",
  "PayrollUser",
  "ProfileOps",
  "DeviceTrust",
  "SecurityOps",
  "ProductionReadiness",
  "AttendanceCorrections",
  "AttendanceImport",
  "EmploymentContracts",
  "Complaints",
  "DigitalIdentity",
  "OperationsV2",
  "WorkforceOps",
  "PlatformOps",
  "ConfigCenter",
  "PayrollListPage",
  "SppgLocationConfig",
  "SystemSettings",
]);

const AUTH_FUNCTIONS = new Set(["login", "logout", "checkSession"]);
const FORBIDDEN_QUERY_KEYS = new Set([
  "token",
  "auth_token",
  "authorization",
  "bearer",
  "session",
  "session_token",
]);

function configuredOrigin(env: Env): string {
  return String(env.HADIRLY_ORIGIN || DEFAULT_ORIGIN).replace(/\/$/, "");
}

function supabaseUrl(env: Env): string {
  return String(env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, "");
}

function maxAge(env: Env): number {
  const value = Number(env.SESSION_MAX_AGE_SECONDS || DEFAULT_MAX_AGE);
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), DEFAULT_MAX_AGE) : DEFAULT_MAX_AGE;
}

function requestId(): string {
  return `BFF_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

function securityHeaders(id: string): Headers {
  return new Headers({
    "Cache-Control": "no-store, max-age=0",
    "Pragma": "no-cache",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Request-Id": id,
  });
}

function json(body: unknown, status: number, id: string, extraHeaders?: HeadersInit): Response {
  const headers = securityHeaders(id);
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function cookieHeader(token: string, env: Env): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge(env)}`;
}

function expiredCookieHeader(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

function readCookie(request: Request): string {
  const header = request.headers.get("cookie") || "";
  for (const segment of header.split(";")) {
    const [name, ...rest] = segment.trim().split("=");
    if (name !== COOKIE_NAME) continue;
    try {
      return decodeURIComponent(rest.join("=")).trim();
    } catch {
      return "";
    }
  }
  return "";
}

function hasForbiddenQuery(url: URL): boolean {
  for (const key of url.searchParams.keys()) {
    if (FORBIDDEN_QUERY_KEYS.has(key.toLowerCase())) return true;
  }
  return false;
}

function sameOriginReference(value: string | null, origin: string): boolean {
  if (!value) return false;
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}

function validateBrowserSource(request: Request, env: Env, mutation: boolean): string | null {
  const origin = configuredOrigin(env);
  const secFetchSite = (request.headers.get("sec-fetch-site") || "").toLowerCase();
  if (secFetchSite === "cross-site") return "CROSS_SITE_REQUEST";

  const suppliedOrigin = request.headers.get("origin");
  const suppliedReferer = request.headers.get("referer");
  if (suppliedOrigin && suppliedOrigin !== origin) return "ORIGIN_NOT_ALLOWED";
  if (!suppliedOrigin && suppliedReferer && !sameOriginReference(suppliedReferer, origin)) {
    return "REFERER_NOT_ALLOWED";
  }

  if (mutation) {
    if (!suppliedOrigin && !sameOriginReference(suppliedReferer, origin)) return "ORIGIN_REQUIRED";
    if (request.headers.get(CSRF_HEADER) !== CSRF_VALUE) return "CSRF_CHECK_FAILED";
  }
  return null;
}

async function readJson(request: Request): Promise<JsonObject> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) throw new Error("JSON_REQUIRED");
  const value = await request.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_JSON_OBJECT");
  return value as JsonObject;
}

function removeSessionTokenFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeSessionTokenFields);
  if (!value || typeof value !== "object") return value;
  const out: JsonObject = {};
  for (const [key, item] of Object.entries(value as JsonObject)) {
    if (key.toLowerCase() === "token" || key.toLowerCase() === "auth_token") continue;
    out[key] = removeSessionTokenFields(item);
  }
  return out;
}

function injectSessionToken(value: JsonObject, token: string): JsonObject {
  const clean = removeSessionTokenFields(value) as JsonObject;
  const data = clean.data && typeof clean.data === "object" && !Array.isArray(clean.data)
    ? { ...(clean.data as JsonObject), token }
    : clean.data;
  return {
    ...clean,
    token,
    ...(data && typeof data === "object" ? { data } : {}),
  };
}

function functionNameOf(body: JsonObject): string {
  return String(body.function || body.functionName || body.action || "").trim();
}

async function upstreamJson(url: string, body: JsonObject, id: string, idempotencyKey?: string | null) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": id,
      ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({ success: false, code: "INVALID_UPSTREAM_RESPONSE" }));
  return { response, payload: payload as JsonObject };
}

async function canonicalAuthCall(env: Env, functionName: string, data: JsonObject, id: string) {
  const url = `${supabaseUrl(env)}/functions/v1/AbsenV2`;
  return await upstreamJson(url, { function: functionName, data }, id);
}

function payloadResult(payload: JsonObject): JsonObject {
  const result = payload.result;
  return result && typeof result === "object" && !Array.isArray(result) ? result as JsonObject : payload;
}

function sessionTokenFrom(payload: JsonObject): string {
  const result = payloadResult(payload);
  return typeof result.token === "string" ? result.token.trim() : "";
}

function upstreamFailed(response: Response, payload: JsonObject): boolean {
  return !response.ok || payload.success === false;
}

async function login(request: Request, env: Env, id: string): Promise<Response> {
  const body = await readJson(request);
  const email = String(body.email || body.username || "").trim();
  const password = String(body.password || "");
  if (!email || !password) return json({ success: false, code: "CREDENTIALS_REQUIRED" }, 422, id);

  const called = await canonicalAuthCall(env, "login", { email, username: email, password }, id);
  if (upstreamFailed(called.response, called.payload)) {
    return json({ success: false, code: "LOGIN_FAILED", message: "Email/Username atau password salah." },
      called.response.status >= 400 && called.response.status < 500 ? called.response.status : 401, id);
  }

  const rawToken = sessionTokenFrom(called.payload);
  if (!rawToken) return json({ success: false, code: "SESSION_ISSUE_FAILED" }, 502, id);
  const safe = removeSessionTokenFields(payloadResult(called.payload));
  return json({ success: true, result: safe }, 200, id, { "Set-Cookie": cookieHeader(rawToken, env) });
}

async function session(request: Request, env: Env, id: string): Promise<Response> {
  const token = readCookie(request);
  if (!token) return json({ success: false, authenticated: false, code: "SESSION_MISSING" }, 401, id);

  const checked = await canonicalAuthCall(env, "checkSession", { token }, id);
  const check = payloadResult(checked.payload);
  if (upstreamFailed(checked.response, checked.payload) || check.valid !== true) {
    return json({ success: false, authenticated: false, code: "SESSION_EXPIRED" }, 401, id, {
      "Set-Cookie": expiredCookieHeader(),
    });
  }

  const profile = await canonicalAuthCall(env, "getProfilLengkap", { token }, id);
  if (upstreamFailed(profile.response, profile.payload)) {
    return json({ success: false, authenticated: false, code: "SESSION_PROFILE_FAILED" }, 502, id);
  }
  return json({
    success: true,
    authenticated: true,
    session: removeSessionTokenFields(check),
    result: removeSessionTokenFields(payloadResult(profile.payload)),
  }, 200, id);
}

async function logout(request: Request, env: Env, id: string): Promise<Response> {
  const token = readCookie(request);
  if (!token) {
    return json({ success: true, revoked: false }, 200, id, { "Set-Cookie": expiredCookieHeader() });
  }

  const called = await canonicalAuthCall(env, "logout", { token }, id);
  if (upstreamFailed(called.response, called.payload)) {
    return json({ success: false, revoked: false, code: "LOGOUT_REVOKE_FAILED" }, 502, id, {
      "Set-Cookie": expiredCookieHeader(),
    });
  }
  return json({ success: true, revoked: true }, 200, id, { "Set-Cookie": expiredCookieHeader() });
}

async function exchange(request: Request, env: Env, id: string): Promise<Response> {
  if (String(env.ALLOW_LEGACY_EXCHANGE || "false").toLowerCase() !== "true") {
    return json({ success: false, code: "LEGACY_EXCHANGE_DISABLED" }, 410, id);
  }
  const body = await readJson(request);
  const legacyToken = typeof body.token === "string" ? body.token.trim() : "";
  if (!legacyToken) return json({ success: false, code: "LEGACY_TOKEN_REQUIRED" }, 422, id);

  const checked = await canonicalAuthCall(env, "checkSession", { token: legacyToken }, id);
  const result = payloadResult(checked.payload);
  if (upstreamFailed(checked.response, checked.payload) || result.valid !== true) {
    return json({ success: false, code: "SESSION_EXPIRED" }, 401, id);
  }

  return json({ success: true, migrated: true }, 200, id, {
    "Set-Cookie": cookieHeader(legacyToken, env),
  });
}

async function proxy(request: Request, env: Env, id: string, target: string): Promise<Response> {
  if (!PROXY_TARGETS.has(target) || target.endsWith("Core") || target === "SessionGateway") {
    return json({ success: false, code: "TARGET_NOT_ALLOWED" }, 404, id);
  }
  const token = readCookie(request);
  if (!token) return json({ success: false, code: "SESSION_MISSING" }, 401, id);

  const body = await readJson(request);
  const functionName = functionNameOf(body);
  if (AUTH_FUNCTIONS.has(functionName)) {
    return json({ success: false, code: "USE_DEDICATED_AUTH_ENDPOINT" }, 422, id);
  }

  const upstreamBody = injectSessionToken(body, token);
  const url = `${supabaseUrl(env)}/functions/v1/${encodeURIComponent(target)}`;
  const called = await upstreamJson(url, upstreamBody, id, request.headers.get("x-idempotency-key"));
  const status = called.response.status >= 100 && called.response.status <= 599 ? called.response.status : 502;
  const safePayload = removeSessionTokenFields(called.payload);
  return json(safePayload, status, id, {
    ...(called.response.headers.get("retry-after") ? { "Retry-After": called.response.headers.get("retry-after")! } : {}),
  });
}

async function handle(request: Request, env: Env): Promise<Response> {
  const id = requestId();
  const url = new URL(request.url);
  if (hasForbiddenQuery(url)) return json({ success: false, code: "SESSION_TOKEN_IN_URL_FORBIDDEN" }, 400, id);

  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();
  const isSessionRead = path === "/api/auth/session" && method === "GET";
  const mutation = !isSessionRead;
  const sourceError = validateBrowserSource(request, env, mutation);
  if (sourceError) return json({ success: false, code: sourceError }, 403, id);

  try {
    if (path === "/api/auth/login" && method === "POST") return await login(request, env, id);
    if (path === "/api/auth/logout" && method === "POST") return await logout(request, env, id);
    if (path === "/api/auth/session" && (method === "GET" || method === "POST")) return await session(request, env, id);
    if (path === "/api/auth/exchange" && method === "POST") return await exchange(request, env, id);
    if (path.startsWith("/api/functions/") && method === "POST") {
      const target = decodeURIComponent(path.slice("/api/functions/".length));
      return await proxy(request, env, id, target);
    }
    return json({ success: false, code: "NOT_FOUND" }, 404, id);
  } catch (error) {
    const code = error instanceof Error ? error.message : "BFF_ERROR";
    const safeCode = ["JSON_REQUIRED", "INVALID_JSON_OBJECT"].includes(code) ? code : "BFF_ERROR";
    return json({ success: false, code: safeCode }, safeCode === "BFF_ERROR" ? 500 : 400, id);
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
};
