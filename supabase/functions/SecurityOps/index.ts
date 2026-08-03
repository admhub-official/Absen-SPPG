import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  HEALTH_STATUSES,
  INCIDENT_STATUSES,
  normalizeRole,
  OPERATIONAL_ROLES,
} from "../_shared/contracts.ts";
import {
  corsHeaders,
  createRequestId,
  isOriginAllowed,
  jsonResponse,
} from "../_shared/http.ts";
import {
  enumValue,
  isoDate,
  optionalString,
  pageOptions,
  positiveInteger,
  requiredString,
  ValidationError,
} from "../_shared/validation.ts";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(URL, KEY, { auth: { persistSession: false } });
const corsOptions = {
  allowedOriginsEnv: Deno.env.get("ABSEN_ALLOWED_ORIGINS") || "",
  productionOrigin: "https://absen-sppg.pages.dev",
  previewSuffix: ".absen-sppg.pages.dev",
  localOrigins: ["http://localhost:4173", "http://127.0.0.1:4173"],
};

type Auth = { idUser: string; role: string; email: string };

async function authenticate(tokenValue: unknown): Promise<Auth> {
  const token = requiredString(tokenValue, "token", { min: 16, max: 512 });
  const session = await db.from("Sessions").select("ID_User,Type,Expires_At").eq("Token", token).maybeSingle();
  if (session.error || !session.data?.ID_User || String(session.data.Type).toLowerCase() !== "user" || new Date(session.data.Expires_At).getTime() <= Date.now()) throw new Error("SESSION_EXPIRED");
  const user = await db.from("Users").select("ID_User,Role,Email,Status_Aktif").eq("ID_User", session.data.ID_User).maybeSingle();
  const active = user.data?.Status_Aktif === true || ["TRUE", "1"].includes(String(user.data?.Status_Aktif || "").toUpperCase());
  if (user.error || !user.data || !active) throw new Error("ACCOUNT_INACTIVE");
  const role = normalizeRole(user.data.Role);
  if (!OPERATIONAL_ROLES.includes(role as typeof OPERATIONAL_ROLES[number])) throw new Error("FORBIDDEN");
  return { idUser: String(user.data.ID_User), role, email: String(user.data.Email || "") };
}

async function dashboard(body: Record<string, unknown>) {
  const since = isoDate(body.since, new Date(Date.now() - 24 * 3600_000).toISOString());
  const [summary, recent, incidents, metrics] = await Promise.all([
    db.rpc("security_dashboard_summary", { p_since: since }),
    db.from("Attendance_Security_Events").select("Event_ID,Request_ID,ID_User,Device_ID,Event_Type,Result,Risk_Score,Risk_Level,Client_IP,Created_At").gte("Created_At", since).order("Created_At", { ascending: false }).limit(30),
    db.from("Security_Incidents").select("Incident_ID,Title,Severity,Status,ID_User,Device_ID,Risk_Score,Assigned_To,Created_At,Updated_At").order("Created_At", { ascending: false }).limit(20),
    db.from("System_Health_Metrics").select("Service_Name,Metric_Name,Metric_Value,Unit,Status,Recorded_At").order("Recorded_At", { ascending: false }).limit(30),
  ]);
  if (summary.error || recent.error || incidents.error || metrics.error) throw new Error("DASHBOARD_QUERY_FAILED");
  return { summary: summary.data, recentEvents: recent.data || [], incidents: incidents.data || [], health: metrics.data || [] };
}

async function listIncidents(body: Record<string, unknown>) {
  const { page, pageSize, from } = pageOptions(body);
  let query = db.from("Security_Incidents").select("*", { count: "exact" });
  if (body.status) query = query.eq("Status", enumValue(body.status, "status", INCIDENT_STATUSES));
  if (body.severity) query = query.eq("Severity", String(body.severity).toUpperCase());
  if (body.userId) query = query.eq("ID_User", String(body.userId));
  const result = await query.order("Created_At", { ascending: false }).range(from, from + pageSize - 1);
  if (result.error) throw new Error("INCIDENT_QUERY_FAILED");
  return { incidents: result.data || [], total: result.count || 0, page, pageSize };
}

async function updateIncident(body: Record<string, unknown>, actor: Auth) {
  const incidentId = requiredString(body.incidentId, "incidentId", { max: 100 });
  const status = enumValue(body.status, "status", INCIDENT_STATUSES);
  const patch: Record<string, unknown> = { Status: status, Updated_By: actor.idUser, Updated_At: new Date().toISOString() };
  if (body.assignedTo !== undefined) patch.Assigned_To = optionalString(body.assignedTo, 100);
  if (body.resolutionNotes !== undefined) patch.Resolution_Notes = optionalString(body.resolutionNotes, 4000);
  if (["RESOLVED", "FALSE_POSITIVE"].includes(status)) patch.Resolved_At = new Date().toISOString();
  const result = await db.from("Security_Incidents").update(patch).eq("Incident_ID", incidentId).select().maybeSingle();
  if (result.error || !result.data) throw new Error("INCIDENT_UPDATE_FAILED");
  const note = optionalString(body.note, 4000);
  if (note) await db.from("Security_Incident_Notes").insert({ Incident_ID: incidentId, Author_ID: actor.idUser, Note: note });
  return result.data;
}

