import { createClient } from "jsr:@supabase/supabase-js@2";
import { authenticateUserSession, requireOperationalRole } from "../_shared/auth.ts";
import { corsHeaders, createRequestId, isOriginAllowed, jsonResponse } from "../_shared/http.ts";

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
    const body = await req.json();
    const actor = await authenticateUserSession(db, body.token);
    const action = String(body.action || "");

    if (action === "readiness") {
      const result = await db.rpc("platform_readiness_summary");
      if (result.error) throw result.error;
      return jsonResponse({ success: true, result: result.data, requestId }, 200, requestId, headers);
    }

    if (action === "privacyRequest") {
      const result = await db
        .from("Privacy_Requests")
        .insert({
          ID_User: actor.idUser,
          Request_Type: String(body.type || ""),
          Reason: String(body.reason || "").slice(0, 2000),
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

    throw new Error("UNKNOWN_ACTION");
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    const status = code === "SESSION_EXPIRED"
      ? 401
      : code === "ACCOUNT_INACTIVE" || code === "FORBIDDEN"
      ? 403
      : 422;
    const message = status === 422 && !["UNKNOWN_ACTION"].includes(code)
      ? "Permintaan tidak dapat diproses."
      : code;
    return jsonResponse({ success: false, code, message, requestId }, status, requestId, headers);
  }
});
