import { createClient } from "jsr:@supabase/supabase-js@2";
import { handlePayrollSignatureWorkflow } from "../Absen/payroll-signature-workflow.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,x-client-info,apikey,content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

function json(body: unknown, status = 200, requestId?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(requestId ? { "X-Request-Id": requestId } : {}),
    },
  });
}

function mapError(message: string) {
  if (message === "SESI_HABIS") return { status: 401, code: "SESSION_EXPIRED", message: "Sesi telah berakhir. Silakan login kembali." };
  if (message === "AKUN_NONAKTIF") return { status: 403, code: "ACCOUNT_INACTIVE", message: "Akun tidak aktif." };
  if (/Akses ditolak|di luar cakupan/i.test(message)) return { status: 403, code: "FORBIDDEN", message };
  if (/tidak ditemukan pada akun|Slip tidak ditemukan|tidak ditemukan$/i.test(message)) return { status: 404, code: "NOT_FOUND", message };
  if (/sudah ditandatangani|sudah tersedia|belum dapat|belum tersedia|Tandatangani/i.test(message)) return { status: 409, code: "CONFLICT", message };
  if (/wajib|tidak valid|tidak lengkap|minimal|maksimal|tidak boleh|hanya boleh|duplikat/i.test(message)) {
    return { status: 422, code: "VALIDATION_ERROR", message };
  }
  return { status: 500, code: "INTERNAL_ERROR", message: "Layanan payroll gagal memproses permintaan." };
}

Deno.serve(async (request) => {
  const requestId = `PAY_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "POST") {
    return json({ success: false, code: "METHOD_NOT_ALLOWED", message: "Method tidak didukung", requestId }, 405, requestId);
  }

  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, code: "INVALID_JSON", message: "Body JSON tidak valid", requestId }, 400, requestId);
  }

  try {
    const functionName = String(body.function || body.functionName || "").trim();
    if (!functionName) {
      return json({ success: false, code: "FUNCTION_REQUIRED", message: "Nama fungsi payroll wajib diisi.", requestId }, 422, requestId);
    }
    const payload = body.data && typeof body.data === "object" ? body.data : body;
    const workflow = await handlePayrollSignatureWorkflow(functionName, payload, db);
    if (!workflow.handled) {
      return json({ success: false, code: "FUNCTION_NOT_SUPPORTED", message: "Fungsi payroll tidak didukung", requestId }, 404, requestId);
    }
    return json({ success: true, result: workflow.result, requestId }, 200, requestId);
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const mapped = mapError(raw);
    console.error(JSON.stringify({ requestId, code: mapped.code, status: mapped.status, error: raw }));
    return json({ success: false, code: mapped.code, message: mapped.message, requestId }, mapped.status, requestId);
  }
});