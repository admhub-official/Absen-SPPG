-- Employment Contracts / Perjanjian Kerja Digital v1
-- Service-role mediated module. Direct anon/authenticated access stays closed.

alter table public."Users"
  add column if not exists "NIK" text,
  add column if not exists "Alamat" text;

create unique index if not exists users_nik_unique_nonempty
  on public."Users" ("NIK")
  where nullif(btrim(coalesce("NIK", '')), '') is not null;

alter table public."Master_SPPG"
  add column if not exists "Kode_SPPG" text,
  add column if not exists "Alamat_SPPG" text,
  add column if not exists "Lokasi_SPPG" text,
  add column if not exists "Nama_Mitra" text,
  add column if not exists "Nama_Kepala_SPPG" text,
  add column if not exists "Updated_At" timestamptz not null default now(),
  add column if not exists "Updated_By" text;

create unique index if not exists master_sppg_code_unique_nonempty
  on public."Master_SPPG" (upper("Kode_SPPG"))
  where nullif(btrim(coalesce("Kode_SPPG", '')), '') is not null;

alter table public."Master_Jabatan"
  add column if not exists "Kode_Jabatan" text,
  add column if not exists "Divisi" text,
  add column if not exists "Updated_At" timestamptz not null default now(),
  add column if not exists "Updated_By" text;

create table if not exists public."Master_Job_Description" (
  "ID_Job_Description" text primary key,
  "ID_Master_Jabatan" text not null,
  "Nama_Jabatan" text not null,
  "Job_Description" text not null,
  "Version" integer not null default 1 check ("Version" > 0),
  "SPPG_Scope" text,
  "Aktif" boolean not null default true,
  "Created_At" timestamptz not null default now(),
  "Updated_At" timestamptz not null default now(),
  "Updated_By" text
);
create index if not exists master_job_description_lookup_idx
  on public."Master_Job_Description" ("ID_Master_Jabatan", "Aktif", "Version" desc);

create table if not exists public."Master_Jam_Kerja" (
  "ID_Jam_Kerja" text primary key,
  "ID_Master_Jabatan" text,
  "Nama_Jabatan" text,
  "Divisi" text,
  "Hari_Kerja" text not null default 'Sesuai jadwal operasional SPPG',
  "Jam_Masuk" time,
  "Jam_Pulang" time,
  "Keterangan" text,
  "SPPG_Scope" text,
  "Aktif" boolean not null default true,
  "Created_At" timestamptz not null default now(),
  "Updated_At" timestamptz not null default now(),
  "Updated_By" text
);
create index if not exists master_jam_kerja_lookup_idx
  on public."Master_Jam_Kerja" ("ID_Master_Jabatan", "Divisi", "SPPG_Scope", "Aktif");

create table if not exists public."Master_Employment_Terms" (
  "ID_Employment_Term" text primary key,
  "Nama_Status_Kerja" text not null,
  "Jenis_Kontrak" text not null check ("Jenis_Kontrak" in ('PKWT','PKWTT','RELAWAN','LAINNYA')),
  "Durasi_Default_Bulan" integer check ("Durasi_Default_Bulan" is null or "Durasi_Default_Bulan" > 0),
  "Keterangan" text,
  "SPPG_Scope" text,
  "Aktif" boolean not null default true,
  "Created_At" timestamptz not null default now(),
  "Updated_At" timestamptz not null default now(),
  "Updated_By" text
);

create table if not exists public."Master_Contract_Compensation" (
  "ID_Compensation" text primary key,
  "ID_Master_Jabatan" text,
  "Nama_Jabatan" text,
  "Jenis_Kontrak" text,
  "Gaji_Pokok" numeric(18,2),
  "Gaji_Bulanan" numeric(18,2),
  "Insentif_Default" numeric(18,2) not null default 0,
  "Keterangan" text,
  "SPPG_Scope" text,
  "Aktif" boolean not null default true,
  "Created_At" timestamptz not null default now(),
  "Updated_At" timestamptz not null default now(),
  "Updated_By" text
);

create table if not exists public."Master_SOP_References" (
  "ID_SOP" text primary key,
  "Kode_SOP" text,
  "Nama_SOP" text not null,
  "Deskripsi" text,
  "Urutan" integer not null default 0,
  "SPPG_Scope" text,
  "Aktif" boolean not null default true,
  "Created_At" timestamptz not null default now(),
  "Updated_At" timestamptz not null default now(),
  "Updated_By" text
);

