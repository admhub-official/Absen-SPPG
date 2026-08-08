import { createClient } from "jsr:@supabase/supabase-js@2";
import { authenticateUserSession, requireOperationalRole } from "../_shared/auth.ts";
import { corsHeaders, createRequestId, isOriginAllowed, jsonResponse } from "../_shared/http.ts";
import { optionalString, requiredString, ValidationError } from "../_shared/validation.ts";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const corsOptions = {
  allowedOriginsEnv: Deno.env.get("ABSEN_ALLOWED_ORIGINS") || "",
  productionOrigin: "https://absen-sppg.pages.dev",
  previewSuffix: ".absen-sppg.pages.dev",
  localOrigins: ["http://localhost:4173", "http://127.0.0.1:4173"],
};

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin, corsOptions);
  const requestId = createRequestId();

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: origin && isOriginAllowed(origin, corsOptions) ? 204 : 403,
      headers,
    });
  }
  if (req.method !== "POST") {
    return jsonResponse(
      { success: false, code: "METHOD_NOT_ALLOWED", message: "Gunakan POST.", requestId },
      405,
      requestId,
      headers,
    );
  }

  try {
    const body = await req.json() as Record<string, unknown>;
    const actor = await authenticateUserSession(db, body.token);
    const action = requiredString(body.action, "action", { max: 80 });

    if (action === "readiness") {
      const result = await db.rpc("platform_readiness_summary");
      if (result.error) throw result.error;
      return jsonResponse({ success: true, result: result.data, requestId }, 200, requestId, headers);
    }

    if (action === "privacyRequest") {
      const requestType = requiredString(body.type, "type", { min: 2, max: 80 }).toUpperCase();
      const reason = optionalString(body.reason, 2000);
      const result = await db
        .from("Privacy_Requests")
        .insert({
          ID_User: actor.idUser,
          Request_Type: requestType,
          Reason: reason,
        })
        .select()
        .single();
      if (result.error) throw result.error;
      return jsonResponse({ success: true, result: result.data, requestId }, 201, requestId, headers);
    }

    requireOperationalRole(actor);
    if (action === "retentionPolicies") {
      const result = await db.from("Data_Retention_Policies").select("*").order("Data_Type");
      if (result.error) throw result.error;
      return jsonResponse({ success: true, result: result.data, requestId }, 200, requestId, headers);
    }

    if (action === "purgePreview") {
      const result = await db.rpc("purge_expired_operational_data", { p_dry_run: true });
      if (result.error) throw result.error;
      return jsonResponse({ success: true, result: result.data, requestId }, 200, requestId, headers);
    }

    throw new ValidationError("ACTION_NOT_SUPPORTED", "Action tidak didukung.", "action");
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    let status = 500;
    let code = "INTERNAL_ERROR";
    let message = "Terjadi kesalahan pada server.";
    if (error instanceof ValidationError) {
      status = 422;
      code = error.code;
      message = error.message;
    } else if (raw === "SESSION_EXPIRED") {
      status = 401;
      code = raw;
      message = "Sesi telah berakhir. Silakan login kembali.";
    } else if (raw === "ACCOUNT_INACTIVE" || raw === "FORBIDDEN") {
      status = 403;
      code = raw;
      message = "Akses ditolak.";
    }
    console.error(JSON.stringify({ requestId, code, status, error: raw }));
    return jsonResponse({
      success: false,
      code,
      message,
      requestId,
      ...(error instanceof ValidationError && error.field ? { details: { field: error.field } } : {}),
    }, status, requestId, headers);
  }
});