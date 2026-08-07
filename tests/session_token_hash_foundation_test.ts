const read = (path: string) => Deno.readTextFile(path);

Deno.test("session hash migration is backward-compatible and automatically maintained", async () => {
  const migration = await read("supabase/migrations/20260807213000_session_token_hash_foundation.sql");
  for (const marker of [
    'add column if not exists "Token_Hash" text',
    'hash_session_token',
    "extensions.digest(p_token, 'sha256')",
    'sync_session_token_hash',
    'trg_sessions_token_hash',
    'alter column "Token_Hash" set not null',
    'sessions_token_hash_unique',
  ]) {
    if (!migration.includes(marker)) throw new Error(`session hash migration missing ${marker}`);
  }
  if (/drop\s+column\s+"?Token"?/i.test(migration)) throw new Error("phase 8A must not remove raw Token yet");
  if (/drop\s+constraint\s+"?Sessions_pkey"?/i.test(migration)) throw new Error("phase 8A must not remove legacy session primary key");
});

Deno.test("shared modern authentication prefers Token_Hash with explicit legacy fallback", async () => {
  const auth = await read("supabase/functions/_shared/auth.ts");
  for (const marker of [
    'crypto.subtle.digest("SHA-256"',
    '.eq("Token_Hash", tokenHash)',
    'Phase 8A compatibility',
    '.eq("Token", token)',
    'SESSION_EXPIRED',
  ]) {
    if (!auth.includes(marker)) throw new Error(`shared auth missing ${marker}`);
  }
  const hashLookup = auth.indexOf('.eq("Token_Hash", tokenHash)');
  const rawLookup = auth.indexOf('.eq("Token", token)');
  if (hashLookup < 0 || rawLookup < 0 || hashLookup > rawLookup) {
    throw new Error("modern auth must try hashed lookup before legacy raw-token fallback");
  }
});
