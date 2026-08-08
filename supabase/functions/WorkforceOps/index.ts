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

function integerInRange(value: unknown, field: string, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ValidationError("INVALID_INTEGER", `${field} harus bilangan bulat ${min}-${max}.`, field);
  }
  return parsed;
}

function dateOnly(value: unknown, field: string, required = true): string | null {
  if ((value === undefined || value === null || value === "") && !required) return null;
  const raw = requiredString(value, field, { max: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(new Date(`${raw}T00:00:00Z`).getTime())) {
    throw new ValidationError("INVALID_DATE", `${field} tidak valid.`, field);
  }
  return raw;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new ValidationError("INVALID_BOOLEAN", `${field} wajib boolean.`, field);
  return value;
}

function quietHour(value: unknown, field: string): string | null {
  const raw = optionalString(value, 5);
  if (!raw) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
    throw new ValidationError("INVALID_TIME", `${field} harus berformat HH:MM.`, field);
  }
  return raw;
}

async function listNotifications(auth: AuthenticatedUser, body: Record<string, unknown>) {
  const limit = integerInRange(body.limit, "limit", 30, 1, 100);
  if (body.unreadOnly !== undefined && typeof body.unreadOnly !== "boolean") {
    throw new ValidationError("INVALID_BOOLEAN", "unreadOnly wajib boolean.", "unreadOnly");
  }
  let query = db
    .from("Notifications")
    .select("*")
    .or(`ID_User.eq.${auth.idUser},Target_Role.eq.${auth.role}`)
    .order("Created_At", { ascending: false })
    .limit(limit);
  if (body.unreadOnly === true) query = query.is("Read_At", null);
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
  if (body.save !== undefined && typeof body.save !== "boolean") {
    throw new ValidationError("INVALID_BOOLEAN", "save wajib boolean.", "save");
  }
  if (body.save === true) {
    const inAppEnabled = optionalBoolean(body.inAppEnabled, "inAppEnabled");
    const pushEnabled = optionalBoolean(body.pushEnabled, "pushEnabled");
    const soundEnabled = optionalBoolean(body.soundEnabled, "soundEnabled");
    const row = {
      ID_User: auth.idUser,
      In_App_Enabled: inAppEnabled ?? true,
      Push_Enabled: pushEnabled ?? true,
      Sound_Enabled: soundEnabled ?? false,
      Quiet_Hours_Start: quietHour(body.quietHoursStart, "quietHoursStart"),
      Quiet_Hours_End: quietHour(body.quietHoursEnd, "quietHoursEnd"),
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
  const validFrom = dateOnly(body.validFrom, "validFrom")!;
  const validUntil = dateOnly(body.validUntil, "validUntil", false);
  if (validUntil && validUntil < validFrom) {
    throw new ValidationError("INVALID_DATE_RANGE", "validUntil tidak boleh sebelum validFrom.", "validUntil");
  }
  const row = {
    ID_User: requiredString(body.userId, "userId", { max: 100 }),
    Shift_ID: requiredString(body.shiftId, "shiftId", { max: 100 }),
    SPPG: optionalString(body.sppg, 200),
    Valid_From: validFrom,
    Valid_Until: validUntil,
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
  if (body.userId) query = query.eq("ID_User", requiredString(body.userId, "userId", { max: 100 }));
  if (body.sppg) query = query.eq("SPPG", requiredString(body.sppg, "sppg", { max: 200 }));
  const result = await query;
  if (result.error) throw new Error("SHIFT_QUERY_FAILED");
  return result.data || [];
}

async function analytics(auth: AuthenticatedUser, body: Record<string, unknown>) {
  requireOperationalRole(auth);
  const from = dateOnly(body.from, "from")!;
  const to = dateOnly(body.to, "to")!;
  if (to < from) throw new ValidationError("INVALID_DATE_RANGE", "to tidak boleh sebelum from.", "to");
  const result = await db.rpc("attendance_analytics_summary", {
    p_from: from,
    p_to: to,
    p_sppg: optionalString(body.sppg, 200),
  });
  if (result.error) throw new Error("ANALYTICS_QUERY_FAILED");
  return result.data;
}

async function scheduleReport(auth: AuthenticatedUser, body: Record<string, unknown>) {
  requireOperationalRole(auth);
  const recipients = body.recipients === undefined ? [] : body.recipients;
  if (!Array.isArray(recipients) || recipients.length > 100 || recipients.some((value) => typeof value !== "string" || !value.trim())) {
    throw new ValidationError("INVALID_RECIPIENTS", "recipients wajib berupa array string valid maksimal 100 item.", "recipients");
  }
  if (body.filters !== undefined && (!body.filters || typeof body.filters !== "object" || Array.isArray(body.filters))) {
    throw new ValidationError("INVALID_FILTERS", "filters wajib berupa object.", "filters");
  }
  let nextRunAt: string | null = null;
  if (body.nextRunAt) {
    const parsed = new Date(String(body.nextRunAt));
    if (Number.isNaN(parsed.getTime())) throw new ValidationError("INVALID_DATETIME", "nextRunAt tidak valid.", "nextRunAt");
    nextRunAt = parsed.toISOString();
  }
  const format = requiredString(body.format || "CSV", "format", { max: 20 }).toUpperCase();
  if (!["CSV", "PDF", "XLSX", "EXCEL"].includes(format)) {
    throw new ValidationError("INVALID_FORMAT", "Format laporan tidak valid.", "format");
  }
  const row = {
    Name: requiredString(body.name, "name", { min: 3, max: 200 }),
    Report_Type: requiredString(body.reportType, "reportType", { max: 30 }).toUpperCase(),
    SPPG: optionalString(body.sppg, 200),
    Frequency: requiredString(body.frequency, "frequency", { max: 20 }).toUpperCase(),
    Format: format,
    Recipients: recipients.map((value) => String(value).trim()),
    Filters: body.filters || {},
    Next_Run_At: nextRunAt,
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
    const body = await req.json() as Record<string, unknown>;
    const auth = await authenticateUserSession(db, body.token);
    const action = requiredString(body.action, "action", { max: 80 });
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
        throw new ValidationError("ACTION_NOT_SUPPORTED", "Action tidak valid.", "action");
    }

    return jsonResponse({ success: true, result, requestId }, 200, requestId, headers);
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
    } else if (raw === "NOTIFICATION_NOT_FOUND") {
      status = 404;
      code = raw;
      message = "Notifikasi tidak ditemukan.";
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