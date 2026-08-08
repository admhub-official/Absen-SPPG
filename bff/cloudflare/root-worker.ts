import bffWorker from "./worker.ts";

type Env = {
  STATIC_ORIGIN?: string;
  HADIRLY_ORIGIN?: string;
  SUPABASE_URL?: string;
  SESSION_MAX_AGE_SECONDS?: string;
  ALLOW_LEGACY_EXCHANGE?: string;
};

const DEFAULT_STATIC_ORIGIN = "https://absen-sppg.pages.dev";
const DEFAULT_CANONICAL_ORIGIN = "https://hadirly.org";
const SENSITIVE_FORWARD_HEADERS = new Set([
  "authorization",
  "cookie",
  "x-hadirly-csrf",
  "cf-connecting-ip",
  "x-forwarded-for",
  "x-real-ip",
]);

function staticOrigin(env: Env): string {
  return String(env.STATIC_ORIGIN || DEFAULT_STATIC_ORIGIN).replace(/\/$/, "");
}

function canonicalOrigin(env: Env): string {
  return String(env.HADIRLY_ORIGIN || DEFAULT_CANONICAL_ORIGIN).replace(/\/$/, "");
}

function isApiPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return normalized === "/api" || normalized.startsWith("/api/");
}

function staticRequest(request: Request, env: Env): Request {
  const incoming = new URL(request.url);
  const upstream = new URL(`${incoming.pathname}${incoming.search}`, `${staticOrigin(env)}/`);
  const headers = new Headers(request.headers);
  for (const name of SENSITIVE_FORWARD_HEADERS) headers.delete(name);
  headers.delete("host");
  return new Request(upstream.toString(), {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  });
}

function rewriteStaticLocation(headers: Headers, env: Env): void {
  const location = headers.get("location");
  if (!location) return;
  try {
    const resolved = new URL(location, `${staticOrigin(env)}/`);
    if (resolved.origin !== new URL(staticOrigin(env)).origin) return;
    headers.set("location", `${canonicalOrigin(env)}${resolved.pathname}${resolved.search}${resolved.hash}`);
  } catch {
    // Keep an unparseable upstream Location unchanged rather than inventing a redirect.
  }
}

async function serveStatic(request: Request, env: Env): Promise<Response> {
  const response = await fetch(staticRequest(request, env));
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  rewriteStaticLocation(headers, env);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (isApiPath(url.pathname)) return bffWorker.fetch(request, env);
    return serveStatic(request, env);
  },
};
