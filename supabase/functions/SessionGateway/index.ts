import { createClient } from "jsr:@supabase/supabase-js@2";
import { enforceSessionActivity, sha256Hex } from "../_shared/session-policy.ts";

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
  ConfigCenter: "ConfigCenterCore",
  PayrollListPage: "PayrollListPageCore",
  SppgLocationConfig: "SppgLocationConfigCore",
  SystemSettings: "SystemSettingsCore",
});
const PUBLIC_UNAUTHENTICATED_ABSEN_FUNCTIONS = new Set([
  "getPublicConfig",
  "getMasterData",
  "checkUsernameUnique",
  "registerUser",
  "verifyRegistrationOtp",
  "requestResetPassword",
  "requestResetPasswordByEmail",
  "verifyResetPasswordOtp",
  "resetPassword",
  "resendConfirmationEmail",
]);
const DIGEST_RE = /^[0-9a-f]{64}$/i;

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
function isServiceRequest(request: Request): boolean {
  return request.headers.get("authorization") === `Bearer ${SERVICE_KEY}`;
}
function functionNameOfPayload(payload: Record<string, unknown>): string {
  return String(payload.function || payload.functionName || payload.action || "").trim();
}
function isPublicUnauthenticatedPayload(target: string, payload: Record<string, unknown>): boolean {
  return target === "AbsenV2" && PUBLIC_UNAUTHENTICATED_ABSEN_FUNCTIONS.has(functionNameOfPayload(payload));
}

async function sessionForwardMap(
  payload: Record<string, unknown>,
  allowStoredDigest: boolean,
): Promise<Map<string, string>> {
  const candidates = [...collectTokenCandidates(payload)];
  if (!candidates.length) return new Map();

  const pairs = await Promise.all(candidates.map(async (raw) => [raw, await sha256Hex(raw)] as const));
  const directDigests = candidates
    .filter((candidate) => DIGEST_RE.test(candidate))
    .map((candidate) => candidate.toLowerCase());
  const hashes = [...new Set([...pairs.map(([, hash]) => hash), ...directDigests])];
  const result = await db
    .from("Sessions")
    .select("Token,Token_Hash,ID_User,ID_Device,Type,Expires_At,Last_Activity_At")
    .in("Token_Hash", hashes);
  if (result.error) throw new Error("SESSION_LOOKUP_FAILED");

  const rows = new Map(
    (result.data || []).map((row) => [String(row.Token_Hash || "").toLowerCase(), row]),
  );
  if (!allowStoredDigest && directDigests.some((digest) => rows.has(digest))) {
    throw new Error("SESSION_DIGEST_NOT_ACCEPTED");
  }

  const output = new Map<string, string>();
  for (const [raw, hash] of pairs) {
    const directDigest = DIGEST_RE.test(raw) && rows.has(raw.toLowerCase());
    const lookupHash = directDigest ? raw.toLowerCase() : hash;
    const row = rows.get(lookupHash);
    if (!row) throw new Error("SESSION_EXPIRED");

    await enforceSessionActivity(db, row, lookupHash);
    const storedToken = String(row.Token || "");
    // Legacy Core implementations intentionally receive the stored digest after cutover.
    output.set(raw, storedToken.toLowerCase() === lookupHash ? lookupHash : raw);
  }
  return output;
}

function replaceSessionTokens(value: unknown, replacements: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => replaceSessionTokens(item, replacements));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "token" && typeof item === "string" && replacements.has(item.trim())) {
      output[key] = replacements.get(item.trim());
    } else output[key] = replaceSessionTokens(item, replacements);
  }
  return output;
}
function requestId(): string {
  return `SGW_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}
function invokedFunctionName(request: Request): string {
  try {
    return decodeURIComponent(new URL(request.url).pathname.split("/").filter(Boolean).at(-1) || "");
  } catch {
    return "";
  }
}

Deno.serve(async (request) => {
  const id = requestId();
  const origin = request.headers.get("origin");
  const headers = cors(origin);
  if (origin && !originAllowed(origin)) {
    return new Response(
      JSON.stringify({ success: false, code: "ORIGIN_NOT_ALLOWED", message: "Origin tidak diizinkan.", requestId: id }),
      { status: 403, headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "X-Request-Id": id } },
    );
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, code: "METHOD_NOT_ALLOWED", message: "Gunakan POST.", requestId: id }),
      { status: 405, headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "X-Request-Id": id } },
    );
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    const invoked = invokedFunctionName(request);
    const directAlias = Object.prototype.hasOwnProperty.call(TARGETS, invoked);
    const target = directAlias ? invoked : String(body.target || "").trim();
    const core = TARGETS[target];
    if (!core) {
      return new Response(
        JSON.stringify({ success: false, code: "TARGET_NOT_ALLOWED", message: "Layanan tujuan tidak diizinkan.", requestId: id }),
        { status: 422, headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "X-Request-Id": id } },
      );
    }

    const payload = directAlias
      ? body
      : body.payload && typeof body.payload === "object"
      ? body.payload as Record<string, unknown>
      : {};
    const replacements = isPublicUnauthenticatedPayload(target, payload)
      ? new Map<string, string>()
      : await sessionForwardMap(payload, isServiceRequest(request));
    const forwardedPayload = replaceSessionTokens(payload, replacements);
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
    const code = error instanceof Error ? error.message : String(error);
    const sessionRejected = code === "SESSION_DIGEST_NOT_ACCEPTED" || code === "SESSION_EXPIRED";
    if (!sessionRejected) console.error(JSON.stringify({ service: "SessionGateway", requestId: id, error: code }));
    return new Response(
      JSON.stringify({
        success: false,
        code: sessionRejected ? "SESSION_EXPIRED" : "GATEWAY_ERROR",
        message: sessionRejected
          ? "Sesi tidak valid atau telah berakhir. Silakan login kembali."
          : "Gateway sesi gagal memproses permintaan.",
        requestId: id,
      }),
      {
        status: sessionRejected ? 401 : 500,
        headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "X-Request-Id": id },
      },
    );
  }
});
