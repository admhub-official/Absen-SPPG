import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const UPSTREAM_URL = `${SUPABASE_URL}/functions/v1/Absen`;
const IDEMPOTENT_FUNCTIONS = new Set(["recordAbsensiSelf", "recordAbsensi"]);
const CHALLENGE_FUNCTION = "createAttendanceChallenge";
const CHALLENGE_TTL_SECONDS = 60;
const MAX_LOCATION_AGE_SECONDS = 30;
const MAX_ACCEPTED_ACCURACY_METER = 60;

type ErrorDescriptor = { status: number; code: string; message: string };
type StoredIdempotency = {
  Status: "PROCESSING" | "COMPLETED" | "FAILED";
  HTTP_Status: number | null;
  Response_Body: Record<string, unknown> | null;
  Request_Fingerprint: string;
  Expires_At: string;
};
type AuthContext = { idUser: string; token: string; tokenHash: string };
type RiskAssessment = { score: number; level: "LOW" | "MEDIUM" | "HIGH"; reasons: string[] };

function requestId(): string {
  return `REQ_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

function configuredOrigins(): Set<string> {
  const configured = (Deno.env.get("ABSEN_ALLOWED_ORIGINS") || "")
    .split(",").map((item) => item.trim()).filter(Boolean);
  return new Set([
    "https://absen-sppg.pages.dev",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    ...configured,
  ]);
}

function resolveCors(origin: string | null): Record<string, string> {
  const allowed = configuredOrigins();
  const acceptedOrigin = !origin ? "" : allowed.has(origin) ? origin : "";
  return {
    ...(acceptedOrigin ? { "Access-Control-Allow-Origin": acceptedOrigin } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Expose-Headers": "X-Request-Id, Retry-After",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, id: string, cors: Record<string, string>, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, ...extraHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Request-Id": id },
  });
}

function normalizeError(raw: unknown): ErrorDescriptor {
  const text = String(raw || "Terjadi kesalahan pada server.");
  if (text.includes("SESI_HABIS")) return { status: 401, code: "SESSION_EXPIRED", message: "Sesi telah berakhir. Silakan login kembali." };
  if (text.includes("AKUN_NONAKTIF")) return { status: 403, code: "ACCOUNT_INACTIVE", message: "Akun tidak aktif." };
  if (/Akses ditolak|hanya untuk/i.test(text)) return { status: 403, code: "FORBIDDEN", message: text };
  if (text.includes("ATTENDANCE_DUPLICATE_IN")) return { status: 409, code: "ATTENDANCE_DUPLICATE_IN", message: "Anda sudah melakukan absen masuk hari ini." };
  if (text.includes("ATTENDANCE_DUPLICATE_OUT")) return { status: 409, code: "ATTENDANCE_DUPLICATE_OUT", message: "Anda sudah melakukan absen pulang hari ini." };
  if (text.includes("ATTENDANCE_CHECKOUT_BEFORE_CHECKIN")) return { status: 409, code: "ATTENDANCE_INVALID_STATE", message: "Absen pulang hanya dapat dilakukan setelah absen masuk." };
  if (text.includes("CHALLENGE_")) return { status: 409, code: text, message: "Challenge presensi tidak valid atau sudah tidak berlaku. Periksa lokasi kembali." };
  if (text.includes("LOCATION_ACCURACY_TOO_LOW")) return { status: 422, code: "LOCATION_ACCURACY_TOO_LOW", message: "Akurasi GPS belum memadai. Pindah ke area terbuka dan coba lagi." };
  if (text.includes("LOCATION_STALE")) return { status: 422, code: "LOCATION_STALE", message: "Data lokasi sudah kedaluwarsa. Ambil lokasi terbaru." };
  if (/tidak ditemukan/i.test(text)) return { status: 404, code: "NOT_FOUND", message: text };
  if (/wajib|tidak valid|invalid|format/i.test(text)) return { status: 422, code: "VALIDATION_ERROR", message: text };
  return { status: 500, code: "INTERNAL_ERROR", message: "Terjadi kesalahan pada server." };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clientIp(request: Request): string {
  return (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "").slice(0, 128);
}

async function authenticate(tokenValue: unknown): Promise<AuthContext> {
  const token = String(tokenValue || "").trim();
  if (!token) throw new Error("SESI_HABIS");
  const { data: session, error: sessionError } = await supabase.from("Sessions").select("ID_User,Type,Expires_At").eq("Token", token).maybeSingle();
  if (sessionError || !session || !session.ID_User || String(session.Type || "").toLowerCase() !== "user" || new Date(session.Expires_At).getTime() <= Date.now()) throw new Error("SESI_HABIS");
  const { data: user, error: userError } = await supabase.from("Users").select("ID_User,Status_Aktif").eq("ID_User", session.ID_User).maybeSingle();
  const active = user?.Status_Aktif === true || ["TRUE", "1"].includes(String(user?.Status_Aktif || "").toUpperCase());
  if (userError || !user || !active) throw new Error("AKUN_NONAKTIF");
  return { idUser: String(user.ID_User), token, tokenHash: await sha256(token) };
}

async function consumeRateLimit(rateKey: string, action: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const { data, error } = await supabase.rpc("consume_api_rate_limit", { p_rate_key: rateKey, p_action: action, p_limit: limit, p_window_seconds: windowSeconds });
  if (error) throw new Error("RATE_LIMIT_CHECK_FAILED");
  const result = data as { allowed?: boolean; retryAfterSeconds?: number } | null;
  return { allowed: Boolean(result?.allowed), retryAfterSeconds: Math.max(1, Number(result?.retryAfterSeconds || windowSeconds)) };
}

function parseLocation(body: Record<string, unknown>) {
  const latitude = Number(body.lat);
  const longitude = Number(body.lng);
  const accuracy = Number(body.accuracy);
  const capturedAt = new Date(String(body.locationCapturedAt || ""));
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isFinite(accuracy) || accuracy <= 0 || Number.isNaN(capturedAt.getTime())) throw new Error("Lokasi atau waktu pengambilan lokasi tidak valid.");
  const ageSeconds = Math.max(0, (Date.now() - capturedAt.getTime()) / 1000);
  if (ageSeconds > MAX_LOCATION_AGE_SECONDS) throw new Error("LOCATION_STALE");
  if (accuracy > MAX_ACCEPTED_ACCURACY_METER) throw new Error("LOCATION_ACCURACY_TOO_LOW");
  return { latitude, longitude, accuracy, capturedAt, ageSeconds };
}

function assessRisk(location: { accuracy: number; ageSeconds: number }, ip: string, userAgent: string): RiskAssessment {
  let score = 0;
  const reasons: string[] = [];
  if (location.accuracy > 50) { score += 45; reasons.push("GPS_ACCURACY_OVER_50M"); }
  else if (location.accuracy > 30) { score += 25; reasons.push("GPS_ACCURACY_OVER_30M"); }
  else if (location.accuracy > 15) { score += 10; reasons.push("GPS_ACCURACY_OVER_15M"); }
  if (location.ageSeconds > 20) { score += 20; reasons.push("LOCATION_AGE_OVER_20S"); }
  else if (location.ageSeconds > 10) { score += 10; reasons.push("LOCATION_AGE_OVER_10S"); }
  if (!ip) { score += 5; reasons.push("CLIENT_IP_UNAVAILABLE"); }
  if (!userAgent) { score += 5; reasons.push("USER_AGENT_UNAVAILABLE"); }
  score = Math.min(100, score);
  return { score, level: score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW", reasons };
}

async function writeSecurityEvent(input: { requestId: string; idUser?: string; challengeId?: string; eventType: string; result: "SUCCESS" | "REJECTED" | "FAILED"; risk?: RiskAssessment; request: Request; location?: { latitude: number; longitude: number; accuracy: number }; detail?: Record<string, unknown> }): Promise<void> {
  const { error } = await supabase.from("Attendance_Security_Events").insert({
    Request_ID: input.requestId,
    ID_User: input.idUser || null,
    Challenge_ID: input.challengeId || null,
    Event_Type: input.eventType,
    Result: input.result,
    Risk_Score: input.risk?.score || 0,
    Risk_Level: input.risk?.level || "LOW",
    Client_IP: clientIp(input.request) || null,
    User_Agent: (input.request.headers.get("user-agent") || "").slice(0, 500) || null,
    Origin: (input.request.headers.get("origin") || "").slice(0, 500) || null,
    Latitude: input.location?.latitude ?? null,
    Longitude: input.location?.longitude ?? null,
    Accuracy_Meter: input.location?.accuracy ?? null,
    Detail: input.detail || {},
  });
  if (error) console.error("Attendance security audit failed", error.message);
}

async function callUpstream(body: Record<string, unknown>, request: Request): Promise<any> {
  const upstream = await fetch(UPSTREAM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: request.headers.get("authorization") || `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, apikey: request.headers.get("apikey") || SUPABASE_SERVICE_ROLE_KEY },
    body: JSON.stringify(body),
  });
  const upstreamBody = await upstream.json().catch(() => ({ success: false, error: "Respons upstream tidak valid." }));
  return { upstream, upstreamBody };
}