async function createFromEvent(body: Record<string, unknown>, actor: Auth) {
  const eventId = positiveInteger(body.eventId, "eventId");
  const result = await db.rpc("create_incident_from_security_event", {
    p_event_id: eventId,
    p_actor: actor.idUser,
    p_title: optionalString(body.title, 250),
  });
  if (result.error) throw new Error(result.error.message);
  return { incidentId: result.data };
}

async function auditExplorer(body: Record<string, unknown>) {
  const { page, pageSize, from } = pageOptions(body);
  let query = db.from("Attendance_Security_Events").select("*", { count: "exact" });
  if (body.userId) query = query.eq("ID_User", String(body.userId));
  if (body.deviceId) query = query.eq("Device_ID", String(body.deviceId));
  if (body.riskLevel) query = query.eq("Risk_Level", String(body.riskLevel).toUpperCase());
  if (body.result) query = query.eq("Result", String(body.result).toUpperCase());
  if (body.eventType) query = query.eq("Event_Type", String(body.eventType));
  if (body.startDate) query = query.gte("Created_At", isoDate(body.startDate, "1970-01-01T00:00:00Z"));
  if (body.endDate) query = query.lte("Created_At", isoDate(body.endDate, new Date().toISOString()));
  const result = await query.order("Created_At", { ascending: false }).range(from, from + pageSize - 1);
  if (result.error) throw new Error("AUDIT_QUERY_FAILED");
  return { events: result.data || [], total: result.count || 0, page, pageSize };
}

async function recordMetric(body: Record<string, unknown>, requestId: string) {
  const service = requiredString(body.service, "service", { max: 100 });
  const metric = requiredString(body.metric, "metric", { max: 100 });
  const value = Number(body.value);
  if (!Number.isFinite(value)) throw new ValidationError("INVALID_NUMBER", "value harus berupa angka.", "value");
  const status = body.status ? enumValue(body.status, "status", HEALTH_STATUSES) : "OK";
  const result = await db.from("System_Health_Metrics").insert({
    Service_Name: service,
    Metric_Name: metric,
    Metric_Value: value,
    Unit: optionalString(body.unit, 30),
    Status: status,
    Request_ID: requestId,
    Metadata: typeof body.metadata === "object" && body.metadata ? body.metadata : {},
  }).select().maybeSingle();
  if (result.error) throw new Error("METRIC_INSERT_FAILED");
  return result.data;
}

function errorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
  if (message === "SESSION_EXPIRED") return 401;
  if (["ACCOUNT_INACTIVE", "FORBIDDEN"].includes(message)) return 403;
  if (error instanceof ValidationError || /REQUIRED|INVALID|NOT_SUPPORTED/.test(message)) return 422;
  return 500;
}

Deno.serve(async (request) => {
  const requestId = createRequestId();
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin, corsOptions);
  if (origin && !isOriginAllowed(origin, corsOptions)) return jsonResponse({ success: false, code: "ORIGIN_NOT_ALLOWED", message: "Origin tidak diizinkan.", requestId }, 403, requestId, headers);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return jsonResponse({ success: false, code: "METHOD_NOT_ALLOWED", message: "Gunakan POST.", requestId }, 405, requestId, headers);
  const started = performance.now();
  try {
    const body = await request.json() as Record<string, unknown>;
    const actor = await authenticate(body.token);
    const action = requiredString(body.action, "action", { max: 100 });
    let result: unknown;
    if (action === "dashboard") result = await dashboard(body);
    else if (action === "listIncidents") result = await listIncidents(body);
    else if (action === "updateIncident") result = await updateIncident(body, actor);
    else if (action === "createIncidentFromEvent") result = await createFromEvent(body, actor);
    else if (action === "auditExplorer") result = await auditExplorer(body);
    else if (action === "recordMetric") result = await recordMetric(body, requestId);
    else throw new ValidationError("ACTION_NOT_SUPPORTED", "Action tidak didukung.", "action");
    const latency = Math.round(performance.now() - started);
    await db.from("System_Health_Metrics").insert({ Service_Name: "SecurityOps", Metric_Name: "request_latency_ms", Metric_Value: latency, Unit: "ms", Status: latency > 2000 ? "WARN" : "OK", Request_ID: requestId, Metadata: { action, actor: actor.idUser } });
    return jsonResponse({ success: true, result, requestId }, 200, requestId, headers);
  } catch (error) {
    const status = errorStatus(error);
    const code = error instanceof ValidationError ? error.code : error instanceof Error ? error.message : "INTERNAL_ERROR";
    const details = error instanceof ValidationError && error.field ? { field: error.field } : undefined;
    console.error(JSON.stringify({ level: "error", service: "SecurityOps", requestId, code, status }));
    return jsonResponse({ success: false, code, message: status === 500 ? "Terjadi kesalahan pada layanan keamanan." : error instanceof Error ? error.message : code, requestId, ...(details ? { details } : {}) }, status, requestId, headers);
  }
});
