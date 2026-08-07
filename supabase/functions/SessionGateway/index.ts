import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const TARGETS: Record<string, string> = Object.freeze({
  AbsenV2: "AbsenV2Core",
  AttendanceLocation: "AttendanceLocationCore",
  PayrollUser: "PayrollUserCore",
  ProfileOps: "ProfileOpsCore",
  DeviceTrust: "DeviceTrustCore",
  SecurityOps: "SecurityOpsCore",
  ProductionReadiness: "ProductionReadinessCore",
  AttendanceCorrections: "AttendanceCorrectionsCore",
  AttendanceImport: "AttendanceImportCore",
  EmploymentContracts: "EmploymentContractsCore",
});

const configuredOrigins = new Set(
  (Deno.env.get("ABSEN_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
configuredOrigins.add("https://hadirly.org");
configuredOrigins.add("http://localhost:4173");
configuredOrigins.add("http://127.0.0.1:4173");

function originAllowed(origin: string): boolean {
  if (configuredOrigins.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && url.hostname.endsWith(".absen-sppg.pages.dev");
  } catch {
    return false;
  }
}

function cors(origin: string | null): Record<string, string> {
  return {
    ...(origin && originAllowed(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-idempotency-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Expose-Headers": "X-Request-Id, Retry-After",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function collectTokenCandidates(value: unknown, output = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value) collectTokenCandidates(item, output);
    return output;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "token" && typeof item === "string" && item.trim().length >= 16) output.add(item.trim());
    else collectTokenCandidates(item, output);
  }
  return output;
}

async function sessionDigestMap(payload: Record<string, unknown>): Promise<Map<string, string>> {
  const candidates = [...collectTokenCandidates(payload)];
  if (!candidates.length) return new Map();
  const pairs = await Promise.all(candidates.map(async (raw) => [raw, await sha256Hex(raw)] as const));
  const hashes = [...new Set(pairs.map(([, hash]) => hash))];
  const result = await db.from("Sessions").select("Token_Hash").in("Token_Hash", hashes);
  if (result.error) throw new Error("SESSION_LOOKUP_FAILED");
  const existing = new Set((result.data || []).map((row) => String(row.Token_Hash || "")));
  return new Map(pairs.filter(([, hash]) => existing.has(hash)));
}

function replaceSessionTokens(value: unknown, digests: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => replaceSessionTokens(item, digests));
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    if (key === "token" && typeof item === "string" && digests.has(item.trim())) output[key] = digests.get(item.trim());
    else output[key] = replaceSessionTokens(item, digests);
  }
  return output;
}

function requestId(): string {
  return `SGW_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

function invokedFunctionName(request: Request): string {
  try {
    const segments = new URL(request.url).pathname.split("/").filter(Boolean);
    return decodeURIComponent(segments.at(-1) || "");
  } catch {
    return "";
  }
}

Deno.serve(async (request) => {
  const id = requestId();
  const origin = request.headers.get("origin");
  const headers = cors(origin);

  if (origin && !originAllowed(origin)) {
    return new Response(JSON.stringify({ success: false, code: "ORIGIN_NOT_ALLOWED", message: "Origin tidak diizinkan.", requestId: id }), {
      status: 403,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "X-Request-Id": id },
    });
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ success: false, code: "METHOD_NOT_ALLOWED", message: "Gunakan POST.", requestId: id }), {
      status: 405,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "X-Request-Id": id },
    });
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    const invoked = invokedFunctionName(request);
    const directAlias = Object.prototype.hasOwnProperty.call(TARGETS, invoked);
    const target = directAlias ? invoked : String(body.target || "").trim();
    const core = TARGETS[target];
    if (!core) {
      return new Response(JSON.stringify({ success: false, code: "TARGET_NOT_ALLOWED", message: "Layanan tujuan tidak diizinkan.", requestId: id }), {
        status: 422,
        headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "X-Request-Id": id },
      });
    }
    const payload = directAlias
      ? body
      : body.payload && typeof body.payload === "object"
      ? body.payload as Record<string, unknown>
      : {};
    const digests = await sessionDigestMap(payload);
    const forwardedPayload = replaceSessionTokens(payload, digests);
    const upstream = await fetch(`${SUPABASE_URL}/functions/v1/${core}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "apikey": SERVICE_KEY,
        "X-Request-Id": id,
        ...(request.headers.get("x-idempotency-key")
          ? { "x-idempotency-key": request.headers.get("x-idempotency-key")! }
          : {}),
      },
      body: JSON.stringify(forwardedPayload),
      cache: "no-store",
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        ...headers,
        "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
        "X-Request-Id": upstream.headers.get("x-request-id") || id,
        ...(upstream.headers.get("retry-after") ? { "Retry-After": upstream.headers.get("retry-after")! } : {}),
      },
    });
  } catch (error) {
    console.error(JSON.stringify({ service: "SessionGateway", requestId: id, error: error instanceof Error ? error.message : String(error) }));
    return new Response(JSON.stringify({ success: false, code: "GATEWAY_ERROR", message: "Gateway sesi gagal memproses permintaan.", requestId: id }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "X-Request-Id": id },
    });
  }
});