async function issueChallenge(body: Record<string, unknown>, request: Request, id: string, cors: Record<string, string>): Promise<Response> {
  const auth = await authenticate(body.token);
  const ip = clientIp(request);
  const rate = await consumeRateLimit(`${auth.idUser}:${ip || "NO_IP"}`, "ATTENDANCE_CHALLENGE", 8, 60);
  if (!rate.allowed) {
    await writeSecurityEvent({ requestId: id, idUser: auth.idUser, eventType: "CHALLENGE_RATE_LIMIT", result: "REJECTED", request, detail: { retryAfterSeconds: rate.retryAfterSeconds } });
    return json({ success: false, code: "RATE_LIMITED", message: "Terlalu banyak permintaan lokasi. Tunggu sebentar lalu coba lagi.", requestId: id }, 429, id, cors, { "Retry-After": String(rate.retryAfterSeconds) });
  }
  const location = parseLocation(body);
  const risk = assessRisk(location, ip, request.headers.get("user-agent") || "");
  const { upstreamBody } = await callUpstream({ functionName: "checkAttendanceLocation", token: auth.token, lat: location.latitude, lng: location.longitude, accuracy: location.accuracy }, request);
  const validation = upstreamBody?.success === false ? null : upstreamBody?.result ?? upstreamBody;
  if (!validation?.valid) {
    await writeSecurityEvent({ requestId: id, idUser: auth.idUser, eventType: "CHALLENGE_LOCATION_REJECTED", result: "REJECTED", risk, request, location, detail: { message: validation?.message || upstreamBody?.error || "Lokasi tidak valid." } });
    return json({ success: false, code: "ATTENDANCE_OUTSIDE_GEOFENCE", message: validation?.message || "Lokasi tidak memenuhi radius presensi.", requestId: id, details: { riskScore: risk.score, riskLevel: risk.level } }, 422, id, cors);
  }
  const challengeId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000).toISOString();
  const { error } = await supabase.from("Attendance_Challenges").insert({ Challenge_ID: challengeId, ID_User: auth.idUser, Session_Token_Hash: auth.tokenHash, Latitude: location.latitude, Longitude: location.longitude, Accuracy_Meter: location.accuracy, Location_Captured_At: location.capturedAt.toISOString(), Risk_Score: risk.score, Risk_Level: risk.level, Issued_IP: ip || null, Issued_User_Agent: (request.headers.get("user-agent") || "").slice(0, 500) || null, Expires_At: expiresAt });
  if (error) throw new Error("Gagal membuat challenge presensi.");
  await writeSecurityEvent({ requestId: id, idUser: auth.idUser, challengeId, eventType: "CHALLENGE_ISSUED", result: "SUCCESS", risk, request, location, detail: { expiresAt, distance: validation.jarak ?? validation.distance ?? null, radius: validation.radius ?? null, reasons: risk.reasons } });
  return json({ success: true, result: { challengeId, expiresAt, riskScore: risk.score, riskLevel: risk.level, location: { valid: true, distance: validation.jarak ?? validation.distance ?? null, radius: validation.radius ?? null } }, requestId: id }, 200, id, cors);
}

