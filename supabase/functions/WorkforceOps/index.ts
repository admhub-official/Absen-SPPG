import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  type AuthenticatedUser,
  authenticateUserSession,
  requireOperationalRole,
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

async function listNotifications(auth: AuthenticatedUser, body: Record<string, unknown>) {
  const limit = Math.min(100, Math.max(1, Number(body.limit || 30)));
  let query = db
    .from("Notifications")
    .select("*")
    .or(`ID_User.eq.${auth.idUser},Target_Role.eq.${auth.role}`)
    .order("Created_At", { ascending: false })
    .limit(limit);
  if (body.unreadOnly) query = query.is("Read_At", null);
  const result = await query;
  if (result.error) throw new Error("NOTIFICATION_QUERY_FAILED");
  return result.data || [];
}

async function markRead(auth: AuthenticatedUser, body: Record<string, unknown>) {
  const notificationId = requiredString(body.notificationId, "notificationId", { max: 100 });
  const result = await db.rpc("mark_notification_read", {
    p_notification_id: notificationId,
    p_user_id: auth.idUser,
  });
  if (result.error || !result.data) throw new Error("NOTIFICATION_NOT_FOUND");
  return { updated: true };
}

async function preferences(auth: AuthenticatedUser, body: Record<string, unknown>) {
  if (body.save) {
    const row = {
      ID_User: auth.idUser,
      In_App_Enabled: body.inAppEnabled !== false,
      Push_Enabled: body.pushEnabled !== false,
      Sound_Enabled: body.soundEnabled === true,
      Quiet_Hours_Start: body.quietHoursStart || null,
      Quiet_Hours_End: body.quietHoursEnd || null,
      Updated_At: new Date().toISOString(),
    };
    const result = await db.from("Notification_Preferences").upsert(row).select().single();
    if (result.error) throw new Error("PREFERENCE_SAVE_FAILED");
    return result.data;
  }

  const result = await db
    .from("Notification_Preferences")
    .select("*")
    .eq("ID_User", auth.idUser)
    .maybeSingle();
  if (result.error) throw new Error("PREFERENCE_QUERY_FAILED");
  return result.data || {
    ID_User: auth.idUser,
    In_App_Enabled: true,
    Push_Enabled: true,
    Sound_Enabled: false,
  };
}

async function assignShift(auth: AuthenticatedUser, body: Record<string, unknown>) {
  requireOperationalRole(auth);
  const row = {
    ID_User: requiredString(body.userId, "userId", { max: 100 }),
    Shift_ID: requiredString(body.shiftId, "shiftId", { max: 100 }),
    SPPG: optionalString(body.sppg, 200),
    Valid_From: requiredString(body.validFrom, "validFrom", { max: 10 }),
    Valid_Until: optionalString(body.validUntil, 10),
    Assigned_By: auth.idUser,
    Notes: optionalString(body.notes, 1000),
    Is_Active: true,
  };
  const result = await db.from("Work_Shift_Assignments").insert(row).select().single();
  if (result.error) throw new Error("SHIFT_ASSIGN_FAILED");
  return result.data;
}

async function listShiftAssignments(auth: AuthenticatedUser, body: Record<string, unknown>) {
  requireOperationalRole(auth);
  let query = db
    .from("Work_Shift_Assignments")
    .select("*")
    .order("Valid_From", { ascending: false })
    .limit(200);
  if (body.userId) query = query.eq("ID_User", String(body.userId));
  if (body.sppg) query = query.eq("SPPG", String(body.sppg));
  const result = await query;
  if (result.error) throw new Error("SHIFT_QUERY_FAILED");
  return result.data || [];
}

async function analytics(auth: AuthenticatedUser, body: Record<string, unknown>) {
  requireOperationalRole(auth);
  const from = requiredString(body.from, "from", { max: 10 });
  const to = requiredString(body.to, "to", { max: 10 });
  const result = await db.rpc("attendance_analytics_summary", {
    p_from: from,
    p_to: to,
    p_sppg: body.sppg ? String(body.sppg) : null,
  });
  if (result.error) throw new Error("ANALYTICS_QUERY_FAILED");
  return result.data;
}

async function scheduleReport(auth: AuthenticatedUser, body: Record<string, unknown>) {
  requireOperationalRole(auth);
  const row = {
    Name: requiredString(body.name, "name", { min: 3, max: 200 }),
    Report_Type: requiredString(body.reportType, "reportType", { max: 30 }).toUpperCase(),
    SPPG: optionalString(body.sppg, 200),
    Frequency: requiredString(body.frequency, "frequency", { max: 20 }).toUpperCase(),
    Format: String(body.format || "CSV").toUpperCase(),
    Recipients: Array.isArray(body.recipients) ? body.recipients : [],
    Filters: body.filters || {},
    Next_Run_At: body.nextRunAt || null,
    Created_By: auth.idUser,
  };
  const result = await db.from("Report_Schedules").insert(row).select().single();
  if (result.error) throw new Error("REPORT_SCHEDULE_FAILED");
  return result.data;
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
    const action = String(body.action || "");
    let result: unknown;

    switch (action) {
      case "listNotifications":
        result = await listNotifications(auth, body);
        break;
      case "markNotificationRead":
        result = await markRead(auth, body);
        break;
      case "notificationPreferences":
        result = await preferences(auth, body);
        break;
      case "assignShift":
        result = await assignShift(auth, body);
        break;
      case "listShiftAssignments":
        result = await listShiftAssignments(auth, body);
        break;
      case "analyticsSummary":
        result = await analytics(auth, body);
        break;
      case "scheduleReport":
        result = await scheduleReport(auth, body);
        break;
      default:
        throw new ValidationError("Action tidak valid.", "action");
    }

    return jsonResponse({ success: true, result, requestId }, 200, requestId, headers);
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    const status = code === "SESSION_EXPIRED"
      ? 401
      : code === "ACCOUNT_INACTIVE" || code === "FORBIDDEN"
      ? 403
      : error instanceof ValidationError
      ? 422
      : 500;
    const message = status === 500 ? "Terjadi kesalahan pada server." : code;
    return jsonResponse({ success: false, code, message, requestId }, status, requestId, headers);
  }
});
