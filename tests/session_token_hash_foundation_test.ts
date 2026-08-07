const read = (path: string) => Deno.readTextFile(path);

Deno.test("phase 8A migration establishes backward-compatible session hashes", async () => {
  const migration = await read("supabase/migrations/20260807213000_session_token_hash_foundation.sql");
  for (const marker of ['add column if not exists "Token_Hash" text','hash_session_token',"extensions.digest(p_token, 'sha256')",'sync_session_token_hash','trg_sessions_token_hash','alter column "Token_Hash" set not null','sessions_token_hash_unique']) if (!migration.includes(marker)) throw new Error(`session hash foundation missing ${marker}`);
});

Deno.test("final migration persists only SHA-256 digests while retaining the legacy PK alias", async () => {
  const migration = await read("supabase/migrations/20260807220000_session_token_hash_at_rest_final.sql");
  for (const marker of ['set "Token" = lower("Token_Hash")',"new.\"Token\" ~ '^[0-9a-fA-F]{64}$'",'new."Token" := v_digest','new."Token_Hash" := v_digest','sessions_token_digest_at_rest_check','"Token" = "Token_Hash"',"Raw bearer tokens must never be persisted"]) if (!migration.includes(marker)) throw new Error(`final session migration missing ${marker}`);
  if (/drop\s+constraint\s+"?Sessions_pkey"?/i.test(migration)) throw new Error("legacy Token PK must remain digest-only compatibility alias");
});

Deno.test("shared modern authentication is hash-only with no raw database fallback", async () => {
  const auth = await read("supabase/functions/_shared/auth.ts");
  const policy = await read("supabase/functions/_shared/session-policy.ts");
  for (const marker of ['.eq("Token_Hash", tokenHash)', 'SESSION_EXPIRED', 'sha256Hex', 'enforceSessionActivity']) {
    if (!auth.includes(marker)) throw new Error(`shared auth missing ${marker}`);
  }
  for (const marker of ['crypto.subtle.digest("SHA-256"', 'export async function sha256Hex']) {
    if (!policy.includes(marker)) throw new Error(`shared session crypto helper missing ${marker}`);
  }
  if (auth.includes('.eq("Token", token)') || auth.includes('Phase 8A compatibility')) {
    throw new Error("shared auth must not fall back to raw Sessions.Token");
  }
});

Deno.test("SessionGateway is safe before and after final database cutover", async () => {
  const gateway = await read("supabase/functions/SessionGateway/index.ts");
  for (const marker of [
    'AbsenV2: "AbsenV2Core"',
    'AttendanceLocation: "AttendanceLocationCore"',
    'EmploymentContracts: "EmploymentContractsCore"',
    'sessionForwardMap',
    'Token,Token_Hash,ID_User,ID_Device,Type,Expires_At,Last_Activity_At',
    'storedToken.toLowerCase() === lookupHash ? lookupHash : raw',
    'SESSION_DIGEST_NOT_ACCEPTED',
    'isServiceRequest(request)',
    'directAlias',
    '`Bearer ${SERVICE_KEY}`',
    'enforceSessionActivity(db, row, lookupHash)',
  ]) if (!gateway.includes(marker)) throw new Error(`SessionGateway missing ${marker}`);
});

Deno.test("browser and public contract verification route legacy calls through SessionGateway", async () => {
  const config = await read("supabase-config.js");
  const verifyContract = await read("verify-contract.html");
  for (const marker of ["sessionGatewayFunctionName: 'SessionGateway'",'__HADIRLY_SESSION_GATEWAY_FETCH__',"'AbsenV2','AttendanceLocation','PayrollUser','ProfileOps','DeviceTrust'","JSON.stringify({ target, payload })","credentials: 'omit'","referrerPolicy: 'no-referrer'"]) if (!config.includes(marker)) throw new Error(`frontend session gateway missing ${marker}`);
  if (!verifyContract.includes('/functions/v1/SessionGateway') || !verifyContract.includes("target:'EmploymentContracts'")) throw new Error("public contract verification must use SessionGateway");
});

Deno.test("production deployment keeps public gateway aliases separate from JWT-verified internal cores", async () => {
  const deploy = await read("deploy-supabase.ps1");
  for (const marker of ['$PublicFunctionNames','"SessionGateway"','$InternalFunctionNames','"AbsenV2Core"','"EmploymentContractsCore"','$GatewayAliases','Set-Content -LiteralPath $AliasIndex -Value $GatewaySource','--no-verify-jwt','Men-deploy Edge Function internal']) if (!deploy.includes(marker)) throw new Error(`deployment session cutover missing ${marker}`);
});