async function consumeChallenge(body: Record<string, unknown>, request: Request, id: string): Promise<{ auth: AuthContext; challenge: any; risk: RiskAssessment }> {
  const auth = await authenticate(body.token);
  const ip = clientIp(request);
  const rate = await consumeRateLimit(`${auth.idUser}:${ip || "NO_IP"}`, "ATTENDANCE_SUBMIT", 6, 60);
  if (!rate.allowed) { const error = new Error("RATE_LIMITED"); (error as any).retryAfterSeconds = rate.retryAfterSeconds; throw error; }
  const challengeId = String(body.challengeId || "").trim();
  if (!challengeId) throw new Error("CHALLENGE_REQUIRED");
  const location = parseLocation(body);
  const { data: challenge, error } = await supabase.from("Attendance_Challenges").select("Challenge_ID,ID_User,Session_Token_Hash,Latitude,Longitude,Accuracy_Meter,Location_Captured_At,Risk_Score,Risk_Level,Expires_At,Used_At").eq("Challenge_ID", challengeId).maybeSingle();
  if (error || !challenge) throw new Error("CHALLENGE_NOT_FOUND");
  if (String(challenge.ID_User) !== auth.idUser || String(challenge.Session_Token_Hash) !== auth.tokenHash) throw new Error("CHALLENGE_OWNER_MISMATCH");
  if (challenge.Used_At) throw new Error("CHALLENGE_ALREADY_USED");
  if (new Date(challenge.Expires_At).getTime() <= Date.now()) throw new Error("CHALLENGE_EXPIRED");
  const coordinateDrift = Math.max(Math.abs(Number(challenge.Latitude) - location.latitude), Math.abs(Number(challenge.Longitude) - location.longitude));
  if (coordinateDrift > 0.00002 || Math.abs(Number(challenge.Accuracy_Meter) - location.accuracy) > 5) throw new Error("CHALLENGE_LOCATION_MISMATCH");
  const { data: claimed, error: claimError } = await supabase.from("Attendance_Challenges").update({ Used_At: new Date().toISOString(), Used_Request_ID: id }).eq("Challenge_ID", challengeId).is("Used_At", null).gt("Expires_At", new Date().toISOString()).select("Challenge_ID").maybeSingle();
  if (claimError || !claimed) throw new Error("CHALLENGE_ALREADY_USED");
  return { auth, challenge, risk: { score: Number(challenge.Risk_Score || 0), level: String(challenge.Risk_Level || "LOW") as "LOW" | "MEDIUM" | "HIGH", reasons: [] } };
}

