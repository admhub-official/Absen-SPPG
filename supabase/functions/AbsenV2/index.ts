import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const UPSTREAM_URL = `${SUPABASE_URL}/functions/v1/Absen`;
const IDEMPOTENT_FUNCTIONS = new Set(["recordAbsensiSelf", "recordAbsensi"]);
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ErrorDescriptor = { status: number; code: string; message: string };
type StoredIdempotency = {
  Status: "PROCESSING" | "COMPLETED" | "FAILED";
  HTTP_Status: number | null;
  Response_Body: Record<string, unknown> | null;
  Request_Fingerprint: string;
  Expires_At: string;
};

function requestId(): string {
  return `REQ_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

function json(body: unknown, status: number, id: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Request-Id": id,
    },
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
  if (/tidak ditemukan/i.test(text)) return { status: 404, code: "NOT_FOUND", message: text };
  if (/wajib|tidak valid|invalid|format/i.test(text)) return { status: 422, code: "VALIDATION_ERROR", message: text };
  return { status: 500, code: "INTERNAL_ERROR", message: "Terjadi kesalahan pada server." };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readStoredIdempotency(key: string): Promise<StoredIdempotency | null> {
  const { data, error } = await supabase.from("API_Idempotency")
    .select("Status,HTTP_Status,Response_Body,Request_Fingerprint,Expires_At")
    .eq("Idempotency_Key", key)
    .maybeSingle();
  if (error) throw new Error("Gagal membaca status idempotensi.");
  return data as StoredIdempotency | null;
}

function isExpired(record: StoredIdempotency): boolean {
  return new Date(record.Expires_At).getTime() <= Date.now();
}

async function releaseExpiredIdempotency(key: string): Promise<void> {
  const { error } = await supabase.from("API_Idempotency")
    .delete()
    .eq("Idempotency_Key", key)
    .lte("Expires_At", new Date().toISOString());
  if (error) throw new Error("Gagal membersihkan idempotency key kedaluwarsa.");
}

function replayStored(record: StoredIdempotency, id: string): Response | null {
  if (!record.Response_Body) return null;
  if (record.Status === "COMPLETED" || record.Status === "FAILED") {
    return json(record.Response_Body, Number(record.HTTP_Status || (record.Status === "FAILED" ? 500 : 200)), id);
  }
  return null;
}

Deno.serve(async (request) => {
  const id = requestId();
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "POST") {
    return json({ success: false, code: "METHOD_NOT_ALLOWED", message: "Gunakan metode POST.", requestId: id }, 405, id);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, code: "INVALID_JSON", message: "Payload JSON tidak valid.", requestId: id }, 400, id);
  }

  const functionName = String(body.functionName || body.function || "").trim();
  const isIdempotent = IDEMPOTENT_FUNCTIONS.has(functionName);
  const headerKey = request.headers.get("x-idempotency-key") || "";
  const idempotencyKey = String(body.idempotencyKey || headerKey).trim();
  const fingerprintBody = { ...body };
  delete fingerprintBody.token;
  delete fingerprintBody.idempotencyKey;
  const fingerprint = await sha256(JSON.stringify({ functionName, body: fingerprintBody }));

  if (isIdempotent && !idempotencyKey) {
    return json({ success: false, code: "IDEMPOTENCY_KEY_REQUIRED", message: "Kunci idempotensi wajib tersedia untuk presensi.", requestId: id }, 400, id);
  }

  if (isIdempotent) {
    const existing = await readStoredIdempotency(idempotencyKey);
    if (existing && isExpired(existing)) {
      await releaseExpiredIdempotency(idempotencyKey);
    } else if (existing) {
      if (existing.Request_Fingerprint !== fingerprint) {
        return json({ success: false, code: "IDEMPOTENCY_KEY_REUSED", message: "Kunci idempotensi telah digunakan untuk permintaan yang berbeda.", requestId: id }, 409, id);
      }
      const replay = replayStored(existing, id);
      if (replay) return replay;
      return json({ success: false, code: "REQUEST_IN_PROGRESS", message: "Permintaan presensi sedang diproses.", requestId: id }, 409, id);
    }

    const { error: claimError } = await supabase.from("API_Idempotency").insert({
      Idempotency_Key: idempotencyKey,
      Function_Name: functionName,
      Request_Fingerprint: fingerprint,
      Status: "PROCESSING",
    });
    if (claimError) {
      const raced = await readStoredIdempotency(idempotencyKey);
      if (raced && !isExpired(raced)) {
        const replay = replayStored(raced, id);
        if (replay) return replay;
      }
      return json({ success: false, code: "REQUEST_IN_PROGRESS", message: "Permintaan presensi sedang diproses.", requestId: id }, 409, id);
    }
  }

  try {
    const upstream = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: request.headers.get("authorization") || `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: request.headers.get("apikey") || SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify(body),
    });
    const upstreamBody = await upstream.json().catch(() => ({ success: false, error: "Respons upstream tidak valid." }));

    let status = upstream.status;
    let responseBody: Record<string, unknown> = upstreamBody;
    if (upstreamBody?.success === false) {
      const normalized = normalizeError(upstreamBody.error || upstreamBody.message);
      status = normalized.status;
      responseBody = { success: false, code: normalized.code, message: normalized.message, requestId: id, details: upstreamBody.details || {} };
    } else {
      status = status >= 200 && status < 300 ? status : 200;
      responseBody = { ...upstreamBody, requestId: id };
    }

    if (isIdempotent) {
      const finalState = status >= 500 ? "FAILED" : "COMPLETED";
      await supabase.from("API_Idempotency").update({
        Status: finalState,
        HTTP_Status: status,
        Response_Body: responseBody,
        Completed_At: new Date().toISOString(),
      }).eq("Idempotency_Key", idempotencyKey);
    }
    return json(responseBody, status, id);
  } catch (error) {
    const normalized = normalizeError(error instanceof Error ? error.message : error);
    const responseBody = { success: false, code: normalized.code, message: normalized.message, requestId: id };
    if (isIdempotent) {
      await supabase.from("API_Idempotency").update({
        Status: "FAILED",
        HTTP_Status: normalized.status,
        Response_Body: responseBody,
        Completed_At: new Date().toISOString(),
      }).eq("Idempotency_Key", idempotencyKey);
    }
    return json(responseBody, normalized.status, id);
  }
});
