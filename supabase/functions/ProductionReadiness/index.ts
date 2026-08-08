import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, createRequestId, isOriginAllowed, jsonResponse } from "../_shared/http.ts";
import { normalizeRole } from "../_shared/contracts.ts";
import { optionalString, requiredString, ValidationError } from "../_shared/validation.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const corsOptions = {
  allowedOriginsEnv: Deno.env.get("ABSEN_ALLOWED_ORIGINS") || "",
  productionOrigin: "https://hadirly.org",
  previewSuffix: ".pages.dev",
  localOrigins: ["http://localhost:4173", "http://127.0.0.1:4173"],
};

type Actor = { idUser: string; role: string };

async function authenticate(tokenValue: unknown): Promise<Actor> {
  const token = String(tokenValue || "").trim();
  if (!token || token.length > 2048) throw new Error("SESSION_EXPIRED");
  const session = await db.from("Sessions").select("ID_User,Type,Expires_At").eq("Token", token).maybeSingle();
  if (session.error || !session.data?.ID_User || String(session.data.Type).toLowerCase() !== "user") {
    throw new Error("SESSION_EXPIRED");
  }
  if (new Date(session.data.Expires_At).getTime() <= Date.now()) throw new Error("SESSION_EXPIRED");

  const user = await db.from("Users").select("ID_User,Role,Status_Aktif").eq("ID_User", session.data.ID_User).maybeSingle();
  const active = user.data?.Status_Aktif === true || ["TRUE", "1"].includes(String(user.data?.Status_Aktif || "").toUpperCase());
  if (user.error || !user.data || !active) throw new Error("ACCOUNT_INACTIVE");

  const role = normalizeRole(user.data.Role);
  if (!(["ADMIN", "SUPER ADMIN", "AKUNTAN"] as string[]).includes(role)) throw new Error("FORBIDDEN");
  return { idUser: String(user.data.ID_User), role };
}

async function readinessReport() {
  const report = await db.rpc("production_readiness_report");
  if (report.error) throw new Error("READINESS_REPORT_FAILED");
  return report.data;
}

async function evaluate(body: Record<string, unknown>) {
  const userId = requiredString(body.userId, "userId", { min: 1, max: 120 });
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const accuracy = Number(body.accuracy);
  const deviceId = optionalString(body.deviceId, 100);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new ValidationError("INVALID_LATITUDE", "Latitude tidak valid.", "latitude");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new ValidationError("INVALID_LONGITUDE", "Longitude tidak valid.", "longitude");
  }
  if (!Number.isFinite(accuracy) || accuracy <= 0) {
    throw new ValidationError("INVALID_ACCURACY", "Akurasi tidak valid.", "accuracy");
  }

  const result = await db.rpc("evaluate_attendance_readiness", {
    p_user_id: userId,
    p_device_id: deviceId || null,
    p_latitude: latitude,
    p_longitude: longitude,
    p_accuracy: accuracy,
  });
  if (result.error) throw new Error("READINESS_EVALUATION_FAILED");
  return result.data;
}

async function recordAudit(body: Record<string, unknown>, actor: Actor) {
  const releaseName = requiredString(body.releaseName, "releaseName", { min: 3, max: 120 });
  const environment = requiredString(body.environment, "environment", { min: 3, max: 20 }).toUpperCase();
  const component = requiredString(body.component, "component", { min: 2, max: 120 });
  const checkName = requiredString(body.checkName, "checkName", { min: 2, max: 200 });
  const status = requiredString(body.status, "status", { min: 4, max: 4 }).toUpperCase();
  if (!["DEVELOPMENT", "STAGING", "PRODUCTION"].includes(environment)) {
    throw new ValidationError("INVALID_ENVIRONMENT", "Environment tidak valid.", "environment");
  }
  if (!["PASS", "WARN", "FAIL"].includes(status)) {
    throw new ValidationError("INVALID_STATUS", "Status audit tidak valid.", "status");
  }
  if (body.detail !== undefined && (!body.detail || typeof body.detail !== "object" || Array.isArray(body.detail))) {
    throw new ValidationError("INVALID_DETAIL", "detail wajib berupa object.", "detail");
  }

  const result = await db.from("Deployment_Audit").insert({
    Release_Name: releaseName,
    Commit_SHA: optionalString(body.commitSha, 80) || null,
    Environment: environment,
    Component: component,
    Check_Name: checkName,
    Status: status,
    Detail: body.detail || {},
    Checked_By: actor.idUser,
  }).select().maybeSingle();
  if (result.error) throw new Error("DEPLOYMENT_AUDIT_INSERT_FAILED");
  return result.data;
}

Deno.serve(async (request) => {
  const requestId = createRequestId("RDY");
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin, corsOptions);
  if (origin && !isOriginAllowed(origin, corsOptions)) {
    return jsonResponse({ success: false, code: "ORIGIN_NOT_ALLOWED", message: "Origin tidak diizinkan.", requestId }, 403, requestId, headers);
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") {
    return jsonResponse({ success: false, code: "METHOD_NOT_ALLOWED", message: "Gunakan POST.", requestId }, 405, requestId, headers);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return jsonResponse({ success: false, code: "INVALID_JSON", message: "Payload JSON tidak valid.", requestId }, 400, requestId, headers);
  }

  try {
    const actor = await authenticate(body.token);
    const action = requiredString(body.action, "action", { min: 3, max: 80 });
    let result: unknown;
    if (action === "report") result = await readinessReport();
    else if (action === "evaluateAttendance") result = await evaluate(body);
    else if (action === "recordDeploymentAudit") result = await recordAudit(body, actor);
    else throw new ValidationError("ACTION_NOT_SUPPORTED", "Action tidak didukung.", "action");
    return jsonResponse({ success: true, result, requestId }, 200, requestId, headers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
    const validation = error instanceof ValidationError;
    const status = validation ? 422 : message === "SESSION_EXPIRED" ? 401 : ["ACCOUNT_INACTIVE", "FORBIDDEN"].includes(message) ? 403 : 500;
    console.error(JSON.stringify({ requestId, code: validation ? error.code : message, status, error: message }));
    return jsonResponse({
      success: false,
      code: validation ? error.code : message,
      message: status === 500 ? "Pemeriksaan kesiapan produksi gagal." : error instanceof Error ? error.message : message,
      requestId,
      details: validation ? { field: error.field } : {},
    }, status, requestId, headers);
  }
});