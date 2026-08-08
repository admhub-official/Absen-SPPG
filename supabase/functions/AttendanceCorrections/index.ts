import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, createRequestId, isOriginAllowed, jsonResponse } from "../_shared/http.ts";
import { requiredString, ValidationError } from "../_shared/validation.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(url, key, { auth: { persistSession: false } });
const operatorRoles = new Set(["ADMIN", "SUPER ADMIN", "AKUNTAN"]);
const roleOf = (value: unknown) => String(value || "").toUpperCase().replace(/_/g, " ");
const active = (value: unknown) => value === true || value === 1 || ["TRUE", "1"].includes(String(value || "").toUpperCase());
const corsOptions = {
  allowedOriginsEnv: Deno.env.get("ABSEN_ALLOWED_ORIGINS") || "",
  productionOrigin: "https://hadirly.org",
  previewSuffix: ".pages.dev",
  localOrigins: ["http://localhost:4173", "http://127.0.0.1:4173"],
};

async function auth(token: unknown) {
  const cleanToken = requiredString(token, "token", { min: 16, max: 2048 });
  const session = await db.from("Sessions")
    .select("ID_User,Type,Expires_At")
    .eq("Token", cleanToken)
    .maybeSingle();
  if (
    session.error || !session.data?.ID_User ||
    String(session.data.Type || "").toLowerCase() !== "user" ||
    new Date(session.data.Expires_At).getTime() <= Date.now()
  ) throw new Error("SESSION_EXPIRED");

  const user = await db.from("Users")
    .select("ID_User,Role,Status_Aktif")
    .eq("ID_User", session.data.ID_User)
    .maybeSingle();
  if (user.error || !user.data || !active(user.data.Status_Aktif)) throw new Error("ACCOUNT_INACTIVE");
  return { id: String(user.data.ID_User), role: roleOf(user.data.Role) };
}

function dateOnly(value: unknown, field: string): string {
  const date = requiredString(value, field, { max: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
    throw new ValidationError("INVALID_DATE", `${field} tidak valid.`, field);
  }
  return date;
}

function errorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "SESSION_EXPIRED") return 401;
  if (message === "ACCOUNT_INACTIVE" || message === "FORBIDDEN") return 403;
  if (error instanceof ValidationError) return 422;
  return 500;
}

Deno.serve(async (req) => {
  const requestId = createRequestId("COR");
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin, corsOptions);

  if (origin && !isOriginAllowed(origin, corsOptions)) {
    return jsonResponse({ success: false, code: "ORIGIN_NOT_ALLOWED", message: "Origin tidak diizinkan.", requestId }, 403, requestId, headers);
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") {
    return jsonResponse({ success: false, code: "METHOD_NOT_ALLOWED", message: "Gunakan POST.", requestId }, 405, requestId, headers);
  }

  try {
    const body = await req.json() as Record<string, unknown>;
    const actor = await auth(body.token);
    const action = requiredString(body.action, "action", { max: 40 });

    if (action === "create") {
      const reason = requiredString(body.reason, "reason", { min: 10, max: 2000 });
      const attendanceDate = dateOnly(body.attendanceDate, "attendanceDate");
      const correctionType = requiredString(body.correctionType, "correctionType", { max: 100 });
      const attendanceId = body.attendanceId == null ? null : requiredString(body.attendanceId, "attendanceId", { max: 160 });
      if (!body.requestedValues || typeof body.requestedValues !== "object" || Array.isArray(body.requestedValues)) {
        throw new ValidationError("INVALID_REQUESTED_VALUES", "requestedValues wajib berupa object.", "requestedValues");
      }
      const evidenceUrl = body.evidenceUrl == null || String(body.evidenceUrl).trim() === ""
        ? null
        : requiredString(body.evidenceUrl, "evidenceUrl", { max: 2000 });

      const row = {
        ID_User: actor.id,
        ID_Absensi: attendanceId,
        Attendance_Date: attendanceDate,
        Correction_Type: correctionType,
        Requested_Values: body.requestedValues,
        Reason: reason,
        Evidence_URL: evidenceUrl,
      };
      const result = await db.from("Attendance_Corrections").insert(row).select("*").single();
      if (result.error) throw result.error;
      return jsonResponse({ success: true, result: result.data, requestId }, 201, requestId, headers);
    }

    if (action === "listMine") {
      const result = await db.from("Attendance_Corrections")
        .select("*")
        .eq("ID_User", actor.id)
        .order("Submitted_At", { ascending: false })
        .limit(100);
      if (result.error) throw result.error;
      return jsonResponse({ success: true, result: result.data || [], requestId }, 200, requestId, headers);
    }

    if (action === "listQueue") {
      if (!operatorRoles.has(actor.role)) throw new Error("FORBIDDEN");
      let query = db.from("Attendance_Corrections")
        .select("*")
        .order("Submitted_At", { ascending: false })
        .limit(100);
      if (body.status) {
        const status = String(body.status).trim().toUpperCase();
        if (!["PENDING", "APPROVED", "REJECTED"].includes(status)) {
          throw new ValidationError("INVALID_STATUS", "Status koreksi tidak valid.", "status");
        }
        query = query.eq("Status", status);
      }
      const result = await query;
      if (result.error) throw result.error;
      return jsonResponse({ success: true, result: result.data || [], requestId }, 200, requestId, headers);
    }

    if (action === "review") {
      if (!operatorRoles.has(actor.role)) throw new Error("FORBIDDEN");
      const correctionId = requiredString(body.correctionId, "correctionId", { max: 160 });
      const status = requiredString(body.status, "status", { max: 20 }).toUpperCase();
      const notes = requiredString(body.notes, "notes", { min: 10, max: 2000 });
      if (!["APPROVED", "REJECTED"].includes(status)) {
        throw new ValidationError("INVALID_STATUS", "Status review tidak valid.", "status");
      }
      const result = await db.rpc("apply_attendance_correction", {
        p_correction_id: correctionId,
        p_reviewer_id: actor.id,
        p_status: status,
        p_notes: notes,
      });
      if (result.error) throw result.error;
      return jsonResponse({ success: true, result: result.data, requestId }, 200, requestId, headers);
    }

    throw new ValidationError("ACTION_NOT_SUPPORTED", "Aksi tidak tersedia.", "action");
  } catch (error) {
    const status = errorStatus(error);
    const raw = error instanceof Error ? error.message : String(error);
    const code = error instanceof ValidationError ? error.code : raw;
    console.error(JSON.stringify({ requestId, code, status, error: raw }));
    return jsonResponse({
      success: false,
      code: status === 500 ? "INTERNAL_ERROR" : code,
      message: status === 500 ? "Layanan koreksi presensi gagal memproses permintaan." : raw,
      requestId,
      ...(error instanceof ValidationError && error.field ? { details: { field: error.field } } : {}),
    }, status, requestId, headers);
  }
});