import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const SESSION_IDLE_SETTING_KEY = "security.idle_session_expiry";
export const SESSION_RUNTIME_SETTING_KEY = "security.session_idle_runtime";
export const DEFAULT_IDLE_SECONDS = 60 * 60;
export const DEFAULT_TOUCH_INTERVAL_SECONDS = 5 * 60;
const POLICY_CACHE_MS = 30_000;

type SessionRow = Readonly<{
  Token_Hash?: string | null;
  Type?: string | null;
  ID_User?: string | null;
  ID_Device?: string | null;
  Expires_At?: string | null;
  Last_Activity_At?: string | null;
}>;

export type SessionPolicy = Readonly<{
  idleEnabled: boolean;
  idleSeconds: number;
  touchIntervalSeconds: number;
  enforcementStartedAt: string | null;
}>;

let cachedPolicy: { expiresAt: number; value: SessionPolicy } | null = null;

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function settingEnabled(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value && typeof value === "object" && "enabled" in value) {
    return Boolean((value as Record<string, unknown>).enabled);
  }
  return fallback;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function getSessionPolicy(db: SupabaseClient): Promise<SessionPolicy> {
  const now = Date.now();
  if (cachedPolicy && cachedPolicy.expiresAt > now) return cachedPolicy.value;

  const result = await db
    .from("System_Settings")
    .select("Setting_Key,Setting_Value")
    .in("Setting_Key", [SESSION_IDLE_SETTING_KEY, SESSION_RUNTIME_SETTING_KEY]);

  if (result.error) {
    if (cachedPolicy) return cachedPolicy.value;
    return Object.freeze({
      idleEnabled: false,
      idleSeconds: DEFAULT_IDLE_SECONDS,
      touchIntervalSeconds: DEFAULT_TOUCH_INTERVAL_SECONDS,
      enforcementStartedAt: null,
    });
  }

  const rows = new Map(
    (result.data || []).map((row) => [String(row.Setting_Key || ""), row.Setting_Value]),
  );
  const runtime = rows.get(SESSION_RUNTIME_SETTING_KEY);
  const runtimeObject = runtime && typeof runtime === "object"
    ? runtime as Record<string, unknown>
    : {};
  const start = String(runtimeObject.enforcementStartedAt || "").trim();
  const validStart = start && Number.isFinite(new Date(start).getTime()) ? start : null;
  const policy = Object.freeze({
    idleEnabled: settingEnabled(rows.get(SESSION_IDLE_SETTING_KEY), true),
    idleSeconds: boundedInteger(runtimeObject.idleSeconds, DEFAULT_IDLE_SECONDS, 300, 28_800),
    touchIntervalSeconds: boundedInteger(
      runtimeObject.touchIntervalSeconds,
      DEFAULT_TOUCH_INTERVAL_SECONDS,
      60,
      900,
    ),
    // Missing cutover metadata intentionally means "touch only, do not expire by idle yet".
    // The production migration writes this timestamp only after existing live sessions are reset.
    enforcementStartedAt: validStart,
  });
  cachedPolicy = { expiresAt: now + POLICY_CACHE_MS, value: policy };
  return policy;
}

async function removeSession(db: SupabaseClient, tokenHash: string): Promise<void> {
  const result = await db.from("Sessions").delete().eq("Token_Hash", tokenHash);
  if (result.error) throw new Error("SESSION_REVOKE_FAILED");
}

export async function enforceSessionActivity(
  db: SupabaseClient,
  session: SessionRow,
  tokenHash: string,
): Promise<void> {
  const now = Date.now();
  const expiresAt = new Date(String(session.Expires_At || "")).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    await removeSession(db, tokenHash);
    throw new Error("SESSION_EXPIRED");
  }

  const policy = await getSessionPolicy(db);
  const lastActivityAt = new Date(String(session.Last_Activity_At || "")).getTime();
  const enforcementStartedAt = policy.enforcementStartedAt
    ? new Date(policy.enforcementStartedAt).getTime()
    : Number.NaN;

  if (
    policy.idleEnabled &&
    Number.isFinite(enforcementStartedAt) &&
    (!Number.isFinite(lastActivityAt) || lastActivityAt <= now - policy.idleSeconds * 1000)
  ) {
    await removeSession(db, tokenHash);
    throw new Error("SESSION_EXPIRED");
  }

  const shouldTouch = !Number.isFinite(lastActivityAt) ||
    lastActivityAt <= now - policy.touchIntervalSeconds * 1000;
  if (!shouldTouch) return;

  const update = await db
    .from("Sessions")
    .update({ Last_Activity_At: new Date(now).toISOString() })
    .eq("Token_Hash", tokenHash)
    .gt("Expires_At", new Date(now).toISOString());
  if (update.error) throw new Error("SESSION_ACTIVITY_UPDATE_FAILED");
}
