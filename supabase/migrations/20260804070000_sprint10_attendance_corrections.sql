create table if not exists public."Attendance_Corrections" (
  "Correction_ID" uuid primary key default gen_random_uuid(),
  "ID_User" text not null,
  "ID_Absensi" text,
  "Attendance_Date" date not null,
  "Correction_Type" text not null check ("Correction_Type" in ('MISSING_IN','MISSING_OUT','WRONG_TIME','WRONG_TYPE','OTHER')),
  "Requested_Values" jsonb not null default '{}'::jsonb,
  "Reason" text not null check (char_length("Reason") between 10 and 1000),
  "Evidence_URL" text,
  "Status" text not null default 'SUBMITTED' check ("Status" in ('SUBMITTED','IN_REVIEW','APPROVED','REJECTED','CANCELLED')),
  "Reviewer_ID" text,
  "Review_Notes" text,
  "Submitted_At" timestamptz not null default now(),
  "Reviewed_At" timestamptz,
  "Applied_At" timestamptz,
  "Created_At" timestamptz not null default now(),
  "Updated_At" timestamptz not null default now()
);
create index if not exists attendance_corrections_user_idx on public."Attendance_Corrections" ("ID_User", "Submitted_At" desc);
create index if not exists attendance_corrections_status_idx on public."Attendance_Corrections" ("Status", "Submitted_At" desc);

create or replace function public.apply_attendance_correction(p_correction_id uuid, p_reviewer_id text, p_status text, p_notes text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public."Attendance_Corrections"%rowtype; v_time timestamptz; v_type text; v_date date;
begin
  if p_status not in ('APPROVED','REJECTED') then raise exception 'INVALID_REVIEW_STATUS'; end if;
  select * into c from public."Attendance_Corrections" where "Correction_ID"=p_correction_id for update;
  if not found then raise exception 'CORRECTION_NOT_FOUND'; end if;
  if c."Status" in ('APPROVED','REJECTED','CANCELLED') then raise exception 'CORRECTION_ALREADY_FINAL'; end if;
  if p_status='APPROVED' then
    v_time := nullif(c."Requested_Values"->>'Waktu_Timestamp','')::timestamptz;
    v_type := nullif(c."Requested_Values"->>'Jenis_Absen','');
    v_date := nullif(c."Requested_Values"->>'Tanggal','')::date;
    if c."ID_Absensi" is not null then
      update public."Absensi" set
        "Waktu_Timestamp"=coalesce(v_time,"Waktu_Timestamp"),
        "Jenis_Absen"=coalesce(v_type,"Jenis_Absen"),
        "Tanggal"=coalesce(v_date,"Tanggal")
      where "ID_Absensi"::text=c."ID_Absensi" and "ID_User"::text=c."ID_User";
      if not found then raise exception 'ATTENDANCE_TARGET_NOT_FOUND'; end if;
    end if;
  end if;
  update public."Attendance_Corrections" set "Status"=p_status,"Reviewer_ID"=p_reviewer_id,"Review_Notes"=p_notes,
    "Reviewed_At"=now(),"Applied_At"=case when p_status='APPROVED' then now() else null end,"Updated_At"=now()
  where "Correction_ID"=p_correction_id;
  return jsonb_build_object('correctionId',p_correction_id,'status',p_status);
end $$;
revoke all on function public.apply_attendance_correction(uuid,text,text,text) from public;
grant execute on function public.apply_attendance_correction(uuid,text,text,text) to service_role;
