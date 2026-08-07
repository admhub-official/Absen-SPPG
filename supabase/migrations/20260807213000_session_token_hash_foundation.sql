-- Session token hash foundation (backward-compatible)
-- Phase 8A: modern auth can authenticate via Token_Hash while legacy gateways
-- continue using the existing raw Token primary key until the HttpOnly-cookie cutover.

create or replace function public.hash_session_token(p_token text)
returns text
language sql
immutable
strict
set search_path = public, extensions
as $$
  select encode(extensions.digest(p_token, 'sha256'), 'hex');
$$;

alter table public."Sessions"
  add column if not exists "Token_Hash" text;

update public."Sessions"
set "Token_Hash" = public.hash_session_token("Token")
where "Token_Hash" is null
   or "Token_Hash" <> public.hash_session_token("Token");

create or replace function public.sync_session_token_hash()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new."Token_Hash" := public.hash_session_token(new."Token");
  return new;
end;
$$;

drop trigger if exists trg_sessions_token_hash on public."Sessions";
create trigger trg_sessions_token_hash
before insert or update of "Token"
on public."Sessions"
for each row execute function public.sync_session_token_hash();

alter table public."Sessions"
  alter column "Token_Hash" set not null;

create unique index if not exists sessions_token_hash_unique
  on public."Sessions" ("Token_Hash");

revoke all on function public.hash_session_token(text) from public, anon, authenticated;
grant execute on function public.hash_session_token(text) to service_role;
revoke all on function public.sync_session_token_hash() from public, anon, authenticated;

comment on column public."Sessions"."Token_Hash" is
  'SHA-256 hash of the raw session token. Phase 8A keeps raw Token only for legacy compatibility; new/modern auth should prefer Token_Hash.';
comment on function public.hash_session_token(text) is
  'Canonical SHA-256 helper used during the migration from raw session-token lookup to hash-at-rest.';
