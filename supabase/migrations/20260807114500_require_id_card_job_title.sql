create or replace function public.require_id_card_job_title()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_title text;
begin
  select nullif(btrim(coalesce("Jabatan_Divisi", '')), '')
    into v_job_title
  from public."Users"
  where "ID_User" = new."ID_User";

  if v_job_title is null then
    raise exception 'ID_CARD_JOB_TITLE_REQUIRED'
      using errcode = '23514',
            hint = 'Lengkapi Jabatan / Divisi pada profil sebelum membuat ID Card.';
  end if;

  return new;
end;
$$;

drop trigger if exists digital_id_cards_require_job_title on public."Digital_ID_Cards";
create trigger digital_id_cards_require_job_title
before insert on public."Digital_ID_Cards"
for each row execute function public.require_id_card_job_title();

revoke all on function public.require_id_card_job_title() from public, anon, authenticated;

comment on function public.require_id_card_job_title() is
  'Mencegah penerbitan ID Card tanpa Jabatan_Divisi. Role akun tidak boleh menjadi fallback jabatan pada ID Card.';