create table if not exists public."Master_Contract_Templates" (
  "ID_Template" uuid primary key default gen_random_uuid(),
  "Nama_Template" text not null,
  "Version" integer not null check ("Version" > 0),
  "Document_Type" text not null default 'PERJANJIAN_KERJA',
  "Title" text not null,
  "Content_JSON" jsonb not null,
  "SPPG_Scope" text,
  "Aktif" boolean not null default true,
  "Effective_From" date not null default current_date,
  "Created_At" timestamptz not null default now(),
  "Updated_At" timestamptz not null default now(),
  "Updated_By" text,
  unique ("Nama_Template", "Version", "SPPG_Scope")
);
create index if not exists master_contract_templates_active_idx
  on public."Master_Contract_Templates" ("Aktif", "Effective_From" desc, "Version" desc);

create table if not exists public."Employment_Contract_Number_Sequences" (
  "SPPG_Code" text not null,
  "Year" integer not null,
  "Last_Number" integer not null default 0,
  "Updated_At" timestamptz not null default now(),
  primary key ("SPPG_Code", "Year")
);

create table if not exists public."Employment_Contracts" (
  "ID_Contract" uuid primary key default gen_random_uuid(),
  "Contract_Number" text not null unique,
  "Document_Type" text not null default 'PERJANJIAN_KERJA' check ("Document_Type" in ('PERJANJIAN_KERJA','ADDENDUM')),
  "Parent_Contract_ID" uuid references public."Employment_Contracts"("ID_Contract") on delete restrict,
  "ID_User" text not null,
  "SPPG" text not null,
  "SPPG_Code" text not null,
  "Contract_Date" date not null,
  "Start_Date" date not null,
  "End_Date" date,
  "Work_Status" text not null,
  "Contract_Type" text not null,
  "Template_ID" uuid not null references public."Master_Contract_Templates"("ID_Template") on delete restrict,
  "Template_Version" integer not null,
  "Template_Content_Snapshot" jsonb not null,
  "Snapshot" jsonb not null,
  "Status" text not null default 'DRAFT' check ("Status" in ('DRAFT','WAITING_MITRA','WAITING_HEAD','WAITING_EMPLOYEE','SIGNED','ACTIVE','ENDED','CANCELLED','SUPERSEDED')),
  "Signature_Progress" integer not null default 0 check ("Signature_Progress" between 0 and 3),
  "Final_PDF_Storage_Path" text,
  "Final_PDF_SHA256" text,
  "Public_Token_Hash" text unique,
  "Verification_Hint" text,
  "Created_By" text not null,
  "Created_At" timestamptz not null default now(),
  "Updated_At" timestamptz not null default now(),
  "Signed_At" timestamptz,
  "Activated_At" timestamptz,
  "Ended_At" timestamptz,
  "Cancelled_At" timestamptz,
  "Cancelled_By" text,
  "Cancellation_Reason" text
);
create index if not exists employment_contracts_user_idx on public."Employment_Contracts" ("ID_User", "Created_At" desc);
create index if not exists employment_contracts_sppg_status_idx on public."Employment_Contracts" ("SPPG", "Status", "Created_At" desc);
create unique index if not exists employment_contracts_one_active_per_user
  on public."Employment_Contracts" ("ID_User") where "Status" = 'ACTIVE' and "Document_Type" = 'PERJANJIAN_KERJA';

create table if not exists public."Employment_Contract_Signatures" (
  "ID_Signature" uuid primary key default gen_random_uuid(),
  "ID_Contract" uuid not null references public."Employment_Contracts"("ID_Contract") on delete cascade,
  "Signer_Role" text not null check ("Signer_Role" in ('MITRA','KEPALA_SPPG','KARYAWAN')),
  "Signer_User_ID" text,
  "Signer_Name" text not null,
  "Signature_Storage_Path" text not null,
  "Signed_At" timestamptz not null default now(),
  "Accepted_Statement" boolean not null default false,
  "Client_Metadata" jsonb not null default '{}'::jsonb,
  unique ("ID_Contract", "Signer_Role")
);

create table if not exists public."Employment_Contract_Audit_Log" (
  "ID_Audit" uuid primary key default gen_random_uuid(),
  "ID_Contract" uuid references public."Employment_Contracts"("ID_Contract") on delete set null,
  "ID_User_Actor" text,
  "Action" text not null,
  "Detail" jsonb not null default '{}'::jsonb,
  "Created_At" timestamptz not null default now()
);
create index if not exists employment_contract_audit_contract_idx on public."Employment_Contract_Audit_Log" ("ID_Contract", "Created_At" desc);

