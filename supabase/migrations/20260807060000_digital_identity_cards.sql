-- Digital identity infrastructure for per-account QR codes and printable ID cards.
-- Artifacts are private and are only exposed through short-lived signed URLs.

create extension if not exists pgcrypto;

-- Preserve existing identifiers and only fill accounts that do not have one yet.
update public."Users"
set "ID_Card_Unik" = 'HAD-' || upper(substr(
  encode(digest("ID_User" || ':' || coalesce("Created_At"::text, ''), 'sha256'), 'hex'),
  1,
  12
))
where nullif(trim("ID_Card_Unik"), '') is null;

create unique index if not exists users_id_card_unik_unique
  on public."Users" (upper("ID_Card_Unik"))
  where nullif(trim("ID_Card_Unik"), '') is not null;

create table if not exists public."Digital_ID_Cards" (
  "ID" uuid primary key default gen_random_uuid(),
  "ID_User" text not null references public."Users"("ID_User") on delete cascade,
  "Version" integer not null default 1 check ("Version" > 0),
  "Status" text not null default 'ACTIVE' check ("Status" in ('ACTIVE', 'REVOKED')),
  "Public_Token_Hash" text not null unique,
  "Token_Hint" text,
  "QR_PNG_Storage_Path" text not null,
  "QR_PDF_Storage_Path" text not null,
  "ID_Card_PDF_Storage_Path" text not null,
  "ID_Card_PDF_SHA256" text not null,
  "Payload_Version" integer not null default 1,
  "Generated_By" text not null,
  "Generated_At" timestamptz not null default now(),
  "Updated_At" timestamptz not null default now(),
  "Revoked_At" timestamptz,
  "Revoked_By" text,
  "Revocation_Reason" text,
  "Last_Verified_At" timestamptz,
  "Verification_Count" bigint not null default 0 check ("Verification_Count" >= 0),
  "Metadata" jsonb not null default '{}'::jsonb,
  unique ("ID_User", "Version")
);

create unique index if not exists digital_id_cards_one_active_per_user
  on public."Digital_ID_Cards" ("ID_User")
  where "Status" = 'ACTIVE';

create index if not exists digital_id_cards_user_history_idx
  on public."Digital_ID_Cards" ("ID_User", "Generated_At" desc);

create index if not exists digital_id_cards_status_idx
  on public."Digital_ID_Cards" ("Status", "Generated_At" desc);

alter table public."Digital_ID_Cards" enable row level security;
revoke all on table public."Digital_ID_Cards" from anon, authenticated;
grant all on table public."Digital_ID_Cards" to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'digital-id-cards',
  'digital-id-cards',
  false,
  15728640,
  array['image/png', 'application/pdf']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

comment on table public."Digital_ID_Cards" is
  'Versioned registry of private QR and printable ID-card artifacts. Public QR tokens are stored only as SHA-256 hashes.';
comment on column public."Digital_ID_Cards"."Public_Token_Hash" is
  'SHA-256 hash of the opaque token embedded in the public verification QR code.';
comment on column public."Digital_ID_Cards"."ID_Card_PDF_SHA256" is
  'Integrity hash of the generated printable ID-card PDF.';
