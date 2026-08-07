-- Final hash-at-rest cutover for session tokens.
-- Browser/API clients continue to hold the raw bearer token, but the database
-- stores only SHA-256 digests. The legacy Token PK is retained as a digest alias
-- so the pinned legacy core can continue equality lookups behind SessionGateway.

drop trigger if exists trg_sessions_token_hash on public."Sessions";

-- Existing Phase 8A rows currently contain raw Token + Token_Hash. Replace the
-- legacy PK value with its already-verified digest before installing the final trigger.
update public."Sessions"
set "Token" = lower("Token_Hash")
where "Token" is distinct from lower("Token_Hash");

create or replace function public.sync_session_token_hash()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_digest text;
begin
  if new."Token" is null or btrim(new."Token") = '' then
    raise exception 'SESSION_TOKEN_REQUIRED';
  end if;

  -- Internal legacy calls already carry a SHA-256 digest. New login/session
  -- creation still supplies a raw token and is hashed here before persistence.
  if new."Token" ~ '^[0-9a-fA-F]{64}$' then
    v_digest := lower(new."Token");
  else
    v_digest := public.hash_session_token(new."Token");
  end if;

  new."Token" := v_digest;
  new."Token_Hash" := v_digest;
  return new;
end;
$$;

create trigger trg_sessions_token_hash
before insert or update of "Token", "Token_Hash"
on public."Sessions"
for each row execute function public.sync_session_token_hash();

alter table public."Sessions"
  drop constraint if exists sessions_token_digest_at_rest_check;

alter table public."Sessions"
  add constraint sessions_token_digest_at_rest_check
  check (
    "Token" = "Token_Hash"
    and "Token" ~ '^[0-9a-f]{64}$'
  );

comment on column public."Sessions"."Token" is
  'Legacy primary-key alias containing only the SHA-256 session digest. Raw bearer tokens must never be persisted.';
comment on column public."Sessions"."Token_Hash" is
  'Canonical SHA-256 digest of the raw session bearer token.';
comment on function public.sync_session_token_hash() is
  'Normalizes every persisted session token to a SHA-256 digest in both Token and Token_Hash for legacy-core compatibility.';