create or replace function public.next_employment_contract_number(p_sppg_code text, p_contract_date date)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_sppg_code,''), '[^A-Za-z0-9]', '', 'g'));
  v_year integer := extract(year from p_contract_date)::integer;
  v_month integer := extract(month from p_contract_date)::integer;
  v_next integer;
  v_roman text[] := array['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
begin
  if v_code = '' then raise exception 'SPPG_CODE_REQUIRED'; end if;
  insert into public."Employment_Contract_Number_Sequences" ("SPPG_Code","Year","Last_Number","Updated_At")
  values (v_code, v_year, 1, now())
  on conflict ("SPPG_Code","Year") do update
    set "Last_Number" = public."Employment_Contract_Number_Sequences"."Last_Number" + 1,
        "Updated_At" = now()
  returning "Last_Number" into v_next;
  return 'PK/SPPG-' || v_code || '/' || lpad(v_next::text, 4, '0') || '/' || v_roman[v_month] || '/' || v_year::text;
end;
$$;
revoke all on function public.next_employment_contract_number(text,date) from public, anon, authenticated;
grant execute on function public.next_employment_contract_number(text,date) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employment-contracts', 'employment-contracts', false, 15728640, array['application/pdf','image/png','image/jpeg'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Default employment terms.
insert into public."Master_Employment_Terms" ("ID_Employment_Term","Nama_Status_Kerja","Jenis_Kontrak","Durasi_Default_Bulan","Keterangan") values
('TERM_PKWTT','Karyawan','PKWTT',null,'Perjanjian kerja waktu tidak tertentu.'),
('TERM_PKWT12','Karyawan Kontrak','PKWT',12,'Perjanjian kerja waktu tertentu 12 bulan.'),
('TERM_RELAWAN','Relawan','RELAWAN',12,'Penempatan relawan sesuai kebijakan SPPG/Yayasan.')
on conflict ("ID_Employment_Term") do nothing;

-- SOP references from the agreed master contract.
insert into public."Master_SOP_References" ("ID_SOP","Kode_SOP","Nama_SOP","Urutan") values
('SOP_01','SOP-01','Penerimaan dan Pemeriksaan Bahan Pangan',1),('SOP_02','SOP-02','Penyimpanan Bahan Pangan',2),
('SOP_03','SOP-03','Persiapan Bahan Makanan',3),('SOP_04','SOP-04','Pengolahan Makanan',4),
('SOP_05','SOP-05','Pengawasan Mutu (Quality Control)',5),('SOP_06','SOP-06','Pemorsian',6),
('SOP_07','SOP-07','Pengemasan (Packing)',7),('SOP_08','SOP-08','Distribusi Makanan',8),
('SOP_09','SOP-09','Pencucian Peralatan',9),('SOP_10','SOP-10','Kebersihan Lingkungan',10),
('SOP_11','SOP-11','Higiene dan Sanitasi',11),('SOP_12','SOP-12','Keamanan Pangan',12),
('SOP_13','SOP-13','Keselamatan dan Kesehatan Kerja (K3)',13),('SOP_14','SOP-14','Pengelolaan Limbah',14),
('SOP_15','SOP-15','Administrasi dan Pelaporan Operasional',15)
on conflict ("ID_SOP") do nothing;

-- One canonical v1 template; employee/SPPG values are snapshotted at contract creation.
insert into public."Master_Contract_Templates" ("Nama_Template","Version","Title","Content_JSON","Aktif")
select 'PK SPPG MBG', 1, 'SURAT PERJANJIAN KERJA RELAWAN / KARYAWAN SPPG - PROGRAM MAKAN BERGIZI GRATIS (MBG)',
$json${
  "intro":"Perjanjian kerja antara Yayasan/Mitra dan Relawan/Karyawan SPPG untuk mendukung operasional Program Makan Bergizi Gratis (MBG).",
  "articles":[
    {"number":1,"title":"MAKSUD DAN TUJUAN","body":"Perjanjian ini dibuat sebagai dasar hubungan kerja antara Yayasan/Mitra dengan Relawan/Karyawan yang ditempatkan pada {{nama_sppg}} dalam rangka mendukung operasional Program Makan Bergizi Gratis (MBG). Relawan/Karyawan berkewajiban melaksanakan tugas secara profesional, disiplin, bertanggung jawab, serta mematuhi seluruh ketentuan operasional yang berlaku di lingkungan SPPG."},
    {"number":2,"title":"PENEMPATAN DAN JABATAN","body":"Relawan/Karyawan ditempatkan pada jabatan {{jabatan}} di {{nama_sppg}}. Tugas dan tanggung jawab jabatan mengikuti Master Jabatan dan Job Description yang berlaku pada saat kontrak dibuat.\n\n{{job_description}}"},
    {"number":3,"title":"JAM KERJA","body":"Jam kerja mengikuti jadwal operasional SPPG sesuai divisi masing-masing.\n\n{{jam_kerja}}\n\nJam operasional produksi, persiapan, distribusi, dan pencucian mengikuti jadwal yang telah ditetapkan oleh Kepala SPPG sesuai kebutuhan operasional MBG."},
    {"number":4,"title":"HAK DAN KEWAJIBAN","body":"Hak Karyawan:\n• Menerima upah sesuai ketentuan.\n• Mendapatkan perlengkapan kerja dan APD.\n• Mendapatkan pelatihan sesuai kebutuhan.\n• Mendapatkan lingkungan kerja yang aman.\n• Mendapatkan hak cuti dan istirahat sesuai ketentuan perusahaan.\n• Mendapatkan evaluasi kinerja secara berkala.\n\nKewajiban Karyawan:\n• Menjalankan pekerjaan sesuai Job Description.\n• Menjaga mutu pelayanan MBG.\n• Menjaga kerahasiaan data perusahaan.\n• Menjaga aset perusahaan.\n• Mematuhi seluruh SOP, Peraturan Perusahaan, dan Kode Etik."},
    {"number":5,"title":"PERATURAN PERUSAHAAN","body":"Seluruh Relawan/Karyawan wajib hadir tepat waktu sesuai jadwal kerja; menggunakan seragam dan APD; menjaga kebersihan area kerja; menjaga etika, sopan santun, dan profesionalisme; menjaga inventaris; mematuhi instruksi Kepala SPPG; tidak merokok di area produksi; tidak membawa pihak luar tanpa izin; tidak menyalahgunakan fasilitas; serta tidak melakukan tindakan yang merugikan Yayasan, SPPG, maupun Program MBG."},
    {"number":6,"title":"SOP OPERASIONAL SPPG","body":"Seluruh Relawan/Karyawan wajib memahami dan melaksanakan SOP Operasional SPPG yang menjadi bagian tidak terpisahkan dari Perjanjian Kerja ini. SOP mencakup penerimaan dan pemeriksaan bahan pangan, penyimpanan, persiapan, pengolahan, pengawasan mutu, pemorsian, pengemasan, distribusi, pencucian peralatan, kebersihan lingkungan, higiene dan sanitasi, keamanan pangan, K3, pengelolaan limbah, serta administrasi dan pelaporan operasional."},
    {"number":7,"title":"KODE ETIK","body":"Setiap Relawan/Karyawan wajib bekerja dengan jujur, disiplin, dan bertanggung jawab; mengutamakan kepentingan penerima manfaat; menjaga nama baik Yayasan dan SPPG; menghormati rekan kerja dan mitra; menolak gratifikasi dan penyalahgunaan wewenang; menjaga kerahasiaan seluruh data operasional; dan menjaga profesionalisme dalam setiap pelaksanaan tugas."},
    {"number":8,"title":"PENILAIAN KINERJA","body":"Penilaian dilakukan secara berkala oleh Kepala SPPG berdasarkan kehadiran, disiplin, kepatuhan terhadap SOP, kualitas pekerjaan, kerja sama tim, tanggung jawab, kebersihan area kerja, produktivitas, dan sikap kerja."},
    {"number":9,"title":"SANKSI","body":"Pelanggaran terhadap Perjanjian Kerja, Peraturan Perusahaan, SOP Operasional, maupun Kode Etik dapat dikenakan sanksi secara bertahap berupa Teguran Lisan, Surat Peringatan I (SP1), Surat Peringatan II (SP2), Surat Peringatan III (SP3), penghentian sementara, atau pemutusan hubungan kerja sesuai ketentuan perusahaan dan peraturan perundang-undangan."},
    {"number":10,"title":"PENUTUP","body":"Perjanjian Kerja ini berlaku sejak {{tanggal_mulai}} dan menjadi dasar hubungan kerja antara Yayasan, SPPG, dan Relawan/Karyawan. Dengan memberikan persetujuan melalui aplikasi dan membubuhkan tanda tangan elektronik, para pihak menyatakan telah membaca, memahami, dan menyetujui seluruh isi Perjanjian Kerja, Peraturan Perusahaan, SOP Operasional SPPG, serta Kode Etik yang menjadi satu kesatuan yang tidak terpisahkan dari dokumen ini."}
  ]
}$json$::jsonb, true
where not exists (select 1 from public."Master_Contract_Templates" where "Nama_Template"='PK SPPG MBG' and "Version"=1 and "SPPG_Scope" is null);

-- Service-role-only tables.
do $$ declare t text; begin
  foreach t in array array[
    'Master_Job_Description','Master_Jam_Kerja','Master_Employment_Terms','Master_Contract_Compensation',
    'Master_SOP_References','Master_Contract_Templates','Employment_Contract_Number_Sequences',
    'Employment_Contracts','Employment_Contract_Signatures','Employment_Contract_Audit_Log'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

comment on table public."Employment_Contracts" is 'Immutable-snapshot digital employment agreements with ordered signatures and final PDF verification.';
comment on column public."Employment_Contracts"."Snapshot" is 'Identity, SPPG, job, schedule, and compensation snapshot captured at contract creation; later profile/master edits do not mutate the signed agreement.';
