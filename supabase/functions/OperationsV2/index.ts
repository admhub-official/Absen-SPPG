import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  type AuthenticatedUser,
  authenticateUserSession,
  requireOperationalRole,
  requireSuperAdminRole,
} from "../_shared/auth.ts";
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

async function route(
  action: string,
  body: Record<string, unknown>,
  auth: AuthenticatedUser,
) {
  if (action === "listFeatureFlags") {
    requireOperationalRole(auth);
    const result = await db.from("Release_Feature_Flags").select("*").order("Flag_Key");
    if (result.error) throw result.error;
    return result.data || [];
  }

  if (action === "setFeatureFlag") {
    requireSuperAdminRole(auth);
    const key = requiredString(body.key, "key", { max: 100 });
    const enabled = Boolean(body.enabled);
    const scope = optionalString(body.scopeSppg, 200);
    const config = typeof body.config === "object" && body.config ? body.config : {};
    const result = await db
      .from("Release_Feature_Flags")
      .upsert({
        Flag_Key: key,
        Enabled: enabled,
        Scope_SPPG: scope,
        Config: config,
        Updated_By: auth.idUser,
        Updated_At: new Date().toISOString(),
      })
      .select()
      .maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  }

  if (action === "transitionPayroll") {
    requireOperationalRole(auth);
    const result = await db.rpc("transition_payroll_workflow", {
      p_slip_id: requiredString(body.slipId, "slipId", { max: 200 }),
      p_user_id: requiredString(body.userId, "userId", { max: 100 }),
      p_to_status: requiredString(body.toStatus, "toStatus", { max: 50 }).toUpperCase(),
      p_actor_id: auth.idUser,
      p_reason: optionalString(body.reason, 2000),
      p_idempotency_key: optionalString(body.idempotencyKey, 200),
    });
    if (result.error) throw result.error;
    return result.data;
  }

  if (action === "listPayrollWorkflow") {
    requireOperationalRole(auth);
    let query = db
      .from("Payroll_Workflow_State")
      .select("*")
      .order("Updated_At", { ascending: false })
      .limit(200);
    if (body.status) query = query.eq("Status", String(body.status).toUpperCase());
    const result = await query;
    if (result.error) throw result.error;
    return result.data || [];
  }

  if (action === "logComplaintIdentityAccess") {
    requireSuperAdminRole(auth);
    const result = await db.rpc("log_complaint_identity_access", {
      p_complaint_id: requiredString(body.complaintId, "complaintId", { max: 200 }),
      p_actor_id: auth.idUser,
      p_actor_role: auth.role,
      p_reason: requiredString(body.reason, "reason", { min: 10, max: 2000 }),
      p_request_id: optionalString(body.requestId, 200),
    });
    if (result.error) throw result.error;
    return { accessId: result.data };
  }

  if (action === "listComplaintPrivacyLog") {
    requireSuperAdminRole(auth);
    const result = await db
      .from("Complaint_Privacy_Access_Log")
      .select("*")
      .order("Created_At", { ascending: false })
      .limit(300);
    if (result.error) throw result.error;
    return result.data || [];
  }

  if (action === "listUserAccess") {
    requireOperationalRole(auth);
    let query = db
      .from("User_SPPG_Access_V2")
      .select("*")
      .order("Created_At", { ascending: false })
      .limit(500);
    if (body.userId) query = query.eq("ID_User", String(body.userId));
    const result = await query;
    if (result.error) throw result.error;
    return result.data || [];
  }

  if (action === "grantUserAccess") {
    requireSuperAdminRole(auth);
    const row = {
      ID_User: requiredString(body.userId, "userId", { max: 100 }),
      SPPG: requiredString(body.sppg, "sppg", { max: 200 }),
      Role_Scope: optionalString(body.roleScope, 100),
      Active: true,
      Valid_Until: body.validUntil || null,
      Granted_By: auth.idUser,
    };
    const result = await db
      .from("User_SPPG_Access_V2")
      .upsert(row, { onConflict: "ID_User,SPPG,Role_Scope" })
      .select()
      .maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  }

  if (action === "recordUserSecurityEvent") {
    requireOperationalRole(auth);
    const result = await db
      .from("User_Security_Events")
      .insert({
        ID_User: requiredString(body.userId, "userId", { max: 100 }),
        Event_Type: requiredString(body.eventType, "eventType", { max: 100 }),
        Actor_ID: auth.idUser,
        Session_ID: optionalString(body.sessionId, 200),
        Device_ID: optionalString(body.deviceId, 200),
        Before_Data: body.beforeData || {},
        After_Data: body.afterData || {},
        Reason: optionalString(body.reason, 2000),
      })
      .select()
      .maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  }

  throw new ValidationError("ACTION_NOT_SUPPORTED", "action");
}

Deno.serve(async (req) => {
  const requestId = createRequestId();
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin, corsOptions);

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
    const auth = await authenticateUserSession(db, body.token);
    const result = await route(String(body.action || ""), body, auth);
    return jsonResponse({ success: true, result, requestId }, 200, requestId, headers);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    let status = 500;
    let code = "INTERNAL_ERROR";
    let message = "Terjadi kesalahan pada server.";

    if (error instanceof ValidationError) {
      status = 422;
      code = error.code;
      message = error.message;
    } else if (rawMessage === "SESSION_EXPIRED") {
      status = 401;
      code = rawMessage;
      message = "Sesi telah berakhir.";
    } else if (rawMessage === "ACCOUNT_INACTIVE" || rawMessage === "FORBIDDEN") {
      status = 403;
      code = rawMessage;
      message = "Akses ditolak.";
    } else if (rawMessage.includes("FINAL_STATE") || rawMessage.includes("IDEMPOTENCY")) {
      status = 409;
      code = rawMessage;
      message = "Status workflow tidak dapat diubah.";
    }

    console.error(JSON.stringify({ requestId, code, error: rawMessage }));
    return jsonResponse({ success: false, code, message, requestId }, status, requestId, headers);
  }
});
