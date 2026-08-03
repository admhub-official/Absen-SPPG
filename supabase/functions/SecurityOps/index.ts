import { createClient } from "jsr:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(URL, KEY, { auth: { persistSession: false } });

type Auth = { idUser: string; role: string; email: string };
const id = () => `REQ_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

function allowedOrigin(origin: string): boolean {
  const configured = new Set((Deno.env.get("ABSEN_ALLOWED_ORIGINS") || "").split(",").map((x) => x.trim()).filter(Boolean));
  configured.add("https://absen-sppg.pages.dev");
  configured.add("http://localhost:4173");
  configured.add("http://127.0.0.1:4173");
  if (configured.has(origin)) return true;
  try { const u = new URL(origin); return u.protocol === "https:" && u.hostname.endsWith(".absen-sppg.pages.dev"); } catch { return false; }
}

function headers(origin: string | null) {
  return {
    ...(origin && allowedOrigin(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Expose-Headers": "X-Request-Id",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, requestId: string, h: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...h, "Content-Type": "application/json", "Cache-Control": "no-store", "X-Request-Id": requestId } });
}

async function auth(tokenValue: unknown): Promise<Auth> {
  const token = String(tokenValue || "").trim();
  if (!token) throw new Error("SESSION_EXPIRED");
  const session = await db.from("Sessions").select("ID_User,Type,Expires_At").eq("Token", token).maybeSingle();
  if (session.error || !session.data?.ID_User || String(session.data.Type).toLowerCase() !== "user" || new Date(session.data.Expires_At).getTime() <= Date.now()) throw new Error("SESSION_EXPIRED");
  const user = await db.from("Users").select("ID_User,Role,Email,Status_Aktif").eq("ID_User", session.data.ID_User).maybeSingle();
  const active = user.data?.Status_Aktif === true || ["TRUE", "1"].includes(String(user.data?.Status_Aktif || "").toUpperCase());
  if (user.error || !user.data || !active) throw new Error("ACCOUNT_INACTIVE");
  const role = String(user.data.Role || "").trim().toUpperCase().replace(/_/g, " ");
  if (!["ADMIN", "SUPER ADMIN", "AKUNTAN"].includes(role)) throw new Error("FORBIDDEN");
  return { idUser: String(user.data.ID_User), role, email: String(user.data.Email || "") };
}

function iso(value: unknown, fallback: string) {
  const d = new Date(String(value || ""));
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

async function dashboard(body: Record<string, unknown>) {
  const since = iso(body.since, new Date(Date.now() - 24 * 3600_000).toISOString());
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
  const page = Math.max(1, Number(body.page) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(body.pageSize) || 25));
  let q = db.from("Security_Incidents").select("*", { count: "exact" });
  if (body.status) q = q.eq("Status", String(body.status));
  if (body.severity) q = q.eq("Severity", String(body.severity));
  if (body.userId) q = q.eq("ID_User", String(body.userId));
  const from = (page - 1) * pageSize;
  const result = await q.order("Created_At", { ascending: false }).range(from, from + pageSize - 1);
  if (result.error) throw new Error("INCIDENT_QUERY_FAILED");
  return { incidents: result.data || [], total: result.count || 0, page, pageSize };
}

async function updateIncident(body: Record<string, unknown>, actor: Auth) {
  const incidentId = String(body.incidentId || "").trim();
  if (!incidentId) throw new Error("INCIDENT_ID_REQUIRED");
  const status = String(body.status || "").trim().toUpperCase();
  const allowed = ["OPEN","INVESTIGATING","CONFIRMED","RESOLVED","FALSE_POSITIVE"];
  if (!allowed.includes(status)) throw new Error("INVALID_INCIDENT_STATUS");
  const patch: Record<string, unknown> = { Status: status, Updated_By: actor.idUser, Updated_At: new Date().toISOString() };
  if (body.assignedTo !== undefined) patch.Assigned_To = String(body.assignedTo || "") || null;
  if (body.resolutionNotes !== undefined) patch.Resolution_Notes = String(body.resolutionNotes || "").slice(0, 4000) || null;
  if (["RESOLVED","FALSE_POSITIVE"].includes(status)) patch.Resolved_At = new Date().toISOString();
  const result = await db.from("Security_Incidents").update(patch).eq("Incident_ID", incidentId).select().maybeSingle();
  if (result.error || !result.data) throw new Error("INCIDENT_UPDATE_FAILED");
  if (body.note) await db.from("Security_Incident_Notes").insert({ Incident_ID: incidentId, Author_ID: actor.idUser, Note: String(body.note).slice(0, 4000) });
  return result.data;
}

async function createFromEvent(body: Record<string, unknown>, actor: Auth) {
  const eventId = Number(body.eventId);
  if (!Number.isInteger(eventId) || eventId <= 0) throw new Error("EVENT_ID_REQUIRED");
  const result = await db.rpc("create_incident_from_security_event", { p_event_id: eventId, p_actor: actor.idUser, p_title: String(body.title || "") || null });
  if (result.error) throw new Error(result.error.message);
  return { incidentId: result.data };
}

async function auditExplorer(body: Record<string, unknown>) {
  const page = Math.max(1, Number(body.page) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(body.pageSize) || 25));
  let q = db.from("Attendance_Security_Events").select("*", { count: "exact" });
  if (body.userId) q = q.eq("ID_User", String(body.userId));
  if (body.deviceId) q = q.eq("Device_ID", String(body.deviceId));
  if (body.riskLevel) q = q.eq("Risk_Level", String(body.riskLevel));
  if (body.result) q = q.eq("Result", String(body.result));
  if (body.eventType) q = q.eq("Event_Type", String(body.eventType));
  if (body.startDate) q = q.gte("Created_At", iso(body.startDate, "1970-01-01T00:00:00Z"));
  if (body.endDate) q = q.lte("Created_At", iso(body.endDate, new Date().toISOString()));
  const from = (page - 1) * pageSize;
  const result = await q.order("Created_At", { ascending: false }).range(from, from + pageSize - 1);
  if (result.error) throw new Error("AUDIT_QUERY_FAILED");
  return { events: result.data || [], total: result.count || 0, page, pageSize };
}

async function recordMetric(body: Record<string, unknown>, requestId: string) {
  const service = String(body.service || "").trim();
  const metric = String(body.metric || "").trim();
  const value = Number(body.value);
  if (!service || !metric || !Number.isFinite(value)) throw new Error("INVALID_METRIC");
  const result = await db.from("System_Health_Metrics").insert({
    Service_Name: service.slice(0, 100), Metric_Name: metric.slice(0, 100), Metric_Value: value,
    Unit: String(body.unit || "").slice(0, 30) || null,
    Status: ["OK","WARN","CRITICAL"].includes(String(body.status)) ? String(body.status) : "OK",
    Request_ID: requestId, Metadata: typeof body.metadata === "object" && body.metadata ? body.metadata : {}
  }).select().maybeSingle();
  if (result.error) throw new Error("METRIC_INSERT_FAILED");
  return result.data;
}

Deno.serve(async (request) => {
  const requestId = id();
  const origin = request.headers.get("origin");
  const h = headers(origin);
  if (origin && !allowedOrigin(origin)) return json({ success: false, code: "ORIGIN_NOT_ALLOWED", message: "Origin tidak diizinkan.", requestId }, 403, requestId, h);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (request.method !== "POST") return json({ success: false, code: "METHOD_NOT_ALLOWED", message: "Gunakan POST.", requestId }, 405, requestId, h);
  const started = performance.now();
  try {
    const body = await request.json() as Record<string, unknown>;
    const actor = await auth(body.token);
    const action = String(body.action || "");
    let result: unknown;
    if (action === "dashboard") result = await dashboard(body);
    else if (action === "listIncidents") result = await listIncidents(body);
    else if (action === "updateIncident") result = await updateIncident(body, actor);
    else if (action === "createIncidentFromEvent") result = await createFromEvent(body, actor);
    else if (action === "auditExplorer") result = await auditExplorer(body);
    else if (action === "recordMetric") result = await recordMetric(body, requestId);
    else throw new Error("ACTION_NOT_SUPPORTED");
    const latency = Math.round(performance.now() - started);
    await db.from("System_Health_Metrics").insert({ Service_Name: "SecurityOps", Metric_Name: "request_latency_ms", Metric_Value: latency, Unit: "ms", Status: latency > 2000 ? "WARN" : "OK", Request_ID: requestId, Metadata: { action, actor: actor.idUser } });
    return json({ success: true, result, requestId }, 200, requestId, h);
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
    const status = message === "SESSION_EXPIRED" ? 401 : ["ACCOUNT_INACTIVE","FORBIDDEN"].includes(message) ? 403 : /REQUIRED|INVALID|NOT_SUPPORTED/.test(message) ? 422 : 500;
    console.error(JSON.stringify({ level: "error", service: "SecurityOps", requestId, message }));
    return json({ success: false, code: message, message: status === 500 ? "Terjadi kesalahan pada layanan keamanan." : message, requestId }, status, requestId, h);
  }
});