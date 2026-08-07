import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { normalizeRole, OPERATIONAL_ROLES } from "./contracts.ts";
import { requiredString } from "./validation.ts";

export type AuthenticatedUser = Readonly<{
  idUser: string;
  role: string;
}>;

function isActiveAccount(value: unknown): boolean {
  if (value === true || value === 1) return true;
  return ["TRUE", "1", "ACTIVE", "AKTIF"].includes(String(value ?? "").trim().toUpperCase());
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function findSession(db: SupabaseClient, token: string) {
  const tokenHash = await sha256Hex(token);
  const hashed = await db
    .from("Sessions")
    .select("ID_User,Type,Expires_At")
    .eq("Token_Hash", tokenHash)
    .maybeSingle();

  if (!hashed.error && hashed.data) return hashed;

  // Phase 8A compatibility: legacy deployments and sessions still retain raw
  // Token until every gateway has migrated. Remove this fallback only at the
  // final HttpOnly-cookie/hash-only cutover.
  return await db
    .from("Sessions")
    .select("ID_User,Type,Expires_At")
    .eq("Token", token)
    .maybeSingle();
}

export async function authenticateUserSession(
  db: SupabaseClient,
  tokenValue: unknown,
): Promise<AuthenticatedUser> {
  const token = requiredString(tokenValue, "token", { min: 16, max: 512 });
  const session = await findSession(db, token);

  const sessionType = String(session.data?.Type ?? "").trim().toLowerCase();
  const expiresAt = new Date(String(session.data?.Expires_At ?? "")).getTime();
  if (
    session.error ||
    !session.data?.ID_User ||
    sessionType !== "user" ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    throw new Error("SESSION_EXPIRED");
  }

  const user = await db
    .from("Users")
    .select("ID_User,Role,Status_Aktif")
    .eq("ID_User", session.data.ID_User)
    .maybeSingle();

  if (user.error || !user.data || !isActiveAccount(user.data.Status_Aktif)) {
    throw new Error("ACCOUNT_INACTIVE");
  }

  return Object.freeze({
    idUser: String(user.data.ID_User),
    role: normalizeRole(user.data.Role),
  });
}

export function requireOperationalRole(auth: AuthenticatedUser): void {
  if (!OPERATIONAL_ROLES.includes(auth.role as (typeof OPERATIONAL_ROLES)[number])) {
    throw new Error("FORBIDDEN");
  }
}

export function requireSuperAdminRole(auth: AuthenticatedUser): void {
  if (auth.role !== "SUPER ADMIN") throw new Error("FORBIDDEN");
}
