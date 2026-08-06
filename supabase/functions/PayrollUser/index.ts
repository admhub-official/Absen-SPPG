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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ success: false, error: "Method tidak didukung" }, 405);

  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "Body JSON tidak valid" }, 400);
  }

  try {
    const functionName = String(body.function || body.functionName || "");
    const payload = body.data && typeof body.data === "object" ? body.data : body;
    const workflow = await handlePayrollSignatureWorkflow(functionName, payload, db);
    if (!workflow.handled) {
      return json({ success: false, error: "Fungsi payroll tidak didukung" }, 404);
    }
    return json({ success: true, result: workflow.result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = ["SESI_HABIS", "AKUN_NONAKTIF"].includes(message) ? 401 : 400;
    return json({ success: false, error: message }, status);
  }
});