async function readStoredIdempotency(key: string): Promise<StoredIdempotency | null> {
  const { data, error } = await supabase.from("API_Idempotency").select("Status,HTTP_Status,Response_Body,Request_Fingerprint,Expires_At").eq("Idempotency_Key", key).maybeSingle();
  if (error) throw new Error("Gagal membaca status idempotensi.");
  return data as StoredIdempotency | null;
}
function isExpired(record: StoredIdempotency): boolean { return new Date(record.Expires_At).getTime() <= Date.now(); }
async function releaseExpiredIdempotency(key: string): Promise<void> { const { error } = await supabase.from("API_Idempotency").delete().eq("Idempotency_Key", key).lte("Expires_At", new Date().toISOString()); if (error) throw new Error("Gagal membersihkan idempotency key kedaluwarsa."); }
function replayStored(record: StoredIdempotency, id: string, cors: Record<string, string>): Response | null { if (!record.Response_Body) return null; if (record.Status === "COMPLETED" || record.Status === "FAILED") return json(record.Response_Body, Number(record.HTTP_Status || (record.Status === "FAILED" ? 500 : 200)), id, cors); return null; }

Deno.serve(async (request) => {
  const id = requestId();
  const origin = request.headers.get("origin");
  const cors = resolveCors(origin);
  if (origin && !cors["Access-Control-Allow-Origin"]) return json({ success: false, code: "ORIGIN_NOT_ALLOWED", message: "Origin tidak diizinkan.", requestId: id }, 403, id, cors);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json({ success: false, code: "METHOD_NOT_ALLOWED", message: "Gunakan metode POST.", requestId: id }, 405, id, cors);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ success: false, code: "INVALID_JSON", message: "Payload JSON tidak valid.", requestId: id }, 400, id, cors); }
  const functionName = String(body.functionName || body.function || "").trim();
  if (functionName === CHALLENGE_FUNCTION) {
    try { return await issueChallenge(body, request, id, cors); }
    catch (error) { const normalized = normalizeError(error instanceof Error ? error.message : error); return json({ success: false, code: normalized.code, message: normalized.message, requestId: id }, normalized.status, id, cors); }
  }

  let attendanceContext: { auth: AuthContext; challenge: any; risk: RiskAssessment } | null = null;
  if (functionName === "recordAbsensiSelf") {
    try {
      attendanceContext = await consumeChallenge(body, request, id);
      body.securityRequestId = id;
      body.riskScore = attendanceContext.risk.score;
      body.riskLevel = attendanceContext.risk.level;
    } catch (error) {
      const retryAfter = Number((error as any)?.retryAfterSeconds || 0);
      const normalized = String((error as Error)?.message || "") === "RATE_LIMITED" ? { status: 429, code: "RATE_LIMITED", message: "Terlalu banyak percobaan presensi. Tunggu sebentar lalu coba lagi." } : normalizeError(error instanceof Error ? error.message : error);
      await writeSecurityEvent({ requestId: id, eventType: "ATTENDANCE_CHALLENGE_REJECTED", result: "REJECTED", request, detail: { code: normalized.code } });
      return json({ success: false, code: normalized.code, message: normalized.message, requestId: id }, normalized.status, id, cors, retryAfter ? { "Retry-After": String(retryAfter) } : {});
    }
  }

  const isIdempotent = IDEMPOTENT_FUNCTIONS.has(functionName);
  const idempotencyKey = String(body.idempotencyKey || request.headers.get("x-idempotency-key") || "").trim();
  const fingerprintBody = { ...body }; delete fingerprintBody.token; delete fingerprintBody.idempotencyKey;
  const fingerprint = await sha256(JSON.stringify({ functionName, body: fingerprintBody }));
  if (isIdempotent && !idempotencyKey) return json({ success: false, code: "IDEMPOTENCY_KEY_REQUIRED", message: "Kunci idempotensi wajib tersedia untuk presensi.", requestId: id }, 400, id, cors);
  if (isIdempotent) {
    const existing = await readStoredIdempotency(idempotencyKey);
    if (existing && isExpired(existing)) await releaseExpiredIdempotency(idempotencyKey);
    else if (existing) {
      if (existing.Request_Fingerprint !== fingerprint) return json({ success: false, code: "IDEMPOTENCY_KEY_REUSED", message: "Kunci idempotensi telah digunakan untuk permintaan yang berbeda.", requestId: id }, 409, id, cors);
      const replay = replayStored(existing, id, cors); if (replay) return replay;
      return json({ success: false, code: "REQUEST_IN_PROGRESS", message: "Permintaan presensi sedang diproses.", requestId: id }, 409, id, cors);
    }
    const { error: claimError } = await supabase.from("API_Idempotency").insert({ Idempotency_Key: idempotencyKey, Function_Name: functionName, Request_Fingerprint: fingerprint, Status: "PROCESSING" });
    if (claimError) {
      const raced = await readStoredIdempotency(idempotencyKey);
      if (raced && !isExpired(raced)) { const replay = replayStored(raced, id, cors); if (replay) return replay; }
      return json({ success: false, code: "REQUEST_IN_PROGRESS", message: "Permintaan presensi sedang diproses.", requestId: id }, 409, id, cors);
    }
  }

  try {
    const { upstream, upstreamBody } = await callUpstream(body, request);
    let status = upstream.status;
    let responseBody: Record<string, unknown> = upstreamBody;
    if (upstreamBody?.success === false) { const normalized = normalizeError(upstreamBody.error || upstreamBody.message); status = normalized.status; responseBody = { success: false, code: normalized.code, message: normalized.message, requestId: id, details: upstreamBody.details || {} }; }
    else { status = status >= 200 && status < 300 ? status : 200; responseBody = { ...upstreamBody, requestId: id }; }
    if (isIdempotent) await supabase.from("API_Idempotency").update({ Status: status >= 500 ? "FAILED" : "COMPLETED", HTTP_Status: status, Response_Body: responseBody, Completed_At: new Date().toISOString() }).eq("Idempotency_Key", idempotencyKey);
    if (functionName === "recordAbsensiSelf" && attendanceContext) await writeSecurityEvent({ requestId: id, idUser: attendanceContext.auth.idUser, challengeId: String(attendanceContext.challenge.Challenge_ID), eventType: "ATTENDANCE_SUBMITTED", result: status >= 200 && status < 300 ? "SUCCESS" : "REJECTED", risk: attendanceContext.risk, request, location: { latitude: Number(attendanceContext.challenge.Latitude), longitude: Number(attendanceContext.challenge.Longitude), accuracy: Number(attendanceContext.challenge.Accuracy_Meter) }, detail: { status, code: responseBody.code || null } });
    return json(responseBody, status, id, cors);
  } catch (error) {
    const normalized = normalizeError(error instanceof Error ? error.message : error);
    const responseBody = { success: false, code: normalized.code, message: normalized.message, requestId: id };
    if (isIdempotent) await supabase.from("API_Idempotency").update({ Status: "FAILED", HTTP_Status: normalized.status, Response_Body: responseBody, Completed_At: new Date().toISOString() }).eq("Idempotency_Key", idempotencyKey);
    if (functionName === "recordAbsensiSelf" && attendanceContext) await writeSecurityEvent({ requestId: id, idUser: attendanceContext.auth.idUser, challengeId: String(attendanceContext.challenge.Challenge_ID), eventType: "ATTENDANCE_SUBMITTED", result: "FAILED", risk: attendanceContext.risk, request, detail: { code: normalized.code } });
    return json(responseBody, normalized.status, id, cors);
  }
});
