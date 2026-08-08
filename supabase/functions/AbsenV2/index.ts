import { createClient } from "jsr:@supabase/supabase-js@2";
import { authenticateUserSession } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const UPSTREAM_URL = `${SUPABASE_URL}/functions/v1/Absen`;
const IDEMPOTENT = new Set(["recordAbsensiSelf", "recordAbsensi"]);
const CHALLENGE_TTL_MS = 60_000;
const MAX_LOCATION_AGE_MS = 30_000;
const MAX_ACCURACY_M = 60;

type Risk = { score: number; level: "LOW" | "MEDIUM" | "HIGH"; reasons: string[] };
type Auth = { idUser: string; token: string; tokenHash: string };
type Stored = {
  Status: "PROCESSING" | "COMPLETED" | "FAILED";
  HTTP_Status: number | null;
  Response_Body: Record<string, unknown> | null;
  Request_Fingerprint: string;
  Expires_At: string;
};

const requestId = () => `REQ_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function originAllowed(origin: string): boolean {
  const configured = new Set((Deno.env.get("ABSEN_ALLOWED_ORIGINS") || "").split(",").map((v) => v.trim()).filter(Boolean));
  configured.add("https://absen-sppg.pages.dev");
  configured.add("http://localhost:4173");
  configured.add("http://127.0.0.1:4173");
  if (configured.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && (url.hostname === "absen-sppg.pages.dev" || url.hostname.endsWith(".absen-sppg.pages.dev"));
  } catch {
    return false;
  }
}

function cors(origin: string | null): Record<string, string> {
  return {
    ...(origin && originAllowed(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Expose-Headers": "X-Request-Id, Retry-After",
    "Vary": "Origin",
  };
}

function respond(body: unknown, status: number, id: string, headers: Record<string, string>, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, ...extra, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Request-Id": id },
  });
}

function normalizedError(raw: unknown): { status: number; code: string; message: string } {
  const text = String(raw || "");
  if (text.includes("SESI_HABIS")) return { status: 401, code: "SESSION_EXPIRED", message: "Sesi telah berakhir. Silakan login kembali." };
  if (text.includes("AKUN_NONAKTIF")) return { status: 403, code: "ACCOUNT_INACTIVE", message: "Akun tidak aktif." };
  if (/Akses ditolak|hanya untuk/i.test(text)) return { status: 403, code: "FORBIDDEN", message: text };
  if (text.includes("ATTENDANCE_DUPLICATE_IN")) return { status: 409, code: "ATTENDANCE_DUPLICATE_IN", message: "Anda sudah melakukan absen masuk hari ini." };
  if (text.includes("ATTENDANCE_DUPLICATE_OUT")) return { status: 409, code: "ATTENDANCE_DUPLICATE_OUT", message: "Anda sudah melakukan absen pulang hari ini." };
  if (text.includes("ATTENDANCE_CHECKOUT_BEFORE_CHECKIN")) return { status: 409, code: "ATTENDANCE_INVALID_STATE", message: "Absen pulang hanya dapat dilakukan setelah absen masuk." };
  if (text.includes("LOCATION_ACCURACY_TOO_LOW")) return { status: 422, code: "LOCATION_ACCURACY_TOO_LOW", message: "Akurasi GPS belum memadai. Pindah ke area terbuka dan coba lagi." };
  if (text.includes("LOCATION_STALE")) return { status: 422, code: "LOCATION_STALE", message: "Data lokasi sudah kedaluwarsa. Ambil lokasi terbaru." };
  if (text.includes("CHALLENGE_")) return { status: 409, code: text, message: "Challenge presensi tidak valid atau sudah tidak berlaku. Periksa lokasi kembali." };
  if (/tidak ditemukan/i.test(text)) return { status: 404, code: "NOT_FOUND", message: text };
  if (/wajib|tidak valid|invalid|format/i.test(text)) return { status: 422, code: "VALIDATION_ERROR", message: text };
  return { status: 500, code: "INTERNAL_ERROR", message: "Terjadi kesalahan pada server." };
}

function ipOf(request: Request): string {
  return (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "").slice(0, 128);
}

async function authenticate(tokenValue: unknown): Promise<Auth> {
  const token = String(tokenValue || "").trim();
  if (!token) throw new Error("SESI_HABIS");
  const { data: session, error } = await supabase.from("Sessions").select("ID_User,Type,Expires_At").eq("Token", token).maybeSingle();
  if (error || !session?.ID_User || String(session.Type || "").toLowerCase() !== "user" || new Date(session.Expires_At).getTime() <= Date.now()) throw new Error("SESI_HABIS");
  const userResult = await supabase.from("Users").select("ID_User,Status_Aktif").eq("ID_User", session.ID_User).maybeSingle();
  const active = userResult.data?.Status_Aktif === true || ["TRUE", "1"].includes(String(userResult.data?.Status_Aktif || "").toUpperCase());
  if (userResult.error || !userResult.data || !active) throw new Error("AKUN_NONAKTIF");
  return { idUser: String(userResult.data.ID_User), token, tokenHash: await sha256(token) };
}

async function rateLimit(key: string, action: string, limit: number, windowSeconds: number) {
  const { data, error } = await supabase.rpc("consume_api_rate_limit", { p_rate_key: key, p_action: action, p_limit: limit, p_window_seconds: windowSeconds });
  if (error) throw new Error("RATE_LIMIT_CHECK_FAILED");
  return { allowed: Boolean(data?.allowed), retryAfter: Math.max(1, Number(data?.retryAfterSeconds || windowSeconds)) };
}

function locationOf(body: Record<string, unknown>) {
  const latitude = Number(body.lat);
  const longitude = Number(body.lng);
  const accuracy = Number(body.accuracy);
  const capturedAt = new Date(String(body.locationCapturedAt || ""));
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isFinite(accuracy) || accuracy <= 0 || Number.isNaN(capturedAt.getTime())) throw new Error("Lokasi atau waktu pengambilan lokasi tidak valid.");
  const ageMs = Math.max(0, Date.now() - capturedAt.getTime());
  if (ageMs > MAX_LOCATION_AGE_MS) throw new Error("LOCATION_STALE");
  if (accuracy > MAX_ACCURACY_M) throw new Error("LOCATION_ACCURACY_TOO_LOW");
  return { latitude, longitude, accuracy, capturedAt, ageMs };
}

function riskOf(location: { accuracy: number; ageMs: number }, ip: string, userAgent: string): Risk {
  let score = 0;
  const reasons: string[] = [];
  if (location.accuracy > 50) { score += 45; reasons.push("GPS_ACCURACY_OVER_50M"); }
  else if (location.accuracy > 30) { score += 25; reasons.push("GPS_ACCURACY_OVER_30M"); }
  else if (location.accuracy > 15) { score += 10; reasons.push("GPS_ACCURACY_OVER_15M"); }
  if (location.ageMs > 20_000) { score += 20; reasons.push("LOCATION_AGE_OVER_20S"); }
  else if (location.ageMs > 10_000) { score += 10; reasons.push("LOCATION_AGE_OVER_10S"); }
  if (!ip) { score += 5; reasons.push("CLIENT_IP_UNAVAILABLE"); }
  if (!userAgent) { score += 5; reasons.push("USER_AGENT_UNAVAILABLE"); }
  score = Math.min(100, score);
  return { score, level: score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW", reasons };
}

async function audit(request: Request, input: { requestId: string; userId?: string; challengeId?: string; event: string; result: "SUCCESS" | "REJECTED" | "FAILED"; risk?: Risk; location?: any; detail?: Record<string, unknown> }) {
  const { error } = await supabase.from("Attendance_Security_Events").insert({
    Request_ID: input.requestId,
    ID_User: input.userId || null,
    Challenge_ID: input.challengeId || null,
    Event_Type: input.event,
    Result: input.result,
    Risk_Score: input.risk?.score || 0,
    Risk_Level: input.risk?.level || "LOW",
    Client_IP: ipOf(request) || null,
    User_Agent: (request.headers.get("user-agent") || "").slice(0, 500) || null,
    Origin: (request.headers.get("origin") || "").slice(0, 500) || null,
    Latitude: input.location?.latitude ?? null,
    Longitude: input.location?.longitude ?? null,
    Accuracy_Meter: input.location?.accuracy ?? null,
    Detail: input.detail || {},
  });
  if (error) console.error("Security audit failed", error.message);
}

async function upstream(body: Record<string, unknown>, request: Request) {
  const response = await fetch(UPSTREAM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: request.headers.get("authorization") || `Bearer ${SERVICE_KEY}`, apikey: request.headers.get("apikey") || SERVICE_KEY },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json().catch(() => ({ success: false, error: "Respons upstream tidak valid." })) };
}

async function issueChallenge(body: Record<string, unknown>, request: Request, id: string, headers: Record<string, string>): Promise<Response> {
  const auth = await authenticate(body.token);
  const ip = ipOf(request);
  const rate = await rateLimit(`${auth.idUser}:${ip || "NO_IP"}`, "ATTENDANCE_CHALLENGE", 8, 60);
  if (!rate.allowed) {
    await audit(request, { requestId: id, userId: auth.idUser, event: "CHALLENGE_RATE_LIMIT", result: "REJECTED", detail: { retryAfter: rate.retryAfter } });
    return respond({ success: false, code: "RATE_LIMITED", message: "Terlalu banyak permintaan lokasi. Tunggu sebentar lalu coba lagi.", requestId: id }, 429, id, headers, { "Retry-After": String(rate.retryAfter) });
  }
  const location = locationOf(body);
  const risk = riskOf(location, ip, request.headers.get("user-agent") || "");
  const checked = await upstream({ functionName: "checkAttendanceLocation", token: auth.token, lat: location.latitude, lng: location.longitude, accuracy: location.accuracy }, request);
  const validation = checked.body?.success === false ? null : checked.body?.result ?? checked.body;
  if (!validation?.valid) {
    await audit(request, { requestId: id, userId: auth.idUser, event: "CHALLENGE_LOCATION_REJECTED", result: "REJECTED", risk, location, detail: { message: validation?.message || checked.body?.error } });
    return respond({ success: false, code: "ATTENDANCE_OUTSIDE_GEOFENCE", message: validation?.message || "Lokasi tidak memenuhi radius presensi.", requestId: id }, 422, id, headers);
  }
  const challengeId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
  const { error } = await supabase.from("Attendance_Challenges").insert({ Challenge_ID: challengeId, ID_User: auth.idUser, Session_Token_Hash: auth.tokenHash, Latitude: location.latitude, Longitude: location.longitude, Accuracy_Meter: location.accuracy, Location_Captured_At: location.capturedAt.toISOString(), Risk_Score: risk.score, Risk_Level: risk.level, Issued_IP: ip || null, Issued_User_Agent: (request.headers.get("user-agent") || "").slice(0, 500) || null, Expires_At: expiresAt });
  if (error) throw new Error("Gagal membuat challenge presensi.");
  await audit(request, { requestId: id, userId: auth.idUser, challengeId, event: "CHALLENGE_ISSUED", result: "SUCCESS", risk, location, detail: { expiresAt, reasons: risk.reasons, distance: validation.jarak ?? validation.distance ?? null } });
  return respond({ success: true, result: { challengeId, expiresAt, riskScore: risk.score, riskLevel: risk.level, location: { valid: true, distance: validation.jarak ?? validation.distance ?? null, radius: validation.radius ?? null } }, requestId: id }, 200, id, headers);
}

async function consumeChallenge(body: Record<string, unknown>, request: Request, id: string) {
  const auth = await authenticate(body.token);
  const ip = ipOf(request);
  const rate = await rateLimit(`${auth.idUser}:${ip || "NO_IP"}`, "ATTENDANCE_SUBMIT", 6, 60);
  if (!rate.allowed) { const e: any = new Error("RATE_LIMITED"); e.retryAfter = rate.retryAfter; throw e; }
  const challengeId = String(body.challengeId || "").trim();
  if (!challengeId) throw new Error("CHALLENGE_REQUIRED");
  const location = locationOf(body);
  const result = await supabase.from("Attendance_Challenges").select("Challenge_ID,ID_User,Session_Token_Hash,Latitude,Longitude,Accuracy_Meter,Risk_Score,Risk_Level,Expires_At,Used_At").eq("Challenge_ID", challengeId).maybeSingle();
  const challenge = result.data;
  if (result.error || !challenge) throw new Error("CHALLENGE_NOT_FOUND");
  if (String(challenge.ID_User) !== auth.idUser || String(challenge.Session_Token_Hash) !== auth.tokenHash) throw new Error("CHALLENGE_OWNER_MISMATCH");
  if (challenge.Used_At) throw new Error("CHALLENGE_ALREADY_USED");
  if (new Date(challenge.Expires_At).getTime() <= Date.now()) throw new Error("CHALLENGE_EXPIRED");
  const drift = Math.max(Math.abs(Number(challenge.Latitude) - location.latitude), Math.abs(Number(challenge.Longitude) - location.longitude));
  if (drift > 0.00002 || Math.abs(Number(challenge.Accuracy_Meter) - location.accuracy) > 5) throw new Error("CHALLENGE_LOCATION_MISMATCH");
  const claimed = await supabase.from("Attendance_Challenges").update({ Used_At: new Date().toISOString(), Used_Request_ID: id }).eq("Challenge_ID", challengeId).is("Used_At", null).gt("Expires_At", new Date().toISOString()).select("Challenge_ID").maybeSingle();
  if (claimed.error || !claimed.data) throw new Error("CHALLENGE_ALREADY_USED");
  return { auth, challenge, risk: { score: Number(challenge.Risk_Score || 0), level: String(challenge.Risk_Level || "LOW") as Risk["level"], reasons: [] } as Risk };
}

async function stored(key: string): Promise<Stored | null> {
  const { data, error } = await supabase.from("API_Idempotency").select("Status,HTTP_Status,Response_Body,Request_Fingerprint,Expires_At").eq("Idempotency_Key", key).maybeSingle();
  if (error) throw new Error("Gagal membaca status idempotensi.");
  return data as Stored | null;
}

async function persistIdempotencyBestEffort(
  key: string,
  patch: Record<string, unknown>,
  phase: string,
): Promise<void> {
  const result = await supabase.from("API_Idempotency").update(patch).eq("Idempotency_Key", key);
  if (result.error) {
    console.error(JSON.stringify({
      code: "IDEMPOTENCY_UPDATE_DEFERRED",
      phase,
      keyHint: key.slice(-12),
      error: result.error.message,
    }));
  }
}

function replay(row: Stored, id: string, headers: Record<string, string>): Response | null {
  if (!row.Response_Body || (row.Status !== "COMPLETED" && row.Status !== "FAILED")) return null;
  return respond(row.Response_Body, Number(row.HTTP_Status || (row.Status === "FAILED" ? 500 : 200)), id, headers);
}

async function handlePresenceHeartbeat(body: Record<string, unknown>, id: string, headers: Record<string, string>): Promise<Response> {
  const token = String(body.token || "").trim();
  await authenticateUserSession(supabase, token);
  const tokenHash = await sha256(token);
  const requestedState = String(body.clientState || "ACTIVE").toUpperCase();
  const clientState = requestedState === "HIDDEN" ? "HIDDEN" : "ACTIVE";
  const { error } = await supabase.from("Sessions").update({
    Last_Activity_At: new Date().toISOString(),
    Client_State: clientState,
  }).eq("Token_Hash", tokenHash);
  if (error) throw new Error("HEARTBEAT_UPDATE_FAILED");
  return respond({ success: true, result: { online: clientState === "ACTIVE", clientState }, requestId: id }, 200, id, headers);
}

Deno.serve(async (request) => {
  const id = requestId();
  const origin = request.headers.get("origin");
  const headers = cors(origin);
  if (origin && !originAllowed(origin)) return respond({ success: false, code: "ORIGIN_NOT_ALLOWED", message: "Origin tidak diizinkan.", requestId: id }, 403, id, headers);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return respond({ success: false, code: "METHOD_NOT_ALLOWED", message: "Gunakan metode POST.", requestId: id }, 405, id, headers);

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return respond({ success: false, code: "INVALID_JSON", message: "Payload JSON tidak valid.", requestId: id }, 400, id, headers); }
  const functionName = String(body.functionName || body.function || "").trim();
  if (functionName === "createAttendanceChallenge") {
    try { return await issueChallenge(body, request, id, headers); }
    catch (error) { const e = normalizedError(error instanceof Error ? error.message : error); return respond({ success: false, code: e.code, message: e.message, requestId: id }, e.status, id, headers); }
  }
  if (functionName === "presenceHeartbeat") {
    try { return await handlePresenceHeartbeat(body, id, headers); }
    catch (error) { const e = normalizedError(error instanceof Error ? error.message : error); return respond({ success: false, code: e.code, message: e.message, requestId: id }, e.status, id, headers); }
  }

  const isIdempotent = IDEMPOTENT.has(functionName);
  const idempotencyKey = String(body.idempotencyKey || request.headers.get("x-idempotency-key") || "").trim();
  const fingerprintBody = { ...body };
  delete fingerprintBody.token; delete fingerprintBody.idempotencyKey; delete fingerprintBody.securityRequestId; delete fingerprintBody.riskScore; delete fingerprintBody.riskLevel;
  const fingerprint = await sha256(JSON.stringify({ functionName, body: fingerprintBody }));
  if (isIdempotent && !idempotencyKey) return respond({ success: false, code: "IDEMPOTENCY_KEY_REQUIRED", message: "Kunci idempotensi wajib tersedia untuk presensi.", requestId: id }, 400, id, headers);

  if (isIdempotent) {
    const existing = await stored(idempotencyKey);
    if (existing && new Date(existing.Expires_At).getTime() <= Date.now()) {
      const cleanup = await supabase.from("API_Idempotency").delete()
        .eq("Idempotency_Key", idempotencyKey)
        .lte("Expires_At", new Date().toISOString());
      if (cleanup.error) throw new Error("IDEMPOTENCY_CLEANUP_FAILED");
    } else if (existing) {
      if (existing.Request_Fingerprint !== fingerprint) return respond({ success: false, code: "IDEMPOTENCY_KEY_REUSED", message: "Kunci idempotensi telah digunakan untuk permintaan berbeda.", requestId: id }, 409, id, headers);
      const cached = replay(existing, id, headers); if (cached) return cached;
      return respond({ success: false, code: "REQUEST_IN_PROGRESS", message: "Permintaan presensi sedang diproses.", requestId: id }, 409, id, headers);
    }
    const claim = await supabase.from("API_Idempotency").insert({ Idempotency_Key: idempotencyKey, Function_Name: functionName, Request_Fingerprint: fingerprint, Status: "PROCESSING" });
    if (claim.error) {
      const raced = await stored(idempotencyKey); const cached = raced ? replay(raced, id, headers) : null;
      return cached || respond({ success: false, code: "REQUEST_IN_PROGRESS", message: "Permintaan presensi sedang diproses.", requestId: id }, 409, id, headers);
    }
  }

  let context: any = null;
  if (functionName === "recordAbsensiSelf") {
    try {
      context = await consumeChallenge(body, request, id);
      body.securityRequestId = id; body.riskScore = context.risk.score; body.riskLevel = context.risk.level;
    } catch (error) {
      const rate = String((error as Error)?.message) === "RATE_LIMITED";
      const e = rate ? { status: 429, code: "RATE_LIMITED", message: "Terlalu banyak percobaan presensi. Tunggu sebentar lalu coba lagi." } : normalizedError(error instanceof Error ? error.message : error);
      const responseBody = { success: false, code: e.code, message: e.message, requestId: id };
      if (isIdempotent) {
        await persistIdempotencyBestEffort(idempotencyKey, {
          Status: "COMPLETED",
          HTTP_Status: e.status,
          Response_Body: responseBody,
          Completed_At: new Date().toISOString(),
        }, "CHALLENGE_REJECTED");
      }
      await audit(request, { requestId: id, event: "ATTENDANCE_CHALLENGE_REJECTED", result: "REJECTED", detail: { code: e.code } });
      return respond(responseBody, e.status, id, headers, rate ? { "Retry-After": String((error as any).retryAfter || 60) } : {});
    }
  }

  try {
    const called = await upstream(body, request);
    let status = called.response.status;
    let responseBody: Record<string, unknown> = called.body;
    if (called.body?.success === false) { const e = normalizedError(called.body.error || called.body.message); status = e.status; responseBody = { success: false, code: e.code, message: e.message, requestId: id, details: called.body.details || {} }; }
    else { status = status >= 200 && status < 300 ? status : 200; responseBody = { ...called.body, requestId: id }; }
    if (isIdempotent) {
      await persistIdempotencyBestEffort(idempotencyKey, {
        Status: status >= 500 ? "FAILED" : "COMPLETED",
        HTTP_Status: status,
        Response_Body: responseBody,
        Completed_At: new Date().toISOString(),
      }, "UPSTREAM_COMPLETE");
    }
    if (context) await audit(request, { requestId: id, userId: context.auth.idUser, challengeId: String(context.challenge.Challenge_ID), event: "ATTENDANCE_SUBMITTED", result: status >= 200 && status < 300 ? "SUCCESS" : "REJECTED", risk: context.risk, location: { latitude: Number(context.challenge.Latitude), longitude: Number(context.challenge.Longitude), accuracy: Number(context.challenge.Accuracy_Meter) }, detail: { status, code: responseBody.code || null } });
    return respond(responseBody, status, id, headers);
  } catch (error) {
    const e = normalizedError(error instanceof Error ? error.message : error);
    const responseBody = { success: false, code: e.code, message: e.message, requestId: id };
    if (isIdempotent) {
      await persistIdempotencyBestEffort(idempotencyKey, {
        Status: "FAILED",
        HTTP_Status: e.status,
        Response_Body: responseBody,
        Completed_At: new Date().toISOString(),
      }, "UPSTREAM_FAILED");
    }
    if (context) await audit(request, { requestId: id, userId: context.auth.idUser, challengeId: String(context.challenge.Challenge_ID), event: "ATTENDANCE_SUBMITTED", result: "FAILED", risk: context.risk, detail: { code: e.code } });
    return respond(responseBody, e.status, id, headers);
  }
});
