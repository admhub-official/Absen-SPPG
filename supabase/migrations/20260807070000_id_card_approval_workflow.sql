-- Approval workflow for portrait employee ID cards.
-- Existing ACTIVE cards remain valid until a PENDING replacement is approved.

alter table public."Digital_ID_Cards"
  drop constraint if exists "Digital_ID_Cards_Status_check";

alter table public."Digital_ID_Cards"
  add constraint "Digital_ID_Cards_Status_check"
  check ("Status" in ('PENDING', 'ACTIVE', 'REVOKED'));

alter table public."Digital_ID_Cards"
  add column if not exists "Requested_At" timestamptz,
  add column if not exists "Requested_By" text,
  add column if not exists "Approved_At" timestamptz,
  add column if not exists "Approved_By" text,
  add column if not exists "Head_SPPG_Name" text,
  add column if not exists "Head_SPPG_Signature_Storage_Path" text;

update public."Digital_ID_Cards"
set "Requested_At" = coalesce("Requested_At", "Generated_At"),
    "Requested_By" = coalesce("Requested_By", "Generated_By"),
    "Approved_At" = case when "Status" = 'ACTIVE' then coalesce("Approved_At", "Generated_At") else "Approved_At" end,
    "Approved_By" = case when "Status" = 'ACTIVE' then coalesce("Approved_By", "Generated_By") else "Approved_By" end
where "Requested_At" is null
   or "Requested_By" is null
   or ("Status" = 'ACTIVE' and ("Approved_At" is null or "Approved_By" is null));

create unique index if not exists digital_id_cards_one_pending_per_user
  on public."Digital_ID_Cards" ("ID_User")
  where "Status" = 'PENDING';

create index if not exists digital_id_cards_pending_queue_idx
  on public."Digital_ID_Cards" ("Status", "Requested_At" asc)
  where "Status" = 'PENDING';

create or replace function public.approve_digital_id_card(
  p_card_id uuid,
  p_approved_by text,
  p_head_name text,
  p_signature_path text,
  p_pdf_sha256 text,
  p_approved_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id text;
begin
  select "ID_User"
    into v_user_id
  from public."Digital_ID_Cards"
  where "ID" = p_card_id
    and "Status" = 'PENDING'
  for update;

  if v_user_id is null then
    raise exception 'CARD_NOT_PENDING';
  end if;

  update public."Digital_ID_Cards"
  set "Status" = 'REVOKED',
      "Revoked_At" = p_approved_at,
      "Revoked_By" = p_approved_by,
      "Revocation_Reason" = 'REPLACED_BY_APPROVED_CARD',
      "Updated_At" = p_approved_at
  where "ID_User" = v_user_id
    and "Status" = 'ACTIVE';

  update public."Digital_ID_Cards"
  set "Status" = 'ACTIVE',
      "Approved_At" = p_approved_at,
      "Approved_By" = p_approved_by,
      "Head_SPPG_Name" = p_head_name,
      "Head_SPPG_Signature_Storage_Path" = p_signature_path,
      "ID_Card_PDF_SHA256" = p_pdf_sha256,
      "Updated_At" = p_approved_at
  where "ID" = p_card_id
    and "Status" = 'PENDING';

  if not found then
    raise exception 'CARD_NOT_PENDING';
  end if;
end;
$$;

revoke all on function public.approve_digital_id_card(uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.approve_digital_id_card(uuid, text, text, text, text, timestamptz) to service_role;

comment on column public."Digital_ID_Cards"."Requested_At" is
  'Timestamp when the employee requested issuance or renewal of the ID card.';
comment on column public."Digital_ID_Cards"."Head_SPPG_Name" is
  'Snapshot of the Head of SPPG name supplied by the approving administrator.';
comment on column public."Digital_ID_Cards"."Head_SPPG_Signature_Storage_Path" is
  'Private storage path of the Head of SPPG signature used on the approved card.';
