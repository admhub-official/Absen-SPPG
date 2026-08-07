-- Hardening for Employment Contracts v1.

alter table public."Users"
  drop constraint if exists users_nik_format_check;
alter table public."Users"
  add constraint users_nik_format_check
  check (
    "NIK" is null
    or btrim("NIK") = ''
    or "NIK" ~ '^[0-9]{16}$'
  );

alter table public."Employment_Contracts"
  drop constraint if exists employment_contract_dates_check;
alter table public."Employment_Contracts"
  add constraint employment_contract_dates_check
  check ("End_Date" is null or "End_Date" >= "Start_Date");

create unique index if not exists employment_contracts_one_open_primary_per_user
  on public."Employment_Contracts" ("ID_User")
  where "Document_Type" = 'PERJANJIAN_KERJA'
    and "Status" in ('DRAFT','WAITING_MITRA','WAITING_HEAD','WAITING_EMPLOYEE','SIGNED');

create or replace function public.enforce_contract_scoped_master_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_sppg text;
begin
  if new."Updated_By" is null or btrim(new."Updated_By") = '' then
    return new;
  end if;

  select upper(replace(coalesce("Role", ''), '_', ' ')), upper(btrim(coalesce("SPPG", '')))
    into v_role, v_sppg
  from public."Users"
  where "ID_User" = new."Updated_By"
    and coalesce("Status_Aktif", false) = true;

  if v_role = 'SUPER ADMIN' then
    return new;
  end if;

  if v_role <> 'ADMIN' or coalesce(v_sppg, '') = '' then
    raise exception 'MASTER_SCOPE_FORBIDDEN';
  end if;

  if tg_op = 'UPDATE' and old."SPPG_Scope" is null then
    raise exception 'GLOBAL_MASTER_REQUIRES_SUPER_ADMIN';
  end if;

  if tg_op = 'UPDATE'
     and old."SPPG_Scope" is not null
     and upper(btrim(old."SPPG_Scope")) <> v_sppg then
    raise exception 'MASTER_SCOPE_FORBIDDEN';
  end if;

  new."SPPG_Scope" := v_sppg;
  return new;
end;
$$;

create or replace function public.enforce_contract_sppg_master_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_sppg text;
begin
  if new."Updated_By" is null or btrim(new."Updated_By") = '' then
    return new;
  end if;

  select upper(replace(coalesce("Role", ''), '_', ' ')), upper(btrim(coalesce("SPPG", '')))
    into v_role, v_sppg
  from public."Users"
  where "ID_User" = new."Updated_By"
    and coalesce("Status_Aktif", false) = true;

  if v_role = 'SUPER ADMIN' then
    return new;
  end if;

  if v_role <> 'ADMIN'
     or coalesce(v_sppg, '') = ''
     or upper(btrim(coalesce(new."Nama_SPPG", ''))) <> v_sppg then
    raise exception 'MASTER_SCOPE_FORBIDDEN';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_contract_scoped_master_write() from public, anon, authenticated;
revoke all on function public.enforce_contract_sppg_master_write() from public, anon, authenticated;

-- ADMIN may create/update only SPPG-scoped overrides. Global rows stay under SUPER ADMIN.
do $$
declare
  t text;
begin
  foreach t in array array[
    'Master_Jabatan',
    'Master_Job_Description',
    'Master_Jam_Kerja',
    'Master_Employment_Terms',
    'Master_Contract_Compensation',
    'Master_SOP_References',
    'Master_Contract_Templates'
  ] loop
    execute format('drop trigger if exists contract_master_scope_guard on public.%I', t);
    execute format(
      'create trigger contract_master_scope_guard before insert or update on public.%I for each row execute function public.enforce_contract_scoped_master_write()',
      t
    );
  end loop;
end $$;

drop trigger if exists contract_sppg_master_scope_guard on public."Master_SPPG";
create trigger contract_sppg_master_scope_guard
before insert or update on public."Master_SPPG"
for each row execute function public.enforce_contract_sppg_master_write();

comment on function public.enforce_contract_scoped_master_write() is
  'For contract master UI writes: SUPER ADMIN may edit global data; ADMIN is forced to its own SPPG scope and cannot modify global masters.';
comment on index public.employment_contracts_one_open_primary_per_user is
  'Allows an existing ACTIVE agreement to remain valid while preventing multiple simultaneous draft/signing primary agreements for one employee.';